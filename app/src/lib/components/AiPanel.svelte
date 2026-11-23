<script lang="ts">
  import { fly } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import { app } from '../state.svelte';
  import { backend } from '../backend';
  import { ai, answerText, pieces, sourceLabel, SCOPES, type NoteSource, type Source, type Turn } from '../ai.svelte';
  import type { Section } from '../state.svelte';
  import ModelPicker from './ModelPicker.svelte';
  import { ease, ms } from '../motion';
  import { dayLabel, people, searchHistory, type HistItem } from '../aiExtras';

  /** Что показано: разговор или история вопросов */
  let view = $state<'chat' | 'history'>('chat');
  let hq = $state('');
  const found = $derived(searchHistory(ai.history, hq));
  const groups = $derived.by(() => {
    const out: { day: string; items: HistItem[] }[] = [];
    for (const h of found) {
      const day = dayLabel(h.at);
      if (out.at(-1)?.day !== day) out.push({ day, items: [] });
      out.at(-1)!.items.push(h);
    }
    return out;
  });
  const hhmm = (at: number) => new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  function openHist(h: HistItem) { ai.restore(h); view = 'chat'; }
  /** Начало ответа для списка — без ссылок и разметки */
  const gist = (h: HistItem) => h.a.replace(/\s*[[(](?:[SN]\d+(?:\s*[,;]\s*)?)+[\])]/g, '').replace(/\*\*/g, '').slice(0, 140);

  // «Спрашивать перед отправкой»: первый Enter показывает подтверждение, второй — отправляет
  let confirming = $state(false);
  let copied = $state('');
  async function copy(t: Turn) {
    try { await navigator.clipboard.writeText(ai.copyText(t)); copied = t.id; setTimeout(() => { if (copied === t.id) copied = ''; }, 1600); } catch { /* без буфера */ }
  }

  let input = $state('');
  let list: HTMLElement | undefined = $state();
  let field: HTMLTextAreaElement | undefined = $state();
  const scope = $derived<Section>(app.hasLaws ? app.section : 'project');
  const examples = $derived(scope === 'laws' ? [
    'Что грозит за убийство полицейского?',
    'Сколько дают за угон машины?',
    'Можно ли носить оружие без лицензии?',
    'Что будет за отказ выйти из машины по требованию полиции?',
  ] : [
    'Можно ли убить человека без причины?',
    'Что будет за оскорбление родных?',
    'Какое наказание за кражу машины?',
    'Можно ли грабить в зелёной зоне?',
  ]);


  // Новое сообщение и каждый кусочек ответа — прокрутка вниз
  $effect(() => {
    const last = ai.turns[ai.turns.length - 1];
    last?.a; last?.error; ai.turns.length;
    if (list) requestAnimationFrame(() => list!.scrollTo({ top: list!.scrollHeight }));
  });
  $effect(() => { if (ai.ready) field?.focus(); });

  // Z.ai подолгу держит вопрос в очереди — показываем, сколько уже ждём
  const slow = $derived(ai.provider === 'zai');
  let waited = $state(0);
  $effect(() => {
    if (!ai.busy) { waited = 0; return; }
    const started = Date.now();
    const timer = setInterval(() => (waited = Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  });


  function send(text = input, sure = false) {
    if (!text.trim() || ai.busy) return;
    if (ai.confirmSend && !sure && text === input) { confirming = true; return; }
    confirming = false;
    view = 'chat';
    ai.ask(text);
    input = '';
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input, confirming); }
    else if (e.key === 'Escape' && confirming) { e.preventDefault(); e.stopPropagation(); confirming = false; }
    else if (confirming) confirming = false;
  }

  function open(s: Source) {
    app.query = '';
    app.open(s.entry.doc.id, s.entry.node.id);
  }

  /** Источники, на которые ответ действительно сослался (их показываем под ответом) */
  function cited(t: Turn): Source[] {
    const used = new Set(pieces(t.a).flatMap((p) => (p.t === 'ref' && p.kind === 's' ? [p.n] : [])));
    return t.sources.filter((s) => used.has(s.n));
  }
  /** Разъяснения, на которые сослался ответ */
  function citedNotes(t: Turn): NoteSource[] {
    const used = new Set(pieces(t.a).flatMap((p) => (p.t === 'ref' && p.kind === 'n' ? [p.n] : [])));
    return (t.notes ?? []).filter((s) => used.has(s.n));
  }
  const short = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}…` : text);
</script>

<aside class="ai" transition:fly={{ x: 24, duration: ms(220), easing: ease }} aria-label="ИИ-помощник">
  <header>
    <span class="title"><Icon name="spark" size={17} /> ИИ-помощник</span>
    <span class="tools">
      {#if ai.ready}
        <button class="tool" class:on={view === 'history'} title="История вопросов" aria-label="История вопросов" aria-pressed={view === 'history'} onclick={() => (view = view === 'history' ? 'chat' : 'history')}><Icon name="history" size={16} /></button>
      {/if}
      {#if ai.turns.length && view === 'chat'}
        <button class="tool" title="Начать заново" aria-label="Начать заново" onclick={() => ai.clear()} disabled={ai.busy}><Icon name="refresh" size={15} /></button>
      {/if}
      <button class="tool" aria-label="Закрыть" onclick={() => (app.aiOpen = false)}><Icon name="close" size={16} /></button>
    </span>
  </header>

  {#if !ai.ready}
    <div class="body">
      <div class="setup-card">
        <span class="ico"><Icon name="spark" size={22} /></span>
        <h2>Помощник не настроен</h2>
        <p>Чтобы задавать вопросы своими словами, подключите бесплатный ключ нейросети. Это займёт 2 минуты — программа проведёт по шагам.</p>
        <button class="btn primary wide" onclick={() => (ai.setupOpen = true)}>Настроить</button>
      </div>
    </div>
  {:else if view === 'history'}
    <div class="body hist">
      <label class="hsearch"><Icon name="search" size={15} /><input bind:value={hq} placeholder="Найти в истории…" aria-label="Найти в истории" /></label>
      {#if !ai.history.length}
        <div class="hempty"><Icon name="history" size={22} /><b>Здесь будут ваши вопросы</b><span>Всё, о чём вы спросите помощника, сохранится на этом компьютере — последние 200 вопросов.</span></div>
      {:else if !found.length}
        <div class="hempty"><b>Ничего не нашлось</b><span>Попробуйте другое слово.</span></div>
      {:else}
        {#each groups as g (g.day)}
          <p class="hday">{g.day}</p>
          {#each g.items as h (h.id)}
            <div class="hitem">
              <button class="hopen" onclick={() => openHist(h)}>
                <span class="hq">{#if h.nick}<Icon name="idcheck" size={14} />{/if}{h.q}</span>
                <span class="ha">{h.nick ? (h.nick.verdict === 'ok' ? 'Ник подходит' : h.nick.verdict === 'bad' ? 'Ник не подходит' : 'Ник спорный') : gist(h)}</span>
                <span class="hmeta">{hhmm(h.at)} · {h.nick ? 'проверка ника' : h.scope === 'laws' ? 'законы' : 'правила'}{#if h.rating}<span class="hrate" class:down={h.rating === 'down'}><Icon name={h.rating === 'up' ? 'thumbup' : 'thumbdown'} size={12} /></span>{/if}</span>
              </button>
              <button class="hdel" title="Убрать из истории" aria-label="Убрать из истории" onclick={() => ai.forget(h.id)}><Icon name="close" size={13} /></button>
            </div>
          {/each}
        {/each}
      {/if}
    </div>
  {:else}
    <div class="body" bind:this={list}>
      {#if !ai.turns.length}
        <p class="lead">{scope === 'laws' ? 'Спросите своими словами — помощник ответит по законам штата и покажет статьи, на которые опирается.' : 'Спросите своими словами — помощник ответит по правилам проекта и покажет пункты, на которые опирается.'}</p>
        <div class="examples">
          {#each examples as q (q)}<button onclick={() => send(q, true)}>{q}</button>{/each}
        </div>
        <p class="nickhint"><Icon name="idcheck" size={15} /><span>Можно проверить ник — просто напишите его, например <b>Ivan_Petrov</b></span></p>
      {/if}

      {#each ai.turns as t (t.id)}
        <div class="q selectable">{t.q}</div>
        <div class="a" aria-live="polite">
          {#if t.error}
            <p class="error selectable"><Icon name="alert" size={15} />{t.error}</p>
            <div class="err-actions">
              <button class="btn sm" onclick={() => { ai.turns = ai.turns.filter((x) => x !== t); ai.ask(t.q); }} disabled={ai.busy}>Спросить снова</button>
              {#if t.error.includes('Z.ai') && ai.status?.provider !== 'Z.ai'}<button class="btn sm primary" onclick={() => (ai.setupOpen = true)}>Подключить Z.ai</button>{/if}
            </div>
          {:else if t.nick}
            {@const n = t.nick}
            <div class="nick">
              <div class="nhead">
                <span class="nname selectable">{n.nick}</span>
                {#if n.verdict === null}<span class="nv wait"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>проверяю</span>
                {:else}<span class="nv {n.verdict}">{n.verdict === 'ok' ? 'Подходит' : n.verdict === 'bad' ? 'Не подходит' : 'Спорно'}</span>{/if}
              </div>
              <ul class="nlist">
                {#each n.format as f (f.label)}<li class:bad={!f.ok}><Icon name={f.ok ? 'check' : 'close'} size={13} />{f.label}</li>{/each}
                {#if n.names}
                  {@const [fn = '', ln = ''] = n.nick.split('_')}
                  {#each [{ c: n.names.first, w: fn, what: 'Имя' }, { c: n.names.last, w: ln, what: 'Фамилия' }] as x (x.what)}
                    {#if x.c === null}<li class="doubt"><Icon name="alert" size={13} />{x.what} не проверено — forebears.io не ответил</li>
                    {:else if x.c > 0}<li><Icon name="check" size={13} /><span>{x.what} <b>{x.w}</b> есть в жизни — у {people(x.c)} человек</span></li>
                    {:else}<li class="doubt"><Icon name="alert" size={13} /><span>{x.what} <b>{x.w}</b> не нашлась на forebears.io — выдуманные разрешены, если вписываются в RP</span></li>{/if}
                  {/each}
                {/if}
                {#if n.verdict !== null}
                  {#if n.issues.length}
                    {#each n.issues as i (i)}<li class:bad={n.verdict === 'bad'} class:doubt={n.verdict !== 'bad'}><Icon name="alert" size={13} />{i}</li>{/each}
                  {:else if n.verdict === 'ok'}<li><Icon name="check" size={13} />Без скрытого смысла, мата и чужих имён</li>{/if}
                {/if}
              </ul>
              {#if t.sources[0] && n.verdict !== null}
                {@const s0 = t.sources[0]}
                <button class="src" onclick={() => open(s0)}><span class="num">{sourceLabel(s0).num}</span><span class="doc">{sourceLabel(s0).doc}</span><Icon name="chevron" size={13} /></button>
                {#if n.verdict !== 'ok' && s0.entry.node.punishments[0]}<p class="npun"><b>Наказание:</b> {s0.entry.node.punishments[0].raw.split('|')[0]?.trim()}</p>{/if}
              {/if}
              {#if n.names}<p class="nsrc">Имена проверены по <button class="link" onclick={() => backend.openUrl(`https://forebears.io/surnames/${n.nick.split('_')[1]?.toLowerCase() ?? ''}`)}>forebears.io</button> — его советует п. 2.13</p>{/if}
              {#if n.verdict === 'doubt'}<p class="nnote">Окончательно решает администрация. Смысл и звучание ника нейросеть оценивает приблизительно.</p>{/if}
            </div>
            {#if !t.pending}
              <div class="acts">
                <button class="act" onclick={() => copy(t)} title="Скопировать итог проверки"><Icon name={copied === t.id ? 'check' : 'copy'} size={14} />{copied === t.id ? 'Скопировано' : 'Копировать'}</button>
                <span class="rate">
                  <button class="act icon" class:on={t.rating === 'up'} onclick={() => ai.rate(t, 'up')} title="Проверка верная" aria-label="Проверка верная" aria-pressed={t.rating === 'up'}><Icon name="thumbup" size={15} /></button>
                  <button class="act icon down" class:on={t.rating === 'down'} onclick={() => ai.rate(t, 'down')} title="Проверка ошиблась" aria-label="Проверка ошиблась" aria-pressed={t.rating === 'down'}><Icon name="thumbdown" size={15} /></button>
                </span>
              </div>
            {/if}
          {:else if !t.a}
            <p class="thinking"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>{t.sources.length ? `Читаю ${t.sources.length} пунктов…` : `Ищу в разделе «${SCOPES[t.scope ?? 'project'].label}»…`}{#if slow && waited >= 2}<span class="secs">{waited} с</span>{/if}</p>
            {#if slow && waited >= 3}
              <p class="wait-note">Бесплатные серверы Z.ai загружены — ответ может занять до минуты. Быстрее отвечает Groq, но он не работает в России и СНГ.</p>
            {/if}
          {:else}
            {#if t.debate}<p class="kind"><Icon name="scale" size={13} />Разбор вашего довода</p>{/if}
            <p class="text selectable">
              {#each pieces(answerText(t.a)) as p, i (i)}
                {#if p.t === 'bold'}<b>{p.v}</b>
                {:else if p.t === 'ref' && p.kind === 'n'}
                  {@const ns = t.notes?.find((x) => x.n === p.n)}
                  {#if ns}<span class="ref note" title={ns.note.text}>Разъяснение</span>{/if}
                {:else if p.t === 'ref'}
                  {@const s = t.sources.find((x) => x.n === p.n)}
                  {#if s}<button class="ref" onclick={() => open(s)} title="{sourceLabel(s).doc}, {sourceLabel(s).num}">{sourceLabel(s).num}</button>{/if}
                {:else}{p.v}{/if}
              {/each}
            </p>
            {#if !t.pending && (cited(t).length || citedNotes(t).length)}
              <div class="sources">
                {#each citedNotes(t) as s (`n${s.n}`)}
                  <p class="src note" title={s.note.text}><span class="num">Разъяснение</span><span class="doc">{short(s.note.text)}</span></p>
                {/each}
                {#each cited(t) as s (s.n)}
                  <button class="src" onclick={() => open(s)}>
                    <span class="num">{sourceLabel(s).num}</span><span class="doc">{sourceLabel(s).doc}</span><Icon name="chevron" size={13} />
                  </button>
                {/each}
              </div>
            {/if}
            {#if t.learnState === 'checking'}
              <p class="learn wait"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>Сверяю довод с законом…</p>
            {:else if t.learnState === 'sent'}
              <p class="learn"><Icon name="check" size={14} />{t.verdict?.agree
                ? 'Ваше толкование отправлено на проверку. Если его примут, помощник будет так отвечать всем игрокам.'
                : 'Ваш довод передан на проверку команде. Если помощник ошибся, его поправят.'}</p>
            {/if}
            {#if !t.pending && !t.debate}
              <div class="acts">
                <button class="act" onclick={() => copy(t)} title="Скопировать ответ — например, для репорта"><Icon name={copied === t.id ? 'check' : 'copy'} size={14} />{copied === t.id ? 'Скопировано' : 'Копировать'}</button>
                <button class="act" onclick={() => send(t.q, true)} disabled={ai.busy} title="Задать этот вопрос снова и получить свежий ответ"><Icon name="refresh" size={14} />Спросить снова</button>
                <span class="rate">
                  <button class="act icon" class:on={t.rating === 'up'} onclick={() => ai.rate(t, 'up')} title="Ответ помог" aria-label="Ответ помог" aria-pressed={t.rating === 'up'}><Icon name="thumbup" size={15} /></button>
                  <button class="act icon down" class:on={t.rating === 'down'} onclick={() => ai.rate(t, 'down')} title="Ответ не помог" aria-label="Ответ не помог" aria-pressed={t.rating === 'down'}><Icon name="thumbdown" size={15} /></button>
                </span>
              </div>
              {#if t.rating === 'down'}<p class="thanks">Спасибо — так мы видим, где помощник ошибается. Если хотите поспорить с ответом, просто напишите свой довод.</p>{/if}
            {/if}
            {#if app.devMode && !t.pending}
              <!-- Только в режиме разработчика: что выбрала нейросеть и что нашёл поиск -->
              <details class="debug">
                <summary>Поиск: {t.sources.length} пунктов</summary>
                {#if t.plan}
                  <p><b>Документы:</b> {t.plan.docs.length ? t.plan.docs.join('; ') : 'не выбраны'}</p>
                  <p><b>Слова:</b> {t.plan.keywords || '—'}</p>
                {/if}
                {#if t.time}
                  <p><b>Время:</b> {[t.time.plan !== undefined ? `выбор документов ${t.time.plan} с` : 'без выбора документов', t.time.first !== undefined ? `первые слова ${t.time.first} с` : '', t.time.total !== undefined ? `весь ответ ${t.time.total} с` : ''].filter(Boolean).join(' · ')} · {t.model ?? ai.status?.provider}</p>
                {/if}
                <ol>
                  {#each t.sources as s (s.n)}
                    <li><button onclick={() => open(s)}>S{s.n} · {sourceLabel(s).num} · {sourceLabel(s).doc}</button></li>
                  {/each}
                </ol>
              </details>
            {/if}
          {/if}
        </div>
      {/each}
    </div>

    <footer>
      {#if app.hasLaws}
        <p class="scopebar"><Icon name={scope === 'laws' ? 'scale' : 'scroll'} size={14} /><span>Отвечаю по <b>{scope === 'laws' ? `законам сервера ${app.serverName}` : 'правилам проекта'}</b>. {scope === 'laws' ? 'Правила' : 'Законы'} — переключатель слева вверху</span></p>
      {/if}
      {#if confirming}
        <p class="confirm"><Icon name="chat" size={14} /><span>Отправить вопрос? <b>Enter</b> — да, <b>Esc</b> — нет</span></p>
      {/if}
      <div class="input" class:confirm-on={confirming}>
        <textarea bind:this={field} bind:value={input} onkeydown={onKey} rows="1" placeholder={scope === 'laws' ? 'Вопрос по законам штата…' : 'Вопрос по правилам проекта…'} maxlength="600" disabled={ai.busy}></textarea>
        <button class="send" onclick={() => send(input, true)} disabled={ai.busy || !input.trim()} aria-label="Спросить"><Icon name="chevron" size={18} /></button>
      </div>
      <div class="foot">
        <p class="note">Подсказка. Окончательно решает администрация.</p>
        <ModelPicker />
      </div>
    </footer>
  {/if}
</aside>

<style>
  .ai { width: 380px; flex-shrink: 0; display: flex; flex-direction: column; border-left: 1px solid var(--border); background: var(--surface); min-height: 0; }
  header { display: flex; align-items: center; justify-content: space-between; height: 52px; padding: 0 8px 0 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .title { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: var(--fs-md); }
  .title :global(svg) { color: var(--accent); }
  .tools { display: flex; gap: 2px; }
  .tool { display: grid; place-items: center; width: 30px; height: 30px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-dim); }
  .tool:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
  .body { flex: 1; min-height: 0; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
  .lead { margin: 0 0 4px; font-size: var(--fs-sm); color: var(--text-dim); }
  .examples { display: flex; flex-direction: column; gap: 6px; }
  .examples button { text-align: left; padding: 10px 12px; border-radius: 12px 12px 12px 4px; background: var(--surface-2); border: 1px solid var(--border); font-size: var(--fs-sm); color: var(--text-dim); }
  .examples button:hover { border-color: var(--accent-line); color: var(--text); }

  .setup-card { display: flex; flex-direction: column; align-items: flex-start; padding: 18px; border-radius: var(--radius-lg); background: var(--accent-glow), var(--surface-2); border: 1px solid var(--accent-line); }
  .setup-card .ico { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; background: var(--accent); color: var(--on-accent); margin-bottom: 12px; }
  .setup-card h2 { margin: 0 0 8px; font-size: var(--fs-lg); font-weight: 800; }
  .setup-card p { margin: 0 0 14px; font-size: var(--fs-sm); color: var(--text-dim); }

  .q { align-self: flex-end; max-width: 88%; padding: 9px 12px; border-radius: 14px 14px 4px 14px; background: var(--accent); color: var(--on-accent); font-size: var(--fs-sm); font-weight: 600; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  .q::selection { background: var(--on-accent); color: var(--accent); }
  .a { align-self: stretch; padding: 12px 14px; border-radius: 14px 14px 14px 4px; background: var(--surface-2); border: 1px solid var(--border); font-size: var(--fs-sm); line-height: 1.6; }
  .text { margin: 0; color: var(--text); white-space: pre-wrap; }
  .text b { color: var(--accent-soft); }
  .ref { display: inline-flex; align-items: center; height: 20px; margin: 0 2px; padding: 0 6px; vertical-align: 1px; border: 0; border-radius: 5px; background: var(--accent-tint); color: var(--accent); font-size: 11.5px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .ref:hover { background: var(--accent); color: var(--on-accent); }
  .ref.note { background: var(--info-tint); color: var(--info); cursor: help; }
  .kind { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; font-size: 11.5px; font-weight: 800; color: var(--text-muted); }
  .kind :global(svg) { color: var(--accent); }
  .src.note { margin: 0 -8px; cursor: help; }
  .src.note:hover { background: none; color: var(--text-dim); }
  .src.note .num { background: var(--info-tint); color: var(--info); }
  .learn { display: flex; gap: 8px; align-items: flex-start; margin: 10px 0 0; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--success-tint); color: var(--success); font-size: var(--fs-xs); line-height: 1.45; }
  .learn :global(svg) { flex-shrink: 0; margin-top: 1px; }
  .learn.wait { background: var(--surface-3); color: var(--text-muted); align-items: center; }
  .sources { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
  .src { display: flex; align-items: center; gap: 8px; padding: 6px 8px; margin: 0 -8px; border: 0; border-radius: var(--radius-sm); background: none; text-align: left; color: var(--text-dim); font-size: var(--fs-xs); }
  .src:hover { background: var(--surface-3); color: var(--text); }
  .src .num { flex-shrink: 0; padding: 2px 6px; border-radius: 5px; background: var(--accent-tint); color: var(--accent); font-weight: 800; }
  .src .doc { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .debug { margin-top: 10px; padding: 8px 10px; border-radius: var(--radius-sm); border: 1px dashed var(--border-strong); font-size: 11.5px; color: var(--text-muted); }
  .debug summary { cursor: pointer; color: var(--accent-soft); font-weight: 700; }
  .debug p { margin: 6px 0 0; }
  .debug ol { margin: 6px 0 0; padding-left: 18px; }
  .debug li button { border: 0; background: none; padding: 1px 0; color: var(--text-dim); text-align: left; font-size: 11.5px; }
  .debug li button:hover { color: var(--accent-soft); }
  .thinking { display: flex; align-items: center; gap: 10px; margin: 0; color: var(--text-muted); }
  .secs { margin-left: auto; font-size: var(--fs-xs); font-variant-numeric: tabular-nums; color: var(--text-muted); }
  .wait-note { margin: 10px 0 0; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--accent-tint); color: var(--accent-soft); font-size: var(--fs-xs); line-height: 1.45; }
  .dots { display: inline-flex; gap: 4px; }
  .dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: blink 1s ease-in-out infinite; }
  .dots i:nth-child(2) { animation-delay: 0.15s; }
  .dots i:nth-child(3) { animation-delay: 0.3s; }
  @keyframes blink { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
  .err-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .error { display: flex; gap: 8px; align-items: flex-start; margin: 0 0 10px; color: var(--danger); }
  .error :global(svg) { flex-shrink: 0; margin-top: 3px; }

  footer { padding: 10px 12px 12px; border-top: 1px solid var(--border); flex-shrink: 0; }
  .input { display: flex; align-items: flex-end; gap: 6px; padding: 5px 5px 5px 12px; border-radius: var(--radius); background: var(--bg); border: 1px solid var(--border-strong); }
  .input:focus-within { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-tint); }
  textarea { flex: 1; min-width: 0; min-height: 32px; max-height: 120px; padding: 6px 0; resize: none; field-sizing: content; border: 0; outline: 0; background: none; color: var(--text); font: inherit; font-size: var(--fs-sm); line-height: 1.45; }
  .send { display: grid; place-items: center; width: 34px; height: 34px; flex-shrink: 0; border: 0; border-radius: var(--radius-sm); background: var(--accent); color: var(--on-accent); }
  .send:disabled { background: var(--surface-3); color: var(--text-muted); }
  .scopebar { display: flex; align-items: flex-start; gap: 7px; margin: 0 0 8px; padding: 7px 10px; border-radius: var(--radius-sm); background: var(--accent-tint); color: var(--accent-soft); font-size: var(--fs-xs); line-height: 1.4; }
  .scopebar :global(svg) { flex-shrink: 0; margin-top: 1px; }
  .scopebar b { color: var(--text); }
  .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
  .note { margin: 0 2px; font-size: 11px; line-height: 1.35; color: var(--text-muted); }

  .tool.on { background: var(--accent-tint); color: var(--accent); }
  .nickhint { display: flex; align-items: center; gap: 8px; margin: 6px 0 0; font-size: var(--fs-xs); color: var(--text-muted); }
  .nickhint :global(svg) { color: var(--accent); flex-shrink: 0; }
  .nickhint b { color: var(--text-dim); }
  /* Действия под ответом */
  .acts { display: flex; align-items: center; gap: 2px; margin: 10px -6px -4px; }
  .act { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-muted); font-size: 12px; font-weight: 700; }
  .act:hover:not(:disabled) { background: var(--surface-3); color: var(--text); }
  .act.icon { width: 28px; padding: 0; justify-content: center; }
  .act.on { color: var(--success); background: var(--success-tint); }
  .act.down.on { color: var(--danger); background: var(--danger-tint, rgba(255, 90, 95, 0.12)); }
  .rate { margin-left: auto; display: flex; gap: 2px; }
  .thanks { margin: 8px 0 0; font-size: var(--fs-xs); color: var(--text-muted); line-height: 1.45; }
  /* Проверка ника */
  .nick { display: flex; flex-direction: column; gap: 10px; }
  .nhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .nname { font-size: 17px; font-weight: 800; letter-spacing: 0.01em; overflow-wrap: anywhere; }
  .nv { flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; }
  .nv.ok { background: var(--success-tint); color: var(--success); }
  .nv.bad { background: var(--danger-tint, rgba(255, 90, 95, 0.12)); color: var(--danger); }
  .nv.doubt { background: var(--accent-tint); color: var(--accent-soft); }
  .nv.wait { background: var(--surface-3); color: var(--text-muted); font-weight: 700; }
  .nlist { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 5px; font-size: var(--fs-xs); color: var(--text-dim); }
  .nlist li { display: flex; align-items: flex-start; gap: 7px; line-height: 1.4; }
  .nlist li :global(svg) { flex-shrink: 0; margin-top: 2px; color: var(--success); }
  .nlist li.bad { color: var(--text); }
  .nlist li.bad :global(svg) { color: var(--danger); }
  .nlist li.doubt :global(svg) { color: var(--accent); }
  .nlist li b { color: var(--text); font-weight: 700; }
  .nsrc { margin: -2px 0 0; font-size: 11px; color: var(--text-muted); }
  .nsrc .link { padding: 0; border: 0; background: none; color: var(--text-dim); font: inherit; text-decoration: underline; cursor: pointer; }
  .nick .src { margin: 0 -8px; }
  .npun { margin: -4px 0 0; padding: 6px 9px; border-radius: var(--radius-sm); background: var(--danger-tint); color: #ffb3b6; font-size: var(--fs-xs); line-height: 1.4; }
  .npun b { color: var(--danger); }
  .nnote { margin: 0; font-size: 11.5px; color: var(--text-muted); line-height: 1.4; }
  /* История */
  .hist { gap: 4px; }
  .hsearch { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px; margin-bottom: 6px; border-radius: var(--radius-sm); background: var(--bg); border: 1px solid var(--border-strong); color: var(--text-muted); flex-shrink: 0; }
  .hsearch:focus-within { border-color: var(--accent-line); }
  .hsearch input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; color: var(--text); font: inherit; font-size: var(--fs-sm); }
  .hday { margin: 10px 2px 4px; font-size: 11.5px; font-weight: 800; color: var(--text-muted); }
  .hday:first-of-type { margin-top: 2px; }
  .hitem { position: relative; }
  .hopen { width: 100%; display: flex; flex-direction: column; gap: 3px; padding: 9px 30px 9px 10px; border: 1px solid transparent; border-radius: var(--radius-sm); background: none; text-align: left; color: var(--text); }
  .hopen:hover { background: var(--surface-2); border-color: var(--border); }
  .hq { display: flex; align-items: center; gap: 6px; font-size: var(--fs-sm); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hq :global(svg) { flex-shrink: 0; color: var(--accent); }
  .ha { font-size: var(--fs-xs); color: var(--text-dim); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .hmeta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); }
  .hrate { display: inline-grid; color: var(--success); }
  .hrate.down { color: var(--danger); }
  .hdel { position: absolute; top: 8px; right: 6px; display: grid; place-items: center; width: 22px; height: 22px; border: 0; border-radius: 6px; background: none; color: var(--text-muted); opacity: 0; }
  .hitem:hover .hdel, .hdel:focus-visible { opacity: 1; }
  .hdel:hover { background: var(--surface-3); color: var(--text); }
  .hempty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 40px 16px; text-align: center; color: var(--text-muted); font-size: var(--fs-xs); }
  .hempty b { color: var(--text-dim); font-size: var(--fs-sm); }
  /* Подтверждение отправки */
  .confirm { display: flex; align-items: center; gap: 7px; margin: 0 0 8px; padding: 7px 10px; border-radius: var(--radius-sm); background: var(--accent-tint); color: var(--accent-soft); font-size: var(--fs-xs); }
  .confirm b { color: var(--text); }
  .input.confirm-on { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-tint); }

  @media (max-width: 899px) {
    .ai { position: absolute; top: 0; right: 0; bottom: 0; z-index: 30; width: min(380px, 100%); box-shadow: -8px 0 24px rgba(0, 0, 0, 0.5); }
  }
</style>
