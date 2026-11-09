<script lang="ts">
  import Icon from './Icon.svelte';
  import { app, formatDate, shortTitle } from '../state.svelte';

  // Раскрыт раздел с открытым документом; остальные — по клику
  let expanded = $state<Record<string, boolean>>({});
  const currentDoc = $derived(app.view.kind === 'doc' ? app.view.docId : '');
  const currentCategory = $derived(app.db.docs.find((d) => d.id === currentDoc)?.category);

  function isOpen(category: string, count: number) {
    return expanded[category] ?? (category === currentCategory || count === 1);
  }
</script>

<nav class="sidebar" class:open={app.sidebarOpen} aria-label="Разделы правил">
  <div class="scroll">
    {#each app.categories as group (group.category)}
      {@const open = isOpen(group.category, group.docs.length)}
      {#if group.docs.length === 1}
        <button class="doc single" class:current={currentDoc === group.docs[0]!.id} onclick={() => app.open(group.docs[0]!.id)}>
          {group.label}
        </button>
      {:else}
        <button class="group" aria-expanded={open} onclick={() => (expanded[group.category] = !open)}>
          <span class="chev" class:down={open}><Icon name="chevron" size={14} /></span>
          <span class="label">{group.label}</span>
          <span class="count">{group.docs.length}</span>
        </button>
        {#if open}
          <div class="docs">
            {#each group.docs as d (d.id)}
              <button class="doc" class:current={currentDoc === d.id} onclick={() => app.open(d.id)} title={d.title}>
                {shortTitle(d.title)}
              </button>
            {/each}
          </div>
        {/if}
      {/if}
    {/each}

    <button class="changes" class:current={app.view.kind === 'changes'} onclick={() => { app.view = { kind: 'changes' }; app.sidebarOpen = false; }}>
      <Icon name="history" size={16} />
      <span>Что изменилось</span>
      {#if app.recentChanges}<span class="badge">{app.recentChanges}</span>{/if}
    </button>
  </div>

  <footer class="status">
    <div class="freshness">
      <span class="dot" class:stale={app.check?.status === 'available'}></span>
      <span>
        {#if app.check?.status === 'available'}Есть новые правки
        {:else if app.lastChecked && app.check?.status === 'upToDate'}Правила актуальны, проверено в {app.lastChecked.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        {:else if app.db.manifest}Правила от {formatDate(app.db.manifest.generatedAt)}
        {:else}Правила не загружены{/if}
      </span>
    </div>
    <button class="btn wide" onclick={() => app.analyze(true)} disabled={app.checking}>
      <span class:spin={app.checking}><Icon name="refresh" size={16} /></span>
      {app.checking ? 'Сверяю с форумом…' : 'Анализ правил'}
    </button>
  </footer>
</nav>
{#if app.sidebarOpen}
  <button class="scrim" aria-label="Закрыть меню" onclick={() => (app.sidebarOpen = false)}></button>
{/if}

<style>
  .sidebar {
    width: 216px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-right: 1px solid var(--border);
    min-height: 0;
  }
  .scroll { flex: 1; overflow-y: auto; padding: 10px 8px; display: flex; flex-direction: column; gap: 1px; }
  button { border: 0; background: transparent; text-align: left; }
  .group {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 7px 8px 7px 4px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text);
  }
  .group:hover { background: var(--surface-2); }
  .chev { display: grid; color: var(--text-muted); transition: transform 0.15s; }
  .chev.down { transform: rotate(90deg); }
  .label { flex: 1; min-width: 0; }
  .count { font-size: var(--fs-xs); color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .docs { display: flex; flex-direction: column; gap: 1px; margin: 1px 0 6px 13px; padding-left: 8px; border-left: 1px solid var(--border); }
  .doc {
    width: 100%;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    color: var(--text-dim);
    line-height: 1.35;
  }
  .doc.single { padding: 7px 8px 7px 24px; font-weight: 700; color: var(--text); }
  .doc:hover { background: var(--surface-2); color: var(--text); }
  .doc.current, .changes.current { background: var(--accent-tint); color: var(--accent-soft); }
  .changes {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    padding: 8px 8px;
    border-top: 1px solid var(--border);
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text);
  }
  .changes:hover { background: var(--surface-2); }
  .changes span:first-of-type { flex: 1; }
  .badge {
    min-width: 22px;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: var(--fs-xs);
    font-weight: 800;
    text-align: center;
  }
  .status { padding: 10px 10px 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
  .freshness { display: flex; align-items: center; gap: 8px; font-size: var(--fs-xs); color: var(--text-muted); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); flex-shrink: 0; }
  .dot.stale { background: var(--accent); }
  .spin { display: grid; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .scrim { display: none; }

  /* Узкое окно: меню выезжает поверх содержимого */
  @media (max-width: 639px) {
    .sidebar {
      position: absolute;
      top: var(--titlebar);
      bottom: 0;
      left: 0;
      z-index: 20;
      width: min(272px, 85vw);
      transform: translateX(-100%);
      transition: transform 0.18s ease-out;
      box-shadow: 8px 0 24px rgba(0, 0, 0, 0.5);
    }
    .sidebar.open { transform: none; }
    .scrim { display: block; position: absolute; inset: var(--titlebar) 0 0 0; z-index: 19; background: rgba(0, 0, 0, 0.45); border: 0; }
  }
</style>
