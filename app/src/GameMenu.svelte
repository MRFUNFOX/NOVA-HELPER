<script lang="ts">
  // Меню поверх игры: горизонтальная полоска с разделами, окна разделов над ней.
  // Утверждённый дизайн — claude/game-menu-spec.md, образец — прототип в Claude Design.
  import { untrack } from 'svelte';
  import Icon, { type IconName } from './lib/components/Icon.svelte';
  import GameWindow from './lib/components/game/GameWindow.svelte';
  import GameDocs from './lib/components/game/GameDocs.svelte';
  import GamePins from './lib/components/game/GamePins.svelte';
  import BuyersView from './lib/components/BuyersView.svelte';
  import AiPanel from './lib/components/AiPanel.svelte';
  import SettingsView from './lib/components/SettingsView.svelte';
  import AdminView from './lib/components/AdminView.svelte';
  import AiSetup from './lib/components/AiSetup.svelte';
  import News from './lib/components/News.svelte';
  import { app } from './lib/state.svelte';
  import { ai } from './lib/ai.svelte';
  import { learn } from './lib/learn.svelte';
  import { prices } from './lib/prices.svelte';
  import { backend } from './lib/backend';
  import { gm, glassVars, RAIL, type WinId } from './lib/gamemenu.svelte';

  let started = $state(false);
  $effect(() => {
    prices.quiet = true;
    void gm.load();
    app.start(true)
      .then(async () => { started = true; await ai.init(); learn.init(); })
      .catch(() => { started = true; app.loaded = true; });
    const resize = () => { gm.vw = window.innerWidth; gm.vh = window.innerHeight; };
    window.addEventListener('resize', resize);
    // Открыли меню — свежие закрепки и вход в «Управление» (могли поменяться в основном окне)
    let off: (() => void) | undefined;
    void backend.on('game-menu-shown', () => { void app.loadPins(); void learn.checkSession(); }).then((f) => (off = f));
    return () => { window.removeEventListener('resize', resize); off?.(); };
  });
  $effect(() => {
    if (started && app.buyersEnabled) untrack(() => prices.start());
  });

  const hide = () => { void backend.gameMenuHide().catch(() => {}); };
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !e.defaultPrevented && !ai.setupOpen && !app.guideOpen) hide();
  }
  // Клик по пустому месту экрана — спрятать меню (как клавиша вызова)
  function onRoot(e: PointerEvent) {
    if (e.target === e.currentTarget) hide();
  }

  // ── Кнопки меню ──
  type Item = { sep: true } | { id: WinId; label: string; icon: IconName; badge?: number; yellow?: boolean; iconOnly?: boolean };
  const items = $derived.by<Item[]>(() => {
    const out: Item[] = [{ id: 'rules', label: 'Правила', icon: 'scroll' }];
    if (app.hasLaws) out.push({ id: 'laws', label: 'Законы', icon: 'scale' });
    if (app.buyersEnabled) out.push({ sep: true }, { id: 'buyers', label: 'Скупщики', icon: 'chartline' });
    if (app.aiEnabled) out.push({ sep: true }, { id: 'ai', label: 'ИИ-помощник', icon: 'chat', iconOnly: true });
    out.push({ sep: true });
    if (app.pinsEnabled) out.push({ id: 'pins', label: 'Мои окна поверх игры', icon: 'layers', badge: app.pins.length || undefined, iconOnly: true });
    if (learn.staff) out.push({ id: 'admin', label: learn.pending ? `Управление: ${learn.pending} на проверке` : 'Управление', icon: 'shield', badge: learn.pending || undefined, yellow: true, iconOnly: true });
    out.push({ id: 'settings', label: 'Настройки', icon: 'settings', iconOnly: true });
    return out;
  });
  // Управление закрыто для игрока — его окно не держим открытым
  $effect(() => { if (!learn.staff && gm.open.includes('admin')) untrack(() => gm.close('admin')); });

  // ── Перетаскивание меню за ручку ──
  let bar: HTMLElement | undefined = $state();
  let drag = $state<{ x: number; y: number } | null>(null);
  let hw = 640;
  const near = $derived(drag ? (drag.x < 150 ? 'left' : drag.x > gm.vw - 150 ? 'right' : '') : '');
  const vertical = $derived(drag ? !!near : gm.vertical);
  const clamp = (v: number, a: number, b: number) => Math.round(Math.max(a, Math.min(b, v)));
  const vbar = $derived(18 + items.filter((x) => !('sep' in x)).length * 50 + items.filter((x) => 'sep' in x).length * 13 + 14 + (learn.staff ? 30 : 0));
  const vy = (y: number) => clamp(y + vbar / 2 - 15, vbar / 2 + 16, gm.vh - vbar / 2 - 16);
  const hx = (x: number) => clamp(x - 15 + hw / 2, hw / 2 + 16, gm.vw - hw / 2 - 16);
  const hy = (y: number) => clamp(y, 47, gm.vh - 47);

  function gripDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (!gm.vertical && bar) hw = bar.offsetWidth;
    drag = { x: e.clientX, y: e.clientY };
  }
  function gripMove(e: PointerEvent) { if (drag) drag = { x: e.clientX, y: e.clientY }; }
  function gripUp(e: PointerEvent) {
    if (!drag) return;
    const side = e.clientX < 150 ? 'left' : e.clientX > gm.vw - 150 ? 'right' : '';
    gm.layout.bar = side ? { dock: side, cx: 0, cy: vy(e.clientY) } : { dock: 'free', cx: hx(e.clientX), cy: hy(e.clientY) };
    drag = null;
    gm.save();
  }
  function gripReset() { gm.layout.bar = { dock: 'bottom', cx: 0, cy: 0 }; gm.save(); }

  const dock = $derived(gm.layout.bar.dock);
  const barStyle = $derived.by(() => {
    const b = gm.layout.bar;
    if (drag && near) return `${near}: 16px; top: ${vy(drag.y)}px; transform: translateY(-50%);`;
    if (drag) return `left: ${hx(drag.x)}px; top: ${hy(drag.y)}px; transform: translate(-50%, -50%);`;
    if (b.dock === 'left' || b.dock === 'right') return `${b.dock}: 16px; top: ${clamp(b.cy, vbar / 2 + 16, gm.vh - vbar / 2 - 16)}px; transform: translateY(-50%);`;
    if (b.dock === 'free') return `left: ${clamp(b.cx, 0, gm.vw)}px; top: ${clamp(b.cy, 0, gm.vh)}px; transform: translate(-50%, -50%);`;
    return 'left: 50%; bottom: 16px; transform: translateX(-50%);';
  });
  const barTop = $derived(!vertical && (drag ? drag.y : dock === 'free' ? gm.layout.bar.cy : gm.vh) < gm.vh / 2);
  const side = $derived((drag ? near : dock) === 'right' ? 'right' : 'left');
  // Окна — в свободной части экрана, с той стороны, где больше места
  const winBox = $derived.by(() => {
    const b = gm.layout.bar;
    if (b.dock === 'left') return `padding: 16px 16px 16px ${RAIL}px; justify-content: flex-start; align-items: center;`;
    if (b.dock === 'right') return `padding: 16px ${RAIL}px 16px 16px; justify-content: flex-end; align-items: center;`;
    if (b.dock === 'free' && b.cy < gm.vh / 2) return `padding: ${b.cy + 31 + 16}px 16px 16px; justify-content: center; align-items: flex-start;`;
    if (b.dock === 'free') return `padding: 16px 16px ${gm.vh - b.cy + 31 + 16}px; justify-content: center; align-items: flex-end;`;
    return 'padding: 16px 16px 100px; justify-content: center; align-items: flex-end;';
  });
  const isOpen = (id: WinId) => gm.open.includes(id);

  function setGlass(e: Event) {
    gm.layout.glass = Number((e.currentTarget as HTMLInputElement).value);
    gm.save();
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="layer" style={glassVars(gm.layout.glass)} onpointerdown={onRoot}>
  <div class="wins" style={winBox} onpointerdown={onRoot}>
    {#if isOpen('rules')}
      <GameWindow id="rules" title="Правила проекта" icon="scroll"><GameDocs section="project" /></GameWindow>
    {/if}
    {#if isOpen('laws')}
      <GameWindow id="laws" title={`Законы ${app.serverName}`} icon="scale"><GameDocs section="laws" /></GameWindow>
    {/if}
    {#if isOpen('buyers')}
      <GameWindow id="buyers" title="Скупщики" icon="chartline"><div class="pad"><BuyersView /></div></GameWindow>
    {/if}
    {#if isOpen('ai')}
      <GameWindow id="ai" title="ИИ-помощник" icon="spark">
        {#snippet tools()}
          {#if ai.turns.length}<button class="ib" aria-label="Начать заново" title="Начать заново" onclick={() => ai.clear()} disabled={ai.busy}><Icon name="refresh" size={15} /></button>{/if}
        {/snippet}
        <div class="ai"><AiPanel /></div>
      </GameWindow>
    {/if}
    {#if isOpen('pins')}
      <GameWindow id="pins" title="Мои окна" icon="layers"><GamePins /></GameWindow>
    {/if}
    {#if isOpen('settings')}
      <GameWindow id="settings" title="Настройки" icon="settings" ownGlass={false}>
        <div class="pad">
          <section class="card">
            <h3>Прозрачность меню в игре</h3>
            <p>Для меню и всех окон. Отдельному окну — значок с полукругом в его заголовке.</p>
            <div class="row"><Icon name="contrast" size={16} /><input type="range" min="0" max="80" value={gm.layout.glass} oninput={setGlass} aria-label="Прозрачность меню в игре" /><b>{gm.layout.glass}%</b></div>
          </section>
          <SettingsView />
        </div>
      </GameWindow>
    {/if}
    {#if isOpen('admin') && learn.staff}
      <GameWindow id="admin" title="Управление" icon="shield"><div class="pad"><AdminView /></div></GameWindow>
    {/if}
  </div>

  <nav class="bar" class:v={vertical} class:right={side === 'right' && vertical} class:top={barTop} class:drag={!!drag} style={barStyle} aria-label="Меню NOVA HELPER" bind:this={bar}>
    <button class="grip" aria-label="Переместить меню" onpointerdown={gripDown} onpointermove={gripMove} onpointerup={gripUp} onpointercancel={() => (drag = null)} ondblclick={gripReset}>
      <svg width={vertical ? 16 : 10} height={vertical ? 10 : 16} viewBox={vertical ? '0 0 16 10' : '0 0 10 16'} fill="currentColor" aria-hidden="true">
        {#each [[2, 2], [8, 2], [vertical ? 14 : 2, vertical ? 2 : 14], [2, 8], [8, 8], [vertical ? 14 : 8, vertical ? 8 : 14]] as [cx, cy], i (i)}<circle {cx} {cy} r="1.6" />{/each}
      </svg>
      <span class="tip">Зажмите и перетащите меню.<br />К левому или правому краю — станет вертикальным.<br />Двойной клик — вернуть вниз.</span>
    </button>
    {#if learn.staff}<span class="role" class:dev={learn.isDev}>{learn.isDev ? 'Dev' : 'Admin'}</span>{/if}
    {#each items as it, i (i)}
      {#if 'sep' in it}
        <span class="sep" aria-hidden="true"></span>
      {:else}
        {@const icon = vertical || it.iconOnly}
        <button class="nb" class:icon class:on={isOpen(it.id)} class:ai={it.id === 'ai'} aria-label={it.label} aria-pressed={isOpen(it.id)} onclick={() => gm.toggle(it.id)}>
          <Icon name={it.icon} size={18} />
          {#if !icon}<span>{it.label}</span>{/if}
          {#if it.badge}<span class="badge" class:yellow={it.yellow}>{it.badge}</span>{/if}
          {#if icon}<span class="tip">{it.label}</span>{/if}
        </button>
      {/if}
    {/each}
  </nav>

  {#if ai.setupOpen && app.aiEnabled}
    <div class="backdrop">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Настройка ИИ-помощника">
        <AiSetup compact onDone={() => { ai.setupOpen = false; app.markAiSetupDone(); }} />
      </div>
    </div>
  {/if}
  {#if app.guideOpen}
    <div class="backdrop">
      <div class="dialog wide" role="dialog" aria-modal="true" aria-label="Как работают окна поверх игры">
        <News onDone={() => (app.guideOpen = false)} />
      </div>
    </div>
  {/if}
  {#if app.toast}
    {#key app.toast}
      <div class="toast" class:error={app.toast.tone === 'error'} role="status"><Icon name={app.toast.tone === 'error' ? 'alert' : 'check'} size={16} />{app.toast.text}</div>
    {/key}
  {/if}

  {#if drag}
    <div class="zone l" class:hot={near === 'left'} aria-hidden="true"></div>
    <div class="zone r" class:hot={near === 'right'} aria-hidden="true"></div>
    {#if near}<span class="zone-tip" style={near === 'left' ? 'left: 24px;' : 'right: 24px;'}>Отпустите — меню станет вертикальным</span>{/if}
  {/if}
</div>

<style>
  :global(html), :global(body) { background: transparent !important; overflow: hidden; }
  /* Тонкая тёмная прокрутка, как в программе: подложка у прозрачных окон прозрачная */
  :global(::-webkit-scrollbar-thumb) { background: rgba(255, 255, 255, 0.14) !important; border: 3px solid transparent !important; background-clip: padding-box !important; }
  :global(::-webkit-scrollbar-thumb:hover) { background-color: rgba(255, 255, 255, 0.28) !important; }
  .layer { position: fixed; inset: 0; font-family: var(--font, 'Manrope Variable', 'Segoe UI', sans-serif); color: var(--text); }
  .wins { position: absolute; inset: 0; display: flex; gap: 16px; box-sizing: border-box; pointer-events: none; }
  .wins > :global(*) { pointer-events: auto; }
  .pad { padding: 8px 14px 14px; flex: 1; min-height: 0; }
  .ai { flex: 1; min-height: 0; display: flex; }
  .ai :global(aside.ai) { width: 100%; border: 0; background: transparent; }
  .ai :global(aside.ai > header) { display: none; }
  /* Заголовок раздела уже в заголовке окна — внутри не повторяем */
  .pad :global(.crumbs), .pad :global(h1) { display: none; }
  .card { padding: 14px; margin-bottom: 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); }
  .card h3 { margin: 0 0 4px; font-size: 13.5px; font-weight: 800; }
  .card p { margin: 0 0 10px; font-size: 12px; line-height: 1.45; color: var(--text-dim); }
  .card .row { display: flex; align-items: center; gap: 12px; color: var(--text-dim); }
  .card input { flex: 1; accent-color: var(--accent); }
  .card b { width: 40px; text-align: right; font-size: 12.5px; color: var(--text); }
  .ib { width: 34px; height: 34px; border: 0; border-radius: 8px; background: transparent; color: var(--text-dim); display: grid; place-items: center; cursor: pointer; }
  .ib:hover { background: var(--surface-2); color: var(--text); }

  /* ── Меню ── */
  .bar { position: absolute; z-index: 40; display: flex; align-items: center; gap: 2px; padding: 6px; border-radius: 18px; background: var(--bg); border: 1px solid var(--border); box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5); }
  .bar.v { flex-direction: column; }
  .bar.drag { box-shadow: 0 22px 60px rgba(0, 0, 0, 0.65); border-color: var(--border-strong); }
  .sep { width: 1px; height: 28px; background: var(--border); margin: 0 6px; flex-shrink: 0; }
  .bar.v .sep { width: 28px; height: 1px; margin: 6px 0; }
  .role { padding: 3px 7px; margin: 0 8px 0 4px; border-radius: 6px; font-size: 11px; font-weight: 800; background: rgba(122, 162, 255, 0.14); color: #8fb0ff; }
  .role.dev { background: var(--accent); color: #1a1400; }
  .bar.v .role { margin: 2px 0 6px; }
  .nb { position: relative; height: 48px; padding: 0 12px; border: 0; border-radius: 12px; background: transparent; color: #d5d7dc; font: inherit; font-size: 13.5px; font-weight: 700; display: flex; align-items: center; gap: 8px; cursor: pointer; white-space: nowrap; }
  .nb:hover { background: #2a2b30; color: var(--text); }
  .nb.icon { width: 48px; padding: 0; justify-content: center; }
  .nb.ai { color: var(--accent); }
  .nb.on { background: var(--accent-tint); color: var(--accent-soft); }
  .nb.on::after { content: ''; position: absolute; left: 50%; bottom: 4px; width: 18px; height: 3px; margin-left: -9px; border-radius: 2px; background: var(--accent); }
  .bar.v .nb.on::after { left: 4px; top: 50%; bottom: auto; width: 3px; height: 18px; margin: -9px 0 0; }
  .badge { position: absolute; top: 6px; right: 6px; min-width: 17px; height: 17px; padding: 0 4px; box-sizing: border-box; border-radius: 99px; font-size: 10.5px; font-weight: 800; display: grid; place-items: center; background: #313238; color: var(--text); }
  .badge.yellow { background: var(--accent); color: #1a1400; }
  .tip { position: absolute; bottom: 58px; left: 50%; transform: translateX(-50%); padding: 6px 10px; border-radius: 8px; background: #313238; color: var(--text); font-size: 12px; font-weight: 700; line-height: 1.45; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.12s; z-index: 2; }
  .nb:hover .tip, .nb:focus-visible .tip, .grip:hover .tip, .grip:focus-visible .tip { opacity: 1; }
  .bar.top .tip { bottom: auto; top: 58px; }
  .bar.v .tip { bottom: auto; top: 50%; left: calc(100% + 12px); transform: translateY(-50%); }
  .bar.v.right .tip { left: auto; right: calc(100% + 12px); }
  .grip { position: relative; width: 18px; height: 48px; padding: 0; border: 0; border-radius: 9px; background: transparent; color: #55585f; display: grid; place-items: center; cursor: grab; touch-action: none; }
  .grip:hover { color: var(--text-dim); background: #232428; }
  .grip .tip { left: 0; transform: none; text-align: left; }
  .bar.v .grip { width: 48px; height: 18px; }
  .bar.v .grip .tip { top: 0; transform: none; }
  .backdrop { position: absolute; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; background: rgba(10, 10, 12, 0.66); }
  .dialog { width: 100%; max-width: 480px; padding: 24px; border-radius: var(--radius-lg); background: #212226; border: 1px solid #3a3c42; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55); }
  .dialog.wide { max-width: 600px; padding: 22px 24px 20px; }
  .toast { position: absolute; left: 50%; bottom: 96px; transform: translateX(-50%); z-index: 70; display: flex; align-items: center; gap: 10px; max-width: 560px; padding: 10px 16px; border-radius: var(--radius); background: #212226; border: 1px solid #3a3c42; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5); font-size: 13px; }
  .toast :global(svg) { flex-shrink: 0; color: var(--success); }
  .toast.error { background: #3a2224; color: var(--danger); }
  .toast.error :global(svg) { color: var(--danger); }
  .zone { position: absolute; top: 16px; bottom: 16px; width: 6px; border-radius: 3px; z-index: 55; pointer-events: none; background: rgba(255, 195, 0, 0.28); }
  .zone.l { left: 6px; }
  .zone.r { right: 6px; }
  .zone.hot { background: var(--accent); }
  .zone-tip { position: absolute; top: 24px; z-index: 56; pointer-events: none; padding: 8px 12px; border-radius: 10px; background: var(--accent); color: #1a1400; font-size: 13px; font-weight: 800; }
</style>
