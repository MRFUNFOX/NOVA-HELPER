<script lang="ts">
  import Icon from './Icon.svelte';
  import HotkeyField from './HotkeyField.svelte';
  import { app, formatDate } from '../state.svelte';
  import { backend, checkAppUpdate, type HintMode } from '../backend';

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

  <section>
    <h2>Подсказка в углу экрана</h2>
    <p class="hint">Маленькая надпись справа внизу с клавишей вызова, пока окно скрыто. Клики сквозь неё проходят в игру.</p>
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
  </section>

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
        <p class="value">NOVA HELPER {app.version}</p>
        <p class="hint">
          {#if appCheck === 'latest'}Установлена последняя версия.
          {:else if appCheck === 'error'}Не удалось проверить — нет связи с сервером обновлений.
          {:else}Обновления программы ставятся сами, без переустановки.{/if}
        </p>
      </div>
      <button class="btn" onclick={checkProgram} disabled={appCheck === 'checking'}><Icon name="download" size={16} />{appCheck === 'checking' ? 'Проверяю…' : 'Проверить'}</button>
    </div>
  </section>

  <section class="game">
    <Icon name="window" size={18} />
    <p>Окно видно поверх игры, только если в настройках GTA 5 выбран режим экрана <b>«Оконный»</b> или <b>«Без рамки»</b>. В полноэкранном режиме Windows не может показать другое окно поверх игры.</p>
  </section>

  <button class="btn ghost quit" onclick={() => backend.quit()}>Выйти из программы</button>
</div>

<style>
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
  .quit { align-self: flex-start; margin-top: 4px; color: var(--danger); }
  .quit:hover { background: var(--danger-tint); color: var(--danger); }
  @media (max-width: 639px) { .settings { padding: 16px 14px 48px; } section { padding: 16px; } }
</style>
