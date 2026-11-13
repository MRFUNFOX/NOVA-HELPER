<script lang="ts">
  /**
   * Новость с гайдом в картинках: показывается всем один раз после обновления
   * и открывается снова из настроек («Окна поверх игры» → «Как это работает»).
   */
  import Icon from './Icon.svelte';
  import { app } from '../state.svelte';
  import { keys } from '../hotkey';
  import imgPin from '../../assets/guide/1-pin.webp';
  import imgGame from '../../assets/guide/2-game.webp';
  import imgEditor from '../../assets/guide/3-editor.webp';

  let { onDone }: { onDone: () => void } = $props();

  const steps = [
    { img: imgPin, alt: 'Булавка справа у пункта правил', title: 'Закрепите пункт' },
    { img: imgGame, alt: 'Закреплённые пункты поверх игры', title: 'Он появится в игре' },
    { img: imgEditor, alt: 'Редактор окон поверх игры', title: 'Расставьте окна как удобно' },
  ];
  let i = $state(0);
  const last = $derived(i === steps.length - 1);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowRight' && !last) i++;
    else if (e.key === 'ArrowLeft' && i > 0) i--;
    else if (e.key === 'Escape') { e.stopPropagation(); onDone(); }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="news">
  <div class="head">
    <span class="tag"><Icon name="pin" size={13} />Новое в 0.6.0</span>
    <button class="skip" onclick={onDone}>Пропустить</button>
  </div>
  <h2>Пункты поверх игры</h2>

  <figure>
    {#each steps as s, n (n)}
      <img src={s.img} alt={s.alt} class:on={n === i} width="1440" height="810" draggable="false" />
    {/each}
  </figure>

  <div class="step">
    <span class="n">{i + 1}</span>
    <div>
      <h3>{steps[i]?.title}</h3>
      {#if i === 0}
        <p>Наведите мышь на любое правило или статью закона и нажмите булавку справа. Закрепить можно до 8 пунктов.</p>
      {:else if i === 1}
        <p>Пункт висит маленьким окном поверх GTA. Мышь проходит сквозь него — играть он не мешает. Вне игры окна прячутся сами.</p>
        <p class="note"><Icon name="info" size={14} />Игра должна быть в режиме «Оконный без рамки»: Настройки → Графика → Тип экрана.</p>
      {:else}
        <p>
          Нажмите
          <span class="keys">{#each keys(app.editorKey) as k, j (j)}{#if j}<span class="plus">+</span>{/if}<kbd>{k}</kbd>{/each}</span>
          — откроется редактор. Тащите окно мышкой, ширину меняйте за жёлтый уголок. Ползунки — прозрачность и шрифт, замок — чтобы окно не сдвинулось.
        </p>
        <p class="note"><Icon name="info" size={14} />Клавиши можно поменять в настройках.</p>
      {/if}
    </div>
  </div>

  <div class="nav">
    <div class="dots" role="tablist" aria-label="Шаги">
      {#each steps as s, n (n)}
        <button class:on={n === i} onclick={() => (i = n)} role="tab" aria-selected={n === i} aria-label="Шаг {n + 1}: {s.title}"></button>
      {/each}
    </div>
    <div class="btns">
      {#if i > 0}<button class="btn ghost" onclick={() => i--}>Назад</button>{/if}
      {#if last}
        <button class="btn primary" onclick={onDone}>Понятно</button>
      {:else}
        <button class="btn primary" onclick={() => i++}>Далее</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .news { display: flex; flex-direction: column; }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .tag { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: var(--accent-tint); color: var(--accent); font-size: var(--fs-xs); font-weight: 800; }
  .skip { padding: 4px 6px; border: 0; background: none; color: var(--text-muted); font-size: var(--fs-xs); font-weight: 600; cursor: pointer; }
  .skip:hover { color: var(--text); }
  h2 { margin: 0 0 14px; font-size: var(--fs-lg); font-weight: 800; line-height: 1.25; }

  figure { position: relative; margin: 0 0 16px; aspect-ratio: 16 / 9; border-radius: var(--radius); overflow: hidden; background: #0d0e11; border: 1px solid var(--border); }
  img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.25s ease; user-select: none; }
  img.on { opacity: 1; }

  .step { display: flex; gap: 12px; min-height: 132px; }
  .n { flex-shrink: 0; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--accent); color: var(--on-accent); font-size: var(--fs-xs); font-weight: 800; }
  h3 { margin: 2px 0 6px; font-size: var(--fs-md, 15px); font-weight: 800; }
  p { margin: 0 0 8px; color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.55; }
  .note { display: flex; gap: 6px; align-items: flex-start; color: var(--text-muted); font-size: var(--fs-xs); }
  .note :global(svg) { flex-shrink: 0; margin-top: 2px; }
  .keys { display: inline-flex; align-items: center; gap: 3px; vertical-align: 1px; }
  .plus { color: var(--text-muted); font-size: 10px; }

  .nav { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 6px; }
  .dots { display: flex; gap: 6px; }
  .dots button { width: 8px; height: 8px; padding: 0; border: 0; border-radius: 999px; background: var(--surface-3); cursor: pointer; transition: width 0.2s ease, background 0.2s ease; }
  .dots button.on { width: 22px; background: var(--accent); }
  .btns { display: flex; gap: 8px; }
  .btns .btn { height: 38px; min-width: 104px; }

  @media (prefers-reduced-motion: reduce) { img, .dots button { transition: none; } }
</style>
