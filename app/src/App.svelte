<script lang="ts">
  import TitleBar from './lib/components/TitleBar.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import DocView from './lib/components/DocView.svelte';
  import SearchResults from './lib/components/SearchResults.svelte';
  import Changes from './lib/components/Changes.svelte';
  import SettingsView from './lib/components/SettingsView.svelte';
  import Wizard from './lib/components/Wizard.svelte';
  import UpdateDialog from './lib/components/UpdateDialog.svelte';
  import AiPanel from './lib/components/AiPanel.svelte';
  import Icon from './lib/components/Icon.svelte';
  import { app, focusSearch } from './lib/state.svelte';
  import { backend } from './lib/backend';

  let results: SearchResults | undefined = $state();
  let started = $state(false);
  let main: HTMLElement | undefined = $state();

  $effect(() => {
    app.start().then(() => (started = true)).catch((e) => { started = true; app.notify(String(e), 'error'); });
  });

  // При смене документа — наверх (если не переходим к конкретному пункту)
  $effect(() => {
    const v = app.view;
    if (main && !(v.kind === 'doc' && v.focus)) main.scrollTop = 0;
  });

  const currentDoc = $derived(app.view.kind === 'doc' ? app.doc(app.view.docId) : undefined);
  const firstRun = $derived(started && app.settings && !app.settings.firstRunDone);

  function onKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey && e.code === 'KeyF') || (e.key === '/' && document.activeElement?.tagName !== 'INPUT')) {
      e.preventDefault();
      focusSearch();
    }
    if (e.key === 'Escape' && !app.updateDialog && !firstRun) {
      if (app.query) app.query = '';
      else if (app.aiOpen) app.aiOpen = false;
      else if (app.sidebarOpen) app.sidebarOpen = false;
      else backend.hide();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="shell">
  <TitleBar />
  {#if !started}
    <div class="boot"><span class="spinner" aria-hidden="true"></span></div>
  {:else if firstRun}
    <Wizard />
  {:else}
    <div class="body">
      <Sidebar />
      <div class="column">
        <div class="searchbar">
          <label class="search">
            <Icon name="search" size={17} />
            <input
              id="search"
              type="search"
              placeholder="Поиск: «дм», «4.1», «оскорбление»"
              autocomplete="off"
              spellcheck="false"
              bind:value={app.query}
              onkeydown={(e) => results?.onKey(e)}
            />
            {#if app.query}
              <button class="clear" aria-label="Очистить поиск" onclick={() => { app.query = ''; focusSearch(); }}><Icon name="close" size={15} /></button>
            {:else}
              <kbd class="kbd-hint">Ctrl F</kbd>
            {/if}
          </label>
        </div>
        <main bind:this={main}>
          {#if app.query.trim()}
            <SearchResults bind:this={results} />
          {:else if app.view.kind === 'settings'}
            <SettingsView />
          {:else if app.view.kind === 'changes'}
            <Changes />
          {:else if currentDoc}
            {#key currentDoc.id}<DocView doc={currentDoc} />{/key}
          {:else}
            <div class="empty">
              <h1>Правила не загружены</h1>
              <p>Нужен интернет, чтобы скачать правила с сервера. После загрузки они работают и без него.</p>
              <button class="btn primary" onclick={() => app.applyUpdate()} disabled={app.updating}>{app.updating ? 'Загружаю…' : 'Загрузить правила'}</button>
              {#if app.updateError}<p class="error">{app.updateError}</p>{/if}
            </div>
          {/if}
        </main>
      </div>
      {#if app.aiOpen}<AiPanel />{/if}
    </div>
  {/if}
  <UpdateDialog />
  {#if app.toast}
    <div class="toast" class:error={app.toast.tone === 'error'} role="status">{app.toast.text}</div>
  {/if}
</div>

<style>
  .shell { position: relative; height: 100%; display: flex; flex-direction: column; background: var(--bg); border: 1px solid var(--border-strong); }
  .body { flex: 1; display: flex; min-height: 0; }
  .column { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .searchbar { padding: 10px 14px; border-bottom: 1px solid var(--border); }
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 40px;
    padding: 0 10px 0 12px;
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    color: var(--text-muted);
  }
  .search:focus-within { border-color: var(--accent); color: var(--accent); }
  .search input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font-size: var(--fs-md); color: var(--text); }
  .search input::placeholder { color: var(--text-muted); }
  .search input::-webkit-search-cancel-button { display: none; }
  .clear { display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-muted); }
  .clear:hover { background: var(--surface-2); color: var(--text); }
  .kbd-hint { color: var(--text-muted); background: transparent; }
  main { flex: 1; overflow-y: auto; overflow-x: hidden; }
  .empty { padding: 32px 24px; max-width: 460px; }
  .empty h1 { font-size: var(--fs-xl); margin: 0 0 8px; }
  .empty p { color: var(--text-dim); }
  .error { color: var(--danger); font-size: var(--fs-sm); }
  .boot { flex: 1; display: grid; place-items: center; }
  .spinner { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--surface-3); border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .toast {
    position: absolute;
    left: 50%;
    bottom: 18px;
    transform: translateX(-50%);
    z-index: 60;
    max-width: calc(100% - 32px);
    padding: 10px 16px;
    border-radius: var(--radius);
    background: var(--surface-3);
    border: 1px solid var(--border-strong);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    font-size: var(--fs-sm);
    font-weight: 600;
    animation: rise 0.18s ease-out;
  }
  .toast.error { background: var(--danger-tint); border-color: var(--danger-line); color: var(--danger); }
  @keyframes rise { from { opacity: 0; transform: translate(-50%, 8px); } }
  @media (max-width: 579px) { .kbd-hint { display: none; } }
</style>
