<script lang="ts">
  // Наказание за пункт: подпись с молотком и цветные плашки (красный — навсегда/ЧС, оранжевый — бан, жёлтый — остальное)
  import type { Punishment } from '@shared/types';
  import Icon from './Icon.svelte';
  import { variants } from '../punish';

  let { items, compact = false }: { items: Punishment[]; compact?: boolean } = $props();
  const chips = $derived(items.flatMap((p) => variants(p)));
</script>

<div class="pun" class:compact>
  <span class="lbl"><Icon name="gavel" size={compact ? 14 : 15} />Наказание</span>
  <span class="chips">
    {#each chips as c, i (i)}<span class="chip {c.level} selectable">{c.text}</span>{/each}
  </span>
</div>

<style>
  .pun {
    display: flex;
    align-items: flex-start;
    gap: 6px 12px;
    flex-wrap: wrap;
    margin-top: 12px;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .pun.compact { margin-top: 0; padding: 0; background: none; border: 0; gap: 6px 10px; }
  .lbl {
    display: inline-flex; align-items: center; gap: 6px;
    height: 26px;
    font-size: var(--fs-xs); font-weight: 700; color: var(--text-muted);
    flex-shrink: 0;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; flex: 1; }
  .chip {
    display: inline-flex; align-items: center;
    min-height: 26px;
    padding: 3px 10px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm); font-weight: 700; line-height: 1.35;
    background: var(--accent-tint); color: var(--accent);
    border: 1px solid var(--accent-line);
  }
  .compact .chip { font-size: var(--fs-xs); min-height: 24px; padding: 2px 8px; }
  .chip.ban { background: var(--orange-tint); color: var(--orange); border-color: color-mix(in srgb, var(--orange-line) 38%, transparent); }
  .chip.severe { background: var(--danger-tint); color: var(--danger); border-color: color-mix(in srgb, var(--danger-line) 40%, transparent); }
</style>
