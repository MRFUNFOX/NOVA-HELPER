<script lang="ts">
  // Раздел «Скупщики»: цены трёх скупщиков сырья и скупщика продуктов, цели и окна поверх игры
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { app } from '../state.svelte';
  import { backend } from '../backend';
  import { keys } from '../hotkey';
  import { prices } from '../prices.svelte';
  import { fmtPrice, minutesLeft, nextTime, timeLabel, type Group, type Row } from '../prices';

  let tab = $state<Group>('raw');
  let legend = $state(false);
  $effect(() => { untrack(() => prices.opened()); });

  const rows = $derived(prices.rows.filter((r) => r.group === tab));
  const file = $derived(prices.file);
  const left = $derived(file ? minutesLeft(file.time, prices.now) : 0);
  const fresh = $derived(!!file && left > 0);
  const nextLabel = $derived(file ? timeLabel(new Date(nextTime(file.time) + 3 * 3600e3).toISOString()) : '');

  const steps = $derived(prices.steps);
  const done = $derived(steps.filter(Boolean).length);
  const current = $derived(steps.findIndex((s) => !s));
  const showGuide = $derived(!prices.guide.hidden && done < 3);
  /** Товар для ссылки «Поставь цель для …»: первый закреплённый без цели */
  const goalTarget = $derived(prices.rows.find((r) => prices.pinned.has(r.item) && r.goal === null)?.item ?? prices.rows.find((r) => prices.pinned.has(r.item))?.item);

  function focusGoal(item: string) {
    const r = prices.rows.find((x) => x.item === item);
    if (r) tab = r.group;
    requestAnimationFrame(() => {
      const el = document.getElementById(`goal-${item}`) as HTMLInputElement | null;
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus();
    });
  }

  function commitGoal(r: Row, e: Event) {
    const raw = (e.currentTarget as HTMLInputElement).value.replace(/[^\d]/g, '');
    const v = raw ? Number(raw) : null;
    if (v !== r.goal) prices.setGoal(r.item, v);
    (e.currentTarget as HTMLInputElement).value = v ? String(v) : '';
  }

  const editorKeys = $derived(keys(app.editorKey));
  const delta = (d: number | null) => (d === null || d === 0 ? '' : `${d > 0 ? '▲' : '▼'}${Math.abs(d)}%`);
</script>

<section class="buyers">
  <nav class="crumbs" aria-label="Где вы"><span>Инструменты</span><Icon name="chevron" size={13} /><span class="here">Скупщики</span></nav>

  <div class="head">
    <div class="title">
      <h1>Скупщики</h1>
      <p class="status">
        <span class="dot" class:stale={!fresh || prices.loading} class:bad={!!prices.error && !file}></span>
        {#if !file && prices.loading}Загружаю цены…
        {:else if !file}{prices.error || 'Цены ещё не загружены'}
        {:else if fresh}Цены на {timeLabel(file.time)} МСК · следующие около {nextLabel}
        {:else}Цены на {timeLabel(file.time)} МСК · жду новые{prices.error ? ` (${prices.error})` : '…'}{/if}
      </p>
    </div>
    <div class="segmented" role="radiogroup" aria-label="Какие скупщики">
      <button role="radio" aria-checked={tab === 'raw'} class:on={tab === 'raw'} onclick={() => (tab = 'raw')}>Сырьё</button>
      <button role="radio" aria-checked={tab === 'products'} class:on={tab === 'products'} onclick={() => (tab = 'products')}>Продукты</button>
    </div>
  </div>

  {#if showGuide}
    <div class="guide" aria-label="Как пользоваться скупщиками">
      <span class="g-title">
        <b>Начни за 3 шага</b>
        <span class="g-prog"><span class="bar"><span style:width="{(done / 3) * 100}%"></span></span>{done}/3</span>
      </span>
      <span class="g-sep" aria-hidden="true"></span>
      <ol class="g-steps">
        {#each ['Закрепи товар', 'Поставь цель', 'Расставь окна в игре'] as label, i (i)}
          <li class="g-step" class:done={steps[i]} class:now={current === i}>
            <span class="g-num">{#if steps[i]}<Icon name="check" size={12} />{:else}{i + 1}{/if}</span>
            <span class="g-txt">
              <b>{label}</b>
              {#if i === 0 && !steps[0]}<small>булавка у товара ниже</small>{/if}
              {#if i === 1 && !steps[1] && goalTarget}<button class="link" onclick={() => focusGoal(goalTarget!)}>для: {goalTarget.toLowerCase()} →</button>{/if}
              {#if i === 2 && !steps[2]}<span class="g-keys">{#each editorKeys as k, j (j)}<kbd>{k}</kbd>{/each}</span>{/if}
            </span>
          </li>
          {#if i < 2}<Icon name="chevron" size={14} />{/if}
        {/each}
      </ol>
      <button class="btn sm ghost-line" onclick={() => (legend = !legend)} aria-expanded={legend}>Как читать окно</button>
      <button class="x" aria-label="Скрыть подсказку" title="Скрыть — вернуть можно кнопкой «Как это работает»" onclick={() => prices.setGuide({ hidden: true })}><Icon name="close" size={15} /></button>
    </div>
  {/if}

  {#if legend}
    <div class="legend card" role="note">
      <b>Как читать окно</b>
      <ul>
        <li><span class="chip">$204</span>Крупно — цена сразу после обновления скупщика</li>
        <li><span class="chip dim">мин $170</span>Ниже этой цены скупщик не опустит, даже если все продают</li>
        <li><span class="chip"><span class="up">▲8%</span></span>Дороже или дешевле, чем час назад</li>
        <li><span class="chip best">$204</span>Лучшая цена сейчас</li>
        <li><span class="chip rare">$231<span class="corner" aria-hidden="true"></span></span>Редкая — дороже почти всех за неделю</li>
        <li><span class="chip goal">$4470</span>Твоя цель достигнута — окно позеленеет и прозвучит сигнал</li>
      </ul>
    </div>
  {/if}

  <div class="tip">
    <Icon name="window" size={18} />
    <p>Булавка у товара — его цены появятся окном поверх игры. На экране: <b>{prices.pinned.size}</b>.</p>
    <label class="toggle"><input type="checkbox" checked={prices.sound} onchange={(e) => prices.setSound(e.currentTarget.checked)} /><span>Звук при цели</span></label>
    {#if prices.guide.hidden || done === 3}<button class="btn sm ghost" onclick={() => prices.setGuide({ hidden: false, editor: false })}>Как это работает</button>{/if}
    {#if prices.pinned.size}<button class="btn sm" onclick={() => backend.pinsEditor(true)}>Расставить окна</button>{/if}
  </div>

  {#if !file}
    <div class="card empty">
      {#if prices.loading}
        {#each [70, 55, 82, 60] as w, i (i)}<span class="sk" style:width="{w}%" style:height="14px"></span>{/each}
      {:else}
        <p>{prices.error || 'Цены ещё не загружены'}</p>
        <button class="btn" onclick={() => prices.fetchNow()}><Icon name="refresh" size={16} />Попробовать снова</button>
      {/if}
    </div>
  {:else}
    <div class="card table" class:products={tab === 'products'}>
      <div class="thead" aria-hidden="true">
        <span>Товар</span>
        {#if tab === 'raw'}<span class="num">№1</span><span class="num">№2</span><span class="num">№3</span>{:else}<span class="num">Цена</span>{/if}
        <span>Цель</span><span></span>
      </div>
      {#each rows as r (r.item)}
        {@const on = prices.pinned.has(r.item)}
        <div class="row" class:on>
          <span class="name">{r.item}</span>
          <span class="cells">
            {#each r.cells as c (c.n)}
              <span class="cell" class:best={c.best && !c.goal && !c.rare} class:rare={c.rare && !c.goal} class:goal={c.goal}
                title={c.min !== null ? `Скупщик №${c.n}: ${fmtPrice(c.start)} сразу после обновления, ниже ${fmtPrice(c.min)} не опустится` : undefined}>
                {#if c.n}<small class="n">№{c.n}</small>{/if}
                {#if c.rare}<svg class="crown" aria-label="Редкая цена" viewBox="0 0 16 12"><path d="M1.5 10.5h13M2 9 1 2.5l4 3L8 1l3 4.5 4-3L14 9z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" /></svg>{/if}
                <span class="p">{fmtPrice(c.start)}</span>
                {#if delta(c.delta)}<small class="d" class:up={(c.delta ?? 0) > 0}>{delta(c.delta)}</small>{/if}
              </span>
            {/each}
          </span>
          <label class="goal-f" class:hit={r.reached}>
            <span>$</span>
            <input id="goal-{r.item}" type="text" inputmode="numeric" placeholder="цель" value={r.goal ?? ''} aria-label="Цель для {r.item}"
              onchange={(e) => commitGoal(r, e)} onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          </label>
          <button class="pin" class:on aria-pressed={on} title={on ? 'Убрать окно с экрана' : 'Показать окном поверх игры'}
            aria-label={on ? `Убрать ${r.item} с экрана` : `Показать ${r.item} поверх игры`} onclick={() => prices.togglePin(r.item)}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12.6 2.9l4.5 4.5-2 .7-3 3 .3 3.5-1.3 1.3-6.5-6.5 1.3-1.3 3.5.3 3-3z" fill={on ? 'currentColor' : 'none'} /><path d="M7.4 12.6 3.5 16.5" />
            </svg>
          </button>
        </div>
      {/each}
    </div>
    {#if file.rareHours < 24}<p class="note">Редкие цены появятся, когда накопится история за сутки.</p>{/if}
  {/if}
</section>

<style>
  .buyers { max-width: 980px; padding: 22px 24px 64px; display: flex; flex-direction: column; gap: 12px; container-type: inline-size; }
  .crumbs { display: flex; align-items: center; gap: 6px; font-size: var(--fs-xs); font-weight: 600; color: var(--text-muted); }
  .crumbs .here { color: var(--text-dim); }
  .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  h1 { margin: 0 0 4px; font-size: var(--fs-2xl); font-weight: 800; letter-spacing: -0.01em; }
  .status { display: flex; align-items: center; gap: 8px; margin: 0; font-size: var(--fs-xs); color: var(--text-dim); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 3px var(--success-tint); flex-shrink: 0; }
  .dot.stale { background: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint); }
  .dot.bad { background: var(--danger-line); box-shadow: 0 0 0 3px var(--danger-tint); }
  .segmented { display: inline-flex; padding: 3px; gap: 2px; border-radius: var(--radius); background: var(--bg); border: 1px solid var(--border-strong); }
  .segmented button { border: 0; background: none; padding: 7px 14px; border-radius: var(--radius-sm); font-size: var(--fs-sm); font-weight: 600; color: var(--text-dim); transition: background 0.15s var(--ease), color 0.15s var(--ease); }
  .segmented button.on { background: var(--accent); color: var(--on-accent); }

  /* Гайд — одна строка */
  .guide { display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 16px; border-radius: 14px; border: 1px solid var(--accent-line); background: var(--accent-glow), var(--surface); flex-wrap: wrap; }
  .g-title { display: flex; flex-direction: column; gap: 3px; }
  .g-title b { font-size: var(--fs-sm); white-space: nowrap; }
  .g-prog { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; color: var(--text-muted); }
  .bar { width: 40px; height: 4px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--success); transition: width 0.3s var(--ease); }
  .g-sep { width: 1px; align-self: stretch; background: var(--border); }
  .g-steps { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; flex-wrap: wrap; margin: 0; padding: 0; list-style: none; color: var(--border-strong); }
  .g-step { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 4px 10px 4px 6px; border-radius: 9px; color: var(--text-dim); }
  .g-step.now { background: var(--accent-tint); box-shadow: inset 0 0 0 1px var(--accent-line); color: var(--text); }
  .g-step.done { color: var(--text-muted); }
  .g-step.done b { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--text-muted) 70%, transparent); }
  .g-num { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid var(--border-strong); font-size: 11px; font-weight: 800; flex-shrink: 0; color: var(--text-muted); }
  .g-step.now .g-num { border: 0; background: var(--accent); color: var(--on-accent); box-shadow: 0 0 0 3px var(--accent-tint); }
  .g-step.done .g-num { border: 0; background: var(--success); color: #0b2414; }
  .g-txt { display: flex; flex-direction: column; min-width: 0; }
  .g-txt b { font-size: 13px; white-space: nowrap; }
  .g-txt small { font-size: 11.5px; color: var(--text-muted); }
  .link { padding: 0; border: 0; background: none; font-size: 11.5px; font-weight: 700; color: var(--accent-soft); text-align: left; white-space: nowrap; }
  .link:hover { text-decoration: underline; }
  .g-keys { display: flex; gap: 2px; margin-top: 2px; }
  .g-keys kbd { height: 17px; min-width: 18px; font-size: 10px; }
  .ghost-line { background: transparent; color: var(--text-dim); }
  .x { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-muted); flex-shrink: 0; }
  .x:hover { background: var(--surface-2); color: var(--text); }

  .legend { padding: 14px 16px; }
  .legend b { font-size: var(--fs-sm); }
  .legend ul { margin: 10px 0 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 8px 18px; }
  .legend li { display: flex; align-items: center; gap: 10px; font-size: var(--fs-xs); color: var(--text-dim); line-height: 1.4; }
  .chip { position: relative; overflow: hidden; flex-shrink: 0; min-width: 62px; padding: 3px 8px; border-radius: 6px; font-size: 12.5px; font-weight: 800; text-align: center; font-variant-numeric: tabular-nums; color: var(--text); background: var(--surface-2); }
  .chip.dim { font-weight: 600; color: var(--text-muted); }
  .chip .up { color: var(--success); }
  .chip.best, .cell.best { background: rgba(255, 195, 0, 0.12); color: var(--accent-soft); }
  .chip.rare, .cell.rare { background: linear-gradient(180deg, rgba(255, 195, 0, 0.24) 0%, rgba(255, 195, 0, 0.1) 100%); box-shadow: inset 0 0 0 1px rgba(255, 195, 0, 0.85); color: var(--accent-soft); }
  .chip.goal, .cell.goal { background: rgba(111, 220, 154, 0.2); box-shadow: inset 0 0 0 1px rgba(111, 220, 154, 0.6); color: #a9f0c6; }
  .corner { position: absolute; top: 0; right: 0; border-top: 12px solid var(--accent); border-left: 12px solid transparent; }

  .tip { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: var(--radius-lg); border: 1px solid var(--accent-line); background: var(--accent-glow), var(--surface); flex-wrap: wrap; }
  .tip :global(svg) { color: var(--accent); flex-shrink: 0; }
  .tip p { flex: 1 1 220px; margin: 0; font-size: var(--fs-sm); color: var(--text-dim); }
  .tip p b { color: var(--text); }
  .toggle { display: flex; align-items: center; gap: 10px; font-size: var(--fs-sm); cursor: pointer; }
  .toggle input { appearance: none; flex-shrink: 0; width: 36px; height: 20px; margin: 0; border-radius: 999px; background: var(--surface-3); position: relative; cursor: pointer; transition: background 0.15s; }
  .toggle input::after { content: ''; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--text-dim); transition: transform 0.2s var(--ease), background 0.15s; }
  .toggle input:checked { background: var(--accent); }
  .toggle input:checked::after { transform: translateX(16px); background: var(--on-accent); }

  .empty { padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
  .empty p { margin: 0; color: var(--text-dim); font-size: var(--fs-sm); }

  /* Таблица товаров */
  .table { padding: 6px 6px 8px; }
  .thead, .row { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 3fr) 96px 36px; align-items: center; gap: 8px; }
  .products .thead, .products .row { grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) 96px 36px; }
  .thead { padding: 8px 6px 6px 12px; font-size: var(--fs-xs); font-weight: 700; color: var(--text-muted); }
  .thead .num { text-align: right; padding-right: 8px; }
  .table:not(.products) .thead { grid-template-columns: minmax(0, 1.3fr) repeat(3, minmax(0, 1fr)) 96px 36px; }
  .row { min-height: 40px; padding: 0 6px 0 12px; border-radius: var(--radius-sm); }
  .row:hover { background: var(--surface-2); }
  .row.on { background: var(--surface-2); }
  .name { font-size: var(--fs-sm); font-weight: 700; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row.on .name { color: var(--text); }
  .cells { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .products .cells { grid-template-columns: 1fr; }
  .cell { position: relative; display: flex; align-items: center; justify-content: flex-end; gap: 6px; height: 30px; padding: 0 8px; border-radius: 7px; font-weight: 700; font-size: var(--fs-sm); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .cell .n { display: none; font-size: 10.5px; font-weight: 800; color: var(--text-muted); }
  .cell .d { font-size: 11px; font-weight: 800; color: var(--danger); }
  .cell .d.up { color: var(--success); }
  .crown { width: 13px; height: 10px; color: var(--accent); flex-shrink: 0; }
  .goal-f { display: flex; align-items: center; gap: 4px; font-size: var(--fs-xs); font-weight: 700; color: var(--text-muted); }
  .goal-f input { width: 72px; height: 30px; padding: 0 8px; border-radius: 7px; border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .goal-f input:focus { outline: 0; border-color: var(--accent-line); }
  .goal-f.hit input { border-color: rgba(111, 220, 154, 0.7); color: #a9f0c6; }
  .pin { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; background: none; color: var(--text-muted); border-radius: var(--radius-sm); }
  .pin:hover { color: var(--text); }
  .pin.on { color: var(--accent); }
  .pin.on:hover { color: var(--accent-soft); }
  .note { margin: 0; font-size: var(--fs-xs); color: var(--text-muted); }

  /* Узкое окно (как и задумано по умолчанию — 560 px): строки становятся карточками */
  @container (max-width: 620px) {
    .buyers { padding: 16px 14px 48px; }
    .guide { flex-direction: column; align-items: stretch; gap: 6px; padding: 10px 8px 10px 12px; position: relative; }
    .g-title { flex-direction: row; align-items: center; gap: 10px; padding-right: 30px; }
    .g-sep, .g-steps > :global(svg) { display: none; }
    .g-steps { flex-direction: column; align-items: stretch; gap: 2px; }
    .x { position: absolute; top: 8px; right: 8px; }
    .ghost-line { align-self: flex-start; }
    .thead { display: none !important; }
    .table { padding: 6px; display: flex; flex-direction: column; gap: 6px; background: none; border: 0; }
    .row, .products .row { grid-template-columns: minmax(0, 1fr) auto 32px; grid-template-areas: 'name goal pin' 'cells cells cells'; gap: 8px; padding: 10px 10px 10px 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); }
    .row.on { background: var(--surface-2); }
    .name { grid-area: name; font-size: 14px; font-weight: 800; }
    .goal-f { grid-area: goal; }
    .goal-f input { width: 64px; }
    .pin { grid-area: pin; }
    .cells { grid-area: cells; gap: 4px; }
    .cell { flex-direction: column; justify-content: center; gap: 0; height: auto; padding: 4px; }
    .products .cell { flex-direction: row; justify-content: flex-start; gap: 8px; padding: 4px 8px; }
    .cell .n { display: block; }
  }
</style>
