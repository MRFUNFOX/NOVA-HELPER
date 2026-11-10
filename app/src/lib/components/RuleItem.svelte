<script lang="ts">
  /**
   * Один узел дерева правил. Уровни оформлены по-разному, чтобы сразу было видно, что к чему относится:
   *  раздел (верхний уровень)  — карточка с закреплённой шапкой: номер, название, число пунктов, сворачивание;
   *  параграф / глава          — заголовок с жёлтой чертой (тоже закрепляется под шапкой раздела);
   *  пункт                     — жёлтая плашка с номером слева;
   *  подпункт                  — сдвинут вправо, соединён линией с пунктом, плашка-контур поменьше;
   *  наказание                 — отдельная строка с молотком и цветными плашками.
   */
  import { slide } from 'svelte/transition';
  import type { Amendment, RuleNode, RuleDocument } from '@shared/types';
  import Icon, { type IconName } from './Icon.svelte';
  import RichText from './RichText.svelte';
  import RuleItem from './RuleItem.svelte';
  import Punishments from './Punishments.svelte';
  import { app, formatDate } from '../state.svelte';
  import { nodeLabel } from '../search';
  import { backend } from '../backend';
  import { isStructural, matches, stats } from '../punish';
  import { fold } from '../motion';

  let { node, doc, depth = 0, inPoint = false }: { node: RuleNode; doc: RuleDocument; depth?: number; inPoint?: boolean } = $props();

  const ANNOTATION: Record<string, { label: string; icon: IconName; tone: string }> = {
    note: { label: 'Примечание', icon: 'info', tone: 'info' },
    exception: { label: 'Исключение', icon: 'exception', tone: 'ok' },
    explanation: { label: 'Пояснение', icon: 'info', tone: 'info' },
    clarification: { label: 'Уточнение', icon: 'info', tone: 'info' },
  };

  const structural = $derived(isStructural(node));
  const shown = $derived(matches(node, app.filter));
  const children = $derived(app.filter === 'all' ? node.children : node.children.filter((c) => matches(c, app.filter)));
  const focused = $derived(app.view.kind === 'doc' && app.view.focus === node.id);
  const firstLine = $derived((node.text.split('\n')[0] ?? '').replace(structural ? /\s*:\s*$/ : /$^/, ''));
  const restText = $derived(node.text.split('\n').slice(1).join('\n'));
  const sub = $derived(inPoint || node.kind === 'part' || (node.number?.split('.').length ?? 0) > 2);
  const count = $derived.by(() => {
    if (!structural || depth !== 0) return 0;
    const st = stats(node.children);
    return app.filter === 'all' ? st.points : app.filter === 'severe' ? st.severe : st.punished;
  });
  const collapsed = $derived(!!app.collapsed[node.id] && app.filter === 'all');

  // Поправки, которые игроку важно увидеть (давно применённые — не шумим)
  const visible = $derived(node.amendments.filter((a) => a.status !== 'applied' || isRecent(a)));
  let showOld = $state(false);
  let copied = $state(false);

  function isRecent(a: Amendment) {
    return !!a.effectiveAt && Date.now() - new Date(a.effectiveAt).getTime() < 14 * 864e5;
  }

  function stripNumber(t?: string) {
    // В поправке текст начинается с номера пункта — он уже стоит на плашке слева
    return (t ?? '').replace(new RegExp(`^${(node.number ?? '').replace(/\./g, '\\.')}\\s*`), '');
  }

  function toggle() {
    if (app.collapsed[node.id]) delete app.collapsed[node.id];
    else app.collapsed[node.id] = true;
  }

  function plural(n: number) {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? 'пункт' : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? 'пункта' : 'пунктов';
  }

  async function copy() {
    const where = node.number ? `п. ${node.number} «${doc.title}»` : `«${doc.title}»`;
    const pun = node.punishments.map((p) => `Наказание: ${p.raw}`).join('\n');
    await navigator.clipboard.writeText([`${where}:`, node.text, pun].filter(Boolean).join('\n'));
    copied = true;
    setTimeout(() => (copied = false), 1600);
  }

  // Прокрутка к пункту, выбранному в поиске
  function scrollTo(el: HTMLElement, isFocused: boolean) {
    if (isFocused) requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }));
    return { update(f: boolean) { if (f) requestAnimationFrame(() => el.scrollIntoView({ block: 'center' })); } };
  }

  // Высота шапки раздела — чтобы заголовок параграфа закреплялся ровно под ней
  function measure(el: HTMLElement) {
    const card = el.parentElement!;
    const ro = new ResizeObserver(() => card.style.setProperty('--sec-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return { destroy: () => ro.disconnect() };
  }
</script>

{#snippet annotations(list: RuleNode['annotations'])}
  {#each list as a, i (i)}
    {@const m = ANNOTATION[a.type] ?? ANNOTATION.note!}
    <div class="ann {m.tone} selectable">
      <span class="ann-label"><Icon name={m.icon} size={15} />{m.label}</span>
      <div class="ann-text"><RichText text={a.text} /></div>
    </div>
  {/each}
{/snippet}

{#if shown}
  {#if structural && depth === 0}
    <!-- Раздел: карточка -->
    <section class="sec" id={node.id}>
      <button class="sec-head" use:measure onclick={toggle} aria-expanded={!collapsed}>
        <span class="sec-badge" class:icon={!node.number}>
          {#if node.number}{node.number}{:else}<Icon name="layers" size={18} />{/if}
        </span>
        <span class="sec-title">
          {#if node.kind !== 'heading'}<span class="kicker">{node.kind === 'chapter' ? 'Глава' : node.label ?? 'Раздел'}</span>{/if}
          <span class="t">{firstLine || nodeLabel(node)}</span>
        </span>
        {#if count}<span class="sec-count">{count} {plural(count)}</span>{/if}
        <span class="chev" class:up={!collapsed}><Icon name="chevron" size={16} /></span>
      </button>
      {#if !collapsed}
        <div class="sec-body" transition:slide={fold}>
          {#if restText}<div class="intro selectable"><RichText text={restText} /></div>{/if}
          {@render annotations(node.annotations)}
          {#each children as child (child.id)}
            <RuleItem node={child} {doc} depth={1} />
          {/each}
        </div>
      {/if}
    </section>
  {:else if structural}
    <!-- Параграф / глава внутри раздела -->
    <div class="para" class:deep={depth > 1} id={node.id}>
      <h3 class="para-head" class:sticky={depth === 1}>
        <span class="bar" aria-hidden="true"></span>
        {#if node.kind !== 'heading'}<span class="chip-label">{nodeLabel(node)}</span>{/if}
        <span class="t">{firstLine}</span>
      </h3>
      {#if restText}<div class="intro selectable"><RichText text={restText} /></div>{/if}
      {@render annotations(node.annotations)}
      {#each children as child (child.id)}
        <RuleItem node={child} {doc} depth={depth + 1} />
      {/each}
    </div>
  {:else}
    <!-- Пункт или подпункт -->
    <article class="pt" class:sub class:focused class:loose={depth === 0} id={node.id} use:scrollTo={focused}>
      <span class="num" class:empty={!node.number}>{node.number ?? '•'}</span>
      <div class="body">
        {#each visible as a, i (i)}
          <div class="amend" class:warn={a.status !== 'applied' && a.status !== 'notice'}>
            <Icon name={a.status === 'pending' ? 'history' : 'alert'} size={15} />
            <div class="amend-text">
              {#if a.status === 'overlaid'}
                <b>Изменён поправкой{a.effectiveAt ? ` от ${formatDate(a.effectiveAt, false)}` : ''}.</b> Ниже — новая редакция; в основном тексте на форуме пункт ещё старый.
                <button class="link" onclick={() => (showOld = !showOld)}>{showOld ? 'Скрыть старую' : 'Показать старую'}</button>
                {#if showOld}<div class="old selectable" transition:slide={fold}><RichText text={stripNumber(a.previousText)} /></div>{/if}
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

        {@render annotations(node.annotations)}

        {#each node.images as img (img.src)}
          <figure class="sk">
            <img src={img.url ?? img.src} alt={img.alt ?? 'Иллюстрация к пункту'} loading="lazy"
              onload={(e) => (e.currentTarget as HTMLImageElement).closest('figure')!.classList.add('ready')}
              onerror={(e) => (e.currentTarget as HTMLImageElement).closest('figure')!.classList.add('broken')} />
            <figcaption><button class="link" onclick={() => backend.openUrl(img.src)}>Картинка не загрузилась — открыть на форуме</button></figcaption>
          </figure>
        {/each}

        {#if node.punishments.length}<Punishments items={node.punishments} />{/if}

        {#if children.length}
          <div class="subs">
            {#each children as child (child.id)}
              <RuleItem node={child} {doc} depth={depth + 1} inPoint />
            {/each}
          </div>
        {/if}
      </div>
      <button class="copy" onclick={copy} title="Скопировать пункт с наказанием — например, для жалобы" aria-label="Скопировать пункт">
        <Icon name={copied ? 'check' : 'copy'} size={15} />
      </button>
    </article>
  {/if}
{/if}

<style>
  /* ── Раздел ── */
  .sec {
    margin-top: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    /* без overflow: hidden — иначе не работает закрепление шапки */
  }
  .sec-head {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 14px 16px;
    border: 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface);
    text-align: left;
    transition: background 0.15s var(--ease);
  }
  .sec-head[aria-expanded='false'] { border-radius: var(--radius-lg); }
  .sec-head[aria-expanded='true'] { border-bottom: 1px solid var(--border); }
  .sec-head:hover { background: #24252a; }
  .sec-badge {
    display: grid; place-items: center; flex-shrink: 0;
    min-width: 40px; height: 40px; padding: 0 8px;
    border-radius: var(--radius);
    background: var(--accent); color: var(--on-accent);
    font-size: var(--fs-lg); font-weight: 800; font-variant-numeric: tabular-nums;
  }
  .sec-badge.icon { background: var(--accent-tint); color: var(--accent); }
  .sec-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .kicker { font-size: var(--fs-xs); font-weight: 700; color: var(--accent); }
  .sec-title .t { font-size: var(--fs-lg); font-weight: 800; line-height: 1.3; color: var(--text); }
  .sec-count { flex-shrink: 0; font-size: var(--fs-xs); font-weight: 600; color: var(--text-muted); }
  .chev { display: grid; color: var(--text-muted); transition: transform 0.22s var(--ease); }
  .chev.up { transform: rotate(90deg); }
  .sec-body { padding: 4px 16px 10px; }

  .intro { color: var(--text-dim); font-size: var(--fs-sm); margin: 10px 0 4px; }

  /* ── Параграф ── */
  .para { margin-top: 6px; }
  .para + :global(.pt), .para + .para { margin-top: 6px; }
  .para-head {
    display: flex; align-items: center; gap: 10px;
    margin: 0 -16px;
    padding: 12px 16px 10px;
    font-size: var(--fs-md); font-weight: 800; line-height: 1.35; color: var(--text);
    background: var(--surface);
  }
  .para-head.sticky { position: sticky; top: var(--sec-h, 69px); z-index: 2; }
  .para.deep .para-head { font-size: var(--fs-sm); color: var(--text-dim); margin: 0; padding: 10px 0 6px; }
  .bar { width: 3px; align-self: stretch; min-height: 18px; border-radius: 2px; background: var(--accent); flex-shrink: 0; }
  .para.deep .bar { background: var(--accent-line); }
  .chip-label {
    flex-shrink: 0;
    padding: 2px 8px; border-radius: var(--radius-sm);
    background: var(--accent-tint); color: var(--accent);
    font-size: var(--fs-xs); font-weight: 800;
  }

  /* ── Пункт ── */
  .pt {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0 14px;
    padding: 14px 36px 14px 0;
    border-top: 1px solid var(--border);
    scroll-margin: 140px;
    border-radius: var(--radius);
  }
  .para > .para-head + .pt, .para > .intro + .pt, .sec-body > .pt:first-child { border-top: 0; }
  .pt.loose {
    margin-top: 10px;
    padding: 16px 44px 16px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }
  .num {
    display: grid; place-items: center;
    min-width: 54px; height: 28px; padding: 0 8px;
    border-radius: var(--radius-sm);
    background: var(--accent-tint);
    color: var(--accent);
    font-size: var(--fs-sm); font-weight: 800; font-variant-numeric: tabular-nums;
    white-space: nowrap;
    transition: background 0.2s var(--ease), color 0.2s var(--ease);
  }
  .num.empty { min-width: 28px; }
  .body { min-width: 0; }
  .text { line-height: 1.6; padding-top: 2px; }

  /* Подпункты: ветка от пункта */
  .subs { margin-top: 10px; display: flex; flex-direction: column; }
  .pt.sub {
    padding: 8px 32px 8px 18px;
    border-top: 0;
    gap: 0 12px;
  }
  .pt.sub::before {
    content: '';
    position: absolute; left: 0; top: 0; bottom: 0;
    width: 2px; border-radius: 2px;
    background: var(--border-strong);
  }
  .pt.sub:last-child::before { bottom: auto; height: 22px; }
  .pt.sub::after {
    content: '';
    position: absolute; left: 0; top: 21px;
    width: 12px; height: 2px; border-radius: 2px;
    background: var(--border-strong);
  }
  .pt.sub > .num {
    min-width: 46px; height: 24px;
    background: transparent;
    border: 1px solid var(--accent-line);
    color: var(--accent-soft);
    font-size: var(--fs-xs);
  }
  .pt.sub > .body > .text { font-size: var(--fs-sm); color: var(--text-dim); line-height: 1.55; }

  /* Переход из поиска: пункт мягко подсвечивается */
  .pt.focused > .num { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  .pt.focused { animation: focus-pulse 2.4s var(--ease) both; }
  @keyframes focus-pulse {
    0%, 30% { background: rgba(255, 195, 0, 0.14); box-shadow: 0 0 0 1px var(--accent-line); }
    100% { background: rgba(255, 195, 0, 0.04); box-shadow: 0 0 0 1px rgba(255, 195, 0, 0.12); }
  }

  /* ── Примечания и исключения ── */
  .ann {
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--info-tint);
    font-size: var(--fs-sm);
    color: var(--text-dim);
  }
  .ann.ok { background: var(--success-tint); }
  .ann-label { display: flex; align-items: center; gap: 6px; font-weight: 800; font-size: var(--fs-xs); color: var(--info); margin-bottom: 4px; }
  .ann.ok .ann-label { color: var(--success); }
  .ann-text { line-height: 1.55; }
  .sec-body > .ann, .para > .ann { margin-bottom: 8px; }

  /* ── Поправки ── */
  .amend {
    display: flex; gap: 9px;
    margin-bottom: 10px;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--surface-2);
    font-size: var(--fs-sm);
    color: var(--text-dim);
  }
  .amend.warn { background: var(--accent-tint); color: var(--accent-soft); }
  .amend :global(svg) { flex-shrink: 0; margin-top: 2px; }
  .amend-text { min-width: 0; }
  .amend b { color: var(--text); }
  .amend.warn b { color: var(--accent); }
  .new, .old { margin: 6px 0; padding: 6px 10px; border-left: 3px solid var(--accent); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; background: rgba(0, 0, 0, 0.25); color: var(--text); }
  .old { border-left-color: var(--text-muted); color: var(--text-dim); text-decoration: line-through; text-decoration-color: rgba(255, 255, 255, 0.25); }
  .link { border: 0; background: none; padding: 0; color: var(--accent-soft); text-decoration: underline; text-underline-offset: 2px; font-size: inherit; margin-left: 4px; }

  /* ── Картинки: серая плашка, пока грузится ── */
  figure { margin: 12px 0 0; min-height: 140px; border-radius: var(--radius); overflow: hidden; max-width: 100%; }
  figure img { max-width: 100%; display: block; opacity: 0; transition: opacity 0.25s var(--ease); }
  :global(figure.ready) { min-height: 0; background: none; animation: none; }
  :global(figure.ready) img { opacity: 1; }
  figcaption { display: none; font-size: var(--fs-xs); padding: 10px; }
  :global(figure.broken) { min-height: 0; background: var(--surface-2); animation: none; }
  :global(figure.broken) img { display: none; }
  :global(figure.broken) figcaption { display: block; }

  /* ── Копировать ── */
  .copy {
    position: absolute; top: 10px; right: 0;
    display: grid; place-items: center;
    width: 30px; height: 30px;
    border: 0; border-radius: var(--radius-sm);
    background: none; color: var(--text-muted);
    opacity: 0;
    transition: opacity 0.15s var(--ease), background 0.15s var(--ease), color 0.15s var(--ease);
  }
  .pt.loose > .copy { top: 12px; right: 8px; }
  .pt.sub > .copy { top: 4px; }
  .pt:hover > .copy, .copy:focus-visible { opacity: 1; }
  .copy:hover { background: var(--surface-2); color: var(--text); }

  @media (max-width: 479px) {
    .sec-head { padding: 12px; gap: 10px; }
    .sec-body { padding: 2px 12px 8px; }
    .para-head { margin: 0 -12px; padding: 10px 12px 8px; }
    .sec-count { display: none; }
    .pt { gap: 0 10px; padding-right: 28px; }
    .num { min-width: 46px; padding: 0 6px; }
    .pt.sub { padding-left: 14px; }
  }
  @media (max-width: 379px) {
    .pt { grid-template-columns: 1fr; gap: 8px; }
    .num { justify-self: start; }
  }
</style>
