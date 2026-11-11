<script lang="ts" module>
  import { flushSync } from 'svelte';

  /**
   * Очередь блоков на достройку: строим по одному за раз, чтобы несколько глав, попавших
   * в зону видимости одновременно, не подвешивали окно одной большой задачей.
   */
  const queue: (() => void)[] = [];
  let scheduled = false;
  const idle: (cb: () => void) => void =
    typeof requestIdleCallback === 'function' ? (cb) => requestIdleCallback(cb, { timeout: 600 }) : (cb) => setTimeout(cb, 40);

  function pump() {
    scheduled = false;
    const job = queue.shift();
    if (job) flushSync(job);
    if (queue.length) schedule();
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    idle(pump);
  }
  /** `urgent` — до блока уже докрутили: строим в первую очередь, не дожидаясь простоя */
  function enqueue(job: () => void, urgent = false) {
    if (urgent) { queue.unshift(job); setTimeout(pump, 0); scheduled = true; return; }
    queue.push(job);
    schedule();
  }
</script>

<script lang="ts">
  /**
   * Отложенная отрисовка больших блоков документа. В Уголовном кодексе ~5 000 элементов: если
   * строить их все сразу, окно подвисает при каждом открытии (и при уходе с документа — их же
   * надо разобрать). Первые блоки строятся сразу, остальные — когда до них остаётся пара экранов
   * прокрутки. До этого на месте блока — серая заглушка примерно той же высоты.
   */
  import type { Snippet } from 'svelte';

  /** `bare` — заглушка без рамки карточки (для глав внутри раздела) */
  let { eager = false, estimate = 400, bare = false, children }: { eager?: boolean; estimate?: number; bare?: boolean; children: Snippet } = $props();
  let shown = $state(false);


  /**
   * Два наблюдателя: за 3 экрана до блока ставим его в очередь «когда будет свободно» —
   * обычно он успевает построиться раньше, чем до него докрутят; если всё же докрутили
   * (осталось меньше экрана) — строим немедленно.
   */
  function watch(el: HTMLElement) {
    const root = el.closest('main');
    const show = () => { shown = true; };
    const far = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { far.disconnect(); enqueue(show); }
    }, { root, rootMargin: '2400px 0px' });
    const near = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { near.disconnect(); far.disconnect(); enqueue(show, true); }
    }, { root, rootMargin: '500px 0px' });
    far.observe(el);
    near.observe(el);
    return { destroy: () => { far.disconnect(); near.disconnect(); } };
  }
</script>

{#if shown || eager}
  {@render children()}
{:else}
  <div class="placeholder" class:bare style="height: {estimate}px" use:watch aria-hidden="true"><span class="sk still"></span></div>
{/if}

<style>
  .placeholder { margin-top: 16px; border-radius: var(--radius-lg); border: 1px solid var(--border); background: var(--surface); overflow: hidden; }
  .placeholder.bare { margin-top: 6px; border: 0; background: none; }
  .placeholder .sk { display: block; width: 100%; height: 100%; border-radius: 0; opacity: 0.35; }
</style>
