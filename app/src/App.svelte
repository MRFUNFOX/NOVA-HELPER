<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import TitleBar from './lib/components/TitleBar.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import DocView from './lib/components/DocView.svelte';
  import DocSkeleton from './lib/components/DocSkeleton.svelte';
  import SearchResults from './lib/components/SearchResults.svelte';
  import Changes from './lib/components/Changes.svelte';
  import CategoryView from './lib/components/CategoryView.svelte';
  import SettingsView from './lib/components/SettingsView.svelte';
  import Wizard from './lib/components/Wizard.svelte';
  import UpdateDialog from './lib/components/UpdateDialog.svelte';
  import AiPanel from './lib/components/AiPanel.svelte';
  import Icon from './lib/components/Icon.svelte';
  import { app, focusSearch } from './lib/state.svelte';
  import { ai } from './lib/ai.svelte';
  import AiSetup from './lib/components/AiSetup.svelte';
  import Consent from './lib/components/Consent.svelte';
  import { track, trackEmptySearch, trackErrors } from './lib/stats';
  import { scale } from 'svelte/transition';
  import { backend } from './lib/backend';
  import { ms } from './lib/motion';

  let results: SearchResults | undefined = $state();
  let started = $state(false);
  let main: HTMLElement | undefined = $state();

  $effect(() => {
    app.start()
      .then(async () => {
        started = true;
        trackErrors();
        track('app_start', { section: app.section, laws: app.hasLaws ? 1 : 0 });
        await ai.init();
        // Программа стояла до появления помощника: один раз предлагаем его настроить
        if (app.aiEnabled && app.settings?.firstRunDone && !app.settings.aiSetupDone && !ai.ready) ai.setupOpen = true;
        else if (ai.ready) app.markAiSetupDone();
      })
      .catch((e) => { started = true; app.loaded = true; app.notify(String(e), 'error'); });
  });

  // Вопрос о статистике — один раз, после первого запуска и после окна настройки помощника
  const consentOpen = $derived(started && !!app.settings?.firstRunDone && app.settings.analytics == null && !ai.setupOpen && !app.updateDialog);

  // Поиск ничего не нашёл — запоминаем запрос (если игрок разрешил статистику), когда он перестал печатать
  $effect(() => {
    const q = app.query.trim();
    const none = !!q && app.hits.length === 0;
    const section = app.section;
    if (!none) return;
    const timer = setTimeout(() => trackEmptySearch(section, q), 1500);
    return () => clearTimeout(timer);
  });

  // Прозрачный фон программы (ползунок вверху): прозрачнее только подложки, текст и кнопки — как были
  $effect(() => {
    const a = app.pinsEnabled && app.glassReady ? app.glass / 100 : 1;
    const root = document.documentElement.style;
    if (a >= 1) {
      for (const v of ['--bg', '--surface', '--surface-2', '--surface-3']) root.removeProperty(v);
      return;
    }
    const f = (x: number) => Math.min(1, x).toFixed(2);
    root.setProperty('--bg', `rgba(26, 27, 30, ${f(a)})`);
    root.setProperty('--surface', `rgba(33, 34, 38, ${f(a + 0.08)})`);
    root.setProperty('--surface-2', `rgba(39, 40, 45, ${f(a + 0.14)})`);
    root.setProperty('--surface-3', `rgba(49, 50, 56, ${f(a + 0.2)})`);
  });

  // При смене экрана — наверх (если не переходим к конкретному пункту)
  $effect(() => {
    const v = app.view;
    if (main && !(v.kind === 'doc' && v.focus)) main.scrollTop = 0;
  });

  const currentDoc = $derived(app.view.kind === 'doc' ? app.doc(app.view.docId) : undefined);
  const firstRun = $derived(started && app.settings && !app.settings.firstRunDone);
  // Ключ экрана — для плавной смены содержимого
  const screen = $derived(
    app.query.trim() ? 'search'
      : app.view.kind === 'doc' ? `doc:${app.view.docId}`
      : app.view.kind === 'category' ? `cat:${app.view.category}` : app.view.kind,
  );

  function onKeydown(e: KeyboardEvent) {
    const typing = document.activeElement?.tagName === 'INPUT';
    if ((e.ctrlKey && (e.code === 'KeyF' || e.code === 'KeyK')) || (e.key === '/' && !typing)) {
      e.preventDefault();
      focusSearch();
    }
    if (e.key === 'Escape' && !app.updateDialog && !firstRun && !ai.setupOpen) {
      if (app.query) app.query = '';
      else if (app.aiOpen) app.aiOpen = false;
      else if (app.sidebarOpen) app.sidebarOpen = false;
      else backend.hide();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="shell">
  {#if firstRun}
    <div class="column">
      <TitleBar wizard />
      <Wizard />
    </div>
  {:else}
    <Sidebar />
    <div class="column">
      <TitleBar onSearchKey={(e) => results?.onKey(e)} />
      {#if app.pinsEnabled && app.gameFullscreen}
        <!-- Поверх полноэкранной игры Windows ничего не показывает -->
        <p class="game-warn" role="status">
          <Icon name="alert" size={15} />
          <span><b>GTA запущена в полноэкранном режиме</b> — программа и закреплённые пункты не видны поверх игры. В настройках игры: Графика → Тип экрана → «Оконный без рамки».</span>
        </p>
      {/if}
      <div class="body">
        <main bind:this={main}>
          {#if !started || !app.loaded || (app.updating && !app.ready)}
            <DocSkeleton />
          {:else}
            {#key screen}
              <div class="screen">
                {#if app.query.trim()}
                  <SearchResults bind:this={results} />
                {:else if app.view.kind === 'settings'}
                  <SettingsView />
                {:else if app.view.kind === 'changes'}
                  <Changes />
                {:else if app.view.kind === 'category'}
                  <CategoryView category={app.view.category} />
                {:else if currentDoc}
                  <DocView doc={currentDoc} />
                {:else}
                  <div class="empty">
                    <div class="card">
                      <span class="empty-ico"><Icon name="download" size={22} /></span>
                      <h1>Правила ещё не скачаны</h1>
                      <p>Нужен интернет, чтобы один раз скачать правила с сервера. Дальше они работают и без него.</p>
                      <button class="btn primary" onclick={() => app.applyUpdate()} disabled={app.updating}>
                        <Icon name="download" size={16} />{app.updating ? 'Скачиваю…' : 'Скачать правила'}
                      </button>
                      {#if app.updateError}<p class="error">{app.updateError}</p>{/if}
                    </div>
                  </div>
                {/if}
              </div>
            {/key}
          {/if}
        </main>
        {#if app.aiOpen && app.aiEnabled}<AiPanel />{/if}
      </div>
    </div>
  {/if}
  <UpdateDialog />
  {#if ai.setupOpen && !firstRun && app.aiEnabled}
    <div class="backdrop" transition:fade={{ duration: ms(160) }}>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Настройка ИИ-помощника" transition:scale={{ start: 0.96, duration: ms(220) }}>
        <AiSetup compact onDone={(ok) => { ai.setupOpen = false; app.markAiSetupDone(); if (ok) app.aiOpen = true; }} />
      </div>
    </div>
  {/if}
  {#if consentOpen}
    <div class="backdrop" transition:fade={{ duration: ms(160) }}>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Анонимная статистика" transition:scale={{ start: 0.96, duration: ms(220) }}>
        <Consent onDone={(ok) => { if (ok) track('app_start', { section: app.section, laws: app.hasLaws ? 1 : 0 }); }} />
      </div>
    </div>
  {/if}
  {#if app.toast}
    {#key app.toast}
      <div class="toast" class:error={app.toast.tone === 'error'} role="status" in:fly={{ y: 12, duration: ms(220) }} out:fade={{ duration: ms(150) }}>
        <Icon name={app.toast.tone === 'error' ? 'alert' : 'check'} size={16} />{app.toast.text}
      </div>
    {/key}
  {/if}
</div>

<style>
  .shell { position: relative; height: 100%; display: flex; background: var(--bg); border: 1px solid var(--border-strong); overflow: hidden; }
  .column { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .body { position: relative; flex: 1; display: flex; min-height: 0; }
  .game-warn { display: flex; gap: 10px; align-items: flex-start; margin: 0; padding: 10px 16px; background: var(--orange-tint); border-bottom: 1px solid var(--border); color: var(--orange); font-size: var(--fs-sm); line-height: 1.45; flex-shrink: 0; }
  .game-warn :global(svg) { flex-shrink: 0; margin-top: 3px; }
  .game-warn b { color: var(--text); }
  main { flex: 1; min-width: 0; overflow-y: auto; overflow-x: hidden; }
  .screen { min-height: 100%; }
  .empty { padding: 32px 24px; max-width: 520px; }
  .empty .card { padding: 24px; }
  .empty-ico { display: grid; place-items: center; width: 44px; height: 44px; border-radius: var(--radius); background: var(--accent-tint); color: var(--accent); margin-bottom: 14px; }
  .empty h1 { font-size: var(--fs-xl); margin: 0 0 8px; }
  .empty p { color: var(--text-dim); margin: 0 0 18px; }
  .error { color: var(--danger); font-size: var(--fs-sm); margin-top: 12px !important; }
  .backdrop { position: absolute; inset: 0; z-index: 55; display: grid; place-items: center; padding: 16px; background: rgba(10, 10, 12, 0.66); overflow-y: auto; }
  .dialog { width: 100%; max-width: 480px; padding: 24px; border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--border-strong); box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55); }
  .toast {
    position: absolute;
    left: 50%;
    bottom: 20px;
    translate: -50% 0;
    z-index: 60;
    display: flex; align-items: center; gap: 10px;
    max-width: calc(100% - 32px);
    padding: 11px 16px;
    border-radius: var(--radius);
    background: var(--surface-3);
    border: 1px solid var(--border-strong);
    box-shadow: 0 14px 36px rgba(0, 0, 0, 0.5);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .toast :global(svg) { flex-shrink: 0; color: var(--success); }
  .toast.error { background: #3a2224; border-color: color-mix(in srgb, var(--danger-line) 45%, transparent); color: var(--danger); }
  .toast.error :global(svg) { color: var(--danger); }
</style>
