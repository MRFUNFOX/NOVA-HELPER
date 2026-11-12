<script lang="ts">
  /**
   * Выбор нейросети в окне помощника: кнопка «● Groq», меню открывается вверх.
   * Для нейросети без ключа выбор открывает пошаговую настройку именно для неё.
   */
  import { scale } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import { ai } from '../ai.svelte';
  import type { AiProvider } from '../backend';
  import { ease, ms } from '../motion';

  const ITEMS: { id: AiProvider; name: string; hint: string }[] = [
    { id: 'groq', name: 'Groq', hint: 'Для Европы · быстрее и точнее' },
    { id: 'zai', name: 'Z.ai', hint: 'Для России и СНГ · ответ до минуты' },
  ];

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
  let items: HTMLButtonElement[] = $state([]);
  const current = $derived(ITEMS.find((i) => i.id === ai.provider)!);

  function toggle() {
    open = !open;
    if (open) requestAnimationFrame(() => items[ITEMS.findIndex((i) => i.id === ai.provider)]?.focus());
  }

  function pick(id: AiProvider) {
    open = false;
    void ai.use(id);
  }

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); open = false; root?.querySelector<HTMLButtonElement>('.trigger')?.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  }

  // Клик мимо меню — закрыть
  $effect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (root && !root.contains(e.target as Node)) open = false; };
    document.addEventListener('pointerdown', off, true);
    return () => document.removeEventListener('pointerdown', off, true);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="picker" bind:this={root} onkeydown={onKey}>
  {#if open}
    <div class="menu" role="menu" aria-label="Нейросеть" transition:scale={{ start: 0.96, duration: ms(140), easing: ease }}>
      <p class="head">Нейросеть</p>
      {#each ITEMS as it, i (it.id)}
        {@const selected = it.id === ai.provider}
        {@const has = ai.has(it.id)}
        <button class="item" class:selected role="menuitemradio" aria-checked={selected} bind:this={items[i]} onclick={() => pick(it.id)}>
          <span class="ico">{it.name[0]}</span>
          <span class="text"><b>{it.name}</b><small>{it.hint}</small></span>
          {#if selected}<span class="check"><Icon name="check" size={16} /></span>
          {:else if has}<span class="state ok">Ключ есть</span>
          {:else}<span class="state need">Нужен ключ</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
  <button class="trigger" class:open aria-haspopup="menu" aria-expanded={open} onclick={toggle} disabled={ai.busy} title="Какая нейросеть отвечает">
    <span class="dot" aria-hidden="true"></span>{current.name}<span class="chev"><Icon name="chevron" size={12} /></span>
  </button>
</div>

<style>
  .picker { position: relative; flex-shrink: 0; }
  .trigger { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 8px 0 9px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text-dim); font-size: 11.5px; font-weight: 700; white-space: nowrap; transition: border-color 0.15s var(--ease), color 0.15s var(--ease); }
  .trigger:hover:not(:disabled), .trigger.open { border-color: var(--accent-line); color: var(--text); }
  .trigger:disabled { opacity: 0.6; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); }
  .chev { display: grid; color: var(--text-muted); transform: rotate(-90deg); transition: transform 0.15s var(--ease); }
  .trigger.open .chev { transform: rotate(90deg); }

  .menu { position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 40; width: 330px; padding: 6px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border-strong); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55); transform-origin: bottom right; }
  .head { margin: 0; padding: 6px 10px 4px; font-size: 11px; font-weight: 700; color: var(--text-muted); }
  .item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border: 0; border-radius: 8px; background: none; text-align: left; color: var(--text); }
  .item:hover, .item:focus-visible { background: var(--surface-3); outline: none; }
  .item.selected { background: var(--accent-tint); }
  .ico { display: grid; place-items: center; width: 30px; height: 30px; flex-shrink: 0; border-radius: 8px; background: var(--surface-3); color: var(--accent-soft); font-size: 12px; font-weight: 800; }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .text b { font-size: var(--fs-sm); }
  .text small { font-size: 11.5px; color: var(--text-muted); }
  .check { display: grid; color: var(--accent); }
  .state { flex-shrink: 0; font-size: 11px; font-weight: 700; }
  .state.ok { color: var(--success); }
  .state.need { color: var(--accent-soft); }
</style>
