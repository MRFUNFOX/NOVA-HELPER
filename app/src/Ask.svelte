<script lang="ts">
  /**
   * Окно ответа на вопрос голосом в игре (дизайн утверждён 25.11.2026).
   * Слушаю → распознаю → ищу в правилах → ответ с полоской времени → само исчезает.
   * Мышь проходит сквозь окно в игру. Когда открыто меню хелпера (курсор свободен) — над ответом
   * кнопки «закрепить» и «закрыть», время стоит на паузе.
   * Место, ширину, фон и шрифт игрок меняет в редакторе окон (как у закреплённых пунктов).
   */
  import { backend, type AskLayout, type AskState } from './lib/backend';
  import { PIN_W, type Pin } from './lib/pins';
  import { autoSeconds } from './lib/askTime';
  import Icon from './lib/components/Icon.svelte';
  import { untrack } from 'svelte';

  type View = AskState | { stage: 'recog' };
  const params = new URLSearchParams(location.search);
  let view = $state<View | null>(null);
  let menu = $state(false);
  let layout = $state<AskLayout>({ x: 0, y: 120, w: 380, bg: 88, font: 15, locked: false });
  let showFor = $state(0);
  let key = $state('Alt+E');
  let menuKey = $state('Alt+Q');
  let wave = $state<number[]>(Array(15).fill(0));
  /** Сколько осталось показывать и сколько было всего (мс) */
  let left = $state(0);
  let total = $state(1);
  let card: HTMLElement | undefined = $state();

  const words = (v: View) => (v.stage === 'answer' ? v.parts.map((p) => p.v).join(' ').split(/\s+/).filter(Boolean).length : 0);
  /** «Авто» — по длине (askTime.ts): в игре читают урывками, поэтому с запасом — от 30 секунд до 2 минут */
  function duration(v: View) {
    if (v.stage === 'error') return 8000;
    if (v.stage !== 'answer') return 0;
    if (showFor > 0) return showFor * 1000;
    return Math.round(autoSeconds(words(v), v.q.split(/\s+/).filter(Boolean).length) * 1000);
  }

  function set(v: View | null) {
    const d = v ? untrack(() => duration(v)) : 0;
    view = v;
    left = d;
    total = d || 1;
    if (v?.stage === 'listen') wave = Array(15).fill(0);
  }

  function close() {
    const listening = view?.stage === 'listen';
    set(null);
    void backend.askHide().catch(() => {});
    if (listening) void backend.voiceCancel().catch(() => {});
  }

  /** Закрепить ответ обычным окном поверх игры — на том же месте */
  async function pin() {
    const v = view;
    if (v?.stage !== 'answer') return;
    const text = v.parts.map((p) => p.v).join('').trim();
    const ref = v.refs[0];
    const p: Pin = {
      key: `answer:${Date.now()}`, docId: '', nodeId: '', kind: 'answer',
      badge: ref?.num ?? 'ИИ', doc: ref ? `${ref.doc} · ответ помощника` : 'Ответ помощника', law: false,
      text, punish: [],
      x: Math.round(layout.x), y: Math.round(layout.y), w: Math.round(Math.min(PIN_W.max, Math.max(PIN_W.min, layout.w))), bg: layout.bg, font: Math.min(20, layout.font),
    };
    try {
      const s = await backend.pinsGet();
      // Закреплённых ответов — не больше четырёх: самый старый уступает место
      const answers = s.pins.filter((x) => x.kind === 'answer');
      const drop = answers.length >= 4 ? answers[0]!.key : '';
      await backend.pinsSet([...s.pins.filter((x) => x.key !== drop), p]);
      void backend.stat('ask_pin', {}).catch(() => {});
    } catch { /* не вышло — просто закрываем */ }
    close();
  }

  $effect(() => {
    const offs: (() => void)[] = [];
    const load = (first = false) => backend.askLayout().then((i) => {
      layout = i.layout; showFor = i.show; key = i.key; menuKey = i.menuKey; menu = i.menu;
      // Окно только создалось — показываем то, что программа уже успела прислать
      if (first && i.state && !view) set(i.state);
    }).catch(() => {});
    void load(true);
    backend.on('ask-state', (p) => { void load(); set(p as AskState); }).then((u) => offs.push(u));
    backend.on('ask-menu', (p) => (menu = !!p)).then((u) => offs.push(u));
    backend.on('ask-layout', (p) => (layout = p as AskLayout)).then((u) => offs.push(u));
    backend.on('voice', (p) => {
      const v = p as { stage: string; origin?: string; text?: string; error?: string };
      if (v.origin !== 'game') return;
      if (v.stage === 'think') set({ stage: 'recog' });
      else if (v.stage === 'heard' && v.text) set({ stage: 'think', q: v.text, step: 'plan' });
      else if (v.stage === 'error') set({ stage: 'error', error: v.error ?? 'Не получилось распознать — скажи ещё раз' });
      else if (v.stage === 'idle') close();
    }).then((u) => offs.push(u));
    backend.on('voice-level', (p) => {
      if (view?.stage !== 'listen') return;
      wave = [...wave.slice(1), Number(p) || 0];
    }).then((u) => offs.push(u));
    // Проверка в браузере: ask.html?answer / ?listen / ?think / ?error (&menu)
    untrack(() => {
    if (params.has('answer')) set({ stage: 'answer', q: 'Человек навёл на меня оружие, я его убил. Это DM?', parts: [{ t: 'bold', v: 'Не DM.' }, { t: 'text', v: ' Прицеливание оружием — весомая IC-причина для убийства.' }], refs: [{ num: '4.1', doc: 'Общие правила проекта' }] });
    else if (params.has('listen')) set({ stage: 'listen' });
    else if (params.has('think')) set({ stage: 'think', q: 'Человек навёл на меня оружие, я его убил. Это DM?', step: 'answer' });
    else if (params.has('error')) set({ stage: 'error', error: 'Помощник не подключён — подключи его в программе' });
    });
    return () => offs.forEach((f) => f());
  });

  // Время показа: идёт, только пока меню закрыто
  $effect(() => {
    if (!view || !(view.stage === 'answer' || view.stage === 'error') || menu) return;
    let last = performance.now();
    const t = setInterval(() => {
      const now = performance.now();
      left = Math.max(0, left - (now - last));
      last = now;
      if (left <= 0) close();
    }, 100);
    return () => clearInterval(t);
  });

  // Окно подгоняется под высоту содержимого
  $effect(() => {
    if (!card) return;
    const el = card;
    const report = () => void backend.askSize(el.offsetHeight).catch(() => {});
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  });

  const STEP = { plan: 'Разбираюсь в ситуации…', answer: 'Ищу в правилах…', check: 'Перепроверяю ответ…' } as const;
  const keys = (k: string) => k.split('+').join(' + ');
</script>

{#if view}
  <div class="card" bind:this={card} style:width="{layout.w}px" style:font-size="{layout.font}px" style:--bg={layout.bg / 100}>
    {#if menu}
      <div class="ctrl">
        {#if view.stage === 'answer'}<button class="c" title="Закрепить поверх игры" aria-label="Закрепить" onclick={pin}><Icon name="pin" size={14} /></button>{/if}
        <button class="c x" title="Закрыть" aria-label="Закрыть" onclick={close}><Icon name="close" size={14} /></button>
      </div>
    {/if}

    {#if view.stage === 'listen'}
      <div class="row">
        <span class="rec"></span>
        <span class="bars">{#each wave as h, i (i)}<i style="height: {4 + h * 18}px"></i>{/each}</span>
        <span class="tt"><b>Слушаю…</b><span>Отпусти {keys(key)} — и вопрос уйдёт помощнику</span></span>
      </div>
    {:else if view.stage === 'recog'}
      <div class="thinking"><span class="spin"></span>Распознаю речь…</div>
    {:else if view.stage === 'think'}
      <p class="q"><Icon name="mic" size={14} /><span>{view.q}</span></p>
      <div class="thinking"><span class="spin"></span>{STEP[view.step ?? 'plan']}</div>
    {:else if view.stage === 'answer'}
      <p class="q"><Icon name="mic" size={14} /><span>{view.q}</span></p>
      <p class="a">{#each view.parts as p, i (i)}{#if p.t === 'bold'}<b>{p.v}</b>{:else}{p.v}{/if}{/each}</p>
      {#if view.refs.length}
        <div class="refs">{#each view.refs as r (r.num + r.doc)}<span class="ref"><span class="badge">{r.num}</span><span class="doc">{r.doc}</span></span>{/each}</div>
      {/if}
    {:else}
      {#if view.q}<p class="q"><Icon name="mic" size={14} /><span>{view.q}</span></p>{/if}
      <div class="err"><Icon name="alert" size={16} /><span>{view.error}</span></div>
    {/if}

    {#if view.stage === 'answer' || view.stage === 'error'}
      <div class="timer" class:paused={menu}><i style="width: {(left / total) * 100}%"></i></div>
      {#if view.stage === 'answer'}
        {#if menu}<span class="foot"><Icon name="history" size={12} />Пауза, пока открыто меню</span>
        {:else}<span class="foot">Закрыть или закрепить — открой меню <kbd>{keys(menuKey)}</kbd></span>{/if}
      {/if}
    {/if}
  </div>
{/if}

<style>
  :global(html), :global(body) { background: transparent !important; overflow: hidden; margin: 0; }
  /* Сверху 40 пикселей — место под кнопки «закрепить» и «закрыть» (их видно, когда открыто меню) */
  .card { position: absolute; left: 8px; top: 40px; box-sizing: border-box; padding: 0.85em 1em 0.8em; border-radius: 12px; background: rgba(14, 15, 19, var(--bg)); color: #fff; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); font-family: var(--font); user-select: none; }
  .row { display: flex; align-items: center; gap: 12px; }
  .rec { width: 10px; height: 10px; flex-shrink: 0; border-radius: 50%; background: var(--danger-line); box-shadow: 0 0 0 4px rgba(255, 90, 95, 0.22); }
  .bars { display: flex; align-items: center; gap: 2px; height: 22px; flex-shrink: 0; }
  .bars i { display: block; width: 3px; border-radius: 2px; background: var(--danger); transition: height 0.08s linear; }
  .tt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .tt b { font-size: 1em; }
  .tt span { font-size: 0.8em; color: #dcdee3; }
  .q { display: flex; gap: 7px; margin: 0 0 0.55em; font-size: 0.85em; line-height: 1.4; color: #dcdee3; }
  .q :global(svg) { flex-shrink: 0; margin-top: 2px; color: var(--danger); }
  .thinking { display: flex; align-items: center; gap: 9px; font-size: 0.9em; font-weight: 700; color: var(--accent-soft); }
  .spin { width: 13px; height: 13px; flex-shrink: 0; border-radius: 50%; border: 2px solid rgba(255, 195, 0, 0.25); border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .a { margin: 0; line-height: 1.45; white-space: pre-line; overflow-wrap: anywhere; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
  .a b { color: var(--accent-soft); }
  .refs { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 0.6em; }
  .ref { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
  .badge { flex-shrink: 0; padding: 1px 7px; border-radius: 5px; background: rgba(255, 195, 0, 0.25); color: var(--accent-soft); font-weight: 800; font-size: 0.86em; }
  .doc { font-size: 0.82em; color: rgba(255, 255, 255, 0.72); font-weight: 600; }
  .err { display: flex; gap: 8px; align-items: flex-start; font-size: 0.9em; line-height: 1.4; }
  .err :global(svg) { flex-shrink: 0; margin-top: 1px; color: var(--orange); }
  .timer { height: 3px; margin-top: 0.75em; border-radius: 3px; background: rgba(255, 255, 255, 0.12); overflow: hidden; }
  .timer i { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
  .timer.paused i { background: rgba(255, 255, 255, 0.45); }
  .foot { display: flex; align-items: center; gap: 5px; margin-top: 0.5em; font-size: 11.5px; color: rgba(255, 255, 255, 0.72); }
  .foot kbd { padding: 0 5px; border-radius: 4px; background: rgba(255, 255, 255, 0.12); font: inherit; font-size: 11px; font-weight: 800; color: #fff; }
  .ctrl { position: absolute; top: -36px; right: -2px; display: flex; gap: 5px; }
  .c { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border-radius: 7px; background: var(--surface); border: 1px solid var(--border-strong); color: #dcdee3; cursor: pointer; }
  .c:hover { color: #fff; border-color: var(--accent-line); }
  .c.x:hover { background: var(--danger-tint); border-color: rgba(255, 90, 95, 0.5); }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
