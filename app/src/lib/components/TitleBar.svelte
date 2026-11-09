<script lang="ts">
  import Icon from './Icon.svelte';
  import { app } from '../state.svelte';
  import { backend } from '../backend';

  let maximized = $state(false);

  async function toggleMax() {
    await backend.toggleMaximize();
    maximized = !maximized;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<header class="titlebar" data-tauri-drag-region ondblclick={toggleMax}>
  {#if app.settings?.firstRunDone}<button class="icon-btn menu" title="Меню" aria-label="Открыть меню" onclick={() => (app.sidebarOpen = !app.sidebarOpen)}>
    <Icon name="menu" />
  </button>{/if}
  <div class="brand" data-tauri-drag-region>
    <span class="mark" aria-hidden="true">§</span>
    <span class="name" data-tauri-drag-region>NOVA HELPER</span>
  </div>

  <div class="actions">
    {#if app.settings?.firstRunDone}
    <button class="ai" class:active={app.aiOpen} onclick={() => (app.aiOpen = !app.aiOpen)} title="Спросить ИИ-помощника о правилах">
      <Icon name="spark" size={17} />
      <span class="ai-label">ИИ-помощник</span>
    </button>
    <button
      class="icon-btn"
      class:active={app.view.kind === 'settings'}
      title="Настройки"
      aria-label="Настройки"
      onclick={() => (app.view = app.view.kind === 'settings' ? { kind: 'doc', docId: app.mainDocId() } : { kind: 'settings' })}
    >
      <Icon name="settings" />
    </button>
    <span class="sep" aria-hidden="true"></span>
    {/if}
    <button class="icon-btn win" title="Свернуть" aria-label="Свернуть" onclick={() => backend.minimize()}><Icon name="minus" /></button>
    <button class="icon-btn win" title={maximized ? 'Вернуть размер' : 'Развернуть'} aria-label="Развернуть" onclick={toggleMax}>
      <Icon name={maximized ? 'squares' : 'square'} size={16} />
    </button>
    <button class="icon-btn win close" title="Скрыть (клавиша {app.settings?.hotkey ?? ''} вернёт окно)" aria-label="Закрыть" onclick={() => backend.hide()}>
      <Icon name="close" />
    </button>
  </div>
</header>

<style>
  .titlebar {
    height: var(--titlebar);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px 0 10px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .brand { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; height: 100%; }
  .mark {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 800;
    font-size: 15px;
    line-height: 1;
  }
  .name { font-weight: 800; font-size: var(--fs-sm); letter-spacing: 0.04em; white-space: nowrap; }
  .actions { display: flex; align-items: center; gap: 2px; }
  .icon-btn {
    display: grid;
    place-items: center;
    width: 34px;
    height: 30px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-dim);
  }
  .icon-btn:hover, .icon-btn.active { background: var(--surface-2); color: var(--text); }
  .icon-btn.close:hover { background: #c42b1c; color: #fff; }
  .menu { display: none; }
  .ai {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 12px 0 10px;
    margin-right: 4px;
    border-radius: 999px;
    border: 1px solid var(--accent-tint);
    background: var(--accent-tint);
    color: var(--accent-soft);
    font-size: var(--fs-xs);
    font-weight: 700;
  }
  .ai:hover, .ai.active { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .sep { width: 1px; height: 18px; background: var(--border); margin: 0 4px; }

  @media (max-width: 639px) {
    .menu { display: grid; }
  }
  @media (max-width: 459px) {
    .ai-label { display: none; }
    .ai { padding: 0 8px; }
  }
</style>
