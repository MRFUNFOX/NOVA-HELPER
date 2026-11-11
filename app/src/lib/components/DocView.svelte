<script lang="ts">
  import type { RuleDocument, RuleNode } from '@shared/types';
  import Icon, { type IconName } from './Icon.svelte';
  import RuleItem from './RuleItem.svelte';
  import RichText from './RichText.svelte';
  import { app, categoryLabel, docCategory, shortTitle } from '../state.svelte';
  import { backend } from '../backend';
  import { isStructural, matches, stats, type Filter } from '../punish';

  let { doc }: { doc: RuleDocument } = $props();

  const law = $derived(doc.scope === 'server');
  /**
   * Многие законы начинаются одним общим заголовком («УГОЛОВНЫЙ КОДЕКС…», «Общая часть»), внутри
   * которого всё остальное. Отдельной карточкой он не нужен: показываем его текст вступлением,
   * а главы и разделы — карточками верхнего уровня.
   */
  const wrapper = $derived(
    doc.children.length === 1 && doc.children[0]!.kind === 'heading' && doc.children[0]!.children.some(isStructural)
      ? doc.children[0]! : null,
  );
  const roots = $derived(wrapper ? wrapper.children : doc.children);
  // Короткий заголовок вроде «Общая часть» вступлением не показываем — это просто подпись
  const preamble = $derived.by(() => { const t = wrapper?.text.trim() ?? ''; return t.includes('\n') || t.length > 60 ? t : ''; });
  const group = $derived(categoryLabel(docCategory(doc)));
  const s = $derived(stats(roots, law));
  const warnings = $derived.by(() => {
    let n = 0;
    const walk = (ns: RuleNode[]) => ns.forEach((x) => { n += x.amendments.filter((a) => a.status === 'unmerged' || a.status === 'conflict' || a.status === 'pending').length; walk(x.children); });
    walk(doc.children);
    return n + doc.looseAmendments.length;
  });

  // Пункты верхнего уровня без раздела собираем в одну общую карточку
  const blocks = $derived.by(() => {
    const out: { kind: 'sec' | 'group'; nodes: RuleNode[] }[] = [];
    for (const n of roots) {
      if (!matches(n, app.filter, law)) continue;
      if (isStructural(n)) out.push({ kind: 'sec', nodes: [n] });
      else if (out.at(-1)?.kind === 'group') out.at(-1)!.nodes.push(n);
      else out.push({ kind: 'group', nodes: [n] });
    }
    return out;
  });
  const sections = $derived(roots.filter(isStructural));
  const allCollapsed = $derived(sections.length > 0 && sections.every((n) => app.collapsed[n.id]));

  function toggleAll() {
    const collapse = !allCollapsed;
    for (const n of sections) {
      if (collapse) app.collapsed[n.id] = true;
      else delete app.collapsed[n.id];
    }
  }

  const cards = $derived<{ id: Filter; label: string; icon: IconName; value: number }[]>([
    { id: 'all', label: law ? 'Всего статей' : 'Всего пунктов', icon: 'list', value: s.points },
    { id: 'punished', label: 'С наказанием', icon: 'gavel', value: s.punished },
    { id: 'severe', label: law ? 'Лишение свободы' : 'Бан навсегда и ЧС', icon: 'ban', value: s.severe },
  ]);
</script>

<article class="doc">
  <header>
    <nav class="crumbs" aria-label="Где вы">
      <span>{law ? `Законы ${app.serverName}` : 'Правила проекта'}</span>
      <Icon name="chevron" size={13} />
      {#if group !== shortTitle(doc.title)}<span>{group}</span><Icon name="chevron" size={13} />{/if}
      <span class="here">{shortTitle(doc.title)}</span>
    </nav>
    <div class="title-row">
      <h1 class="selectable">{doc.title}</h1>
      <button class="btn sm" onclick={() => backend.openUrl(doc.sourceUrl)} title="Открыть тему на форуме NOVA RP">
        <Icon name="external" size={15} />Тема на форуме
      </button>
    </div>
  </header>

  {#if s.punished}
    <div class="stats" role="radiogroup" aria-label="Какие пункты показывать">
      {#each cards as c (c.id)}
        {@const v = c.value}
        <button class="stat" class:on={app.filter === c.id} class:severe={c.id === 'severe'} role="radio" aria-checked={app.filter === c.id}
          disabled={!v && c.id !== 'all'} onclick={() => (app.filter = app.filter === c.id ? 'all' : c.id)}>
          <span class="stat-ico"><Icon name={c.icon} size={17} /></span>
          <span class="stat-label">{c.label}</span>
          <span class="stat-value">{v}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if preamble}
    <div class="preamble selectable"><RichText text={preamble} /></div>
  {/if}

  {#if warnings}
    <p class="note"><Icon name="alert" size={15} /> В документе {warnings} {warnings === 1 ? 'пункт' : warnings < 5 ? 'пункта' : 'пунктов'} с поправками, которые ещё не внесены в основной текст на форуме. Они отмечены жёлтым.</p>
  {/if}

  {#if sections.length > 1 && app.filter === 'all'}
    <div class="toolbar">
      <button class="btn ghost sm" onclick={toggleAll}>
        <Icon name={allCollapsed ? 'layers' : 'collapse'} size={15} />{allCollapsed ? 'Развернуть все разделы' : 'Свернуть все разделы'}
      </button>
    </div>
  {:else if app.filter !== 'all'}
    <div class="toolbar">
      <span class="filter-note">Показаны только {law ? 'статьи' : 'пункты'} {app.filter === 'severe' ? (law ? 'с лишением свободы' : 'с баном навсегда или ЧС') : 'с наказанием'}</span>
      <button class="btn ghost sm" onclick={() => (app.filter = 'all')}><Icon name="close" size={14} />Показать все</button>
    </div>
  {/if}

  {#each blocks as b, i (b.kind === 'sec' ? b.nodes[0]!.id : `g${i}`)}
    {#if b.kind === 'sec'}
      <RuleItem node={b.nodes[0]!} {doc} {law} />
    {:else}
      <div class="group">
        {#each b.nodes as n (n.id)}<RuleItem node={n} {doc} depth={1} {law} />{/each}
      </div>
    {/if}
  {/each}

  {#each doc.looseAmendments as a, i (i)}
    <p class="note"><Icon name="alert" size={15} /> {a.message} <button class="link" onclick={() => backend.openUrl(a.postUrl)}>Поправка на форуме</button></p>
  {/each}
</article>

<style>
  .doc { max-width: 860px; padding: 22px 24px 64px; }
  .crumbs { display: flex; align-items: center; gap: 6px; font-size: var(--fs-xs); font-weight: 600; color: var(--text-muted); margin-bottom: 8px; min-width: 0; }
  .crumbs span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .crumbs .here { color: var(--text-dim); }
  .title-row { display: flex; align-items: flex-start; gap: 16px; }
  h1 { flex: 1; margin: 0; font-size: var(--fs-2xl); font-weight: 800; line-height: 1.2; letter-spacing: -0.01em; }
  .title-row .btn { flex-shrink: 0; margin-top: 2px; }

  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 20px; }
  .stat {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas: 'ico label' 'value value';
    align-items: center;
    gap: 10px 10px;
    padding: 14px 16px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--surface);
    text-align: left;
    transition: border-color 0.2s var(--ease), background 0.2s var(--ease), transform 0.12s var(--ease);
  }
  .stat:hover:not(:disabled) { border-color: var(--border-strong); }
  .stat:active:not(:disabled) { transform: scale(0.985); }
  .stat:disabled { opacity: 0.5; cursor: default; }
  .stat.on { background: var(--accent-glow), var(--surface); border-color: var(--accent-line); }
  .stat.severe.on { background: linear-gradient(140deg, rgba(255, 90, 95, 0.16), rgba(255, 90, 95, 0) 65%), var(--surface); border-color: color-mix(in srgb, var(--danger-line) 45%, transparent); }
  .stat-ico { grid-area: ico; display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text-dim); transition: background 0.2s, color 0.2s; }
  .stat.on .stat-ico { background: var(--accent); color: var(--on-accent); }
  .stat.severe .stat-ico { color: var(--danger); }
  .stat.severe.on .stat-ico { background: var(--danger-line); color: #fff; }
  .stat-label { grid-area: label; font-size: var(--fs-xs); font-weight: 600; color: var(--text-dim); line-height: 1.3; }
  .stat-value { grid-area: value; font-size: var(--fs-2xl); font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }

  .preamble { margin-top: 18px; padding: 14px 16px; border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--accent); color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.6; max-height: 220px; overflow-y: auto; }
  .toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 16px; margin-bottom: -6px; }
  .filter-note { flex: 1; font-size: var(--fs-sm); color: var(--text-dim); }

  .group { margin-top: 16px; padding: 2px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); }
  .group > :global(.pt:first-child) { border-top: 0; }

  .note { display: flex; gap: 8px; align-items: flex-start; margin: 16px 0 0; padding: 10px 12px; border-radius: var(--radius); background: var(--accent-tint); color: var(--accent-soft); font-size: var(--fs-sm); }
  .note :global(svg) { flex-shrink: 0; margin-top: 3px; }
  .link { border: 0; background: none; padding: 0; color: var(--accent-soft); text-decoration: underline; font-size: inherit; }

  @media (max-width: 639px) {
    .doc { padding: 16px 14px 48px; }
    h1 { font-size: var(--fs-xl); }
    .title-row { flex-direction: column; gap: 10px; }
  }
  @media (max-width: 519px) {
    .stats { gap: 8px; }
    .stat { padding: 10px 12px; gap: 8px; grid-template-areas: 'ico ico' 'value value' 'label label'; }
    .stat-ico { width: 28px; height: 28px; }
    .stat-value { font-size: var(--fs-xl); }
  }
</style>
