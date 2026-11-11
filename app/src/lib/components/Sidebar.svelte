<script lang="ts">
  import { slide } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import { app, docCategory, formatDate, shortTitle, type Section } from '../state.svelte';
  import { fold } from '../motion';

  // Раскрыт раздел с открытым документом; остальные — по клику
  let expanded = $state<Record<string, boolean>>({});
  const currentDoc = $derived(app.view.kind === 'doc' ? app.view.docId : '');
  const currentCategory = $derived.by(() => { const d = app.db.docs.find((x) => x.id === currentDoc); return d && docCategory(d); });
  const sections: { id: Section; label: string; icon: 'book' | 'gavel' }[] = [
    { id: 'project', label: 'Правила', icon: 'book' },
    { id: 'laws', label: 'Законы', icon: 'gavel' },
  ];
  const rail = $derived(app.sidebarCollapsed && !app.sidebarOpen);

  function isOpen(category: string) {
    return expanded[category] ?? category === currentCategory;
  }

  function onGroup(category: string, docs: { id: string }[]) {
    if (docs.length === 1) { app.open(docs[0]!.id); return; }
    if (rail) {
      // В свёрнутом меню клик по иконке разворачивает меню и открывает раздел
      app.toggleSidebar();
      expanded[category] = true;
      return;
    }
    expanded[category] = !isOpen(category);
  }

  function go(view: 'changes' | 'settings') {
    app.view = { kind: view };
    app.sidebarOpen = false;
  }
</script>

<nav class="sidebar" class:rail class:open={app.sidebarOpen} aria-label="Разделы правил">
  <div class="brand" data-tauri-drag-region>
    <span class="mark" aria-hidden="true">§</span>
    {#if !rail}<span class="name" data-tauri-drag-region>NOVA <span>HELPER</span></span>{/if}
    <button class="collapse" onclick={() => (app.sidebarOpen ? (app.sidebarOpen = false) : app.toggleSidebar())}
      title={rail ? 'Развернуть меню' : 'Свернуть меню'} aria-label={rail ? 'Развернуть меню' : 'Свернуть меню'}>
      <span class:flip={rail}><Icon name="collapse" size={16} /></span>
    </button>
  </div>

  {#if app.hasLaws}
    <div class="switch" class:rail role="tablist" aria-label="Раздел">
      {#each sections as sec (sec.id)}
        <button role="tab" class:on={app.section === sec.id} aria-selected={app.section === sec.id}
          onclick={() => app.setSection(sec.id)} title={rail ? (sec.id === 'laws' ? `Законы ${app.serverName}` : 'Правила проекта') : undefined}>
          <Icon name={sec.icon} size={rail ? 19 : 16} />{#if !rail}<span>{sec.label}</span>{/if}
        </button>
      {/each}
      {#if !rail}<span class="thumb" class:right={app.section === 'laws'} aria-hidden="true"></span>{/if}
    </div>
  {/if}

  <div class="scroll">
    {#if !rail}<p class="caption">{app.section === 'laws' ? `Законы сервера ${app.serverName}` : 'Правила проекта'}</p>{/if}

    {#if !app.loaded}
      {#each [70, 55, 82, 60, 74] as w, i (i)}
        <div class="sk-row"><span class="sk" style="width: 20px; height: 20px"></span>{#if !rail}<span class="sk" style="width: {w}%; height: 12px"></span>{/if}</div>
      {/each}
    {/if}

    {#each app.categories as group (group.category)}
      {@const single = group.docs.length === 1}
      {@const open = !single && !rail && isOpen(group.category)}
      {@const active = group.category === currentCategory}
      <button class="item" class:active={active && (single || rail)} class:parent={active && !single && !rail}
        onclick={() => onGroup(group.category, group.docs)} title={rail ? group.label : undefined} aria-expanded={single ? undefined : open}>
        <span class="ico"><Icon name={group.icon} size={19} /></span>
        {#if !rail}
          <span class="label">{group.label}</span>
          {#if !single}<span class="chev" class:down={open}><Icon name="chevron" size={14} /></span>{/if}
        {/if}
      </button>
      {#if open}
        <div class="docs" transition:slide={fold}>
          {#each group.docs as d (d.id)}
            <button class="doc" class:current={currentDoc === d.id} onclick={() => app.open(d.id)} title={d.title}>{shortTitle(d.title)}</button>
          {/each}
        </div>
      {/if}
    {/each}

    {#if !rail}<p class="caption gap">Обновления</p>{:else}<div class="divider"></div>{/if}
    <button class="item" class:active={app.view.kind === 'changes'} onclick={() => go('changes')} title={rail ? 'Что изменилось' : undefined}>
      <span class="ico"><Icon name="history" size={19} />{#if rail && app.recentChanges}<span class="dot-badge"></span>{/if}</span>
      {#if !rail}
        <span class="label">Что изменилось</span>
        {#if app.recentChanges}<span class="badge">{app.recentChanges}</span>{/if}
      {/if}
    </button>
  </div>

  <footer>
    {#if !rail}
      <div class="status">
        <div class="fresh">
          <span class="dot" class:stale={app.check?.status === 'available' || !app.loaded} class:busy={app.checking || !app.loaded}></span>
          <span>
            {#if !app.loaded}Загружаю правила…
            {:else if app.checking}Сверяю с форумом…
            {:else if app.check?.status === 'available'}Вышли новые правки
            {:else if app.lastChecked && app.check?.status === 'upToDate'}Актуально · {app.lastChecked.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            {:else if app.db.manifest}От {formatDate(app.db.manifest.generatedAt)}
            {:else}Правила не загружены{/if}
          </span>
        </div>
        <button class="btn sm wide" onclick={() => app.analyze(true)} disabled={app.checking}>
          <span class:spin={app.checking}><Icon name="refresh" size={15} /></span>Анализ правил
        </button>
      </div>
    {:else}
      <button class="item" onclick={() => app.analyze(true)} disabled={app.checking} title="Анализ правил">
        <span class="ico" class:spin={app.checking}><Icon name="refresh" size={19} /></span>
      </button>
    {/if}
    <button class="item" class:active={app.view.kind === 'settings'} onclick={() => go('settings')} title={rail ? 'Настройки' : undefined}>
      <span class="ico"><Icon name="settings" size={19} /></span>{#if !rail}<span class="label">Настройки</span>{/if}
    </button>
  </footer>
</nav>
{#if app.sidebarOpen}
  <button class="scrim" aria-label="Закрыть меню" onclick={() => (app.sidebarOpen = false)}></button>
{/if}

<style>
  .sidebar {
    width: 236px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border-right: 1px solid var(--border);
    min-height: 0;
    transition: width 0.22s var(--ease);
  }
  .sidebar.rail { width: 64px; }
  .brand { height: var(--topbar); display: flex; align-items: center; gap: 10px; padding: 0 8px 0 18px; flex-shrink: 0; }
  .rail .brand { padding: 0; flex-direction: column; justify-content: center; gap: 0; height: auto; padding-top: 12px; }
  .mark {
    display: grid; place-items: center; flex-shrink: 0;
    width: 28px; height: 28px; border-radius: 8px;
    background: var(--accent); color: var(--on-accent);
    font-weight: 800; font-size: 17px; line-height: 1;
  }
  .name { flex: 1; font-weight: 800; font-size: var(--fs-md); letter-spacing: 0.02em; white-space: nowrap; }
  .name span { color: var(--accent); }
  .collapse { display: grid; place-items: center; width: 30px; height: 30px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-muted); transition: background 0.15s, color 0.15s; }
  .collapse:hover { background: var(--surface-2); color: var(--text); }
  .rail .collapse { margin-top: 8px; }
  .collapse span { display: grid; transition: transform 0.22s var(--ease); }
  .collapse .flip { transform: rotate(180deg); }

  /* Переключатель «Правила / Законы»: жёлтая плашка переезжает под выбранный раздел */
  .switch { position: relative; display: grid; grid-template-columns: 1fr 1fr; margin: 2px 12px 6px; padding: 3px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--border); flex-shrink: 0; }
  .switch button { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; gap: 7px; height: 34px; border-radius: var(--radius-sm); font-size: var(--fs-sm); font-weight: 700; color: var(--text-dim); transition: color 0.2s var(--ease); }
  .switch button:hover { color: var(--text); }
  .switch button.on { color: var(--on-accent); }
  .thumb { position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc(50% - 3px); border-radius: var(--radius-sm); background: var(--accent); transition: transform 0.24s var(--ease); }
  .thumb.right { transform: translateX(100%); }
  .switch.rail { grid-template-columns: 1fr; gap: 4px; margin: 10px auto 0; padding: 4px; width: 52px; }
  .switch.rail button { width: 42px; height: 38px; padding: 0; justify-content: center; }
  .switch.rail button.on { background: var(--accent); }
  .scroll { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 6px 12px 10px; display: flex; flex-direction: column; gap: 2px; }
  .rail .scroll { padding: 10px 10px; align-items: center; }
  /* В длинном списке пункты меню не сжимаются, а список прокручивается */
  .scroll > :global(*) { flex-shrink: 0; }
  .caption { margin: 10px 10px 6px; font-size: var(--fs-xs); font-weight: 600; color: var(--text-muted); }
  .caption.gap { margin-top: 18px; }
  .divider { width: 28px; height: 1px; background: var(--border); margin: 10px 0; }

  button { border: 0; background: transparent; text-align: left; }
  .item {
    position: relative;
    display: flex; align-items: center; gap: 11px;
    width: 100%; height: 42px; padding: 0 10px;
    border-radius: var(--radius);
    font-size: var(--fs-sm); font-weight: 600; color: var(--text-dim);
    /* подсветка при наведении — мгновенно, без анимации */
  }
  .rail .item { width: 44px; justify-content: center; padding: 0; }
  .item:hover { background: var(--surface); color: var(--text); }
  .item.active { background: var(--surface-2); color: var(--accent); }
  .item.parent { color: var(--text); }
  .item.parent .ico { color: var(--accent); }
  .ico { position: relative; display: grid; place-items: center; flex-shrink: 0; }
  .label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chev { display: grid; color: var(--text-muted); transition: transform 0.2s var(--ease); }
  .chev.down { transform: rotate(90deg); }

  .docs { display: flex; flex-direction: column; gap: 1px; margin: 2px 0 6px 19px; padding-left: 12px; border-left: 1px solid var(--border-strong); }
  .doc {
    width: 100%; padding: 7px 10px; border-radius: var(--radius-sm);
    font-size: var(--fs-sm); color: var(--text-muted); line-height: 1.35;
    /* подсветка при наведении — мгновенно, без анимации */
  }
  .doc:hover { background: var(--surface); color: var(--text); }
  .doc.current { background: var(--accent-tint); color: var(--accent); font-weight: 600; }

  .badge { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--danger-line); color: #fff; font-size: 11px; font-weight: 800; display: grid; place-items: center; }
  .dot-badge { position: absolute; top: -2px; right: -3px; width: 8px; height: 8px; border-radius: 50%; background: var(--danger-line); border: 2px solid var(--bg); }

  .sk-row { display: flex; align-items: center; gap: 11px; height: 42px; padding: 0 10px; }

  footer { padding: 10px 12px 14px; display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--border); }
  .rail footer { align-items: center; padding: 10px; }
  .status { padding: 12px; margin-bottom: 4px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; }
  .fresh { display: flex; align-items: center; gap: 8px; font-size: var(--fs-xs); color: var(--text-dim); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); flex-shrink: 0; box-shadow: 0 0 0 3px var(--success-tint); }
  .dot.stale { background: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint); }
  .dot.busy { animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.35; } }
  .spin { display: grid; animation: spin 0.9s linear infinite; }
  .scrim { display: none; }

  /* Узкое окно: меню выезжает поверх содержимого */
  @media (max-width: 639px) {
    .sidebar, .sidebar.rail {
      position: absolute; top: 0; bottom: 0; left: 0; z-index: 20;
      width: min(272px, 86vw);
      transform: translateX(-102%);
      transition: transform 0.22s var(--ease);
      box-shadow: 12px 0 32px rgba(0, 0, 0, 0.5);
    }
    .sidebar.open { transform: none; }
    .collapse { display: none; }
    .scrim { display: block; position: absolute; inset: 0; z-index: 19; background: rgba(0, 0, 0, 0.5); border: 0; }
  }
</style>
