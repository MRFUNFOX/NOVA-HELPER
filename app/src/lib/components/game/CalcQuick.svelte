<script lang="ts">
  // Быстрая запись у закреплённого «Итога»: нажали клавишу меню → «+» у окна → сумма → «Записать».
  // Слой закреплённых окон пропускает мышь в игру, поэтому «+» и это окошко рисует меню поверх игры.
  import { app } from '../../state.svelte';
  import { calc } from '../../calc.svelte';
  import { CATS, digits, groupDigits, money, type Kind } from '../../calc';

  let { prof, x, y, onclose }: { prof: string; x: number; y: number; onclose: () => void } = $props();

  let kind = $state<Kind>('inc');
  let cat = $state('');
  let amount = $state('');
  const amt = $derived(digits(amount));
  const p = $derived(calc.profiles.find((q) => q.id === prof));
  const GREEN = '#6fdc9a', RED = '#ff8a8a';

  function save() {
    if (!amt || !p) return;
    calc.add({ at: Date.now(), k: kind, cat: cat || 'Другое', sum: amt }, p.id);
    app.notify(`${kind === 'inc' ? 'Записал доход' : 'Записал расход'} ${money(amt)}`);
    onclose();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onclose(); }
    if (e.key === 'Enter') save();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="qa" role="dialog" tabindex="-1" aria-label="Новая запись" style="left: {x}px; top: {y}px" onkeydown={onKey}>
  <div class="head">
    <b>Новая запись <span>· {p?.name ?? 'профиль удалён'}</span></b>
    <button class="x" aria-label="Закрыть" onclick={onclose}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
  </div>
  {#if p}
    <div class="sw">
      <button class="inc" class:on={kind === 'inc'} onclick={() => { kind = 'inc'; cat = ''; }}>+ Заработал</button>
      <button class="exp" class:on={kind === 'exp'} onclick={() => { kind = 'exp'; cat = ''; }}>− Потратил</button>
    </div>
    <div class="mbox">
      <span class="dollar" style="color: {amt ? (kind === 'inc' ? GREEN : RED) : '#55585f'}">$</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input type="text" inputmode="numeric" placeholder="0" value={amount} oninput={(e) => (amount = groupDigits(digits((e.currentTarget as HTMLInputElement).value)))} aria-label="Сумма" autofocus />
    </div>
    <div class="cats">
      {#each CATS[kind] as c (c.name)}
        <button style={cat === c.name ? `border-color: ${c.color}; background: ${c.color}22; color: var(--text);` : ''} aria-pressed={cat === c.name} onclick={() => (cat = cat === c.name ? '' : c.name)}>{c.name}</button>
      {/each}
    </div>
    <button class="go" disabled={!amt} onclick={save}>{amt ? `${kind === 'inc' ? 'Записать +' : 'Записать −'}${money(amt)}` : 'Введите сумму'}</button>
  {/if}
</div>

<style>
  .qa { position: absolute; z-index: 8; width: 330px; box-sizing: border-box; padding: 12px; border-radius: 14px; background: #1d1e22; border: 1px solid #3a3c42; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6); color: var(--text); pointer-events: auto; }
  .head { display: flex; align-items: center; margin-bottom: 10px; }
  .head b { flex: 1; font-size: 14px; }
  .head span { font-weight: 600; color: var(--text-muted); }
  .x { width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: var(--text-dim); display: grid; place-items: center; cursor: pointer; }
  .x:hover { background: var(--surface-2); color: var(--text); }
  .sw { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: 12px; background: #111214; }
  .sw button { height: 36px; border: 0; border-radius: 9px; background: transparent; color: var(--text-muted); font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; }
  .sw .inc.on { background: #6fdc9a; color: #0d2416; }
  .sw .exp.on { background: #ff8a8a; color: #2b0d0d; }
  .mbox { display: flex; align-items: center; gap: 4px; height: 54px; margin-top: 8px; padding: 0 14px; border-radius: 12px; background: #111214; border: 1px solid #3a3c42; }
  .mbox:focus-within { border-color: rgba(255, 195, 0, 0.7); }
  .mbox input { flex: 1; min-width: 0; height: 100%; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 24px; font-weight: 800; outline: none; }
  .dollar { font-size: 24px; font-weight: 800; }
  .cats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-top: 8px; }
  .cats button { height: 30px; padding: 0 4px; border: 1px solid #2f3035; border-radius: 8px; background: #1a1b1e; color: #d5d7dc; font: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .go { width: 100%; height: 44px; margin-top: 10px; border: 0; border-radius: 12px; background: var(--accent); color: var(--on-accent); font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; }
  .go:disabled { opacity: 0.35; cursor: default; }
</style>
