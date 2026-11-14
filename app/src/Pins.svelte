<script lang="ts">
  /**
   * Слой закреплённых пунктов поверх игры (прозрачное окно во весь монитор).
   * Обычно мышь проходит сквозь него в игру. В режиме редактора окна можно таскать мышкой за любое место,
   * менять ширину за уголок (высота — всегда по тексту), фон, шрифт, залочить и открепить.
   */
  import { backend } from './lib/backend';
  import { keys } from './lib/hotkey';
  import { PIN_BG_DEFAULT, PIN_FONT, PIN_W, type Pin } from './lib/pins';
  import Icon from './lib/components/Icon.svelte';

  let pins = $state<Pin[]>([]);
  let editor = $state(false);
  let editorKey = $state('Alt+Shift+Z');
  let selected = $state<string | null>(null);
  let vw = $state(window.innerWidth);
  let vh = $state(window.innerHeight);
  const els: Record<string, HTMLElement> = $state({});
  /** Пока тянем окно, свежие списки от программы не перетирают положение */
  let dragging = false;

  const W = (p: Pin) => Math.min(PIN_W.max, Math.max(PIN_W.min, p.w ?? PIN_W.default));
  const BG = (p: Pin) => p.bg ?? PIN_BG_DEFAULT;
  const FONT = (p: Pin) => p.font ?? PIN_FONT.default;

  function layoutOf(p: Pin): Partial<Pin> {
    return { key: p.key, x: p.x, y: p.y, w: p.w, bg: p.bg, font: p.font, locked: p.locked };
  }
  function save(list: Pin[]) {
    void backend.pinsLayout(list.map(layoutOf)).catch(() => {});
  }

  /** Новые окна — слева под чатом игры, стопкой; не влезли — следующей колонкой */
  function place() {
    const fresh = pins.filter((p) => p.x === undefined || p.y === undefined);
    if (!fresh.length) return;
    const top = Math.round(Math.min(330, vh * 0.3));
    const gap = 12;
    let x = 40;
    let y = top;
    // Ниже уже стоящих окон в первой колонке
    for (const p of pins) {
      if (p.x !== undefined && p.y !== undefined && Math.abs(p.x - x) < 40) y = Math.max(y, p.y + (els[p.key]?.offsetHeight ?? 120) + gap);
    }
    for (const p of fresh) {
      const h = els[p.key]?.offsetHeight ?? 120;
      if (y + h > vh - 40) { x += PIN_W.default + 24; y = top; }
      p.x = x;
      p.y = y;
      y += h + gap;
    }
    save(fresh);
  }

  /** Место над окном под кнопки редактора (замок, крестик) */
  const CTRL = 36;

  /** Окно не должно уехать за экран (например, после смены разрешения). Если окно помещается —
   *  оставляем над ним место под кнопки, чтобы их было за что взять. */
  function clamp(p: Pin) {
    const h = els[p.key]?.offsetHeight ?? 100;
    const top = h + CTRL <= vh ? CTRL : 0;
    if (p.x !== undefined) p.x = Math.max(0, Math.min(vw - W(p), p.x));
    if (p.y !== undefined) p.y = Math.max(top, Math.min(vh - Math.min(h, vh), p.y));
  }
  /** Окно прижато к верху экрана (очень длинный пункт) — кнопки рисуем внутри окна */
  const ctrlInside = (p: Pin) => (p.y ?? 0) < CTRL;
  /** Уголок для ширины — внизу справа, а если окно выше экрана — у нижнего края экрана, чтобы до него дотянуться */
  function rzTop(p: Pin) {
    const h = els[p.key]?.offsetHeight ?? 100;
    return Math.min(h - 7, vh - (p.y ?? 0) - 24);
  }

  function apply(list: Pin[]) {
    if (dragging) return;
    pins = list;
    if (selected && !pins.some((p) => p.key === selected)) selected = null;
    requestAnimationFrame(() => { place(); pins.forEach(clamp); });
  }

  $effect(() => {
    const offs: (() => void)[] = [];
    backend.pinsGet().then((s) => { editorKey = s.editorKey; editor = s.editor; apply(s.pins); if (editor) sessionStart(); }).catch(() => {});
    backend.on('pins-changed', (p) => apply(p as Pin[])).then((u) => offs.push(u));
    backend.on('pins-editor', (open) => {
      const was = editor;
      editor = !!open;
      if (!editor) selected = null;
      if (editor && !was) sessionStart();
      else if (!editor && was) sessionEnd();
    }).then((u) => offs.push(u));
    backend.on('settings-changed', (s) => { const k = (s as { editorHotkey?: string }).editorHotkey; if (k) editorKey = k; }).then((u) => offs.push(u));
    const resize = () => { vw = window.innerWidth; vh = window.innerHeight; pins.forEach(clamp); };
    window.addEventListener('resize', resize);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && editor) void backend.pinsEditor(false); };
    window.addEventListener('keydown', esc);
    return () => { offs.forEach((f) => f()); window.removeEventListener('resize', resize); window.removeEventListener('keydown', esc); };
  });

  // ── Перетаскивание: зажать мышкой в любом месте окна ──
  let moving = $state<string | null>(null);
  function drag(e: PointerEvent, p: Pin) {
    if (!editor) return;
    selected = p.key;
    if (p.locked || e.button !== 0 || (e.target as HTMLElement).closest('button, .rz')) return;
    e.preventDefault();
    selected = p.key;
    dragging = true;
    moving = p.key;
    const sx = e.clientX - (p.x ?? 0);
    const sy = e.clientY - (p.y ?? 0);
    const move = (ev: PointerEvent) => { p.x = ev.clientX - sx; p.y = ev.clientY - sy; clamp(p); };
    const up = () => {
      dragging = false;
      moving = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      save([p]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ── Ширина за уголок (высота подстраивается под текст сама) ──
  function resizeW(e: PointerEvent, p: Pin) {
    if (p.locked) return;
    e.preventDefault();
    e.stopPropagation();
    selected = p.key;
    dragging = true;
    const sx = e.clientX;
    const sw = W(p);
    const move = (ev: PointerEvent) => {
      p.w = Math.round(Math.min(PIN_W.max, Math.max(PIN_W.min, sw + ev.clientX - sx, 0), vw - (p.x ?? 0)));
    };
    const up = () => {
      dragging = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      clamp(p);
      save([p]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  function saveSoon(p: Pin) {
    clearTimeout(timer);
    timer = setTimeout(() => { clamp(p); save([p]); }, 250);
  }

  function toggleLock(p: Pin) {
    p.locked = !p.locked;
    save([p]);
  }

  function unpin(p: Pin) {
    pins = pins.filter((x) => x !== p);
    if (selected === p.key) selected = null;
    void backend.pinsRemove(p.key).catch(() => {});
    stat('pin_remove', { how: 'editor', left: pins.length });
  }

  // ── Анонимная статистика редактора (уходит, только если игрок её разрешил — проверяет программа) ──
  const stat = (name: string, props: Record<string, string | number>) => void backend.stat(name, props).catch(() => {});
  let session: { t: number; via: string; before: Map<string, Pin> } | null = null;
  function sessionStart() {
    session = { t: Date.now(), via: 'hotkey', before: new Map() };
    // Снимок раскладки — после того как новые окна получили место на экране
    setTimeout(() => { if (session) session.before = new Map(pins.map((p) => [p.key, { ...p }])); }, 300);
    backend.pinsGet().then((s) => { if (session) session.via = s.editorVia ?? 'hotkey'; }).catch(() => {});
  }
  function sessionEnd() {
    if (!session) return;
    const { t, via, before } = session;
    session = null;
    let moved = 0, resized = 0, styled = 0, locked = 0;
    for (const p of pins) {
      const b = before.get(p.key);
      if (p.locked) locked++;
      if (!b) continue;
      if (b.x !== undefined && (b.x !== p.x || b.y !== p.y)) moved++;
      if (b.w !== p.w) resized++;
      if (b.bg !== p.bg || b.font !== p.font) styled++;
    }
    stat('editor', { via, seconds: Math.round((Date.now() - t) / 1000), pins: pins.length, moved, resized, styled, locked });
  }

  const sel = $derived(pins.find((p) => p.key === selected));
  /** Ползунки — под выбранным окном; нет места — над ним; окно на весь экран — сбоку */
  const panelPos = $derived.by(() => {
    if (!sel || sel.x === undefined || sel.y === undefined) return null;
    const PW = 270, PH = 150, gap = 14;
    const h = els[sel.key]?.offsetHeight ?? 100;
    const x = Math.max(8, Math.min(sel.x, vw - PW - 8));
    if (sel.y + h + gap + PH < vh) return { x, y: sel.y + h + gap };
    if (sel.y - CTRL - gap - PH > 0) return { x, y: sel.y - CTRL - gap - PH };
    const right = sel.x + W(sel) + gap;
    const sx = right + PW < vw ? right : Math.max(8, sel.x - gap - PW);
    return { x: sx, y: Math.max(84, Math.min(vh - PH - 8, sel.y + 48)) }; // 84 — ниже плашки «Редактор окон»
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="layer" class:editor onpointerdown={(e) => { if (e.target === e.currentTarget) selected = null; }}>
  {#if editor}
    <div class="dim" aria-hidden="true"></div>
    <div class="topbar" role="toolbar" aria-label="Редактор окон">
      <b>Редактор окон</b>
      <span class="how">Двигайте окно мышкой, ширину — за уголок <span class="rz-ico"></span></span>
      <span class="k">Esc</span>
      <button class="done" onclick={() => backend.pinsEditor(false)}>Готово</button>
    </div>
    {#if !pins.length}
      <p class="empty">Закреплённых пунктов нет. Нажмите булавку у пункта в программе.</p>
    {/if}
  {/if}

  {#each pins as p (p.key)}
    <div
      class="pin"
      class:ed={editor}
      class:sel={editor && selected === p.key}
      class:locked={editor && p.locked}
      class:moving={moving === p.key}
      style:left="{p.x ?? -9999}px"
      style:top="{p.y ?? -9999}px"
      style:width="{W(p)}px"
      style:--bg="rgba(14, 15, 19, {BG(p) / 100})"
      style:--font="{FONT(p)}px"
      bind:this={els[p.key]}
      onpointerdown={(e) => drag(e, p)}
    >
      {#if editor}
        <div class="ctrl" class:inside={ctrlInside(p)}>
          <button class="c lock" class:on={p.locked} onclick={() => toggleLock(p)} title={p.locked ? 'Разлочить — можно будет двигать' : 'Залочить положение и размер'} aria-label={p.locked ? 'Разлочить' : 'Залочить'}>
            <Icon name={p.locked ? 'lock' : 'unlock'} size={13} />
          </button>
          <button class="c" onclick={() => unpin(p)} title="Открепить" aria-label="Открепить"><Icon name="close" size={13} /></button>
        </div>
        {#if !p.locked}<span class="rz" style:top="{rzTop(p)}px" onpointerdown={(e) => resizeW(e, p)} title="Тяните, чтобы поменять ширину" aria-hidden="true"></span>{/if}
      {/if}
      <div class="h"><span class="badge">{p.badge}</span><span class="doc">{p.doc}</span></div>
      <p class="text">{p.text}</p>
      {#if p.punish.length}
        <div class="pun">{#each p.punish as x (x)}<span>{x}</span>{/each}</div>
      {/if}
    </div>
  {/each}

  {#if editor && sel && panelPos}
    <div class="panel" style:left="{panelPos.x}px" style:top="{panelPos.y}px">
      <label class="sl">
        <span class="l"><span>Фон окна</span><span>{BG(sel) === 0 ? 'прозрачный' : BG(sel) === 100 ? 'сплошной' : `${BG(sel)}%`}</span></span>
        <input type="range" min="0" max="100" step="5" value={BG(sel)} oninput={(e) => { sel.bg = Number(e.currentTarget.value); saveSoon(sel); }} />
        <span class="lim"><span>прозрачный</span><span>сплошной</span></span>
      </label>
      <label class="sl">
        <span class="l"><span>Размер шрифта</span><span>{FONT(sel)}</span></span>
        <input type="range" min={PIN_FONT.min} max={PIN_FONT.max} step="1" value={FONT(sel)} oninput={(e) => { sel.font = Number(e.currentTarget.value); saveSoon(sel); }} />
        <span class="lim"><span>{PIN_FONT.min}</span><span>{PIN_FONT.max}</span></span>
      </label>
    </div>
  {/if}

  {#if editor}
    <p class="foot">Открыть редактор снова — {#each keys(editorKey) as k, i (i)}{#if i}<span class="plus">+</span>{/if}<kbd>{k}</kbd>{/each}</p>
  {/if}
</div>

<style>
  :global(html), :global(body) { background: transparent !important; overflow: hidden; }
  .layer { position: fixed; inset: 0; pointer-events: none; }
  .layer.editor { pointer-events: auto; }
  .dim {
    position: absolute; inset: 0;
    background: rgba(5, 6, 10, 0.6);
    background-image: linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
    background-size: 48px 48px;
    pointer-events: none;
  }
  .topbar {
    position: absolute; left: 50%; top: 18px; transform: translateX(-50%);
    display: flex; align-items: center; gap: 14px;
    padding: 9px 10px 9px 16px; border-radius: 12px;
    background: var(--surface); border: 1px solid var(--border-strong); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    font-size: var(--fs-sm); white-space: nowrap; z-index: 5;
  }
  .topbar b { font-weight: 800; }
  .how { display: inline-flex; align-items: center; gap: 6px; color: var(--text-dim); }
  .k { padding: 2px 8px; border-radius: 5px; background: var(--surface-3); font-size: 12px; font-weight: 700; color: var(--text-dim); }
  .done { height: 32px; padding: 0 14px; border: 0; border-radius: 8px; background: var(--accent); color: var(--on-accent); font-weight: 800; font-size: var(--fs-sm); }
  .done:hover { background: var(--accent-soft); }
  .empty { position: absolute; left: 50%; top: 45%; transform: translateX(-50%); margin: 0; padding: 12px 16px; border-radius: 12px; background: var(--surface); color: var(--text-dim); font-size: var(--fs-sm); }
  .foot { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); margin: 0; padding: 6px 12px; border-radius: 999px; background: rgba(26, 27, 30, 0.9); color: var(--text-dim); font-size: var(--fs-xs); font-weight: 600; display: flex; align-items: center; gap: 4px; }
  .foot kbd { padding: 0 6px; font-size: 11px; background: rgba(255, 255, 255, 0.08); }
  .plus { color: var(--text-muted); font-size: 10px; }

  .pin {
    position: absolute;
    padding: 11px 13px 12px;
    border-radius: 10px;
    background: var(--bg);
    color: #fff;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
    font-size: var(--font);
    pointer-events: none;
  }
  .pin.ed { z-index: 1; pointer-events: auto; outline: 1.5px dashed rgba(255, 255, 255, 0.4); outline-offset: 3px; cursor: grab; user-select: none; touch-action: none; }
  .pin.ed:hover:not(.locked):not(.sel) { outline-color: rgba(255, 255, 255, 0.75); }
  .pin.moving { cursor: grabbing; box-shadow: 0 14px 34px rgba(0, 0, 0, 0.5); }
  .pin.ed.locked { cursor: default; }
  .pin.ed .c { cursor: pointer; }
  .pin.sel { outline: 2px solid var(--accent); z-index: 3; }
  .pin.locked { outline-color: rgba(255, 255, 255, 0.2); }
  .h { display: flex; align-items: center; gap: 7px; margin-bottom: 0.4em; min-width: 0; }
  .badge { flex-shrink: 0; padding: 1px 7px; border-radius: 5px; background: rgba(255, 195, 0, 0.25); color: var(--accent-soft); font-weight: 800; font-size: 0.86em; }
  .doc { min-width: 0; font-size: 0.82em; color: rgba(255, 255, 255, 0.65); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .text { margin: 0; line-height: 1.45; white-space: pre-line; overflow-wrap: anywhere; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7); }
  .pun { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 0.5em; }
  .pun span { padding: 2px 8px; border-radius: 5px; background: rgba(255, 90, 95, 0.3); color: #ffc2c4; font-size: 0.86em; font-weight: 800; }

  .ctrl { position: absolute; top: -32px; right: -4px; display: flex; gap: 4px; z-index: 2; }
  .ctrl.inside { top: 6px; right: 6px; padding: 3px; border-radius: 8px; background: rgba(14, 15, 19, 0.85); }
  .c { display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border-radius: 6px; background: var(--surface); border: 1px solid var(--border-strong); color: var(--text-dim); }
  .c:hover:not(:disabled) { color: var(--text); border-color: var(--accent-line); }
  .c.lock.on { background: var(--accent-tint); border-color: var(--accent-line); color: var(--accent); }
  .rz-ico { display: inline-block; width: 11px; height: 11px; border-radius: 3px; background: var(--accent); border: 2px solid #111; }
  .rz { position: absolute; right: -7px; width: 14px; height: 14px; border-radius: 3px; background: var(--accent); border: 2px solid #111; cursor: ew-resize; touch-action: none; }

  .panel { position: absolute; width: 270px; padding: 13px 15px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border-strong); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55); font-size: 12.5px; z-index: 4; }
  .sl { display: block; margin-bottom: 11px; }
  .sl:last-child { margin-bottom: 0; }
  .l { display: flex; justify-content: space-between; color: var(--text-dim); font-weight: 700; margin-bottom: 6px; }
  .l span:last-child { color: var(--text); font-variant-numeric: tabular-nums; }
  .lim { display: flex; justify-content: space-between; color: var(--text-muted); font-size: 11px; margin-top: 2px; }
  input[type='range'] { width: 100%; accent-color: var(--accent); margin: 0; }
</style>
