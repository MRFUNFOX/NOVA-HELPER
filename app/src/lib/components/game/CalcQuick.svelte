<script lang="ts">
  // Быстрая запись у закреплённого «Итога»: нажали клавишу меню → «Записать» над окном → та же форма,
  // что в калькуляторе. Слой закреплённых окон пропускает мышь в игру, поэтому окошко рисует меню поверх игры.
  import { calc } from '../../calc.svelte';
  import CalcEntryForm from '../CalcEntryForm.svelte';

  let { prof, x, y, h, onclose }: { prof: string; x: number; y: number; h: number; onclose: () => void } = $props();
  // Калькулятор в этом окне мог ещё ни разу не открываться — прочитать профили
  calc.start();
  const p = $derived(calc.profiles.find((q) => q.id === prof));

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onclose(); }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="qa" role="dialog" tabindex="-1" aria-label="Новая запись" style="left: {x}px; top: {y}px; height: {h}px" onkeydown={onKey}>
  {#if p}
    <CalcEntryForm prof={p} {onclose} title="Новая запись · {p.name}" closeIcon="close" />
  {:else}
    <p class="gone">Профиль удалили в калькуляторе.</p>
  {/if}
</div>

<style>
  .qa { position: absolute; z-index: 8; width: 460px; box-sizing: border-box; display: flex; flex-direction: column; border-radius: var(--radius-lg, 16px); background: #1b1c1f; border: 1px solid var(--border); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5); overflow: hidden; pointer-events: auto; }
  .gone { margin: 20px; color: var(--text-muted); }
</style>
