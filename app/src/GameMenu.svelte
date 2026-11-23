<script lang="ts">
  // Меню поверх игры: горизонтальная полоска с разделами, окна разделов над ней.
  // Утверждённый дизайн — claude/game-menu-spec.md, образец — прототип в Claude Design.
  import { untrack } from 'svelte';
  import Icon, { type IconName } from './lib/components/Icon.svelte';
  import GameWindow from './lib/components/game/GameWindow.svelte';
  import GameDocs from './lib/components/game/GameDocs.svelte';
  import GamePins from './lib/components/game/GamePins.svelte';
  import BuyersView from './lib/components/BuyersView.svelte';
  import CalcView from './lib/components/CalcView.svelte';
  import CalcQuick from './lib/components/game/CalcQuick.svelte';
  import { CALC_W, PIN_W } from './lib/pins';
  import AiPanel from './lib/components/AiPanel.svelte';
  import SettingsView from './lib/components/SettingsView.svelte';
  import AdminView from './lib/components/AdminView.svelte';
  import AiSetup from './lib/components/AiSetup.svelte';
  import News from './lib/components/News.svelte';
  import UpdateDialog from './lib/components/UpdateDialog.svelte';
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
    void backend.on('game-menu-shown', () => { void app.reloadDbIfChanged(); void app.loadPins(); void learn.checkSession(); }).then((f) => (off = f));
    let offPassive: (() => void) | undefined;
    void backend.on('game-menu-passive', (on) => { gm.passive = !!on; }).then((f) => (offPassive = f));
    return () => { window.removeEventListener('resize', resize); off?.(); offPassive?.(); };
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
  /** Пункт выпадающего списка. soon — показан для примера, ещё не сделан */
  type Kid = { id: WinId; label: string; sub: string; icon: IconName; badge?: number; yellow?: boolean; soon?: boolean };
  type Item = { sep: true } | { group: string; label: string; icon: IconName; kids: Kid[]; iconOnly?: boolean } | { id: WinId; label: string; icon: IconName; badge?: number; yellow?: boolean; iconOnly?: boolean };
  // Предпросмотр нового меню (все функции в выпадающих списках) — только при разработке: game.html?menu2
  const MENU2 = import.meta.env.DEV && new URLSearchParams(location.search).has('menu2');
  const items = $derived.by<Item[]>(() => MENU2 ? items2() : items1());
  function items2(): Item[] {
    const SOON = 'rules' as WinId;
    const out: Item[] = [];
    const rules: Kid[] = [{ id: 'rules', label: 'Правила проекта', sub: 'Общие правила NOVA RP', icon: 'scroll' }];
    if (app.hasLaws) rules.push({ id: 'laws', label: `Законы ${app.serverName}`, sub: 'Законодательство сервера', icon: 'scale' });
    rules.push({ id: SOON, label: 'Проверка ника', sub: 'Подходит ли ник по правилам', icon: 'idcard', soon: true });
    rules.push({ id: SOON, label: 'Что изменилось', sub: 'Свежие правки правил и законов', icon: 'history', soon: true });
    out.push({ group: 'rules', label: 'Правила', icon: 'scroll', kids: rules });
    const earn: Kid[] = [];
    if (app.buyersEnabled) earn.push({ id: 'buyers', label: 'Скупщики', sub: 'Цены скупщиков за час', icon: 'chartline' });
    if (app.calcEnabled) earn.push({ id: 'calc', label: 'Калькулятор', sub: 'Доходы и расходы', icon: 'calc' });
    out.push({ group: 'earn', label: 'Заработок', icon: 'coin', kids: earn });
    out.push({ group: 'guide', label: 'Гид', icon: 'compass', kids: [
      { id: SOON, label: 'Путеводитель', sub: 'С чего начать и что дальше', icon: 'route', soon: true },
      { id: SOON, label: 'Организации', sub: 'Уставы и гайды фракций', icon: 'users', soon: true },
      { id: SOON, label: 'Карта', sub: 'NPC, работы, скупщики', icon: 'map', soon: true },
    ] });
    if (app.aiEnabled) out.push({ sep: true }, { id: 'ai', label: 'ИИ-помощник', icon: 'chat', iconOnly: true });
    const more: Kid[] = [];
    if (app.pinsEnabled) more.push({ id: 'pins', label: 'Мои окна поверх игры', sub: 'Закреплённые окна', icon: 'layers', badge: app.pins.length || undefined });
    if (learn.staff) more.push({ id: 'admin', label: 'Управление', sub: learn.pending ? `${learn.pending} на проверке` : 'Для команды', icon: 'shield', badge: learn.pending || undefined, yellow: true });
    more.push({ id: 'settings', label: 'Настройки', sub: 'Клавиши, вид, обновления', icon: 'settings' });
    more.push({ id: SOON, label: 'Частые вопросы', sub: 'Если что-то не работает', icon: 'question', soon: true });
    out.push({ group: 'more', label: 'Ещё', icon: 'menu', kids: more, iconOnly: true });
    return out;
  }
  function items1(): Item[] {
    const out: Item[] = [{ id: 'rules', label: 'Правила', icon: 'scroll' }];
    if (app.hasLaws) out.push({ id: 'laws', label: 'Законы', icon: 'scale' });
    // «Заработок»: скупщики и калькулятор под одной кнопкой (пока калькулятор — только в режиме разработчика)
    if (app.calcEnabled) {
      const kids: Kid[] = [];
      if (app.buyersEnabled) kids.push({ id: 'buyers', label: 'Скупщики', sub: 'Цены скупщиков за час', icon: 'chartline' });
      kids.push({ id: 'calc', label: 'Калькулятор', sub: 'Доходы и расходы', icon: 'calc' });
      out.push({ sep: true }, { group: 'earn', label: 'Заработок', icon: 'coin', kids });
    } else if (app.buyersEnabled) out.push({ sep: true }, { id: 'buyers', label: 'Скупщики', icon: 'chartline' });
    if (app.aiEnabled) out.push({ sep: true }, { id: 'ai', label: 'ИИ-помощник', icon: 'chat', iconOnly: true });
    out.push({ sep: true });
    if (app.pinsEnabled) out.push({ id: 'pins', label: 'Мои окна поверх игры', icon: 'layers', badge: app.pins.length || undefined, iconOnly: true });
    if (learn.staff) out.push({ id: 'admin', label: learn.pending ? `Управление: ${learn.pending} на проверке` : 'Управление', icon: 'shield', badge: learn.pending || undefined, yellow: true, iconOnly: true });
    out.push({ id: 'settings', label: 'Настройки', icon: 'settings', iconOnly: true });
    return out;
  }
  // Управление закрыто для игрока — его окно не держим открытым
  $effect(() => { if (!learn.staff && gm.open.includes('admin')) untrack(() => gm.close('admin')); });
  $effect(() => { if (!app.calcEnabled && gm.open.includes('calc')) untrack(() => gm.close('calc')); });

  // ── Выпадающий список «Заработок»: открывается при наведении, закрывается чуть позже, чем ушла мышь ──
  /** Какой список открыт (ключ группы) */
  let dd = $state<string | null>(null);
  let ddTimer: ReturnType<typeof setTimeout> | undefined;
  const ddEnter = (g: string) => { clearTimeout(ddTimer); dd = g; };
  const ddLeave = () => { clearTimeout(ddTimer); ddTimer = setTimeout(() => (dd = null), 300); };
  const ddClick = (g: string) => { clearTimeout(ddTimer); dd = dd === g ? null : g; };
  function ddPick(k: Kid) { if (k.soon) return; clearTimeout(ddTimer); dd = null; gm.toggle(k.id); }
  $effect(() => { if (drag || gm.passive) dd = null; });

  // ── «+» у закреплённых окон «Итог» калькулятора: слой окон пропускает мышь в игру, поэтому кнопку рисует меню ──
  const sumPins = $derived(app.calcEnabled ? app.pins.filter((p) => p.kind === 'calc' && p.calc?.type === 'sum' && p.x !== undefined && p.y !== undefined) : []);
  const pinW = (w?: number) => (w === undefined ? CALC_W : Math.min(PIN_W.max, Math.max(PIN_W.min, w)));
  let quick = $state<{ key: string; prof: string; x: number; y: number; h: number } | null>(null);
  /** Окно записи — справа от закреплённого «Итога», не влезает — слева; высота как у окна калькулятора, но не выше экрана */
  function openQuick(p: (typeof sumPins)[number]) {
    if (quick?.key === p.key) { quick = null; return; }
    const w = pinW(p.w), QW = 460;
    const h = Math.min(720, gm.vh - 32);
    const x = p.x! + w + 12 + QW <= gm.vw - 8 ? p.x! + w + 12 : Math.max(8, p.x! - QW - 12);
    quick = { key: p.key, prof: p.calc!.prof, x, y: Math.max(16, Math.min(p.y!, gm.vh - h - 16)), h };
  }
  $effect(() => { if (gm.passive) quick = null; });
  $effect(() => { if (quick && !sumPins.some((p) => p.key === quick!.key)) quick = null; });

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
  const pinLabel = $derived(gm.layout.pinned ? 'Закреплено. Нажмите, чтобы меню снова пряталось' : 'Закрепить: меню и окна останутся на экране, пока вы играете');
  const hotkey = $derived(app.settings?.hotkey ?? 'Alt+Q');

  function setGlass(e: Event) {
    gm.layout.glass = Number((e.currentTarget as HTMLInputElement).value);
    gm.save();
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="layer" class:passive={gm.passive} style={glassVars(gm.layout.glass)} onpointerdown={onRoot}>
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
    {#if !gm.passive}
      {#each sumPins as p (p.key)}
        <button class="qadd" class:on={quick?.key === p.key} style="left: {p.x! + pinW(p.w) - 8}px; top: {p.y! + 8}px" title="Записать доход или расход" aria-label="Записать доход или расход в «{p.doc.replace('Калькулятор · ', '')}»" aria-expanded={quick?.key === p.key} onclick={() => openQuick(p)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      {/each}
      {#if quick}<CalcQuick prof={quick.prof} x={quick.x} y={quick.y} h={quick.h} onclose={() => (quick = null)} />{/if}
    {/if}
    {#if isOpen('calc') && app.calcEnabled}
      <GameWindow id="calc" title="Калькулятор прибыли" icon="calc" badge="Экспериментально"><CalcView /></GameWindow>
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
    <button class="pinb" class:on={gm.layout.pinned} aria-pressed={!!gm.layout.pinned} aria-label={pinLabel} onclick={() => gm.setPinned(!gm.layout.pinned)}>
      <Icon name="pin" size={13} />
      <span class="tip">{pinLabel}</span>
    </button>
    {#if learn.staff}<span class="role" class:dev={learn.isDev}>{learn.isDev ? 'Dev' : 'Admin'}</span>{/if}
    {#each items as it, i (i)}
      {#if 'sep' in it}
        <span class="sep" aria-hidden="true"></span>
      {:else if 'group' in it}
        {@const anyOpen = it.kids.some((k) => !k.soon && isOpen(k.id))}
        {@const show = dd === it.group}
        {@const gBadge = it.kids.reduce((n, k) => n + (k.yellow ? (k.badge ?? 0) : 0), 0)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="grp" onmouseenter={() => ddEnter(it.group)} onmouseleave={ddLeave}>
          <button class="nb" class:icon={vertical || it.iconOnly} class:on={anyOpen || show} class:open={anyOpen} aria-label={it.label} aria-haspopup="menu" aria-expanded={show} onclick={() => ddClick(it.group)}>
            <Icon name={it.icon} size={18} />
            {#if !vertical && !it.iconOnly}<span>{it.label}</span><span class="chev" class:up={!show === !barTop}><Icon name="chevron" size={13} /></span>{/if}
            {#if gBadge}<span class="badge yellow">{gBadge}</span>{/if}
          </button>
          {#if show}
            <span class="bridge" aria-hidden="true"></span>
            <div class="menu" class:edge={it.iconOnly && !vertical} role="menu" aria-label={it.label}>
              {#each it.kids as k (k.label)}
                {@const on = !k.soon && isOpen(k.id)}
                <button class="mi" class:on class:soon={k.soon} role="menuitemcheckbox" aria-checked={on} aria-disabled={k.soon} onclick={() => ddPick(k)}>
                  <span class="mico"><Icon name={k.icon} size={17} /></span>
                  <span class="mt"><b>{k.label}{#if k.id === 'calc' && !k.soon}<em>β</em>{/if}{#if k.soon}<i>скоро</i>{/if}</b><span>{on ? 'Открыто — нажмите, чтобы закрыть' : k.sub}</span></span>
                  {#if k.badge}<span class="badge static" class:yellow={k.yellow}>{k.badge}</span>{/if}
                  {#if on}<span class="mdot"></span>{/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
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
  <!-- Окно «Вышла новая версия»: кнопка «Проверить» в настройках и «Обновить у себя» в «Выпусках» работают и в игре -->
  {#if !gm.passive}<UpdateDialog />{/if}
  {#if app.toast}
    {#key app.toast}
      <div class="toast" class:error={app.toast.tone === 'error'} role="status"><Icon name={app.toast.tone === 'error' ? 'alert' : 'check'} size={16} />{app.toast.text}</div>
    {/key}
  {/if}

  {#if gm.passive}
    <span class="passive-tip"><Icon name="pin" size={13} /><kbd>{hotkey}</kbd>меню</span>
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
  .pinb { position: relative; width: 20px; height: 48px; margin-right: 2px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: #55585f; display: grid; place-items: center; cursor: pointer; }
  .pinb:hover { color: var(--text-dim); background: #232428; }
  .pinb.on { color: var(--accent); }
  .pinb:hover .tip, .pinb:focus-visible .tip { opacity: 1; }
  .pinb .tip { left: 0; transform: none; }
  .bar.v .pinb { width: 48px; height: 20px; margin: 0 0 2px; }
  .bar.v .pinb .tip { top: 0; transform: none; }
  .layer.passive .tip { display: none; }
  /* «+» у закреплённого итога калькулятора */
  /* Маленькая кнопка в правом верхнем углу самого окна — как кнопки в редакторе окон, места не занимает */
  .qadd { position: absolute; z-index: 7; transform: translateX(-100%); display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border-radius: 6px; background: var(--surface); border: 1px solid var(--border-strong); color: var(--accent); cursor: pointer; pointer-events: auto; }
  .qadd:hover, .qadd.on { border-color: var(--accent-line); background: var(--accent-tint); }
  /* «Заработок» со списком */
  .grp { position: relative; }
  .nb.on:not(.open)::after { display: none; }
  .chev { display: grid; margin-left: -2px; opacity: 0.7; transform: rotate(90deg); transition: transform 0.12s; }
  .chev.up { transform: rotate(-90deg); }
  .bridge { position: absolute; left: -10px; right: -10px; bottom: 44px; height: 22px; }
  .menu { position: absolute; left: 50%; bottom: 60px; transform: translateX(-50%); z-index: 3; width: 280px; padding: 6px; box-sizing: border-box; border-radius: 14px; background: #212226; border: 1px solid #3a3c42; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55); }
  .bar.top .bridge { bottom: auto; top: 44px; }
  .bar.top .menu { bottom: auto; top: 60px; }
  .bar.v .bridge { left: 44px; top: -10px; bottom: -10px; width: 22px; height: auto; right: auto; }
  .bar.v .menu { left: 60px; top: 50%; bottom: auto; transform: translateY(-50%); }
  .bar.v.right .bridge { left: auto; right: 44px; }
  .bar.v.right .menu { left: auto; right: 60px; }
  .mi { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px; border: 0; border-radius: 10px; background: transparent; color: var(--text); font: inherit; cursor: pointer; text-align: left; }
  .mi:hover { background: #2a2b30; }
  .mi.on { background: rgba(255, 195, 0, 0.08); }
  .mico { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; flex-shrink: 0; background: #2c2d32; color: #c8cad0; }
  .mi.on .mico { background: rgba(255, 195, 0, 0.16); color: var(--accent); }
  .mt { flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .mt b { font-size: 13.5px; display: flex; align-items: center; gap: 6px; }
  .mt em { font-style: normal; padding: 0 5px; border-radius: 5px; font-size: 10.5px; font-weight: 800; background: var(--accent); color: var(--on-accent); }
  .mt span { font-size: 11.5px; font-weight: 600; color: var(--text-muted); }
  .mt i { font-style: normal; padding: 1px 6px; border-radius: 5px; font-size: 10.5px; font-weight: 700; background: #2c2d32; color: var(--text-muted); }
  .mi.soon { cursor: default; opacity: 0.55; }
  .mi.soon:hover { background: transparent; }
  .badge.static { position: static; }
  .bar:not(.v) .menu.edge { left: auto; right: -8px; transform: none; }
  .mdot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
  .passive-tip { position: absolute; right: 24px; bottom: 18px; z-index: 59; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px; background: rgba(20, 21, 24, 0.8); color: #d5d7dc; font-size: 12.5px; font-weight: 700; pointer-events: none; }
  .passive-tip :global(svg) { color: var(--accent); }
  .passive-tip kbd { padding: 3px 7px; border-radius: 6px; background: #313238; color: var(--text); font: inherit; font-size: 12px; font-weight: 800; }
  .zone { position: absolute; top: 16px; bottom: 16px; width: 6px; border-radius: 3px; z-index: 55; pointer-events: none; background: rgba(255, 195, 0, 0.28); }
  .zone.l { left: 6px; }
  .zone.r { right: 6px; }
  .zone.hot { background: var(--accent); }
  .zone-tip { position: absolute; top: 24px; z-index: 56; pointer-events: none; padding: 8px 12px; border-radius: 10px; background: var(--accent); color: #1a1400; font-size: 13px; font-weight: 800; }
</style>
