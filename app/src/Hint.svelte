<script lang="ts">
  // Подсказка в правом нижнем углу экрана, пока окно программы скрыто. Клики проходят сквозь неё в игру.
  import { keys } from './lib/hotkey';
  const q = new URLSearchParams(location.search);
  let hotkey = $state(q.get('hotkey') ?? 'Alt+Q');
  /** Клавиша редактора закреплённых окон — только когда окна есть */
  let editor = $state<string | null>(q.get('editor'));

  $effect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let off: (() => void) | undefined;
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen<string | { hotkey: string; editor?: string | null }>('hint-update', (e) => {
        if (typeof e.payload === 'string') { hotkey = e.payload; editor = null; }
        else { hotkey = e.payload.hotkey; editor = e.payload.editor ?? null; }
      }))
      .then((u) => (off = u));
    return () => off?.();
  });
</script>

<div class="stack">
  {#if editor}
    <div class="hint">
      <span class="mark alt" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
      <span class="keys">{#each keys(editor) as k, i (i)}{#if i}<span class="plus">+</span>{/if}<kbd>{k}</kbd>{/each}</span>
      <span class="label">окна поверх игры</span>
    </div>
  {/if}
  <div class="hint">
    <span class="mark" aria-hidden="true">§</span>
    <span class="keys">{#each keys(hotkey) as k, i (i)}{#if i}<span class="plus">+</span>{/if}<kbd>{k}</kbd>{/each}</span>
    <span class="label">правила NOVA</span>
  </div>
</div>

<style>
  :global(html), :global(body) { background: transparent !important; }
  .stack { position: fixed; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 12px 0 6px;
    border-radius: 999px;
    background: rgba(26, 27, 30, 0.9);
    border: 1px solid rgba(255, 195, 0, 0.35);
    color: var(--text);
    font-size: var(--fs-xs);
    font-weight: 700;
    white-space: nowrap;
  }
  .mark { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; background: var(--accent); color: var(--on-accent); font-size: 13px; font-weight: 800; }
  .mark.alt { grid-template-columns: repeat(3, 3px); gap: 2px; align-content: center; justify-content: center; }
  .mark.alt i { width: 3px; height: 3px; border-radius: 50%; background: var(--on-accent); }
  .keys { display: inline-flex; align-items: center; gap: 3px; }
  .keys kbd { padding: 0 6px; min-width: 22px; font-size: 11px; background: rgba(255, 255, 255, 0.08); }
  .plus { color: var(--text-muted); font-size: 10px; }
  .label { color: var(--text-dim); font-weight: 600; }
</style>
