<script lang="ts">
  import Icon from './Icon.svelte';
  import HotkeyField from './HotkeyField.svelte';
  import { app, formatDate } from '../state.svelte';
  import { backend, checkAppUpdate, type HintMode } from '../backend';
  import { ai } from '../ai.svelte';
  import { PUBLIC, checkDevCode } from '../features';

  let autostart = $state<boolean | null>(null);
  let appCheck = $state<'idle' | 'checking' | 'latest' | 'error'>('idle');
  $effect(() => { backend.autostart().then((v) => (autostart = v)).catch(() => (autostart = null)); });

  const HINTS: { value: HintMode; label: string }[] = [
    { value: 'always', label: 'Всегда' },
    { value: 'timed', label: '10 секунд' },
    { value: 'off', label: 'Не показывать' },
  ];

  async function save(patch: Partial<NonNullable<typeof app.settings>>) {
    if (!app.settings) return;
    app.settings = await backend.saveSettings({ ...app.settings, ...patch });
  }

  async function toggleAutostart() {
    autostart = await backend.autostart(!autostart);
  }

  // Режим разработчика: 7 нажатий по версии программы → поле для кода
  let taps = 0;
  let devAsk = $state(false);
  let devCode = $state('');
  let devError = $state('');
  function tapVersion() {
    if (app.devMode) return;
    if (++taps >= 7) devAsk = true;
  }
  async function unlock() {
    devError = '';
    if (await checkDevCode(devCode)) {
      await app.setDevMode(true);
      devAsk = false;
      devCode = '';
      app.notify('Режим разработчика включён', 'ok');
    } else devError = 'Код не подходит';
  }

  async function checkProgram() {
    appCheck = 'checking';
    try {
      const u = await checkAppUpdate();
      if (u) { app.appUpdate = u; app.appUpdateDialog = true; appCheck = 'idle'; }
      else appCheck = 'latest';
    } catch { appCheck = 'error'; }
  }
</script>

<div class="settings">
  <h1>Настройки</h1>

  <section>
    <h2>Клавиша вызова</h2>
    <p class="hint">Открывает и прячет окно прямо в игре. Если сочетание нужно в игре — назначьте другое.</p>
    <HotkeyField />
  </section>

  {#if app.pinsEnabled}
    <section>
      <h2>Окна поверх игры</h2>
      <p class="hint">Закрепляйте пункты булавкой — они появятся поверх игры. Эта клавиша открывает редактор: двигать окна, менять ширину, фон и шрифт.</p>
      <HotkeyField kind="editor" />
      <div class="pins-row">
        <span class="hint">{app.pins.length ? `Закреплено: ${app.pins.length} из 8` : 'Пока ничего не закреплено'}</span>
        <span class="pins-btns">
          <button class="btn sm ghost" onclick={() => (app.guideOpen = true)}>Как это работает</button>
          {#if app.pins.length}<button class="btn sm" onclick={() => backend.pinsEditor(true)}>Открыть редактор</button>{/if}
        </span>
      </div>
    </section>
  {/if}

  <section>
    <h2>Подсказка в углу экрана</h2>
    <p class="hint">Маленькая надпись справа внизу с клавишами, пока вы в игре. Окно программы открывается поверх неё, клики сквозь неё проходят в игру.</p>
    <div class="segmented" role="radiogroup" aria-label="Подсказка в углу экрана">
      {#each HINTS as h (h.value)}
        <button role="radio" aria-checked={app.settings?.hint === h.value} class:on={app.settings?.hint === h.value} onclick={() => save({ hint: h.value })}>{h.label}</button>
      {/each}
    </div>
  </section>

  <section class="toggles">
    <label class="toggle">
      <input type="checkbox" checked={app.settings?.closeToTray} onchange={(e) => save({ closeToTray: e.currentTarget.checked })} />
      <span><b>Крестик прячет окно</b><span class="hint">Программа остаётся в трее и открывается по клавише. Выйти — через значок в трее.</span></span>
    </label>
    {#if autostart !== null}
      <label class="toggle">
        <input type="checkbox" checked={autostart} onchange={toggleAutostart} />
        <span><b>Запускать вместе с Windows</b><span class="hint">Окно не откроется само — только подсказка с клавишей.</span></span>
      </label>
    {/if}
    <label class="toggle">
      <input type="checkbox" checked={app.settings?.analytics === true} onchange={(e) => app.setAnalytics(e.currentTarget.checked)} />
      <span><b>Анонимная статистика</b><span class="hint">Скорость ответов помощника, сбои и поиски без результата — чтобы улучшать программу. Ники, ключи и тексты вопросов не отправляются.</span></span>
    </label>
  </section>

  {#if app.aiEnabled}
  <section>
    <h2>ИИ-помощник</h2>
    <div class="row">
      <div>
        <p class="value">{ai.ready ? `Нейросеть ${ai.status?.provider ?? 'Groq'} ${ai.status?.provider === 'Z.ai' ? '(Россия и СНГ)' : '(Европа)'}, ключ ${ai.status?.keyHint}` : 'Не настроен'}</p>
        <p class="hint">{ai.ready ? 'Ключ хранится только на этом компьютере.' : 'Нужен бесплатный ключ: Groq для Европы или Z.ai для России и СНГ. Программа проведёт по шагам.'}</p>
      </div>
      <div class="btns">
        <button class="btn" onclick={() => (ai.setupOpen = true)}><Icon name="spark" size={16} />{ai.ready ? 'Сменить нейросеть' : 'Настроить'}</button>
        {#if ai.ready}<button class="btn ghost" onclick={() => ai.clearKey()}>Удалить</button>{/if}
      </div>
    </div>
  </section>
  {/if}

  <section>
    <h2>Правила</h2>
    <div class="row">
      <div>
        <p class="value">{app.db.manifest ? `Версия от ${formatDate(app.db.manifest.generatedAt)}` : 'Не загружены'}</p>
        <p class="hint">{app.db.docs.length} документов · проверка форума каждые 3 часа{app.lastChecked ? `, последняя — ${formatDate(app.lastChecked.toISOString())}` : ''}</p>
      </div>
      <button class="btn" onclick={() => app.analyze(true)} disabled={app.checking}><Icon name="refresh" size={16} />Анализ правил</button>
    </div>
  </section>

  <section>
    <h2>Программа</h2>
    <div class="row">
      <div>
        <!-- 7 нажатий по версии — поле для кода разработчика -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
        <p class="value" onclick={tapVersion}>NOVA HELPER {app.version}</p>
        <p class="hint">
          {#if appCheck === 'latest'}Установлена последняя версия.
          {:else if appCheck === 'error'}Не удалось проверить — нет связи с сервером обновлений.
          {:else}Обновления программы ставятся сами, без переустановки.{/if}
        </p>
      </div>
      <button class="btn" onclick={checkProgram} disabled={appCheck === 'checking'}><Icon name="download" size={16} />{appCheck === 'checking' ? 'Проверяю…' : 'Проверить'}</button>
    </div>
  </section>

  {#if app.devMode}
    <section class="dev">
      <h2>Режим разработчика</h2>
      <div class="row">
        <p class="hint">Включён: видны функции, которые игрокам ещё не показываются{PUBLIC.ai ? '' : ' (ИИ-помощник)'}.</p>
        <button class="btn" onclick={() => app.setDevMode(false)}>Выключить</button>
      </div>
    </section>
  {:else if devAsk}
    <section class="dev">
      <h2>Код разработчика</h2>
      <div class="row">
        <input class="code" placeholder="NOVA-…" spellcheck="false" autocomplete="off" bind:value={devCode}
          onkeydown={(e) => { if (e.key === 'Enter') unlock(); }} />
        <button class="btn primary" onclick={unlock}>Включить</button>
      </div>
      {#if devError}<p class="hint bad">{devError}</p>{/if}
    </section>
  {/if}

  <section class="game">
    <Icon name="window" size={18} />
    <p>Окно видно поверх игры, только если в настройках GTA 5 выбран режим экрана <b>«Оконный»</b> или <b>«Без рамки»</b>. В полноэкранном режиме Windows не может показать другое окно поверх игры.</p>
  </section>

  <button class="btn ghost quit" onclick={() => backend.quit()}>Выйти из программы</button>
</div>

<style>
  .pins-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 12px; }
  .pins-row .hint { margin: 0; }
  .pins-btns { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  .settings { max-width: 680px; padding: 22px 24px 64px; display: flex; flex-direction: column; gap: 12px; }
  h1 { margin: 0 0 8px; font-size: var(--fs-2xl); font-weight: 800; letter-spacing: -0.01em; }
  section { padding: 18px 20px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); }
  h2 { margin: 0 0 2px; font-size: var(--fs-md); font-weight: 800; }
  .hint { display: block; margin: 0 0 10px; font-size: var(--fs-xs); color: var(--text-muted); line-height: 1.45; }
  .segmented { display: inline-flex; padding: 3px; gap: 2px; border-radius: var(--radius); background: var(--bg); border: 1px solid var(--border-strong); }
  .segmented button { border: 0; background: none; padding: 7px 14px; transition: background 0.15s var(--ease), color 0.15s var(--ease); border-radius: var(--radius-sm); font-size: var(--fs-sm); font-weight: 600; color: var(--text-dim); }
  .segmented button.on { background: var(--accent); color: var(--on-accent); }
  .toggles { display: flex; flex-direction: column; gap: 14px; }
  .toggle { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; }
  .toggle b { display: block; font-size: var(--fs-sm); }
  .toggle .hint { margin: 2px 0 0; }
  .toggle input { appearance: none; flex-shrink: 0; width: 36px; height: 20px; margin: 1px 0 0; border-radius: 999px; background: var(--surface-3); position: relative; cursor: pointer; transition: background 0.15s; }
  .toggle input::after { content: ''; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--text-dim); transition: transform 0.2s var(--ease), background 0.15s; }
  .toggle input:checked { background: var(--accent); }
  .toggle input:checked::after { transform: translateX(16px); background: var(--on-accent); }
  .row { display: flex; align-items: center; gap: 12px; justify-content: space-between; flex-wrap: wrap; }
  .value { margin: 4px 0 2px; font-size: var(--fs-sm); font-weight: 700; }
  .row .hint { margin: 0; }
  .game { display: flex; gap: 12px; align-items: flex-start; color: var(--text-dim); font-size: var(--fs-sm); background: var(--accent-glow), var(--surface); border-color: var(--accent-line); }
  .game p { margin: 0; }
  .game :global(svg) { flex-shrink: 0; margin-top: 2px; color: var(--accent); }
  .dev { border-color: var(--accent-line); }
  .code { flex: 1; min-width: 0; height: 36px; padding: 0 12px; border-radius: var(--radius); border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font-family: ui-monospace, Consolas, monospace; }
  .code:focus { outline: 0; border-color: var(--accent-line); }
  .bad { color: var(--danger); margin-top: 8px; }
  .btns { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  .quit { align-self: flex-start; margin-top: 4px; color: var(--danger); }
  .quit:hover { background: var(--danger-tint); color: var(--danger); }
  @media (max-width: 639px) { .settings { padding: 16px 14px 48px; } section { padding: 16px; } }
</style>
