<script lang="ts">
  import type { RuleDocument } from '@shared/types';
  import Icon from './Icon.svelte';
  import RuleItem from './RuleItem.svelte';
  import { backend } from '../backend';

  let { doc }: { doc: RuleDocument } = $props();
  const warnings = $derived.by(() => {
    let n = 0;
    const walk = (ns: RuleDocument['children']) => ns.forEach((x) => { n += x.amendments.filter((a) => a.status === 'unmerged' || a.status === 'conflict' || a.status === 'pending').length; walk(x.children); });
    walk(doc.children);
    return n + doc.looseAmendments.length;
  });
</script>

<article class="doc">
  <header>
    <h1 class="selectable">{doc.title}</h1>
    <div class="meta">
      <button class="src" onclick={() => backend.openUrl(doc.sourceUrl)}>
        <Icon name="external" size={14} /> Тема на форуме
      </button>
    </div>
    {#if warnings}
      <p class="note"><Icon name="alert" size={15} /> В этом документе {warnings} {warnings === 1 ? 'пункт' : warnings < 5 ? 'пункта' : 'пунктов'} с поправками, которые ещё не внесены в основной текст на форуме. Они отмечены жёлтым.</p>
    {/if}
  </header>

  {#each doc.children as node (node.id)}
    <RuleItem {node} {doc} />
  {/each}

  {#each doc.looseAmendments as a, i (i)}
    <p class="note"><Icon name="alert" size={15} /> {a.message} <button class="src" onclick={() => backend.openUrl(a.postUrl)}>Поправка на форуме</button></p>
  {/each}
</article>

<style>
  .doc { max-width: 760px; padding: 18px 22px 64px 14px; }
  header { padding-left: calc(var(--gutter) + 12px); margin-bottom: 6px; }
  h1 { margin: 0 0 6px; font-size: var(--fs-xl); font-weight: 800; line-height: 1.25; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; font-size: var(--fs-xs); color: var(--text-muted); }
  .src { display: inline-flex; align-items: center; gap: 5px; border: 0; background: none; padding: 0; color: var(--accent-soft); font-size: var(--fs-xs); font-weight: 600; }
  .src:hover { text-decoration: underline; }
  .note { display: flex; gap: 8px; align-items: flex-start; margin: 12px 0 0; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--accent-tint); color: var(--accent-soft); font-size: var(--fs-sm); }
  .note :global(svg) { flex-shrink: 0; margin-top: 3px; }
  @media (max-width: 459px) {
    .doc { padding: 14px 14px 48px 8px; }
    header { padding-left: 54px; }
  }
</style>
