<script lang="ts">
  // Раздел меню: карточки его документов. Нажал карточку — открылся весь документ.
  import Icon from './Icon.svelte';
  import { app, categoryIcon, categoryLabel, sectionOf, shortTitle } from '../state.svelte';
  import { stats } from '../punish';

  let { category }: { category: string } = $props();

  const group = $derived(app.categories.find((c) => c.category === category));
  const law = $derived(app.section === 'laws');
  // Счётчики — один раз на документ (не на каждую перерисовку)
  const cards = $derived(
    (group?.docs ?? []).map((d) => ({ doc: d, s: stats(d.children, sectionOf(d) === 'laws') })),
  );

  function count(n: number) {
    const m10 = n % 10, m100 = n % 100;
    const one = m10 === 1 && m100 !== 11, few = m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20);
    return law ? (one ? 'статья' : few ? 'статьи' : 'статей') : one ? 'пункт' : few ? 'пункта' : 'пунктов';
  }
</script>

<section class="cat">
  <nav class="crumbs" aria-label="Где вы">
    <span>{law ? `Законы ${app.serverName}` : 'Правила проекта'}</span>
    <Icon name="chevron" size={13} />
    <span class="here">{categoryLabel(category)}</span>
  </nav>
  <h1>{categoryLabel(category)}</h1>

  <div class="grid">
    {#each cards as { doc, s } (doc.id)}
      <button class="card doc" onclick={() => app.open(doc.id)} title={doc.title}>
        <span class="ico"><Icon name={categoryIcon(category)} size={17} /></span>
        <span class="name">{shortTitle(doc.title)}</span>
        <span class="meta">
          {s.points} {count(s.points)}{#if s.punished}<span class="pun"><Icon name="gavel" size={12} />{s.punished} с наказанием</span>{/if}
        </span>
      </button>
    {/each}
  </div>
</section>

<style>
  .cat { max-width: 980px; padding: 22px 24px 64px; }
  .crumbs { display: flex; align-items: center; gap: 6px; font-size: var(--fs-xs); font-weight: 600; color: var(--text-muted); margin-bottom: 8px; }
  .crumbs .here { color: var(--text-dim); }
  h1 { margin: 0 0 18px; font-size: var(--fs-2xl); font-weight: 800; letter-spacing: -0.01em; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .doc {
    display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
    padding: 14px 16px 16px;
    text-align: left;
    border-radius: var(--radius-lg);
    color: var(--text);
  }
  .doc:hover { border-color: var(--accent-line); background: var(--accent-glow), var(--surface); }
  .doc:active { transform: scale(0.985); }
  .ico { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius-sm); background: var(--accent-tint); color: var(--accent); }
  .name { font-size: var(--fs-md); font-weight: 800; line-height: 1.3; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: var(--fs-xs); color: var(--text-muted); margin-top: auto; }
  .pun { display: inline-flex; align-items: center; gap: 4px; }
  @media (max-width: 639px) {
    .cat { padding: 16px 14px 48px; }
    .grid { grid-template-columns: 1fr; gap: 8px; }
    .doc { flex-direction: row; align-items: center; flex-wrap: wrap; }
    .name { flex: 1; min-width: 60%; }
    .meta { width: 100%; padding-left: 42px; margin-top: -4px; }
  }
</style>
