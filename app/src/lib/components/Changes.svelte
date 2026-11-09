<script lang="ts">
  import { app, formatDate, shortTitle } from '../state.svelte';
  import { wordDiff } from '../diff';
  import type { NodeChange } from '@shared/format';

  const KIND: Record<NodeChange['kind'], string> = { added: 'Новый пункт', removed: 'Пункт удалён', modified: 'Изменён' };

  // Последние обновления базы с изменениями правил проекта. Записи о документах серверов
  // (законы собирались раньше и выключены) игроку сейчас не нужны.
  const releases = $derived(
    app.db.changelogs
      .map((c) => ({ ...c, documents: c.documents.filter((d) => d.docId.startsWith('project/') && (d.kind !== 'modified' || d.nodes.length)) }))
      .filter((c) => c.documents.length),
  );

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
      {#each rel.documents as d (d.docId)}
        <div class="doc">
          <h3>
            {#if app.doc(d.docId)}
              <button class="doclink" onclick={() => app.open(d.docId)}>{shortTitle(d.title)}</button>
            {:else}{shortTitle(d.title)}{/if}
            {#if d.kind === 'added'}<span class="tag">новый документ</span>{/if}
            {#if d.kind === 'removed'}<span class="tag gone">документ удалён с форума</span>{/if}
          </h3>
          {#each d.nodes as n (n.nodeId + n.kind)}
            <button class="change" onclick={() => go(d.docId, n.nodeId)} disabled={n.kind === 'removed'}>
              <span class="num">{n.number ?? '§'}</span>
              <span class="what">
                <span class="kind" class:add={n.kind === 'added'} class:del={n.kind === 'removed'}>{KIND[n.kind]}</span>
                <span class="diff selectable">
                  {#if n.kind === 'modified'}
                    {#each wordDiff(n.before ?? '', n.after ?? '') as p, i (i)}<span class={p.op}>{p.s}</span>{/each}
                  {:else if n.kind === 'added'}<span class="add">{n.after}</span>
                  {:else}<span class="del">{n.before}</span>{/if}
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
  .changes { max-width: 760px; padding: 18px 22px 64px; }
  h1 { margin: 0 0 4px; font-size: var(--fs-xl); font-weight: 800; }
  .lead { margin: 0 0 18px; font-size: var(--fs-sm); }
  .empty { color: var(--text-dim); }
  .release { margin-bottom: 26px; }
  h2 { font-size: var(--fs-md); font-weight: 800; color: var(--accent); margin: 0 0 8px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
  .doc { margin-bottom: 14px; }
  h3 { font-size: var(--fs-sm); font-weight: 700; margin: 0 0 4px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .doclink { border: 0; background: none; padding: 0; color: var(--text); font-weight: 700; text-align: left; }
  .doclink:hover { color: var(--accent-soft); }
  .tag { font-size: var(--fs-xs); font-weight: 600; color: var(--success); }
  .tag.gone { color: var(--danger); }
  .change {
    display: grid;
    grid-template-columns: 52px 1fr;
    gap: 10px;
    width: 100%;
    padding: 8px 8px 8px 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    text-align: left;
    font-size: var(--fs-sm);
  }
  .change:not(:disabled):hover { background: var(--surface); }
  .change:disabled { cursor: default; }
  .num { font-weight: 800; color: var(--accent); text-align: right; font-variant-numeric: tabular-nums; }
  .what { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .kind { font-size: var(--fs-xs); font-weight: 700; color: var(--text-muted); }
  .kind.add { color: var(--success); }
  .kind.del { color: var(--danger); }
  .diff { color: var(--text-dim); white-space: pre-line; line-height: 1.5; }
  .diff .add { background: var(--accent-tint); color: var(--accent-soft); border-radius: 2px; }
  .diff .del { color: var(--text-muted); text-decoration: line-through; }
</style>
