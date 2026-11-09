<script lang="ts">
  import type { Amendment, RuleNode, RuleDocument } from '@shared/types';
  import Icon from './Icon.svelte';
  import RichText from './RichText.svelte';
  import RuleItem from './RuleItem.svelte';
  import { app, formatDate } from '../state.svelte';
  import { nodeLabel } from '../search';
  import { backend } from '../backend';

  let { node, doc, depth = 0 }: { node: RuleNode; doc: RuleDocument; depth?: number } = $props();

  const ANNOTATION: Record<string, string> = {
    note: 'Примечание', exception: 'Исключение', explanation: 'Пояснение', clarification: 'Уточнение',
  };

  const structural = $derived(node.kind === 'heading' || node.kind === 'section' || node.kind === 'chapter');
  const focused = $derived(app.view.kind === 'doc' && app.view.focus === node.id);
  const firstLine = $derived(node.text.split('\n')[0] ?? '');
  const restText = $derived(node.text.split('\n').slice(1).join('\n'));

  // Поправки, которые игроку важно увидеть (уже применённые давно — не шумим)
  const visible = $derived(node.amendments.filter((a) => a.status !== 'applied' || isRecent(a)));
  // По умолчанию у «overlaid» показываем новую редакцию; старую — по кнопке
  let showOld = $state(false);
  let copied = $state(false);

  function isRecent(a: Amendment) {
    return !!a.effectiveAt && Date.now() - new Date(a.effectiveAt).getTime() < 14 * 864e5;
  }

  function stripNumber(t?: string) {
    // В поправке текст начинается с номера пункта — он уже стоит в колонке слева
    return (t ?? '').replace(new RegExp(`^${(node.number ?? '').replace(/\./g, '\\.')}\\s*`), '');
  }

  async function copy() {
    const where = node.number ? `п. ${node.number} «${doc.title}»` : `«${doc.title}»`;
    const pun = node.punishments.map((p) => `Наказание: ${p.raw}`).join('\n');
    await navigator.clipboard.writeText([`${where}:`, node.text, pun].filter(Boolean).join('\n'));
    copied = true;
    setTimeout(() => (copied = false), 1600);
  }

  // Прокрутка к пункту, выбранному в поиске
  function scrollIntoView(el: HTMLElement, isFocused: boolean) {
    if (isFocused) requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }));
    return { update(f: boolean) { if (f) el.scrollIntoView({ block: 'center' }); } };
  }
</script>

{#if structural}
  <section class="group" class:top={depth === 0} id={node.id}>
    {#if node.kind !== 'heading' || firstLine}
      <h2 class:h3={depth > 0}>
        {#if node.kind !== 'heading'}<span class="glabel">{nodeLabel(node)}</span>{/if}
        {firstLine}
      </h2>
    {/if}
    {#if restText}<div class="intro selectable"><RichText text={restText} /></div>{/if}
    {#each node.annotations as a, i (i)}
      <div class="ann selectable"><b>{ANNOTATION[a.type]}.</b> <RichText text={a.text} /></div>
    {/each}
    {#each node.children as child (child.id)}
      <RuleItem node={child} {doc} depth={depth + 1} />
    {/each}
  </section>
{:else}
  <article class="rule" class:focused class:sub={node.kind === 'part' || (node.number?.split('.').length ?? 0) > 2} id={node.id} use:scrollIntoView={focused}>
    <div class="num">{node.number ?? ''}</div>
    <div class="body">
      {#each visible as a, i (i)}
        <div class="amend" class:warn={a.status !== 'applied' && a.status !== 'notice'}>
          <Icon name={a.status === 'pending' ? 'history' : 'alert'} size={15} />
          <div class="amend-text">
            {#if a.status === 'overlaid'}
              <b>Изменён поправкой{a.effectiveAt ? ` от ${formatDate(a.effectiveAt, false)}` : ''}.</b> Ниже — новая редакция; в основном тексте на форуме пункт ещё старый.
              <button class="link" onclick={() => (showOld = !showOld)}>{showOld ? 'Скрыть старую' : 'Показать старую'}</button>
              {#if showOld}<div class="old selectable"><RichText text={stripNumber(a.previousText)} /></div>{/if}
            {:else if a.status === 'unmerged' || a.status === 'conflict'}
              <b>На форуме есть поправка{a.effectiveAt ? ` от ${formatDate(a.effectiveAt, false)}` : ''}</b>, но основной текст пункта не обновлён. Уточните у администрации; редакция из поправки:
              <div class="new selectable"><RichText text={stripNumber(a.newText)} /></div>
            {:else if a.status === 'pending'}
              <b>С {formatDate(a.effectiveAt)} вступает новая редакция:</b>
              <div class="new selectable"><RichText text={stripNumber(a.newText)} /></div>
            {:else if a.status === 'notice'}
              <div class="selectable"><RichText text={a.message ?? ''} /></div>
            {:else}
              Пункт изменён {formatDate(a.effectiveAt, false)}.
            {/if}
            <button class="link" onclick={() => backend.openUrl(a.postUrl)}>Поправка на форуме</button>
          </div>
        </div>
      {/each}

      <div class="text selectable"><RichText text={node.text} /></div>

      {#each node.annotations as a, i (i)}
        <div class="ann selectable" class:exception={a.type === 'exception'}>
          <span class="ann-label">{ANNOTATION[a.type]}</span>
          <RichText text={a.text} />
        </div>
      {/each}

      {#each node.images as img (img.src)}
        <figure>
          <img src={img.url ?? img.src} alt={img.alt ?? 'Иллюстрация к пункту'} loading="lazy"
            onerror={(e) => ((e.currentTarget as HTMLImageElement).closest('figure')!.classList.add('broken'))} />
          <figcaption><button class="link" onclick={() => backend.openUrl(img.src)}>Картинка не загрузилась — открыть на форуме</button></figcaption>
        </figure>
      {/each}

      {#if node.punishments.length}
        <ul class="punishments" aria-label="Наказание">
          {#each node.punishments as p, i (i)}
            <li class:severe={p.severe} class="selectable">{p.raw}</li>
          {/each}
        </ul>
      {/if}

      <div class="tools">
        <button class="tool" onclick={copy} title="Скопировать пункт — например, для жалобы">
          <Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>

      {#each node.children as child (child.id)}
        <RuleItem node={child} {doc} depth={depth + 1} />
      {/each}
    </div>
  </article>
{/if}

<style>
  .group { margin-top: 8px; }
  .group.top { margin-top: 20px; }
  h2 {
    margin: 22px 0 6px;
    font-size: var(--fs-lg);
    font-weight: 800;
    line-height: 1.3;
    color: var(--text);
  }
  h2.h3 { font-size: var(--fs-md); margin-top: 18px; color: var(--text-dim); }
  .glabel { color: var(--accent); margin-right: 6px; font-variant-numeric: tabular-nums; }
  .intro { color: var(--text-dim); font-size: var(--fs-sm); margin-bottom: 8px; }

  .rule {
    display: grid;
    grid-template-columns: var(--gutter) 1fr;
    gap: 0 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
    scroll-margin: 80px;
  }
  .body :global(article.rule) { border-bottom: 0; padding-bottom: 0; }
  .rule.sub { grid-template-columns: calc(var(--gutter) - 8px) 1fr; }
  .num {
    font-weight: 800;
    font-size: var(--fs-lg);
    line-height: 1.3;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
    text-align: right;
    padding-top: 1px;
    word-break: break-all;
  }
  .rule.sub > .num { font-size: var(--fs-md); color: var(--accent-soft); padding-top: 2px; }
  .rule.focused > .num { text-decoration: underline 3px; text-underline-offset: 6px; }
  .rule.focused > .body > .text { background: var(--accent-tint); box-shadow: 0 0 0 6px var(--accent-tint); border-radius: 2px; }
  .body { min-width: 0; }
  .text { line-height: 1.55; }

  .punishments { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .punishments li {
    padding: 4px 0 4px 11px;
    border-left: 3px solid var(--accent);
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text);
  }
  .punishments li.severe { border-left-color: var(--danger-line); color: var(--danger); }

  .ann { margin-top: 8px; padding: 7px 10px; border-radius: var(--radius-sm); background: var(--surface); font-size: var(--fs-sm); color: var(--text-dim); }
  .ann.exception { background: #1e2a1f; color: #cfe9cc; }
  .ann-label { display: block; font-weight: 800; font-size: var(--fs-xs); color: var(--text); margin-bottom: 2px; }
  .group > .ann { margin-bottom: 8px; }

  .amend {
    display: flex;
    gap: 9px;
    margin-bottom: 8px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: var(--fs-sm);
    color: var(--text-dim);
  }
  .amend.warn { background: var(--accent-tint); color: var(--accent-soft); }
  .amend :global(svg) { flex-shrink: 0; margin-top: 2px; }
  .amend-text { min-width: 0; }
  .amend b { color: var(--text); }
  .amend.warn b { color: var(--accent); }
  .new, .old { margin: 6px 0; padding: 6px 10px; border-left: 3px solid var(--accent); background: rgba(0, 0, 0, 0.25); color: var(--text); }
  .old { border-left-color: var(--text-muted); color: var(--text-dim); text-decoration: line-through; text-decoration-color: rgba(255, 255, 255, 0.25); }

  .link { border: 0; background: none; padding: 0; color: var(--accent-soft); text-decoration: underline; text-underline-offset: 2px; font-size: inherit; margin-left: 4px; }

  figure { margin: 10px 0 0; }
  figure img { max-width: 100%; border-radius: var(--radius-sm); display: block; }
  figcaption { display: none; font-size: var(--fs-xs); }
  :global(figure.broken) img { display: none; }
  :global(figure.broken) figcaption { display: block; }

  .tools { display: flex; gap: 4px; margin-top: 6px; opacity: 0; transition: opacity 0.12s; }
  .rule:hover > .body > .tools, .tools:focus-within { opacity: 1; }
  .tool { display: inline-flex; align-items: center; gap: 5px; border: 0; background: none; padding: 2px 6px; border-radius: var(--radius-sm); font-size: var(--fs-xs); color: var(--text-muted); }
  .tool:hover { background: var(--surface-2); color: var(--text); }

  @media (max-width: 459px) {
    .rule { grid-template-columns: 46px 1fr; gap: 0 8px; }
    .rule.sub { grid-template-columns: 40px 1fr; }
    .num { font-size: var(--fs-md); }
  }
</style>
