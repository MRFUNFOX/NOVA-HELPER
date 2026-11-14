<script lang="ts">
  // Верхняя панель: поиск, ИИ-помощник, кнопки окна. Пустые места — область перетаскивания окна.
  import Icon from './Icon.svelte';
  import { app, focusSearch } from '../state.svelte';
  import { backend } from '../backend';
  import { track } from '../stats';

  let { onSearchKey, wizard = false }: { onSearchKey?: (e: KeyboardEvent) => void; wizard?: boolean } = $props();
  let maximized = $state(false);
  /** Узкое окно: ползунок прозрачности прячется в выпадашку под кнопкой */
  let glassOpen = $state(false);
  // Статистика: какой прозрачностью пользуются (не больше 3 раз за запуск)
  let glassSent = 0;
  const glassStat = () => { if (glassSent++ < 3) track('glass', { value: app.glass }); };
  // Подсказка в поле поиска короче, когда панель узкая — иначе от неё видно «Поиск по г…»
  let barWidth = $state(1000);
  const placeholder = $derived(
    barWidth < 520 ? 'Поиск' : barWidth < 760 ? (app.section === 'laws' ? 'Поиск по законам' : 'Поиск по правилам')
      : app.section === 'laws' ? 'Поиск по законам: «ук 12.1», «арест»…' : 'Поиск по правилам: «дм», «4.1»…',
  );
  let glassBox: HTMLElement | undefined = $state();
  $effect(() => {
    if (!glassOpen) return;
    const off = (e: PointerEvent) => { if (glassBox && !glassBox.contains(e.target as Node)) glassOpen = false; };
    document.addEventListener('pointerdown', off, true);
    return () => document.removeEventListener('pointerdown', off, true);
  });

  async function toggleMax() {
    await backend.toggleMaximize();
    maximized = !maximized;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<header class="topbar" bind:clientWidth={barWidth} data-tauri-drag-region ondblclick={(e) => { if (e.target === e.currentTarget) toggleMax(); }}>
  {#if wizard}
    <div class="brand" data-tauri-drag-region><span class="mark" aria-hidden="true">§</span><span class="name" data-tauri-drag-region>NOVA <span>HELPER</span></span></div>
  {:else}
    <button class="icon-btn menu" aria-label="Открыть меню" onclick={() => (app.sidebarOpen = !app.sidebarOpen)}><Icon name="menu" /></button>
    <label class="search">
      <Icon name="search" size={18} />
      <input
        id="search"
        type="search"
        {placeholder}
        autocomplete="off"
        spellcheck="false"
        bind:value={app.query}
        onkeydown={(e) => onSearchKey?.(e)}
      />
      {#if app.query}
        <button class="clear" aria-label="Очистить поиск" onclick={() => { app.query = ''; focusSearch(); }}><Icon name="close" size={15} /></button>
      {:else}
        <span class="hint" aria-hidden="true"><kbd>Ctrl</kbd><kbd>K</kbd></span>
      {/if}
    </label>
  {/if}

  <div class="actions">
    {#if !wizard && app.pinsEnabled}
      <!-- Прозрачность фона программы: текст и кнопки остаются чёткими, сквозь фон видно игру -->
      <div class="glass" class:off={!app.glassReady} bind:this={glassBox} title={app.glassReady ? `Прозрачность фона: ${100 - app.glass}% — сквозь окно видно игру` : 'Перезапустите программу, чтобы включить прозрачность'}>
        <button class="glass-btn" onclick={() => (glassOpen = !glassOpen)} aria-label="Прозрачность фона программы" aria-expanded={glassOpen}><Icon name="contrast" size={16} /></button>
        <input class="glass-inline" type="range" min="30" max="100" step="5" value={app.glass} disabled={!app.glassReady}
          oninput={(e) => (app.glass = Number(e.currentTarget.value))} onchange={glassStat} aria-label="Прозрачность фона программы" />
        {#if glassOpen}
          <div class="glass-pop">
            <span class="glass-cap">Прозрачность фона <b>{100 - app.glass}%</b></span>
            <input type="range" min="30" max="100" step="5" value={app.glass} disabled={!app.glassReady}
              oninput={(e) => (app.glass = Number(e.currentTarget.value))} onchange={glassStat} aria-label="Прозрачность фона программы" />
            {#if !app.glassReady}<span class="glass-cap">Перезапустите программу, чтобы включить</span>{/if}
          </div>
        {/if}
      </div>
      <span class="sep" aria-hidden="true"></span>
    {/if}
    {#if !wizard && app.aiEnabled}
      <button class="ai" class:active={app.aiOpen} onclick={() => (app.aiOpen = !app.aiOpen)} title="Спросить ИИ-помощника о правилах">
        <Icon name="spark" size={17} />
        <span class="ai-label">ИИ-помощник</span>
      </button>
      <span class="sep" aria-hidden="true"></span>
    {/if}
    <button class="icon-btn" title="Свернуть" aria-label="Свернуть" onclick={() => backend.minimize()}><Icon name="minus" /></button>
    <button class="icon-btn" title={maximized ? 'Вернуть размер' : 'Развернуть'} aria-label="Развернуть" onclick={toggleMax}>
      <Icon name={maximized ? 'squares' : 'square'} size={16} />
    </button>
    <button class="icon-btn close" title="Скрыть — клавиша {app.settings?.hotkey ?? ''} вернёт окно" aria-label="Закрыть" onclick={() => backend.hide()}>
      <Icon name="close" />
    </button>
  </div>
</header>

<style>
  .topbar {
    /* Кнопки подстраиваются под реальную ширину панели, а не всего окна (рядом меню и ИИ-панель) */
    container: topbar / inline-size;
    height: var(--topbar);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 8px 0 18px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .brand { display: flex; align-items: center; gap: 10px; flex: 1; height: 100%; }
  .mark { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--accent); color: var(--on-accent); font-weight: 800; font-size: 17px; }
  .name { font-weight: 800; letter-spacing: 0.02em; }
  .name span { color: var(--accent); }

  .search {
    flex: 1;
    max-width: 440px;
    min-width: 120px;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 38px;
    padding: 0 8px 0 12px;
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
    transition: border-color 0.15s var(--ease), box-shadow 0.15s var(--ease), color 0.15s var(--ease);
  }
  .search:focus-within { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-tint); color: var(--accent); }
  .search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; font-size: var(--fs-sm); color: var(--text); }
  .search input::placeholder { color: var(--text-muted); }
  .search input::-webkit-search-cancel-button { display: none; }
  .hint { display: flex; gap: 4px; }
  .clear { display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-muted); }
  .clear:hover { background: var(--surface-2); color: var(--text); }

  .actions { display: flex; align-items: center; gap: 2px; margin-left: auto; }
  .glass { position: relative; display: flex; align-items: center; gap: 4px; height: 34px; padding: 0 10px 0 0; margin-right: 4px; border-radius: var(--radius-sm); color: var(--text-dim); flex-shrink: 0; }
  .glass:hover { background: var(--surface-2); color: var(--text); }
  .glass.off .glass-inline, .glass.off .glass-btn { opacity: 0.5; }
  .glass input { margin: 0; accent-color: var(--accent); direction: rtl; }
  .glass-inline { width: 84px; }
  .glass-btn { display: grid; place-items: center; width: 30px; height: 34px; padding: 0; border: 0; background: none; color: inherit; pointer-events: none; }
  .glass-pop { display: none; }
  .ai-label { white-space: nowrap; }
  .actions { flex-shrink: 0; }
  .icon-btn {
    display: grid; place-items: center;
    width: 36px; height: 34px;
    border: 0; border-radius: var(--radius-sm);
    background: transparent; color: var(--text-dim);
    transition: background 0.15s var(--ease), color 0.15s var(--ease);
  }
  .icon-btn:hover { background: var(--surface-2); color: var(--text); }
  .icon-btn.close:hover { background: #c42b1c; color: #fff; }
  .menu { display: none; margin-left: -8px; }
  .ai {
    display: inline-flex; align-items: center; gap: 8px;
    height: 36px; padding: 0 14px 0 12px; margin-right: 4px;
    border-radius: var(--radius);
    border: 1px solid var(--accent);
    background: var(--accent); color: var(--on-accent);
    font-size: var(--fs-sm); font-weight: 700;
    transition: background 0.15s var(--ease), transform 0.1s var(--ease);
  }
  .ai:hover { background: var(--accent-soft); }
  .ai:active { transform: scale(0.97); }
  .ai.active { background: var(--accent-tint); color: var(--accent); }
  .sep { width: 1px; height: 22px; background: var(--border); margin: 0 6px; }

  @media (max-width: 639px) {
    .menu { display: grid; }
    .topbar { padding-left: 16px; }
  }
  /* Ширина самой панели: сначала прячем подсказку Ctrl K, потом сворачиваем ползунок, потом подпись ИИ */
  @container topbar (max-width: 700px) {
    .hint { display: none; }
  }
  @container topbar (max-width: 620px) {
    .glass { padding: 0; }
    .glass-inline { display: none; }
    .glass-btn { pointer-events: auto; width: 36px; }
    .glass-pop {
      position: absolute; top: calc(100% + 8px); right: 0; z-index: 50;
      display: flex; flex-direction: column; gap: 8px; width: 220px;
      padding: 12px 14px; border-radius: 12px;
      background: var(--surface-2); border: 1px solid var(--border-strong); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
    }
    .glass-pop input { width: 100%; }
    .glass-cap { font-size: var(--fs-xs); color: var(--text-dim); font-weight: 600; }
    .glass-cap b { color: var(--text); }
  }
  @container topbar (max-width: 520px) {
    .ai-label { display: none; }
    .ai { padding: 0 10px; }
    .sep { display: none; }
  }
</style>
