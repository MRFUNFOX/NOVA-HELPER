<script lang="ts">
  import { fly } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import HotkeyField from './HotkeyField.svelte';
  import { app } from '../state.svelte';
  import { backend } from '../backend';
  import { pretty } from '../hotkey';
  import { enter } from '../motion';

  let step = $state(0);
  let download = $state<'idle' | 'loading' | 'done' | 'error'>(app.ready ? 'done' : 'idle');
  let error = $state('');
  const STEPS = ['Знакомство', 'Режим игры', 'Клавиша', 'Готово'];

  async function fetchRules() {
    if (download === 'loading' || download === 'done') return;
    download = 'loading';
    error = '';
    const ok = await app.applyUpdate();
    download = ok ? 'done' : 'error';
    if (!ok) error = app.updateError;
  }

  // Правила начинают качаться сразу — пока человек читает шаги, они уже загрузятся
  $effect(() => { if (!app.ready) fetchRules(); });

  async function finish() {
    await backend.finishFirstRun();
    if (app.settings) app.settings = { ...app.settings, firstRunDone: true };
    app.view = { kind: 'doc', docId: app.mainDocId() };
  }
</script>

<div class="wizard" role="dialog" aria-modal="true" aria-label="Первый запуск NOVA HELPER">
  <ol class="steps" aria-label="Шаги настройки">
    {#each STEPS as s, i (s)}
      <li class:done={i < step} class:current={i === step}><span class="dot">{i < step ? '✓' : i + 1}</span><span class="sname">{s}</span></li>
    {/each}
  </ol>

  {#key step}
  <div class="card" in:fly={enter}>
    {#if step === 0}
      <div class="mark" aria-hidden="true">§</div>
      <h1>Правила NOVA RP — не сворачивая игру</h1>
      <p>Нажали клавишу — поверх игры открылись правила проекта. Нашли пункт, нажали ещё раз — окно спряталось, вы снова в игре.</p>
      <ul class="facts">
        <li>Поиск понимает сленг: «дм», «пг», «рк» — и номер пункта, например «4.1».</li>
        <li>У каждого пункта видно наказание. Перманентная блокировка выделена красным.</li>
        <li>Программа сама сверяется с форумом и предложит обновить правила, если их изменят.</li>
      </ul>
      <button class="btn primary next" onclick={() => (step = 1)}>Начать настройку</button>

    {:else if step === 1}
      <h1>Переключите игру в режим «Без рамки»</h1>
      <p>Иначе окно программы не сможет появиться поверх игры — так устроена Windows, это не ошибка программы.</p>
      <div class="howto" aria-hidden="true">
        <div class="howto-bar">GTA V — Настройки — Графика</div>
        <div class="howto-row"><span>Разрешение экрана</span><span class="v">1920 × 1080</span></div>
        <div class="howto-row hl"><span>Режим экрана</span><span class="v">‹ Без рамки ›</span></div>
        <div class="howto-row"><span>Вертикальная синхронизация</span><span class="v">Выкл.</span></div>
      </div>
      <p class="small">В игре: <b>Esc → Настройки → Графика → Режим экрана → «Без рамки»</b> (или «Оконный»). Сделать можно и позже — программа подождёт.</p>
      <div class="nav">
        <button class="btn ghost" onclick={() => (step = 0)}>Назад</button>
        <button class="btn primary" onclick={() => (step = 2)}>Понятно</button>
      </div>

    {:else if step === 2}
      <h1>Клавиша вызова</h1>
      <p>По этой клавише окно появится в игре и спрячется обратно. Подойдёт любая, которая не нужна в игре.</p>
      <HotkeyField />
      {#if backend.isTauri}
        <p class="try"><Icon name="keyboard" size={16} /> Попробуйте прямо сейчас: нажмите <b>{pretty(app.settings?.hotkey ?? '')}</b> — окно спрячется, нажмите ещё раз — вернётся.</p>
      {/if}
      <div class="nav">
        <button class="btn ghost" onclick={() => (step = 1)}>Назад</button>
        <button class="btn primary" onclick={() => (step = 3)}>Дальше</button>
      </div>

    {:else}
      <h1>{download === 'done' ? 'Всё готово' : 'Почти готово'}</h1>
      <div class="loadstate">
        {#if download === 'done'}
          <Icon name="check" size={20} />
          <p>Правила загружены: {app.db.docs.length} документов. Они хранятся на компьютере и открываются даже без интернета.</p>
        {:else if download === 'error'}
          <Icon name="alert" size={20} />
          <div>
            <p>Не получилось загрузить правила. {error}</p>
            <button class="btn" onclick={() => { download = 'idle'; fetchRules(); }}><Icon name="refresh" size={16} />Попробовать снова</button>
          </div>
        {:else}
          <span class="spinner" aria-hidden="true"></span>
          <div class="loading"><p>Загружаю правила с сервера…</p><span class="sk" style="height: 8px; width: 100%"></span></div>
        {/if}
      </div>
      <p>Окно открывается на <b>{pretty(app.settings?.hotkey ?? '')}</b>. Справа внизу экрана будет маленькая подсказка с этой клавишей — её можно выключить в настройках.</p>
      <div class="nav">
        <button class="btn ghost" onclick={() => (step = 2)}>Назад</button>
        <button class="btn primary" onclick={finish} disabled={download !== 'done'}>Открыть правила</button>
      </div>
    {/if}
  </div>
  {/key}
</div>

<style>
  .wizard { flex: 1; overflow-y: auto; padding: 28px 22px 32px; display: flex; flex-direction: column; align-items: center; gap: 20px; }
  .steps { display: flex; gap: 6px; list-style: none; margin: 0; padding: 0; width: 100%; max-width: 520px; }
  .steps li { flex: 1; display: flex; flex-direction: column; gap: 6px; font-size: var(--fs-xs); color: var(--text-muted); }
  .steps li::before { content: ''; height: 3px; border-radius: 3px; background: var(--surface-3); }
  .steps li.done::before, .steps li.current::before { background: var(--accent); }
  .steps li.current { color: var(--text); font-weight: 700; }
  .dot { display: none; }
  .card { width: 100%; max-width: 540px; padding: 28px; }
  .loading { flex: 1; }
  @media (max-width: 479px) { .card { padding: 20px 16px; } }
  .mark { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 14px; background: var(--accent); color: var(--on-accent); font-size: 32px; font-weight: 800; margin-bottom: 18px; }
  h1 { margin: 0 0 10px; font-size: var(--fs-xl); font-weight: 800; line-height: 1.25; }
  p { margin: 0 0 14px; color: var(--text-dim); }
  p b { color: var(--text); }
  .small { font-size: var(--fs-sm); }
  .facts { margin: 0 0 22px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
  .facts li { padding: 10px 12px 10px 14px; border-left: 3px solid var(--accent); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; background: var(--surface-2); font-size: var(--fs-sm); color: var(--text); }
  .next { width: 100%; height: 44px; font-size: var(--fs-md); }
  .nav { display: flex; justify-content: space-between; gap: 10px; margin-top: 22px; }
  .nav .btn.primary { min-width: 160px; height: 40px; }
  .howto { margin: 0 0 14px; border-radius: var(--radius); border: 1px solid var(--border-strong); background: #0a0a0a; overflow: hidden; font-size: var(--fs-sm); }
  .howto-bar { padding: 8px 12px; background: var(--surface-2); font-size: var(--fs-xs); color: var(--text-muted); }
  .howto-row { display: flex; justify-content: space-between; padding: 9px 12px; border-top: 1px solid var(--border); color: var(--text-dim); }
  .howto-row.hl { background: var(--accent-tint); color: var(--text); font-weight: 700; }
  .howto-row.hl .v { color: var(--accent); }
  .try { display: flex; gap: 8px; align-items: flex-start; margin-top: 14px; padding: 10px 12px; border-radius: var(--radius); background: var(--surface-2); font-size: var(--fs-sm); }
  .try :global(svg) { flex-shrink: 0; margin-top: 2px; color: var(--accent); }
  .loadstate { display: flex; gap: 12px; align-items: flex-start; padding: 14px; margin-bottom: 14px; border-radius: var(--radius); background: var(--surface-2); }
  .loadstate p { margin: 0 0 8px; color: var(--text); font-size: var(--fs-sm); }
  .loadstate :global(svg) { flex-shrink: 0; color: var(--accent); }
  .spinner { width: 18px; height: 18px; flex-shrink: 0; border-radius: 50%; border: 2px solid var(--surface-3); border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
