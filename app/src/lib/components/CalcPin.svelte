<script lang="ts">
  // Окно калькулятора поверх игры: итог, последние записи, график или категории одного профиля.
  // Данные берёт само из калькулятора (общее хранилище программы) — обновляется, как только игрок что-то записал.
  import { calc } from '../calc.svelte';
  import { byCat, catOf, dateOfAgo, daysAgo, dayName, hhmm, inPeriod, money, perDay, signed, totals, weekdayShort, type Period } from '../calc';
  import type { CalcPinData } from '../pins';

  let { d }: { d: CalcPinData } = $props();

  $effect(() => { calc.start(); });
  let now = $state(Date.now());
  $effect(() => { const t = setInterval(() => (now = Date.now()), 60e3); return () => clearInterval(t); });

  const TYPE = { sum: 'Итог', list: 'Записи', cats: 'По категориям', chart: 'График' } as const;
  const WORDS: Record<Period, string> = { day: 'за сегодня', week: 'за 7 дней', month: 'за 30 дней', all: 'за всё время' };
  const GREEN = '#6fdc9a', RED = '#ff8a8a';

  const prof = $derived(calc.profiles.find((p) => p.id === d.prof));
  const list = $derived(prof ? inPeriod(prof.entries, d.period, now) : []);
  const sum = $derived(totals(list));
  const recent = $derived(prof ? [...prof.entries].sort((a, b) => b.at - a.at).slice(0, 5) : []);
  const cats = $derived([...byCat(list, 'inc').slice(0, 3).map((c) => ({ ...c, k: 'inc' as const })), ...byCat(list, 'exp').slice(0, 3).map((c) => ({ ...c, k: 'exp' as const }))]);
  const catTop = $derived(Math.max(1, ...cats.map((c) => c.sum)));
  // График: неделя — 7 дней, месяц и всё время — 14 (в маленьком окне 30 столбиков не читаются)
  const n = $derived(d.period === 'week' || d.period === 'day' ? 7 : 14);
  const per = $derived(prof ? perDay(prof.entries, n, now) : []);
  const H = 70;
  const maxP = $derived(Math.max(1, ...per.map((p) => Math.max(0, p.net))));
  const maxN = $derived(Math.max(0, ...per.map((p) => Math.max(0, -p.net))));
  const zero = $derived(Math.round((H * maxP) / (maxP + maxN)));
  const when = (t: number) => { const a = daysAgo(t, now); return a === 0 ? hhmm(t) : a === 1 ? 'вчера' : dayName(a, now); };
</script>

<div class="h"><span class="badge">{TYPE[d.type]}</span><span class="doc">{prof ? prof.name : 'Профиль удалён'}{prof ? (d.type === 'list' ? ' · последние записи' : ' · ' + WORDS[d.period]) : ''}</span></div>
{#if !prof}
  <p class="none">Этот профиль удалили в калькуляторе — окно можно открепить.</p>
{:else if d.type === 'sum'}
  <div class="sum">
    <b class="net" style="color: {sum.net > 0 ? GREEN : sum.net < 0 ? RED : '#fff'}">{signed(sum.net)}</b>
    <span class="ie"><span>Заработал <b style="color: {GREEN}">{money(sum.inc)}</b></span><span>Потратил <b style="color: {RED}">{money(sum.exp)}</b></span></span>
  </div>
{:else if d.type === 'list'}
  {#each recent as e (e.id)}
    {@const c = catOf(e.k, e.cat)}
    <div class="row">
      <i style="background: {c.color}33; color: {c.color}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={c.icon} /></svg></i>
      <span class="t">{e.note || e.cat} <small>{when(e.at)}</small></span>
      <b style="color: {e.k === 'inc' ? GREEN : RED}">{e.k === 'inc' ? '+' : '−'}{money(e.sum)}</b>
    </div>
  {:else}
    <p class="none">Записей пока нет.</p>
  {/each}
{:else if d.type === 'chart'}
  <div class="chart">
    <span class="zero" style="top: {zero}px"></span>
    <div class="cols">
      {#each per as p (p.ago)}
        {@const h = Math.max(p.net ? 2 : 0, Math.round((Math.abs(p.net) / (maxP + maxN)) * H))}
        {@const dt = dateOfAgo(p.ago, now)}
        <div class="col">
          <span class="bar" class:neg={p.net < 0} style="height: {h}px; top: {p.net >= 0 ? zero - h : zero}px"></span>
          <span class="lbl" style="top: {H + 6}px">{p.ago === 0 ? 'сег.' : n === 7 ? weekdayShort(dt) : p.ago % 3 === 0 ? dt.getDate() : ''}</span>
        </div>
      {/each}
    </div>
  </div>
{:else}
  {#each cats as c (c.k + c.cat)}
    <div class="crow">
      <span>{c.cat}</span>
      <span class="track"><span style="width: {Math.max(4, (c.sum / catTop) * 100)}%; background: {catOf(c.k, c.cat).color}"></span></span>
      <b style="color: {c.k === 'inc' ? GREEN : RED}">{c.k === 'inc' ? '+' : '−'}{money(c.sum)}</b>
    </div>
  {:else}
    <p class="none">За этот период записей нет.</p>
  {/each}
{/if}

<style>
  .h { display: flex; align-items: center; gap: 7px; margin-bottom: 0.55em; min-width: 0; }
  .badge { flex-shrink: 0; padding: 1px 7px; border-radius: 5px; background: rgba(255, 195, 0, 0.25); color: var(--accent-soft); font-weight: 800; font-size: 0.86em; }
  .doc { min-width: 0; font-size: 0.82em; color: rgba(255, 255, 255, 0.65); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .none { margin: 0; font-size: 0.9em; color: rgba(255, 255, 255, 0.65); }
  b, span, small { text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
  /* Узкое окно или крупный шрифт: «Заработал/Потратил» переносится под сумму, а не вылезает за край */
  .sum { display: flex; flex-wrap: wrap; align-items: flex-end; column-gap: 12px; row-gap: 4px; }
  .net { flex: 1 1 auto; min-width: 0; font-size: 2em; line-height: 1.1; letter-spacing: -0.5px; white-space: nowrap; }
  .ie { display: flex; flex-direction: column; gap: 2px; margin-left: auto; text-align: right; font-size: 0.86em; white-space: nowrap; color: rgba(255, 255, 255, 0.7); }
  .row { display: flex; align-items: center; gap: 9px; padding: 0.28em 0; }
  .row i { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; flex-shrink: 0; }
  .row .t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.93em; }
  .row small { color: rgba(255, 255, 255, 0.5); font-size: 0.85em; }
  .row b { font-size: 0.93em; white-space: nowrap; }
  .chart { position: relative; height: 92px; }
  .zero { position: absolute; left: 0; right: 0; height: 1px; background: rgba(255, 255, 255, 0.25); }
  .cols { position: absolute; inset: 0; display: flex; gap: 5px; }
  .col { flex: 1; position: relative; }
  .bar { position: absolute; left: 0; right: 0; border-radius: 3px 3px 0 0; background: #6fdc9a; }
  .bar.neg { border-radius: 0 0 3px 3px; background: #ff8a8a; }
  .lbl { position: absolute; left: -4px; right: -4px; text-align: center; font-size: 10.5px; color: rgba(255, 255, 255, 0.55); }
  .crow { display: grid; grid-template-columns: minmax(0, 6em) minmax(20px, 1fr) auto; align-items: center; gap: 8px; padding: 0.2em 0; font-size: 0.9em; }
  .crow > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .crow b { white-space: nowrap; text-align: right; min-width: 5.6em; }
  .track { height: 7px; border-radius: 4px; background: rgba(255, 255, 255, 0.08); overflow: hidden; }
  .track span { display: block; height: 100%; border-radius: 4px; }
</style>
