<script lang="ts">
  import { fly } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import { app } from '../state.svelte';
  import { ai, pieces, sourceLabel, SCOPES, type Source, type Turn } from '../ai.svelte';
  import type { Section } from '../state.svelte';
  import ModelPicker from './ModelPicker.svelte';
  import { ease, ms } from '../motion';

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

  async function copyAll() {
    try { await navigator.clipboard.writeText(ai.transcript()); app.notify('Переписка скопирована', 'ok'); }
    catch { app.notify('Не удалось скопировать', 'error'); }
  }

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


  function send(text = input) {
    if (!text.trim() || ai.busy) return;
    ai.ask(text);
    input = '';
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function open(s: Source) {
    app.query = '';
    app.open(s.entry.doc.id, s.entry.node.id);
  }

  /** Источники, на которые ответ действительно сослался (их показываем под ответом) */
  function cited(t: Turn): Source[] {
    const used = new Set(pieces(t.a).flatMap((p) => (p.t === 'ref' ? [p.n] : [])));
    return t.sources.filter((s) => used.has(s.n));
  }
</script>

<aside class="ai" transition:fly={{ x: 24, duration: ms(220), easing: ease }} aria-label="ИИ-помощник">
  <header>
    <span class="title"><Icon name="spark" size={17} /> ИИ-помощник</span>
    <span class="tools">
      {#if ai.turns.some((t) => t.a || t.error)}
        <button class="tool" title="Копировать всю переписку" aria-label="Копировать всю переписку" onclick={copyAll} disabled={ai.busy}><Icon name="copy" size={15} /></button>
      {/if}
      {#if ai.turns.length}
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
  {:else}
    <div class="body" bind:this={list}>
      {#if !ai.turns.length}
        <p class="lead">{scope === 'laws' ? 'Спросите своими словами — помощник ответит по законам штата и покажет статьи, на которые опирается.' : 'Спросите своими словами — помощник ответит по правилам проекта и покажет пункты, на которые опирается.'}</p>
        <div class="examples">
          {#each examples as q (q)}<button onclick={() => send(q)}>{q}</button>{/each}
        </div>
      {/if}

      {#each ai.turns as t (t.id)}
        <div class="q">{t.q}</div>
        <div class="a" aria-live="polite">
          {#if t.error}
            <p class="error"><Icon name="alert" size={15} />{t.error}</p>
            <div class="err-actions">
              <button class="btn sm" onclick={() => { ai.turns = ai.turns.filter((x) => x !== t); ai.ask(t.q); }} disabled={ai.busy}>Спросить снова</button>
              {#if t.error.includes('Z.ai') && ai.status?.provider !== 'Z.ai'}<button class="btn sm primary" onclick={() => (ai.setupOpen = true)}>Подключить Z.ai</button>{/if}
            </div>
          {:else if !t.a}
            <p class="thinking"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>{t.sources.length ? `Читаю ${t.sources.length} пунктов…` : `Ищу в разделе «${SCOPES[t.scope ?? 'project'].label}»…`}{#if slow && waited >= 2}<span class="secs">{waited} с</span>{/if}</p>
            {#if slow && waited >= 3}
              <p class="wait-note">Бесплатные серверы Z.ai загружены — ответ может занять до минуты. Быстрее отвечает Groq, но он не работает в России и СНГ.</p>
            {/if}
          {:else}
            <p class="text selectable">
              {#each pieces(t.a) as p, i (i)}
                {#if p.t === 'bold'}<b>{p.v}</b>
                {:else if p.t === 'ref'}
                  {@const s = t.sources.find((x) => x.n === p.n)}
                  {#if s}<button class="ref" onclick={() => open(s)} title="{sourceLabel(s).doc}, {sourceLabel(s).num}">{sourceLabel(s).num}</button>{/if}
                {:else}{p.v}{/if}
              {/each}
            </p>
            {#if !t.pending && cited(t).length}
              <div class="sources">
                {#each cited(t) as s (s.n)}
                  <button class="src" onclick={() => open(s)}>
                    <span class="num">{sourceLabel(s).num}</span><span class="doc">{sourceLabel(s).doc}</span><Icon name="chevron" size={13} />
                  </button>
                {/each}
              </div>
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
        <p class="scopebar"><Icon name={scope === 'laws' ? 'gavel' : 'book'} size={14} /><span>Отвечаю по <b>{scope === 'laws' ? `законам сервера ${app.serverName}` : 'правилам проекта'}</b>. {scope === 'laws' ? 'Правила' : 'Законы'} — переключатель слева вверху</span></p>
      {/if}
      <div class="input">
        <textarea bind:this={field} bind:value={input} onkeydown={onKey} rows="1" placeholder={scope === 'laws' ? 'Вопрос по законам штата…' : 'Вопрос по правилам проекта…'} maxlength="600" disabled={ai.busy}></textarea>
        <button class="send" onclick={() => send()} disabled={ai.busy || !input.trim()} aria-label="Спросить"><Icon name="chevron" size={18} /></button>
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
  .a { align-self: stretch; padding: 12px 14px; border-radius: 14px 14px 14px 4px; background: var(--surface-2); border: 1px solid var(--border); font-size: var(--fs-sm); line-height: 1.6; }
  .text { margin: 0; color: var(--text); white-space: pre-wrap; }
  .text b { color: var(--accent-soft); }
  .ref { display: inline-flex; align-items: center; height: 20px; margin: 0 2px; padding: 0 6px; vertical-align: 1px; border: 0; border-radius: 5px; background: var(--accent-tint); color: var(--accent); font-size: 11.5px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .ref:hover { background: var(--accent); color: var(--on-accent); }
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

  @media (max-width: 899px) {
    .ai { position: absolute; top: 0; right: 0; bottom: 0; z-index: 30; width: min(380px, 100%); box-shadow: -8px 0 24px rgba(0, 0, 0, 0.5); }
  }
</style>
