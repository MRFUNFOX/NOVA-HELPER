<script lang="ts">
  // Окно раздела в меню поверх игры: двигать за заголовок, растягивать за края,
  // своя прозрачность (значок с полукругом), крестик. Место и размер запоминаются.
  import type { Snippet } from 'svelte';
  import Icon, { type IconName } from '../Icon.svelte';
  import { gm, glassVars, WIN, type WinId } from '../../gamemenu.svelte';

  let { id, title, icon, tools, children, ownGlass = true, badge = '' }: {
    id: WinId; title: string; icon: IconName; tools?: Snippet; children: Snippet; ownGlass?: boolean; badge?: string;
  } = $props();

  let sec: HTMLElement | undefined = $state();
  let glassOpen = $state(false);
  const g = $derived(gm.geo(id));
  const spec = $derived(WIN[id]);
  const placed = $derived(g.x !== undefined && g.y !== undefined);
  const own = $derived(ownGlass && g.glass !== undefined);
  const t = $derived(own ? g.glass! : gm.layout.glass);

  const style = $derived.by(() => {
    let s = placed ? `position: absolute; left: ${g.x}px; top: ${g.y}px;` : `position: relative; order: ${gm.open.indexOf(id)};`;
    s += ` width: ${g.w ?? spec.w}px;`;
    if (spec.h) s += g.h ? ` height: ${g.h}px; max-height: none;` : ` height: ${spec.h}px;`;
    s += gm.top === id ? ' z-index: 3;' : ' z-index: 1;';
    if (own) s += ' ' + glassVars(g.glass!);
    return s;
  });

  const clamp = (v: number, a: number, b: number) => Math.round(Math.max(a, Math.min(b, v)));
  const busy = (e: PointerEvent | MouseEvent) => !!(e.target as Element).closest('button, input, a, label, select, textarea, [role="radiogroup"], [role="dialog"]');

  // ── Перетаскивание за заголовок ──
  let drag: { dx: number; dy: number; w: number } | null = null;
  function dragStart(e: PointerEvent) {
    if (e.button !== 0 || busy(e) || !sec) return;
    e.preventDefault();
    const r = sec.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    gm.top = id;
    glassOpen = false;
    gm.setGeo(id, { x: Math.round(r.left), y: Math.round(r.top) }, false);
  }
  function dragMove(e: PointerEvent) {
    if (!drag) return;
    // Заголовок всегда остаётся на экране — окно можно поймать обратно
    gm.setGeo(id, { x: clamp(e.clientX - drag.dx, -(drag.w - 120), gm.vw - 120), y: clamp(e.clientY - drag.dy, 0, gm.vh - 56) }, false);
  }
  function dragEnd() {
    if (!drag) return;
    drag = null;
    gm.save();
  }
  function home(e: MouseEvent) {
    if (!busy(e)) gm.setGeo(id, { x: undefined, y: undefined });
  }

  // ── Растягивание за края ──
  type Edge = 'l' | 'r' | 'b' | 'bl' | 'br';
  let rs: { edge: Edge; sx: number; sy: number; x0: number; y0: number; w0: number; h0: number } | null = null;
  function sizeStart(e: PointerEvent, edge: Edge) {
    if (e.button !== 0 || !sec) return;
    e.preventDefault();
    e.stopPropagation();
    const r = sec.getBoundingClientRect();
    rs = { edge, sx: e.clientX, sy: e.clientY, x0: r.left, y0: r.top, w0: r.width, h0: r.height };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    gm.top = id;
    // Левый верхний угол стоит на месте, тянется нужный край
    gm.setGeo(id, { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: spec.h ? Math.round(r.height) : undefined }, false);
  }
  function sizeMove(e: PointerEvent) {
    if (!rs) return;
    const dx = e.clientX - rs.sx, dy = e.clientY - rs.sy;
    let w = rs.w0, x = rs.x0, h = rs.h0;
    if (rs.edge.includes('r')) w = clamp(rs.w0 + dx, spec.minW, Math.max(spec.minW, gm.vw - rs.x0 - 8));
    if (rs.edge.includes('l')) { w = clamp(rs.w0 - dx, spec.minW, Math.max(spec.minW, rs.x0 + rs.w0 - 8)); x = rs.x0 + rs.w0 - w; }
    if (rs.edge.includes('b') && spec.h) h = clamp(rs.h0 + dy, spec.minH, Math.max(spec.minH, gm.vh - rs.y0 - 8));
    gm.setGeo(id, { x: Math.round(x), w, h: spec.h ? h : undefined }, false);
  }
  function sizeEnd() {
    if (!rs) return;
    rs = null;
    gm.save();
  }
  const edges: Edge[] = $derived(spec.h ? ['l', 'r', 'b', 'bl', 'br'] : ['l', 'r']);

  function setGlass(e: Event) {
    gm.setGeo(id, { glass: Number((e.currentTarget as HTMLInputElement).value) });
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="gw" bind:this={sec} {style} aria-label={title} onpointerdown={() => (gm.top = id)}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header onpointerdown={dragStart} onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={dragEnd} ondblclick={home}>
    <Icon name={icon} size={17} />
    <h2>{title}</h2>
    {#if badge}<span class="xb" title="Функция в разработке: может меняться">{badge}</span><span class="fill"></span>{/if}
    <span class="tools">{@render tools?.()}</span>
    {#if ownGlass}
      <button class="ib" class:own class:open={glassOpen} aria-label="Прозрачность этого окна" aria-expanded={glassOpen} title="Прозрачность этого окна" onclick={() => (glassOpen = !glassOpen)}><Icon name="contrast" size={16} /></button>
    {/if}
    <button class="ib" aria-label="Закрыть окно" onclick={() => gm.close(id)}><Icon name="close" size={16} /></button>
  </header>
  {#if glassOpen}
    <div class="pop" role="dialog" aria-label="Прозрачность этого окна">
      <b>Прозрачность этого окна</b>
      <div class="row"><input type="range" min="0" max="80" value={t} oninput={setGlass} aria-label="Прозрачность этого окна" /><span>{t}%</span></div>
      <div class="row"><small>{own ? `Своя настройка. Общая — ${gm.layout.glass}%.` : 'Сейчас как у всех окон.'}</small><button class="btn" onclick={() => gm.setGeo(id, { glass: undefined })}>Как у всех</button></div>
    </div>
  {/if}
  <div class="body">{@render children()}</div>
  {#each edges as edge (edge)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="rz rz-{edge}" aria-hidden="true" onpointerdown={(e) => sizeStart(e, edge)} onpointermove={sizeMove} onpointerup={sizeEnd} onpointercancel={sizeEnd} ondblclick={() => gm.setGeo(id, { w: undefined, h: undefined })}></div>
  {/each}
</section>

<style>
  .gw { pointer-events: auto; display: flex; flex-direction: column; box-sizing: border-box; max-height: 100%; border-radius: var(--radius-lg); background: var(--bg); border: 1px solid var(--border); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5); overflow: hidden; color: var(--text); }
  header { display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 8px 0 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; cursor: grab; user-select: none; touch-action: none; }
  header > :global(svg) { color: var(--accent); flex-shrink: 0; }
  .xb { padding: 3px 7px; border-radius: 6px; font-size: 11px; font-weight: 800; background: var(--accent); color: var(--on-accent); white-space: nowrap; flex-shrink: 0; }
  .fill { flex: 1; }
  h2:has(+ .xb) { flex: 0 1 auto; }
  h2 { margin: 0; flex: 1; min-width: 0; font-size: 15px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tools { display: flex; align-items: center; gap: 4px; }
  /* Кнопки, которые окно получает снаружи (история и «начать заново» у помощника) — как свои */
  .tools :global(.ib) { width: 34px; height: 34px; flex-shrink: 0; border: 0; border-radius: 8px; background: transparent; color: var(--text-dim); display: grid; place-items: center; cursor: pointer; }
  .tools :global(.ib:hover) { background: var(--surface-2); color: var(--text); }
  .tools :global(.ib.open) { background: var(--surface-3); color: var(--accent-soft); }
  .tools :global(.ib:disabled) { opacity: 0.45; cursor: default; }
  .ib { width: 34px; height: 34px; flex-shrink: 0; border: 0; border-radius: 8px; background: transparent; color: var(--text-dim); display: grid; place-items: center; cursor: pointer; }
  .ib:hover { background: var(--surface-2); color: var(--text); }
  .ib.own { color: var(--accent); }
  .ib.open { background: var(--surface-3); color: var(--accent-soft); }
  .body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
  .pop { position: absolute; right: 8px; top: 48px; z-index: 5; width: 280px; padding: 14px; box-sizing: border-box; border-radius: 12px; background: #212226; border: 1px solid #3a3c42; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55); display: flex; flex-direction: column; gap: 10px; }
  .pop b { font-size: 13px; }
  .row { display: flex; align-items: center; gap: 10px; }
  .row input { flex: 1; accent-color: var(--accent); }
  .row span { width: 36px; text-align: right; font-size: 12.5px; font-weight: 700; color: var(--text-dim); }
  .row small { flex: 1; font-size: 12px; line-height: 1.4; color: var(--text-muted); }
  .btn { height: 30px; padding: 0 10px; border: 1px solid #3a3c42; border-radius: 8px; background: #313238; color: var(--text); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
  .rz { position: absolute; z-index: 4; touch-action: none; }
  .rz-l { left: 0; top: 52px; bottom: 10px; width: 6px; cursor: ew-resize; }
  .rz-r { right: 0; top: 52px; bottom: 10px; width: 6px; cursor: ew-resize; }
  .rz-b { left: 10px; right: 10px; bottom: 0; height: 6px; cursor: ns-resize; }
  .rz-bl { left: 0; bottom: 0; width: 12px; height: 12px; cursor: nesw-resize; }
  .rz-br { right: 0; bottom: 0; width: 12px; height: 12px; cursor: nwse-resize; }
</style>
