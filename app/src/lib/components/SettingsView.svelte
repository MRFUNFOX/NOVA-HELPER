<script lang="ts">
  import Icon from './Icon.svelte';
  import HotkeyField from './HotkeyField.svelte';
  import { app, formatDate } from '../state.svelte';
  import { backend, checkAppUpdate, type HintMode } from '../backend';
  import { ai } from '../ai.svelte';
  import { voice } from '../voice.svelte';
  import { pretty } from '../hotkey';
  import { PUBLIC, checkDevCode } from '../features';
  import { learn, LearnError } from '../learn.svelte';

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

  // Скрытый вход: 7 нажатий по версии программы → поле для личного кода.
  // Код разработчика включает режим разработчика и «Управление», код админа — только «Управление».
  let taps = 0;
  let devAsk = $state(false);
  let devCode = $state('');
  let devError = $state('');
  let devBusy = $state(false);
  function tapVersion() {
    if (learn.staff) return;
    if (++taps >= 7) devAsk = true;
  }
  async function unlock() {
    if (!devCode.trim() || devBusy) return;
    devError = '';
    devBusy = true;
    try {
      const me = await learn.login(devCode);
      if (me.role === 'dev') await app.setDevMode(true);
      devAsk = false; devCode = ''; taps = 0;
      app.notify(me.role === 'dev' ? 'Вход выполнен: Dev. Раздел «Управление» — в меню слева' : `Вход выполнен: ${me.name}. Раздел «Управление» — в меню слева`, 'ok');
    } catch (e) {
      if (e instanceof LearnError && e.code === 'network' && (await checkDevCode(devCode))) {
        // Нет связи с сервером: режим разработчика всё равно включаем, «Управление» — когда появится связь
        await app.setDevMode(true);
        devAsk = false; devCode = '';
        app.notify('Режим разработчика включён. «Управление» откроется, когда будет связь с сервером', 'ok');
      } else if (e instanceof LearnError && e.status === 429) {
        const until = typeof e.data.until === 'string' ? new Date(e.data.until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
        devError = `Слишком много неверных попыток. Вход с этого компьютера закрыт${until ? ` до ${until}` : ''}.`;
      } else if (e instanceof LearnError && e.status === 401) {
        const left = Number(e.data.left);
        devError = left > 0 ? `Код не подходит. Осталось попыток: ${left}, потом вход закроется на 15 минут.` : 'Код не подходит';
      } else if (e instanceof LearnError && e.code === 'network') devError = 'Нет связи с сервером. Проверьте интернет.';
      else devError = 'Сервер не ответил. Попробуйте ещё раз.';
    }
    devBusy = false;
  }

  // ── Голосовой вопрос ──
  let vstat = $state<{ installed: boolean; installing: boolean; sizeMb: number } | null>(null);
  let devs = $state<{ inputs: string[]; outputs: string[] }>({ inputs: [], outputs: [] });
  let verr = $state('');
  let testing = $state(false);
  async function vload() {
    try { vstat = await backend.voiceStatus(); } catch { vstat = null; }
    if (vstat?.installed) devs = await backend.voiceDevices().catch(() => devs);
  }
  $effect(() => { void vload(); void voice.watchInstall(); });
  // Скачивание закончилось — обновить состояние
  $effect(() => { if (!voice.install && vstat?.installing) void vload(); });
  async function vinstall() {
    verr = '';
    if (app.settings?.voiceDeclined) await save({ voiceDeclined: false });
    vstat = { ...(vstat ?? { installed: false, sizeMb: 290 }), installing: true };
    try { await backend.voiceInstall(); } catch (e) { verr = String(e); }
    await vload();
    // Голос установлен — Alt+Q теперь работает как задумано, напоминание про перенос клавиш больше не нужно
    if (vstat?.installed && app.settings?.keysMoved) await save({ keysMoved: false });
  }
  // Удалил сам — больше не скачиваем в фоне; вернуть можно кнопкой «Установить голос»
  async function vremove() { await backend.voiceRemove().catch(() => {}); await save({ voiceDeclined: true }); await vload(); }
  // Громкость и скорость: двигаем — видно сразу, сохраняем, когда отпустили
  let vol = $state(100);
  let rate = $state(1.1);
  $effect(() => { vol = app.settings?.voiceVolume ?? 100; rate = app.settings?.voiceRate ?? 1.1; });
  async function vtest() {
    testing = true;
    try { await backend.voiceSay('Привет! Так звучит голос помощника. Можно, но только по правилам.'); } catch (e) { verr = String(e); }
    testing = false;
  }
  const mb = (b: number) => `${Math.round(b / 1e6)} МБ`;

  // Контакт автора программы (значок Discord — официальный, от владельца)
  import dsIcon from '../../assets/brand/discord-icon.png';
  const DISCORD = 'badalastor';
  let discordCopied = $state(false);
  async function copyDiscord() {
    try { await navigator.clipboard.writeText(DISCORD); discordCopied = true; setTimeout(() => (discordCopied = false), 1800); } catch { /* без буфера обмена */ }
  }

  async function checkProgram() {
    appCheck = 'checking';
    try {
      const u = await checkAppUpdate(learn.staff);
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
    <p class="hint">Маленькая надпись с клавишами, пока вы в игре (по умолчанию — справа внизу; переставить можно в редакторе окон). Окно программы открывается поверх неё, клики сквозь неё проходят в игру.</p>
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
      <span><b>Анонимная статистика</b><span class="hint">Скорость ответов помощника, сбои, поиски без результата и как пользуются окнами поверх игры — чтобы улучшать программу. Ники, ключи и тексты вопросов не отправляются.</span></span>
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
    {#if ai.ready}
      <div class="aiopts">
        <label class="toggle">
          <input type="checkbox" checked={ai.confirmSend} onchange={(e) => ai.setConfirm(e.currentTarget.checked)} />
          <span><b>Спрашивать перед отправкой</b><span class="hint">Первый Enter покажет «Отправить вопрос?», второй — отправит. Чтобы случайное нажатие не отправило недописанный вопрос.</span></span>
        </label>
        <div class="row">
          <div>
            <p class="value">История вопросов: {ai.history.length}</p>
            <p class="hint">Только на этом компьютере, последние 200. Открыть — часы в окне помощника.</p>
          </div>
          {#if ai.history.length}<button class="btn ghost" onclick={() => ai.forgetAll()}>Очистить</button>{/if}
        </div>
      </div>
    {/if}
  </section>
  {/if}

  {#if app.aiEnabled}
  <section>
    <h2>Голосовой вопрос</h2>
    <p class="hint">Зажмите клавишу в игре и спросите помощника голосом — ответ появится сверху экрана и прозвучит вслух. Речь распознаётся прямо на компьютере, без интернета и ключей.</p>
    {#if app.settings?.keysMoved}
      <p class="vmoved"><Icon name="info" size={15} /><span>Окно помощника теперь открывается на <b>{pretty(app.settings.hotkey)}</b>, а Alt + Q — голосовой вопрос.</span></p>
    {/if}
    {#if !vstat?.installed}
      {#if voice.install || vstat?.installing}
        {@const p = voice.install}
        <div class="vprog">
          <div class="vbar"><i style="width: {p && p.total ? (p.done / p.total) * 100 : 3}%"></i></div>
          <span class="hint">{p?.stage === 'unpack' ? 'Распаковываю…' : p ? `Скачиваю ${mb(p.done)} из ${mb(p.total)}` : 'Начинаю скачивание…'}</span>
        </div>
      {:else}
        <div class="row">
          <div>
            {#if app.settings?.voiceDeclined}
              <p class="value">Голос удалён</p>
              <p class="hint">Сам больше не скачается. Вернуть — около {vstat?.sizeMb ?? 290} МБ, один раз.</p>
            {:else}
              <p class="value">Голос скачается сам — один раз, около {vstat?.sizeMb ?? 290} МБ</p>
              <p class="hint">Распознавание речи и голос помощника. Обновления программы их не трогают, потом всё работает без интернета.</p>
            {/if}
          </div>
          <button class="btn primary" onclick={vinstall}><Icon name="download" size={16} />{app.settings?.voiceDeclined ? 'Установить голос' : 'Скачать сейчас'}</button>
        </div>
      {/if}
    {:else}
      <div class="vgrid">
        <span class="vl">Клавиша — зажать и говорить</span>
        <HotkeyField kind="voice" />
        <label class="toggle">
          <input type="checkbox" checked={app.settings?.voiceSpeak !== false} onchange={(e) => save({ voiceSpeak: e.currentTarget.checked })} />
          <span><b>Озвучивать ответы</b><span class="hint">Окно ответа держится, пока помощник читает. Без озвучки — столько, чтобы успеть прочитать.</span></span>
        </label>
        <label class="vsel"><span class="vl">Микрофон</span>
          <select value={app.settings?.voiceInput ?? ''} onchange={(e) => save({ voiceInput: e.currentTarget.value || null })}>
            <option value="">Как в Windows</option>
            {#each devs.inputs as d (d)}<option value={d}>{d}</option>{/each}
          </select>
        </label>
        <label class="vsel"><span class="vl">Куда выводить голос помощника</span>
          <select value={app.settings?.voiceOutput ?? ''} onchange={(e) => save({ voiceOutput: e.currentTarget.value || null })}>
            <option value="">Как в Windows</option>
            {#each devs.outputs as d (d)}<option value={d}>{d}</option>{/each}
          </select>
        </label>
        <label class="vsel"><span class="vl">Громкость <b class="vnum">{vol}%</b></span>
          <input class="vrange" type="range" min="0" max="100" step="5" bind:value={vol} onchange={() => save({ voiceVolume: vol })} style="--p: {vol}%" />
        </label>
        <label class="vsel"><span class="vl">Скорость речи <b class="vnum">{rate === 1 ? 'обычная' : `${String(rate.toFixed(2)).replace('.', ',')}×`}</b></span>
          <input class="vrange" type="range" min="0.8" max="1.5" step="0.05" bind:value={rate} onchange={() => save({ voiceRate: rate })} style="--p: {((rate - 0.8) / 0.7) * 100}%" />
        </label>
        <div class="vbtns">
          <button class="btn" onclick={vtest} disabled={testing}><Icon name="speaker" size={16} />{testing ? 'Говорю…' : 'Послушать голос'}</button>
          <button class="btn ghost" onclick={vremove}>Удалить голос</button>
        </div>
      </div>
    {/if}
    {#if verr}<p class="msg-err" role="alert">{verr}</p>{/if}
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
        <div class="dev-btns">
          {#if !learn.staff && !devAsk}<button class="btn" onclick={() => (devAsk = true)}>Войти в «Управление»</button>{/if}
          <button class="btn" onclick={() => app.setDevMode(false)}>Выключить</button>
        </div>
      </div>
    </section>
  {/if}
  {#if devAsk && !learn.staff}
    <section class="dev">
      <h2>Вход</h2>
      <div class="row">
        <input class="code" type="password" placeholder="NOVA-…" spellcheck="false" autocomplete="off" bind:value={devCode}
          onkeydown={(e) => { if (e.key === 'Enter') unlock(); }} />
        <button class="btn primary" onclick={unlock} disabled={devBusy || !devCode.trim()}>{devBusy ? 'Проверяю…' : 'Войти'}</button>
      </div>
      {#if devError}<p class="hint bad">{devError}</p>{/if}
    </section>
  {/if}

  <section class="ds">
    <img class="ds-ico" src={dsIcon} alt="Discord" width="42" height="42" />
    <div class="grow">
      <b>Нашли ошибку или есть идея?</b>
      <p>Напишите автору программы в Discord — так NOVA HELPER становится лучше.</p>
    </div>
    <button class="ds-btn" onclick={copyDiscord} title="Скопировать ник"><Icon name={discordCopied ? 'check' : 'copy'} size={16} />{discordCopied ? 'Ник скопирован' : DISCORD}</button>
  </section>

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
  .vmoved { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; padding: 9px 12px; border-radius: 10px; background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--text); font-size: 13.5px; }
  .vmoved :global(svg) { color: var(--accent); flex-shrink: 0; }
  .vprog { display: flex; flex-direction: column; gap: 6px; }
  .vbar { height: 6px; border-radius: 99px; background: var(--surface-3); overflow: hidden; }
  .vbar i { display: block; height: 100%; background: var(--accent); transition: width 0.2s; }
  .vgrid { display: flex; flex-direction: column; gap: 14px; }
  .vl { display: block; font-size: var(--fs-xs); font-weight: 700; color: var(--text-dim); margin-bottom: -6px; }
  .vsel { display: flex; flex-direction: column; gap: 6px; }
  .vnum { margin-left: 6px; color: var(--text); font-weight: 700; font-variant-numeric: tabular-nums; }
  .vrange { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; margin: 8px 0; border-radius: 3px; background: linear-gradient(90deg, var(--accent) var(--p), var(--border-strong) var(--p)); cursor: pointer; }
  .vrange::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 3px solid var(--accent); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4); }
  .vrange:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
  .vsel .vl { margin: 0; }
  .vsel select { height: 38px; padding: 0 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font: inherit; font-size: var(--fs-sm); }
  .vbtns { display: flex; gap: 8px; flex-wrap: wrap; }
  .msg-err { margin: 10px 0 0; font-size: var(--fs-xs); color: var(--danger); }
  .aiopts { display: flex; flex-direction: column; gap: 14px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }
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
  .dev-btns { display: flex; gap: 8px; flex-wrap: wrap; }
  .code { flex: 1; min-width: 0; height: 36px; padding: 0 12px; border-radius: var(--radius); border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font-family: ui-monospace, Consolas, monospace; }
  .code:focus { outline: 0; border-color: var(--accent-line); }
  .bad { color: var(--danger); margin-top: 8px; }
  .btns { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  .quit { align-self: flex-start; margin-top: 4px; color: var(--danger); }
  /* Связь с автором — в цвете Discord */
  .ds { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; background: linear-gradient(140deg, rgba(88, 101, 242, 0.22) 0%, rgba(88, 101, 242, 0.06) 50%, rgba(88, 101, 242, 0) 75%), var(--surface); border-color: rgba(88, 101, 242, 0.5); }
  .ds-ico { width: 42px; height: 42px; border-radius: 11px; flex-shrink: 0; }
  .ds .grow { flex: 1; min-width: 220px; }
  .ds b { display: block; font-size: var(--fs-md); }
  .ds p { margin: 3px 0 0; font-size: var(--fs-sm); color: var(--text-dim); }
  .ds-btn { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 18px 0 14px; border: 0; border-radius: var(--radius); background: #5865f2; color: #fff; font: inherit; font-size: var(--fs-md); font-weight: 700; cursor: pointer; transition: background 0.15s; }
  .ds-btn:hover { background: #4752c4; }
  .quit:hover { background: var(--danger-tint); color: var(--danger); }
  @media (max-width: 639px) { .settings { padding: 16px 14px 48px; } section { padding: 16px; } }
</style>
