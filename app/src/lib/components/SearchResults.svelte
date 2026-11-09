<script lang="ts">
  import { app, shortTitle } from '../state.svelte';
  import { snippet } from '../search';

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
    <div class="empty">
      <p><b>По запросу «{app.query.trim()}» ничего не нашлось.</b></p>
      <p class="muted">Попробуйте другое слово или номер пункта, например «4.1». Можно писать сокращения: «дм», «пг», «рк».</p>
    </div>
  {:else}
    <p class="count muted">Найдено: {app.hits.length}{app.hits.length >= 60 ? '+' : ''}</p>
    {#each app.hits as h, i (h.entry.node.id)}
      {@const s = snippet(h.entry.plain, app.query)}
      {@const pun = h.entry.node.punishments.find((p) => p.severe) ?? h.entry.node.punishments[0]}
      <button class="hit" class:active={i === active} role="option" aria-selected={i === active} onclick={() => pick(i)} onmouseenter={() => (active = i)}>
        <span class="num">{h.entry.node.number ?? '§'}</span>
        <span class="main">
          <span class="where">{shortTitle(h.entry.doc.title)}{h.entry.path.length ? ` · ${h.entry.path[h.entry.path.length - 1]}` : ''}</span>
          <span class="snip">{#each parts(s.text, s.marks) as p, k (k)}{#if p.m}<mark>{p.s}</mark>{:else}{p.s}{/if}{/each}</span>
          {#if pun}<span class="pun" class:severe={pun.severe}>{pun.raw}</span>{/if}
        </span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .results { max-width: 760px; padding: 10px 12px 40px; display: flex; flex-direction: column; gap: 2px; }
  .count { font-size: var(--fs-xs); margin: 4px 10px 6px; }
  .hit {
    display: grid;
    grid-template-columns: var(--gutter) 1fr;
    gap: 12px;
    padding: 10px 10px 10px 0;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    text-align: left;
  }
  .hit.active { background: var(--surface); }
  .num { font-weight: 800; font-size: var(--fs-md); color: var(--accent); text-align: right; font-variant-numeric: tabular-nums; padding-top: 1px; }
  .main { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .where { font-size: var(--fs-xs); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .snip { font-size: var(--fs-sm); color: var(--text); line-height: 1.45; }
  mark { background: var(--accent-tint); color: var(--accent-soft); border-radius: 2px; padding: 0 1px; }
  .pun { font-size: var(--fs-xs); font-weight: 700; color: var(--text-dim); padding-left: 8px; border-left: 2px solid var(--accent); }
  .pun.severe { color: var(--danger); border-left-color: var(--danger-line); }
  .empty { padding: 28px 16px; max-width: 460px; }
  .empty p { margin: 0 0 6px; }
  @media (max-width: 459px) { .hit { grid-template-columns: 46px 1fr; gap: 8px; } }
</style>
