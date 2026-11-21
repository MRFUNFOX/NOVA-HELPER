<script lang="ts">
  // Окно «Мои окна поверх игры» в меню: что закреплено, открепить, расставить окна
  import Icon from '../Icon.svelte';
  import { app } from '../../state.svelte';
  import { backend } from '../../backend';
  import { PIN_LIMIT } from '../../pins';

  let sure = $state(false);

  async function remove(key: string) {
    await backend.pinsRemove(key).catch(() => {});
    app.pins = app.pins.filter((p) => p.key !== key);
  }
  async function removeAll() {
    if (!sure) { sure = true; setTimeout(() => (sure = false), 3000); return; }
    sure = false;
    await backend.pinsSet([]).catch(() => {});
    app.pins = [];
  }
  async function arrange() {
    // Редактор окон поднимается поверх всего — меню прячем, чтобы не мешало
    await backend.gameMenuHide().catch(() => {});
    await backend.pinsEditor(true).catch(() => {});
  }
  const keys = $derived(app.editorKey.split('+'));
</script>

<div class="pins">
  {#if app.pins.length}
    <ul>
      {#each app.pins as p (p.key)}
        <li>
          <span class="badge" class:law={p.law} class:buy={!!p.kind}>{#if p.kind === 'buyer'}<Icon name="chartline" size={14} />{:else if p.kind === 'calc'}<Icon name="calc" size={14} />{:else}{p.badge}{/if}</span>
          <span class="t"><b>{p.kind === 'buyer' ? p.buyer?.item ?? p.badge : p.kind === 'calc' ? p.badge : p.text.split('\n')[0]}</b><small>{p.doc}</small></span>
          <button class="x" aria-label="Открепить" title="Открепить" onclick={() => remove(p.key)}><Icon name="close" size={14} /></button>
        </li>
      {/each}
    </ul>
    <p class="hint">Закреплено {app.rulePins.length} из {PIN_LIMIT} пунктов.</p>
  {:else}
    <p class="empty">Пока ничего не закреплено. Нажмите булавку у пункта в Правилах, Законах или у товара в Скупщиках — он появится окном поверх игры.</p>
  {/if}
  <div class="act">
    <button class="btn primary" onclick={arrange} disabled={!app.pins.length}><Icon name="squares" size={15} />Расставить окна<span class="keys">{#each keys as k, i (i)}{#if i}+{/if}{k}{/each}</span></button>
    {#if app.pins.length}<button class="btn danger" onclick={removeAll}>{sure ? 'Точно открепить все?' : 'Открепить все'}</button>{/if}
  </div>
</div>

<style>
  .pins { padding: 8px 12px 14px; display: flex; flex-direction: column; gap: 10px; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  li { display: flex; align-items: center; gap: 12px; padding: 10px 4px; border-bottom: 1px solid var(--border); }
  .badge { flex-shrink: 0; min-width: 44px; height: 26px; padding: 0 6px; border-radius: 7px; background: var(--accent-tint); color: var(--accent-soft); font-size: 12px; font-weight: 800; display: grid; place-items: center; }
  .badge.law { background: rgba(122, 162, 255, 0.12); color: #8fb0ff; }
  .badge.buy { background: rgba(111, 220, 154, 0.12); color: #6fdc9a; }
  .t { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .t b { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .t small { font-size: 12px; color: var(--text-muted); }
  .x { width: 30px; height: 30px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text-dim); display: grid; place-items: center; cursor: pointer; }
  .x:hover { background: var(--surface-2); color: var(--text); }
  .hint, .empty { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-dim); }
  .empty { padding: 8px 4px; }
  .act { display: flex; flex-direction: column; gap: 8px; }
  .btn { height: 42px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface-3); color: var(--text); font: inherit; font-size: 13.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent, #1a1400); font-weight: 800; }
  .btn.primary:disabled { opacity: 0.5; cursor: default; }
  .btn.danger { background: transparent; border-color: transparent; color: #ff8a8a; height: 34px; }
  .keys { padding: 2px 6px; border-radius: 6px; background: rgba(0, 0, 0, 0.14); font-size: 11.5px; font-weight: 800; }
</style>
