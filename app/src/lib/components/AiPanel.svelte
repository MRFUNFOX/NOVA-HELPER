<script lang="ts">
  import { fly } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import { app } from '../state.svelte';
  import { backend } from '../backend';
  import { ai, answerText, otherScope, pieces, sourceLabel, SCOPES, type NoteSource, type Source, type Turn } from '../ai.svelte';
  import type { Section } from '../state.svelte';
  import ModelPicker from './ModelPicker.svelte';
  import { ease, ms } from '../motion';
  import { dayLabel, people, searchHistory, type HistItem } from '../aiExtras';
  import { learn } from '../learn.svelte';
  import { mic } from '../voice.svelte';

  /** Рассуждения модели: [S2] → номер пункта, [N1] → «разъяснение» — как в ответе */
  function thoughts(t: Turn) {
    return (t.think ?? '').trim().replace(/\[\s*([SN])(\d+)\s*\]/g, (m, k: string, n: string) => {
      if (k === 'N') return '(разъяснение)';
      const src = t.sources.find((x) => x.n === Number(n));
      return src ? `(${sourceLabel(src).num} ${sourceLabel(src).doc})` : '';
    });
  }

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

  // Вопрос голосом: распознанный текст — в поле, игрок правит и отправляет сам
  $effect(() => {
    void mic.init((text) => {
      input = input.trim() ? `${input.trim()} ${text}` : text;
      requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(input.length, input.length); });
    });
    return () => mic.cancel();
  });
  const mb = (b: number) => Math.round(b / 1e6);
  let list: HTMLElement | undefined = $state();
  let field: HTMLTextAreaElement | undefined = $state();
  const scope = $derived<Section>(app.hasLaws ? ai.scope : 'project');
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
  let now = $state(Date.now());
  $effect(() => {
    if (!ai.busy) { waited = 0; return; }
    const started = Date.now();
    const timer = setInterval(() => { now = Date.now(); waited = Math.floor((now - started) / 1000); }, 1000);
    return () => clearInterval(timer);
  });


  function send(text = input, sure = false, as?: Section) {
    if (!text.trim() || ai.busy) return;
    if (ai.confirmSend && !sure && text === input) { confirming = true; return; }
    confirming = false;
    view = 'chat';
    ai.ask(text, as);
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
            {@const left = t.waitUntil ? Math.max(1, Math.ceil((t.waitUntil - now) / 1000)) : 0}
            <p class="thinking"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>{left ? `Жду бесплатный лимит ${ai.status?.provider ?? 'Groq'}… ${left} с` : t.stage === 'plan' ? 'Разбираю ситуацию…' : t.think ? 'Обдумываю ответ…' : t.sources.length ? `Читаю ${t.sources.length} пунктов…` : `Ищу в разделе «${SCOPES[t.scope ?? 'project'].label}»…`}{#if slow && waited >= 2}<span class="secs">{waited} с</span>{/if}</p>
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
            {#if t.stage === 'check'}
              <p class="learn wait"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>Перепроверяю ответ…</p>
            {:else if t.checked?.fixed && !t.pending}
              {#if learn.staffHere && t.checked.problems.length}
                <details class="learn fixed"><summary><Icon name="check" size={14} /><span>Ответ поправлен после перепроверки</span></summary><ul>{#each t.checked.problems as p}<li>{p}</li>{/each}</ul></details>
              {:else}
                <p class="learn"><Icon name="check" size={14} /><span>Ответ поправлен после перепроверки</span></p>
              {/if}
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
                {#if !t.detail && t === ai.turns.at(-1)}
                  <button class="act" onclick={() => ai.more(t)} disabled={ai.busy} title="Объяснить логику: какой пункт, почему, какие исключения"><Icon name="chat" size={14} />Подробнее</button>
                {/if}
                <button class="act" onclick={() => copy(t)} title="Скопировать ответ — например, для репорта"><Icon name={copied === t.id ? 'check' : 'copy'} size={14} />{copied === t.id ? 'Скопировано' : 'Копировать'}</button>
                <button class="act icon" onclick={() => send(t.detail ? (ai.turns.at(-2)?.q ?? t.q) : t.q, true)} disabled={ai.busy} title="Спросить снова и получить свежий ответ" aria-label="Спросить снова"><Icon name="refresh" size={14} /></button>
                <span class="rate">
                  <button class="act icon" class:on={t.rating === 'up'} onclick={() => ai.rate(t, 'up')} title="Ответ помог" aria-label="Ответ помог" aria-pressed={t.rating === 'up'}><Icon name="thumbup" size={15} /></button>
                  <button class="act icon down" class:on={t.rating === 'down'} onclick={() => ai.rate(t, 'down')} title="Ответ не помог" aria-label="Ответ не помог" aria-pressed={t.rating === 'down'}><Icon name="thumbdown" size={15} /></button>
                </span>
              </div>
              {@const other = app.hasLaws && !t.nick && t.scope && t === ai.turns.at(-1) ? otherScope(t.q, t.scope) : null}
              {#if other}
                <p class="other"><Icon name={other === 'laws' ? 'scale' : 'scroll'} size={14} /><span>Похоже, это вопрос о {other === 'laws' ? 'законах штата' : 'правилах проекта'}.</span><button class="link" onclick={() => send(t.q, true, other)} disabled={ai.busy}>Ответить по {other === 'laws' ? 'законам' : 'правилам'}</button></p>
              {/if}
              {#if t.rating === 'down'}<p class="thanks">Спасибо — так мы видим, где помощник ошибается. Если хотите поспорить с ответом, просто напишите свой довод.</p>{/if}
            {/if}
            {#if t.think && learn.staffHere && !t.pending}
              <!-- Только команде: как нейросеть пришла к ответу — чтобы ловить ошибки логики -->
              <details class="why">
                <summary title="Видит только команда (Dev и Admin)"><Icon name="spark" size={13} />Как помощник рассуждал</summary>
                <p class="selectable">{thoughts(t)}</p>
              </details>
            {/if}
            {#if app.devMode && !t.pending}
              <!-- Только в режиме разработчика: что выбрала нейросеть и что нашёл поиск -->
              <details class="debug">
                <summary>Поиск: {t.sources.length} пунктов</summary>
                {#if t.analysis}
                  {#if t.analysis.who.length}<p><b>Участники:</b> {t.analysis.who.join('; ')}</p>{/if}
                  {#if t.analysis.ask}<p><b>Хочет узнать:</b> {t.analysis.ask}</p>{/if}
                  {#if t.analysis.topics.length}<p><b>Проверить:</b> {t.analysis.topics.map((x) => x.check || x.words.join(', ')).join(' · ')}</p>{/if}
                {/if}
                {#if t.checked}<p><b>Перепроверка:</b> {t.checked.fixed ? `поправлен — ${t.checked.problems.join('; ')}` : 'ошибок не нашла'}</p>{/if}
                {#if t.plan}
                  <p><b>Документы:</b> {t.plan.docs.length ? t.plan.docs.join('; ') : 'не выбраны'}</p>
                  <p><b>Слова:</b> {t.plan.keywords || '—'}</p>
                {/if}
                {#if t.time}
                  <p><b>Время:</b> {[t.time.plan !== undefined ? `разбор ${t.time.plan} с` : 'без разбора', t.time.first !== undefined ? `первые слова ${t.time.first} с` : '', t.time.total !== undefined ? `весь ответ ${t.time.total} с` : ''].filter(Boolean).join(' · ')} · {t.model ?? ai.status?.provider}</p>
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
        <div class="scopes" role="radiogroup" aria-label="По чему отвечать">
          <button role="radio" aria-checked={scope === 'project'} class:on={scope === 'project'} onclick={() => ai.setScope('project')} disabled={ai.busy} title="Правила проекта: DM, NonRP, деморган, варны, баны — то, за что наказывает администрация"><Icon name="scroll" size={14} />Правила проекта</button>
          <button role="radio" aria-checked={scope === 'laws'} class:on={scope === 'laws'} onclick={() => ai.setScope('laws')} disabled={ai.busy} title="Законы штата: Уголовный, Административный, Дорожный кодекс — то, за что персонажа судят в игре"><Icon name="scale" size={14} />Законы {app.serverName}</button>
        </div>
      {/if}
      {#if confirming}
        <p class="confirm"><Icon name="chat" size={14} /><span>Отправить вопрос? <b>Enter</b> — да, <b>Esc</b> — нет</span></p>
      {/if}
      {#if mic.stage === 'offer'}
        <div class="voice-pop" transition:fly={{ y: 6, duration: ms(160), easing: ease }}>
          <p><b>Вопрос голосом.</b> Распознавание речи скачивается один раз — около {mic.sizeMb} МБ. Работает прямо на вашем компьютере: бесплатно и без лимитов. Нажмите микрофон и говорите — когда замолчите, запись остановится сама.</p>
          {#if mic.error}<p class="voice-err">{mic.error}</p>{/if}
          <div class="voice-row"><button class="btn primary sm" onclick={() => mic.install()}>Скачать</button><button class="voice-later" onclick={() => mic.dismiss()}>Не сейчас</button></div>
        </div>
      {:else if mic.stage === 'install'}
        <div class="voice-pop">
          <p><b>Скачиваю распознавание речи…</b> {mb(mic.progress.done)} из {mb(mic.progress.total) || mic.sizeMb} МБ</p>
          <div class="voice-prog" role="progressbar" aria-valuemin="0" aria-valuemax={mic.progress.total} aria-valuenow={mic.progress.done}><i style="width: {mic.progress.total ? Math.min(100, (mic.progress.done / mic.progress.total) * 100) : 0}%"></i></div>
        </div>
      {:else if mic.stage === 'error'}
        <p class="voice-pop voice-err-pop"><Icon name="mic" size={14} /><span>{mic.error}</span><button class="voice-later" onclick={() => mic.dismiss()}>Понятно</button></p>
      {/if}
      <div class="input" class:confirm-on={confirming} class:recording={mic.stage === 'listen'}>
        {#if mic.stage === 'listen'}
          <div class="live" aria-live="polite"><span class="rec-dot" aria-hidden="true"></span><span class="bars" aria-hidden="true">{#each mic.wave as v, i (i)}<i style="height: {4 + Math.round(v * 14)}px"></i>{/each}</span><span>Слушаю…</span></div>
        {:else if mic.stage === 'think'}
          <div class="live" aria-live="polite"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span>Распознаю речь…</span></div>
        {:else}
          <textarea bind:this={field} bind:value={input} onkeydown={onKey} rows="1" placeholder={scope === 'laws' ? 'Вопрос по законам штата…' : 'Вопрос по правилам проекта…'} maxlength="600" disabled={ai.busy}></textarea>
        {/if}
        <button class="mic" class:rec={mic.stage === 'listen'} onclick={() => mic.press()} disabled={ai.busy || mic.stage === 'think' || mic.stage === 'install'} title={mic.stage === 'listen' ? 'Остановить запись' : 'Сказать голосом'} aria-label={mic.stage === 'listen' ? 'Остановить запись' : 'Сказать голосом'}>
          {#if mic.stage === 'listen'}<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="2.5" fill="currentColor" /></svg>{:else}<Icon name="mic" size={17} />{/if}
        </button>
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
  .learn.fixed { display: block; }
  .learn.fixed summary { display: flex; gap: 8px; align-items: center; cursor: pointer; list-style: none; }
  .learn.fixed summary::-webkit-details-marker { display: none; }
  .learn.fixed summary::after { content: 'почему'; margin-left: auto; white-space: nowrap; flex-shrink: 0; font-size: 11px; opacity: 0.75; text-decoration: underline; }
  .learn.fixed[open] summary::after { content: 'скрыть'; }
  .learn.fixed ul { margin: 6px 0 0; padding-left: 22px; color: var(--text-dim); }
  .learn.fixed li + li { margin-top: 3px; }
  .learn.wait { background: var(--surface-3); color: var(--text-muted); align-items: center; }
  .sources { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
  .src { display: flex; align-items: center; gap: 8px; padding: 6px 8px; margin: 0 -8px; border: 0; border-radius: var(--radius-sm); background: none; text-align: left; color: var(--text-dim); font-size: var(--fs-xs); }
  .src:hover { background: var(--surface-3); color: var(--text); }
  .src .num { flex-shrink: 0; padding: 2px 6px; border-radius: 5px; background: var(--accent-tint); color: var(--accent); font-weight: 800; }
  .src .doc { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .why { margin-top: 10px; border-radius: var(--radius-sm); background: var(--surface-2); border: 1px solid var(--border); }
  .why summary { display: flex; align-items: center; gap: 6px; padding: 7px 10px; cursor: pointer; list-style: none; font-size: 12px; font-weight: 700; color: var(--text-dim); }
  .why summary::-webkit-details-marker { display: none; }
  .why summary:hover { color: var(--text); }
  .why p { margin: 0; padding: 0 10px 10px; max-height: 260px; overflow: auto; white-space: pre-wrap; font-size: 12.5px; line-height: 1.5; color: var(--text-dim); }
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
  .mic { display: grid; place-items: center; width: 34px; height: 34px; flex-shrink: 0; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); }
  .mic:hover:not(:disabled) { background: var(--surface-3); color: var(--text); }
  .mic.rec, .mic.rec:hover:not(:disabled) { background: var(--danger-tint); color: var(--danger-line); }
  .voice-later { padding: 0; border: 0; background: none; color: var(--text-muted); font-size: var(--fs-xs); font-weight: 700; }
  .voice-later:hover { color: var(--text); }
  .mic:disabled { opacity: 0.45; }
  .input.recording, .input.recording:focus-within { border-color: rgba(255, 90, 95, 0.45); box-shadow: 0 0 0 3px rgba(255, 90, 95, 0.08); }
  .live { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; min-height: 34px; padding-left: 2px; font-size: var(--fs-sm); color: var(--text-dim); }
  .rec-dot { width: 8px; height: 8px; flex-shrink: 0; border-radius: 50%; background: var(--danger-line); box-shadow: 0 0 0 4px rgba(255, 90, 95, 0.18); animation: recpulse 1.2s ease-in-out infinite; }
  @keyframes recpulse { 50% { opacity: 0.45; } }
  .bars { display: flex; align-items: center; gap: 2px; height: 18px; }
  .bars i { display: block; width: 3px; border-radius: 2px; background: var(--danger); transition: height 60ms linear; }
  .voice-pop { margin: 0 0 8px; padding: 10px 12px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--border-strong); font-size: var(--fs-xs); line-height: 1.5; color: var(--text-dim); }
  .voice-pop p { margin: 0; }
  .voice-pop b { color: var(--text); }
  .voice-row { display: flex; align-items: center; gap: 14px; margin-top: 8px; }
  .voice-prog { height: 6px; margin-top: 8px; border-radius: 4px; background: var(--surface-3); overflow: hidden; }
  .voice-prog i { display: block; height: 100%; background: var(--accent); transition: width 150ms linear; }
  .voice-err { margin-top: 6px !important; color: var(--danger); }
  .voice-err-pop { display: flex; align-items: center; gap: 8px; color: var(--danger); }
  .voice-err-pop span { flex: 1; }
  @media (prefers-reduced-motion: reduce) { .rec-dot { animation: none; } }
  .send { display: grid; place-items: center; width: 34px; height: 34px; flex-shrink: 0; border: 0; border-radius: var(--radius-sm); background: var(--accent); color: var(--on-accent); }
  .send:disabled { background: var(--surface-3); color: var(--text-muted); }
  .scopes { display: flex; gap: 2px; margin: 0 0 8px; padding: 3px; border-radius: var(--radius); background: var(--bg); border: 1px solid var(--border-strong); }
  .scopes button { flex: 1; min-width: 0; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 8px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-dim); font-size: var(--fs-xs); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: background 0.15s var(--ease), color 0.15s var(--ease); }
  .scopes button:hover:not(.on):not(:disabled) { background: var(--surface-3); color: var(--text); }
  .scopes button.on { background: var(--accent); color: var(--on-accent); }
  .scopes button:disabled:not(.on) { opacity: 0.5; }
  .scopes button:focus-visible { outline: 2px solid var(--accent-line); outline-offset: 1px; }
  .other { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 7px; margin: 10px 0 0; font-size: var(--fs-xs); color: var(--text-muted); line-height: 1.4; }
  .other :global(svg) { color: var(--accent); flex-shrink: 0; }
  .other .link { border: 0; padding: 0; background: none; color: var(--accent); font: inherit; font-weight: 700; cursor: pointer; }
  .other .link:hover:not(:disabled) { text-decoration: underline; }
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
