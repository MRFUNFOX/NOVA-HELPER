<script lang="ts">
  import { fly } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import Punishments from './Punishments.svelte';
  import { app, categoryIcon, docCategory, shortTitle } from '../state.svelte';
  import { nodeBadge, snippet, type Entry } from '../search';
  import { isStructural } from '../punish';
  import { ms } from '../motion';

  let active = $state(0);
  $effect(() => { app.query; active = 0; });

  function pick(i: number) {
    const h = app.hits[i];
    if (!h) return;
    app.open(h.entry.doc.id, h.entry.node.id);
    app.query = '';
  }

  export function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, app.hits.length - 1); scroll(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); scroll(); e.preventDefault(); }
    if (e.key === 'Enter') { pick(active); e.preventDefault(); }
  }

  function scroll() {
    requestAnimationFrame(() => document.querySelector('.hit.active')?.scrollIntoView({ block: 'nearest' }));
  }

  // Фрагмент из текста пункта; если слово нашлось только в примечании или наказании — оттуда
  function snip(e: Entry, q: string) {
    // Поиск по номеру: номер уже на плашке, показываем начало текста пункта
    if (/^[\p{L}.\s]{0,14}\d+(?:\.\d+)*\.?(?:\s*\p{L}{1,12})?$/u.test(q.trim())) return snippet(e.node.text, '');
    const s = snippet(e.node.text, q);
    return s.marks.length || e.plain === e.node.text ? s : snippet(e.plain, q);
  }

  function parts(text: string, marks: [number, number][]) {
    const out: { s: string; m: boolean }[] = [];
    let last = 0;
    for (const [a, b] of marks) {
      if (a > last) out.push({ s: text.slice(last, a), m: false });
      out.push({ s: text.slice(a, b), m: true });
      last = b;
    }
    out.push({ s: text.slice(last), m: false });
    return out;
  }
</script>

<div class="results" role="listbox" aria-label="Результаты поиска">
  {#if !app.hits.length}
    <div class="empty card">
      <span class="empty-ico"><Icon name="search" size={22} /></span>
      <p><b>По запросу «{app.query.trim()}» ничего не нашлось</b></p>
      <p class="muted">Попробуйте другое слово или номер пункта, например «4.1». Сокращения тоже работают: «дм», «пг», «рк».</p>
    </div>
  {:else}
    <p class="count"><span>Найдено: <b>{app.hits.length}{app.hits.length >= 60 ? '+' : ''}</b></span><span class="keys"><kbd>↑</kbd><kbd>↓</kbd> выбрать <kbd>Enter</kbd> открыть</span></p>
    {#each app.hits as h, i (h.entry.node.id)}
      {@const e = h.entry}
      {@const s = snip(e, app.query)}
      {@const where = e.path.slice(-2)}
      <button class="hit" class:active={i === active} class:sec={isStructural(e.node)} role="option" aria-selected={i === active}
        onclick={() => pick(i)} onmouseenter={() => (active = i)} in:fly={{ y: 6, duration: ms(180), delay: ms(Math.min(i, 8) * 18) }}>
        <span class="where">
          <span class="doc-ico"><Icon name={categoryIcon(docCategory(e.doc))} size={15} /></span>
          <span class="doc-name">{shortTitle(e.doc.title)}</span>
          {#each where as w, k (k)}<Icon name="chevron" size={13} /><span class="sec-name" class:last={k === where.length - 1}>{w}</span>{/each}
        </span>
        <span class="row">
          <span class="num" class:none={!e.node.number}>{e.article ? `ст. ${e.article}, ч. ${e.node.number}` : nodeBadge(e.node, e.doc.scope === 'server') || '§'}</span>
          <span class="snip selectable">{#each parts(s.text, s.marks) as p, k (k)}{#if p.m}<mark>{p.s}</mark>{:else}{p.s}{/if}{/each}</span>
        </span>
        {#if e.node.punishments.length}
          <span class="pun"><Punishments items={e.node.punishments} compact /></span>
        {/if}
      </button>
    {/each}
  {/if}
</div>

<style>
  .results { max-width: 860px; padding: 18px 24px 48px; display: flex; flex-direction: column; gap: 10px; }
  .count { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: var(--fs-sm); color: var(--text-dim); margin: 0 2px 2px; }
  .keys { display: flex; align-items: center; gap: 4px; font-size: var(--fs-xs); color: var(--text-muted); }
  .keys kbd + kbd { margin-left: 0; }
  .keys kbd:nth-of-type(3) { margin-left: 8px; }
  @media (max-width: 519px) { .keys { display: none; } }
  .hit {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--surface);
    text-align: left;
    transition: border-color 0.15s var(--ease), background 0.15s var(--ease);
  }
  .hit.active { border-color: var(--accent-line); background: var(--accent-glow), var(--surface); }
  .where {
    display: flex; align-items: center; gap: 6px;
    min-width: 0;
    font-size: var(--fs-sm); font-weight: 600; color: var(--text-dim);
  }
  .where :global(svg) { flex-shrink: 0; color: var(--text-muted); }
  .doc-ico { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 6px; background: var(--surface-2); flex-shrink: 0; }
  .doc-ico :global(svg) { color: var(--accent); }
  .doc-name { flex-shrink: 0; max-width: 45%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); font-weight: 700; }
  .sec-name { min-width: 0; flex-shrink: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sec-name:not(.last) { flex-shrink: 3; }
  .sec-name.last { color: var(--text); }
  .row { display: flex; align-items: flex-start; gap: 12px; }
  .num {
    display: grid; place-items: center; flex-shrink: 0;
    min-width: 54px; height: 28px; padding: 0 8px;
    border-radius: var(--radius-sm);
    background: var(--accent-tint); color: var(--accent);
    font-size: var(--fs-sm); font-weight: 800; font-variant-numeric: tabular-nums;
  }
  .hit.active .num { background: var(--accent); color: var(--on-accent); }
  .snip { flex: 1; min-width: 0; font-size: var(--fs-md); line-height: 1.55; color: var(--text); padding-top: 2px; }
  .sec .snip { font-weight: 700; }
  mark { background: rgba(255, 195, 0, 0.22); color: var(--accent-soft); border-radius: 3px; padding: 0 2px; }
  .pun { display: block; padding-left: 66px; }

  .empty { padding: 28px 24px; max-width: 520px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
  .empty-ico { display: grid; place-items: center; width: 44px; height: 44px; border-radius: var(--radius); background: var(--surface-2); color: var(--text-muted); margin-bottom: 6px; }
  .empty p { margin: 0; }

  @media (max-width: 639px) { .results { padding: 14px 14px 40px; } }
  @media (max-width: 479px) {
    .row { flex-direction: column; gap: 8px; }
    .pun { padding-left: 0; }
    .doc-name { max-width: 60%; }
  }
</style>
