<script lang="ts">
  // Окно «Правила» или «Законы» в меню поверх игры: свободный свод — разделы слева, документ справа.
  // У каждого окна свой открытый документ: оба окна могут быть открыты одновременно.
  import Icon from '../Icon.svelte';
  import DocView from '../DocView.svelte';
  import { app, sectionOf, shortTitle, type Section } from '../../state.svelte';
  import { search } from '../../search';

  let { section }: { section: Section } = $props();

  let docId = $state('');
  let query = $state('');
  let shut = $state<Record<string, boolean>>({});
  let content: HTMLElement | undefined = $state();

  const groups = $derived(app.categoriesOf(section));
  const doc = $derived(app.doc(docId) ?? app.doc(app.mainDocId(section)));
  const hits = $derived(query.trim() ? search(app.index, query, 40, (d) => sectionOf(d) === section) : []);
  const law = $derived(section === 'laws');

  function open(id: string, focus?: string) {
    docId = id;
    query = '';
    app.open(id, focus);
    if (!focus) content?.scrollTo({ top: 0 });
  }
</script>

<div class="docs">
  <nav class="tree" aria-label={law ? 'Разделы законов' : 'Разделы правил'}>
    <label class="find">
      <Icon name="search" size={15} />
      <input type="search" bind:value={query} placeholder={law ? 'Поиск по законам: «ук 12.1»…' : 'Поиск по правилам: «дм», «4.1»…'} aria-label={law ? 'Поиск по законам' : 'Поиск по правилам'} />
    </label>
    <div class="list">
      {#each groups as g (g.category)}
        {#if g.docs.length === 1}
          <button class="cat" class:on={doc?.id === g.docs[0]!.id} onclick={() => open(g.docs[0]!.id)}>
            <Icon name={g.icon} size={16} /><span>{g.label}</span>
          </button>
        {:else}
          <button class="cat" aria-expanded={!shut[g.category]} onclick={() => (shut[g.category] = !shut[g.category])}>
            <Icon name={g.icon} size={16} /><span>{g.label}</span><b>{g.docs.length}</b>
          </button>
          {#if !shut[g.category]}
            {#each g.docs as d (d.id)}
              <button class="doc" class:on={doc?.id === d.id} onclick={() => open(d.id)}>{shortTitle(d.title)}</button>
            {/each}
          {/if}
        {/if}
      {/each}
    </div>
  </nav>
  <div class="content" bind:this={content}>
    {#if query.trim()}
      {#if hits.length}
        <ul class="hits">
          {#each hits as h (h.entry.node.id)}
            <li><button onclick={() => open(h.entry.doc.id, h.entry.node.id)}>
              <span class="no">{h.entry.node.number || '•'}</span>
              <span class="txt"><b>{shortTitle(h.entry.doc.title)}</b>{h.entry.node.text.slice(0, 160)}</span>
            </button></li>
          {/each}
        </ul>
      {:else}
        <p class="empty">Ничего не нашлось. Попробуйте другое слово или номер пункта.</p>
      {/if}
    {:else if doc}
      {#key doc.id}<DocView {doc} />{/key}
    {:else}
      <p class="empty">Правила ещё загружаются…</p>
    {/if}
  </div>
</div>

<style>
  .docs { flex: 1; min-height: 0; display: flex; }
  .tree { width: 250px; flex-shrink: 0; display: flex; flex-direction: column; border-right: 1px solid var(--border); min-height: 0; }
  .find { display: flex; align-items: center; gap: 8px; margin: 10px; height: 38px; padding: 0 10px; border-radius: var(--radius); background: var(--surface-2); border: 1px solid var(--border-strong); color: var(--text-muted); }
  .find input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--text); font: inherit; font-size: 13px; }
  .list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 10px; display: flex; flex-direction: column; gap: 1px; }
  .cat, .doc { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text); text-align: left; cursor: pointer; font: inherit; }
  .cat { min-height: 36px; padding: 0 10px; font-size: 13px; font-weight: 700; }
  .cat b { margin-left: auto; font-size: 12px; color: var(--text-muted); }
  .doc { min-height: 32px; padding: 7px 10px 7px 36px; margin: 1px 0; font-size: 12.5px; font-weight: 600; color: var(--text-dim); line-height: 1.3; }
  .cat:hover, .doc:hover { background: var(--surface-2); }
  .on { background: var(--accent-tint); color: var(--accent-soft); }
  .content { flex: 1; min-width: 0; overflow-y: auto; padding: 4px 16px 16px; }
  .hits { list-style: none; margin: 0; padding: 10px 0; display: flex; flex-direction: column; gap: 6px; }
  .hits button { display: flex; gap: 12px; width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); text-align: left; cursor: pointer; font: inherit; }
  .hits button:hover { border-color: var(--border-strong); background: var(--surface-2); }
  .no { flex-shrink: 0; min-width: 34px; height: 24px; padding: 0 6px; border-radius: 6px; background: var(--accent-tint); color: var(--accent-soft); font-size: 12px; font-weight: 800; display: grid; place-items: center; }
  .txt { font-size: 13px; line-height: 1.45; color: var(--text-dim); }
  .txt b { display: block; color: var(--text); font-size: 12px; margin-bottom: 2px; }
  .empty { margin: 40px 16px; text-align: center; color: var(--text-muted); font-size: 13px; }
</style>
