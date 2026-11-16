<script lang="ts">
  /**
   * Новость 0.7.0 «Было → Стало»: шторку тянут мышкой — слева сообщение скупщиков в Discord,
   * справа окна с ценами поверх игры. Показывается всем один раз после обновления.
   */
  import Icon from './Icon.svelte';
  import { prices } from '../prices.svelte';

  let { onDone }: { onDone: (result: 'open' | 'later' | 'esc', moved: boolean) => void } = $props();

  let pos = $state(58);
  let moved = $state(false);

  function down(e: PointerEvent) {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const set = (x: number) => { pos = Math.max(4, Math.min(96, ((x - box.left) / box.width) * 100)); moved = true; };
    set(e.clientX);
    const move = (ev: PointerEvent) => set(ev.clientX);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); onDone('esc', moved); }
    else if (e.key === 'ArrowLeft') { pos = Math.max(4, pos - 6); moved = true; }
    else if (e.key === 'ArrowRight') { pos = Math.min(96, pos + 6); moved = true; }
  }

  // Картинка «Было»: настоящее сообщение скупщиков за 16.11.2026 22:05
  const ITEMS = ['Медь', 'Изумруд', 'Рубин', 'Алмаз', 'Бензин', 'Солярка', 'Керосин', 'Фальшивые деньги', 'Окунь', 'Карп', 'Форель', 'Лосось', 'Жемчуг', 'Шкура', 'Идеальное мясо', 'Хорошее мясо'];
  const B1 = [[35, 42], [131, 157], [616, 739], [3602, 4322], [130, 156], [96, 115], [124, 148], [5876, 7051], [45, 54], [364, 436], [452, 542], [3725, 4470], [1341, 1609], [789, 946], [728, 873], [355, 426]];
  const B2 = [[23, 27], [176, 211], [638, 765], [2989, 3586], [170, 204], [180, 216], [158, 189], [9387, 11264], [43, 51]];
  const blocks = [{ n: '№1', rows: B1 }, { n: '№2', rows: B2 }];

  // Картинка «Стало»: два окна поверх игры — редкая цена и сработавшая цель
  type C = { n: number; p: number; m: number; d: number; k?: 'best' | 'rare' | 'goal' };
  const wins: { item: string; cells: C[]; goal?: number; style: string }[] = [
    { item: 'Солярка', style: 'left: 14px; top: 12px; transform-origin: top left', cells: [{ n: 1, p: 115, m: 96, d: 47 }, { n: 2, p: 231, m: 193, d: 22, k: 'rare' }, { n: 3, p: 94, m: 79, d: -24 }] },
    { item: 'Лосось', style: 'right: 14px; top: 126px; transform-origin: top right', goal: 4400, cells: [{ n: 1, p: 4470, m: 3725, d: 80, k: 'goal' }, { n: 2, p: 2547, m: 2123, d: -35 }, { n: 3, p: 4308, m: 3590, d: 116 }] },
  ];
</script>

<svelte:window onkeydown={onKey} />

<div class="news">
  <div class="top">
    <span class="ver">Обновление 0.7.0</span>
    <button class="x" aria-label="Закрыть" onclick={() => onDone('later', moved)}><Icon name="close" size={16} /></button>
  </div>
  <h2>Хватит листать<br />Discord <span class="acc">за ценами</span></h2>
  <p class="sub">Скупщики теперь в программе и прямо в игре — только твои товары, и лучшая цена видна сразу.</p>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="cmp" onpointerdown={down} role="slider" tabindex="0" aria-label="Сравнить: было и стало" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos)}>
    <div class="layer after">
      <div class="city"></div>
      {#each wins as w (w.item)}
        <div class="win" style={w.style}>
          <div class="wh"><span class="badge">{w.item}</span><span class="meta">22:05 · ↻ 23 мин</span></div>
          <div class="cells">
            {#each w.cells as c (c.n)}
              <div class="cell {c.k ?? ''}">
                {#if c.k === 'rare'}<svg class="seal" aria-hidden="true" viewBox="0 0 24 24"><defs><linearGradient id="ng" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe68a" /><stop offset="0.55" stop-color="#ffc300" /><stop offset="1" stop-color="#d99a00" /></linearGradient></defs><path d="M0 0H24V24Z" fill="url(#ng)" /><g transform="translate(12.6 2.6) scale(0.6)"><path d="M1.5 10.5h13M2 9 1 2.5l4 3L8 1l3 4.5 4-3L14 9z" fill="#2a1e00" stroke="#2a1e00" stroke-width="1.4" stroke-linejoin="round" /></g></svg>{/if}
                <span class="n">№{c.n}</span><span class="p">${c.p}</span><span class="m">мин ${c.m}</span>
                <span class="d" class:up={c.d > 0}>{c.d > 0 ? '▲' : '▼'}{Math.abs(c.d)}%</span>
              </div>
            {/each}
          </div>
          {#if w.goal}<div class="tab"><svg aria-hidden="true" viewBox="0 0 104 20" preserveAspectRatio="none"><path d="M0 0C12 0 14 20 26 20H78C90 20 92 0 104 0Z" fill="rgba(14,15,19,0.72)" /></svg><span>цель ${w.goal}</span></div>{/if}
        </div>
      {/each}
      <span class="lbl right">Стало</span>
    </div>

    <div class="clip" style:clip-path="inset(0 {100 - pos}% 0 0)">
      <div class="layer before">
        <div class="msg">
          <span class="ava" aria-hidden="true"></span>
          <div class="body">
            <div class="who"><b>GTA V: NOVA RP</b><span>сегодня в 22:05</span></div>
            <div class="title">Изменение цен у скупщиков (16.11.2026 22:05 МСК)</div>
            {#each blocks as b (b.n)}
              <div class="bt"><span class="dia" aria-hidden="true"></span>Скупщик сырья {b.n}</div>
              <div class="code">{#each b.rows as r, i (i)}<div>- {ITEMS[i]}: ${r[0]} (${r[1]})</div>{/each}</div>
            {/each}
          </div>
        </div>
        <span class="lbl left">Было</span>
      </div>
    </div>

    <div class="handle" style:left="{pos}%"><span class="knob"><svg aria-hidden="true" width="18" height="12" viewBox="0 0 18 12"><path d="M6 1 1 6l5 5M12 1l5 5-5 5" fill="none" stroke="#1a1400" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></span></div>
    {#if !moved}<span class="drag-hint">Потяни ⇆</span>{/if}
  </div>

  <div class="facts">
    <div class="fact"><span class="fi green"><Icon name="refresh" size={16} /></span><span>Цены обновляются сами каждый час</span></div>
    <div class="fact"><span class="fi gold"><svg aria-hidden="true" width="17" height="13" viewBox="0 0 16 12"><path d="M1.5 10.5h13M2 9 1 2.5l4 3L8 1l3 4.5 4-3L14 9z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" /></svg></span><span>Корона — дороже почти всех за неделю</span></div>
    <div class="fact">
      <span class="fi green"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 13.5V9a4.5 4.5 0 0 1 9 0v4.5l1.3 1.5H4.2Z" /><path d="M8.3 17a1.8 1.8 0 0 0 3.4 0" /></svg></span>
      <span>Сигнал, когда цена дошла до цели</span>
      <button class="play" onclick={() => prices.chime()} aria-label="Послушать сигнал" title="Послушать сигнал"><svg aria-hidden="true" width="10" height="10" viewBox="0 0 12 12"><path d="M3 1.8v8.4L10 6Z" fill="currentColor" /></svg></button>
    </div>
  </div>

  <div class="cta">
    <button class="btn primary" onclick={() => onDone('open', moved)}><Icon name="chartline" size={16} />Открыть скупщиков</button>
    <button class="btn ghost" onclick={() => onDone('later', moved)}>Позже</button>
  </div>
</div>

<style>
  .news { display: flex; flex-direction: column; gap: 12px; color: var(--text); }
  .top { display: flex; align-items: center; justify-content: space-between; }
  .ver { font-size: 11.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
  .x { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-muted); }
  .x:hover { background: var(--surface-2); color: var(--text); }
  h2 { margin: 0; font-size: 30px; line-height: 1.08; font-weight: 800; letter-spacing: -0.025em; }
  .acc { color: var(--accent); }
  .sub { margin: -2px 0 2px; font-size: var(--fs-sm); line-height: 1.5; color: var(--text-dim); }

  .cmp { position: relative; height: 262px; border-radius: 14px; overflow: hidden; border: 1px solid var(--border); cursor: ew-resize; user-select: none; touch-action: none; }
  .cmp:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .layer { position: absolute; inset: 0; }
  .clip { position: absolute; inset: 0; }
  .before { background: #313338; overflow: hidden; }
  .before::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 60px; background: linear-gradient(transparent, #313338); }
  .msg { display: flex; gap: 10px; padding: 12px 14px; }
  .ava { width: 30px; height: 30px; border-radius: 50%; background: radial-gradient(circle at 40% 35%, #f0b04a, #8a3f12); flex-shrink: 0; }
  .body { min-width: 0; flex: 1; }
  .who { display: flex; gap: 6px; align-items: baseline; }
  .who b { font-size: 12px; color: #f2f3f5; }
  .who span { font-size: 10px; color: #949ba4; }
  .title { margin-top: 2px; font-size: 11px; font-weight: 800; color: #f2f3f5; }
  .bt { margin-top: 6px; font-size: 11px; font-weight: 800; font-style: italic; color: #dbdee1; }
  .dia { display: inline-block; width: 7px; height: 7px; margin-right: 5px; background: #3b82f6; transform: rotate(45deg); }
  .code { margin-top: 3px; padding: 5px 7px; border-radius: 4px; background: #2b2d31; border: 1px solid #1e1f22; font-family: Consolas, monospace; font-size: 9.5px; line-height: 1.35; color: #dbdee1; }

  .city { position: absolute; inset: 0; background:
    radial-gradient(4px 4px at 12% 72%, rgba(255, 196, 90, 0.9), transparent), radial-gradient(5px 5px at 22% 80%, rgba(255, 150, 60, 0.8), transparent),
    radial-gradient(3px 3px at 35% 74%, rgba(255, 230, 160, 0.9), transparent), radial-gradient(6px 6px at 78% 78%, rgba(120, 170, 255, 0.7), transparent),
    radial-gradient(4px 4px at 90% 70%, rgba(255, 200, 120, 0.85), transparent), radial-gradient(3px 3px at 60% 84%, rgba(255, 240, 200, 0.8), transparent),
    radial-gradient(70% 30% at 50% 90%, rgba(255, 140, 50, 0.22), transparent), linear-gradient(180deg, #1b2333 0%, #2a3346 55%, #3a3640 75%, #191a1f 100%); }
  .win { position: absolute; width: 230px; transform: scale(0.9); box-sizing: border-box; padding: 9px 11px 10px; border-radius: 10px; background: rgba(14, 15, 19, 0.72); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3); color: #fff; font-size: 14px; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7); }
  .wh { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3em; }
  .badge { padding: 1px 7px; border-radius: 5px; background: rgba(255, 195, 0, 0.25); color: var(--accent-soft); font-weight: 800; font-size: 0.86em; }
  .meta { font-size: 0.78em; color: rgba(255, 255, 255, 0.65); font-weight: 600; }
  .cells { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
  .cell { position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: center; padding: 3px 2px 4px; border-radius: 6px; font-variant-numeric: tabular-nums; }
  .n { font-size: 0.72em; font-weight: 800; color: rgba(255, 255, 255, 0.55); }
  .p { font-weight: 800; line-height: 1.25; }
  .m { font-size: 0.72em; font-weight: 600; color: rgba(255, 255, 255, 0.55); }
  .d { font-size: 0.7em; font-weight: 800; color: #ff8a8a; }
  .d.up { color: #6fdc9a; }
  .cell.rare { background: linear-gradient(180deg, rgba(255, 195, 0, 0.24) 0%, rgba(255, 195, 0, 0.1) 100%); box-shadow: inset 0 0 0 1px rgba(255, 195, 0, 0.85); }
  .cell.rare .n, .cell.rare .p { color: var(--accent-soft); }
  .cell.goal { background: rgba(111, 220, 154, 0.28); box-shadow: inset 0 0 0 1px rgba(111, 220, 154, 0.7); }
  .cell.goal .n, .cell.goal .p { color: #a9f0c6; }
  .seal { position: absolute; top: 0; right: 0; width: 1.6em; height: 1.6em; }
  .tab { position: absolute; left: 50%; top: 100%; transform: translateX(-50%); width: 104px; height: 20px; margin-top: -1px; }
  .tab svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .tab span { position: relative; display: block; text-align: center; font-size: 11px; line-height: 17px; font-weight: 800; color: #6fdc9a; }

  .lbl { position: absolute; bottom: 10px; z-index: 2; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 800; letter-spacing: 0.04em; }
  .lbl.left { left: 10px; background: rgba(0, 0, 0, 0.45); color: #dbdee1; }
  .lbl.right { right: 10px; top: 10px; bottom: auto; background: var(--accent); color: var(--on-accent); }
  .handle { position: absolute; top: 0; bottom: 0; z-index: 3; width: 2px; margin-left: -1px; background: var(--accent); box-shadow: 0 0 12px rgba(255, 195, 0, 0.6); pointer-events: none; }
  .knob { position: absolute; top: 50%; left: 50%; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; background: var(--accent); display: grid; place-items: center; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45); }
  .drag-hint { position: absolute; left: 50%; top: 12px; z-index: 4; transform: translateX(-50%); padding: 4px 10px; border-radius: 999px; background: rgba(14, 15, 19, 0.8); font-size: 11.5px; font-weight: 800; color: var(--accent-soft); pointer-events: none; animation: bob 1.6s ease-in-out infinite; }
  @keyframes bob { 50% { transform: translateX(calc(-50% + 6px)); } }

  .facts { display: flex; flex-direction: column; gap: 8px; }
  .fact { display: flex; align-items: center; gap: 10px; font-size: var(--fs-sm); font-weight: 600; color: #dadce0; }
  .fact > span:nth-child(2) { flex: 1; }
  .fi { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0; }
  .fi.green { color: var(--success); background: var(--success-tint); }
  .fi.gold { color: var(--accent); background: var(--accent-tint); }
  .play { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border-radius: 50%; border: 1px solid rgba(111, 220, 154, 0.55); background: transparent; color: #a9f0c6; }
  .play:hover { background: var(--success-tint); }
  .cta { display: flex; gap: 6px; margin-top: 4px; }
  .cta .primary { flex: 1; height: 42px; font-size: 14px; }
  .cta .ghost { height: 42px; }
  @media (max-width: 520px) { h2 { font-size: 25px; } }
</style>
