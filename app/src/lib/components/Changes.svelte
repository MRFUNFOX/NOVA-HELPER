<script lang="ts">
  import { app, formatDate, shortTitle } from '../state.svelte';
  import { wordDiff } from '../diff';
  import type { NodeChange } from '@shared/format';

  const KIND: Record<NodeChange['kind'], string> = { added: 'Новый пункт', removed: 'Пункт удалён', modified: 'Изменён' };

  // Последние обновления базы: правки пунктов и статей, новые и удалённые документы.
  // Новые документы (например, все законы сервера сразу) показываем одним списком, а не по одному.
  const releases = $derived(
    app.db.changelogs
      .map((c) => {
        const docs = c.documents.filter((d) => d.kind !== 'modified' || d.nodes.length);
        return { ...c, added: docs.filter((d) => d.kind === 'added'), documents: docs.filter((d) => d.kind !== 'added') };
      })
      .filter((c) => c.documents.length || c.added.length),
  );

  // Номер пункта уже стоит на плашке — убираем его из начала текста
  function strip(t: string | undefined | null, num?: string | null) {
    return num ? (t ?? '').replace(new RegExp(`^${num.replace(/\./g, '\\.')}\\.?\\s*`), '') : (t ?? '');
  }

  function go(docId: string, nodeId: string) {
    if (app.doc(docId) && app.index.byId.has(nodeId)) app.open(docId, nodeId);
  }
</script>

<div class="changes">
  <h1>Что изменилось</h1>
  <p class="lead muted">Правки правил с форума, которые программа нашла при обновлениях. Новое подсвечено жёлтым, удалённое зачёркнуто.</p>

  {#if !releases.length}
    <p class="empty">Пока изменений не было. Когда администрация поправит правила, здесь появится, что именно поменялось.</p>
  {/if}

  {#each releases as rel (rel.dbVersion)}
    <section class="release">
      <h2>{formatDate(rel.generatedAt)}</h2>
      {#if rel.added.length}
        <div class="doc">
          <h3><span class="tag">{rel.added.length === 1 ? 'новый документ' : `новых документов: ${rel.added.length}`}</span></h3>
          <div class="added">
            {#each rel.added as d (d.docId)}
              <button class="pill" onclick={() => app.open(d.docId)} disabled={!app.doc(d.docId)}>{shortTitle(d.title)}</button>
            {/each}
          </div>
        </div>
      {/if}
      {#each rel.documents as d (d.docId)}
        <div class="doc">
          <h3>
            {#if app.doc(d.docId)}
              <button class="doclink" onclick={() => app.open(d.docId)}>{shortTitle(d.title)}</button>
            {:else}{shortTitle(d.title)}{/if}
            {#if d.kind === 'removed'}<span class="tag gone">документ удалён с форума</span>{/if}
          </h3>
          {#each d.nodes as n (n.nodeId + n.kind)}
            <button class="change" onclick={() => go(d.docId, n.nodeId)} disabled={n.kind === 'removed'}>
              <span class="num">{n.number ?? '§'}</span>
              <span class="what">
                <span class="kind" class:add={n.kind === 'added'} class:del={n.kind === 'removed'}>{KIND[n.kind]}</span>
                <span class="diff selectable">
                  {#if n.kind === 'modified'}
                    {#each wordDiff(strip(n.before, n.number), strip(n.after, n.number)) as p, i (i)}<span class={p.op}>{p.s}</span>{/each}
                  {:else if n.kind === 'added'}<span class="add">{strip(n.after, n.number)}</span>
                  {:else}<span class="del">{strip(n.before, n.number)}</span>{/if}
                </span>
              </span>
            </button>
          {/each}
        </div>
      {/each}
    </section>
  {/each}
</div>

<style>
  .changes { max-width: 860px; padding: 22px 24px 64px; }
  h1 { margin: 0 0 6px; font-size: var(--fs-2xl); font-weight: 800; letter-spacing: -0.01em; }
  .lead { margin: 0 0 20px; font-size: var(--fs-sm); }
  .empty { padding: 20px; color: var(--text-dim); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); }
  .release { margin-bottom: 18px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
  h2 { display: flex; align-items: center; gap: 10px; font-size: var(--fs-md); font-weight: 800; margin: 0; padding: 14px 16px; border-bottom: 1px solid var(--border); }
  h2::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint); }
  .doc { padding: 12px 16px 8px; }
  .doc + .doc { border-top: 1px solid var(--border); }
  h3 { font-size: var(--fs-sm); font-weight: 700; margin: 0 0 6px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .doclink { border: 0; background: none; padding: 0; color: var(--text); font-weight: 800; text-align: left; font-size: var(--fs-md); }
  .doclink:hover { color: var(--accent-soft); }
  .added { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 6px; }
  .pill { padding: 5px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text); font-size: var(--fs-sm); transition: border-color 0.15s var(--ease), color 0.15s var(--ease); }
  .pill:hover:not(:disabled) { border-color: var(--accent-line); color: var(--accent-soft); }
  .tag { padding: 2px 8px; border-radius: var(--radius-sm); font-size: var(--fs-xs); font-weight: 700; color: var(--success); background: var(--success-tint); }
  .tag.gone { color: var(--danger); background: var(--danger-tint); }
  .change {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 12px;
    width: 100%;
    padding: 10px;
    margin: 0 -10px;
    width: calc(100% + 20px);
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    text-align: left;
    font-size: var(--fs-sm);
    transition: background 0.15s var(--ease);
  }
  .change:not(:disabled):hover { background: var(--surface-2); }
  .change:disabled { cursor: default; }
  .num { display: grid; place-items: center; min-width: 54px; height: 28px; padding: 0 8px; border-radius: var(--radius-sm); background: var(--accent-tint); color: var(--accent); font-weight: 800; font-variant-numeric: tabular-nums; }
  .what { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .kind { font-size: var(--fs-xs); font-weight: 700; color: var(--text-muted); }
  .kind.add { color: var(--success); }
  .kind.del { color: var(--danger); }
  .diff { color: var(--text-dim); white-space: pre-line; line-height: 1.55; }
  .diff .add { background: rgba(255, 195, 0, 0.2); color: var(--accent-soft); border-radius: 3px; }
  .diff .del { color: var(--text-muted); text-decoration: line-through; }
  @media (max-width: 639px) { .changes { padding: 16px 14px 48px; } }
</style>
