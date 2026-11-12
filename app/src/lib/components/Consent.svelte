<script lang="ts">
  /** Один раз при запуске: разрешить ли анонимную статистику. Ответ можно поменять в настройках. */
  import Icon from './Icon.svelte';
  import { app } from '../state.svelte';

  let { onDone }: { onDone: (allowed: boolean) => void } = $props();

  async function answer(on: boolean) {
    await app.setAnalytics(on);
    onDone(on);
  }
</script>

<div class="consent">
  <span class="ico"><Icon name="shield" size={22} /></span>
  <h2>Помочь улучшить программу?</h2>
  <p>Программа может отправлять анонимную статистику: так видно, что работает медленно или ломается, и что стоит улучшить в первую очередь.</p>

  <div class="cols">
    <div class="col">
      <p class="label ok"><Icon name="check" size={14} />Отправляется</p>
      <ul>
        <li>Версия программы и Windows, язык системы</li>
        <li>Как быстро ответил ИИ-помощник и были ли ошибки</li>
        <li>Поисковые запросы, которые ничего не нашли</li>
        <li>Сбои программы</li>
      </ul>
    </div>
    <div class="col">
      <p class="label no"><Icon name="close" size={14} />Никогда</p>
      <ul>
        <li>Ник, аккаунт, IP-адрес</li>
        <li>Ключи нейросетей</li>
        <li>Тексты вопросов ИИ-помощнику</li>
      </ul>
    </div>
  </div>

  <p class="muted small">Поменять решение можно в любой момент: Настройки → «Анонимная статистика».</p>
  <div class="nav">
    <button class="btn ghost" onclick={() => answer(false)}>Не отправлять</button>
    <button class="btn primary" onclick={() => answer(true)}>Разрешить</button>
  </div>
</div>

<style>
  .consent { display: flex; flex-direction: column; }
  .ico { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 14px; background: var(--accent-tint); color: var(--accent); margin-bottom: 16px; }
  h2 { margin: 0 0 10px; font-size: var(--fs-lg); font-weight: 800; line-height: 1.25; }
  p { margin: 0 0 12px; color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.55; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 2px 0 14px; }
  .col { padding: 12px 14px; border-radius: var(--radius); background: var(--surface-2); border: 1px solid var(--border); }
  .label { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; font-size: var(--fs-xs); font-weight: 800; }
  .label.ok { color: var(--success); }
  .label.no { color: var(--danger); }
  ul { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-xs); color: var(--text-dim); line-height: 1.45; }
  .small { font-size: var(--fs-xs); color: var(--text-muted); }
  .nav { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 8px; }
  .nav .btn.primary { min-width: 150px; height: 40px; }
  @media (max-width: 519px) { .cols { grid-template-columns: 1fr; } }
</style>
