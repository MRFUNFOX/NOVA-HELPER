<script lang="ts">
  import { fly } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import { app, focusSearch } from '../state.svelte';
  import { ease, ms } from '../motion';

  // ИИ-помощник подключается следующим этапом (нужен сервер-посредник с ключами нейросети).
  // Пока панель честно говорит об этом и предлагает поиск, который уже понимает сленг.
  const examples = ['Можно ли убивать без причины на мероприятии?', 'Что будет за оскорбление родных?', 'Сколько можно иметь аккаунтов?'];
</script>

<aside class="ai" transition:fly={{ x: 24, duration: ms(220), easing: ease }} aria-label="ИИ-помощник">
  <header>
    <span class="title"><Icon name="spark" size={17} /> ИИ-помощник</span>
    <button class="close" aria-label="Закрыть" onclick={() => (app.aiOpen = false)}><Icon name="close" size={16} /></button>
  </header>
  <div class="body">
    <p class="lead">Скоро здесь можно будет спросить своими словами — помощник ответит по правилам проекта и сошлётся на нужные пункты.</p>
    <p class="muted">Он появится в одном из ближайших обновлений — программа обновится сама.</p>
    <div class="examples">
      {#each examples as q (q)}<span>{q}</span>{/each}
    </div>
    <p class="muted">А пока — поиск: он понимает сленг и номера пунктов.</p>
    <button class="btn" onclick={() => { app.aiOpen = false; focusSearch(); }}><Icon name="search" size={16} />Перейти к поиску</button>
  </div>
</aside>

<style>
  .ai { width: 340px; flex-shrink: 0; display: flex; flex-direction: column; border-left: 1px solid var(--border); background: var(--surface); }
  header { display: flex; align-items: center; justify-content: space-between; height: 52px; padding: 0 10px 0 16px; border-bottom: 1px solid var(--border); }
  .title { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: var(--fs-md); }
  .title :global(svg) { color: var(--accent); }
  .close { display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-dim); }
  .close:hover { background: var(--surface-2); color: var(--text); }
  .body { padding: 18px 16px; overflow-y: auto; }
  .lead { margin: 0 0 8px; font-size: var(--fs-sm); color: var(--text); }
  p { margin: 0 0 12px; font-size: var(--fs-sm); }
  .examples { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
  .examples span { padding: 10px 12px; border-radius: 12px 12px 12px 4px; background: var(--surface-2); border: 1px solid var(--border); font-size: var(--fs-sm); color: var(--text-dim); }
  @media (max-width: 899px) {
    .ai { position: absolute; top: 0; right: 0; bottom: 0; z-index: 30; width: min(340px, 100%); box-shadow: -8px 0 24px rgba(0, 0, 0, 0.5); }
  }
</style>
