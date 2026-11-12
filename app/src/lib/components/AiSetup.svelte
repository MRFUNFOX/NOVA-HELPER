<script lang="ts">
  /**
   * Пошаговая настройка ИИ-помощника: выбрать сервис (Groq, а в России — Z.ai),
   * получить бесплатный ключ и вставить его.
   * Показывается в мастере первого запуска, один раз после обновления у тех, кто ставил
   * программу раньше, и по кнопке «Настроить» в окне помощника.
   */
  import { fly } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import { ai } from '../ai.svelte';
  import { backend } from '../backend';
  import { enter } from '../motion';

  /** `onDone(true)` — ключ настроен, `onDone(false)` — пропустили */
  let { onDone, compact = false }: { onDone: (configured: boolean) => void; compact?: boolean } = $props();

  type Service = 'groq' | 'zai';
  const SERVICES = {
    groq: { name: 'Groq', url: 'https://console.groq.com/keys', address: 'console.groq.com/keys', placeholder: 'gsk_…' },
    zai: { name: 'Z.ai', url: 'https://z.ai/manage-apikey/apikey-list', address: 'z.ai/manage-apikey/apikey-list', placeholder: 'Вставьте ключ Z.ai' },
  } as const;
  // Пришли из списка нейросетей — сразу к получению ключа для выбранной
  const preset = ai.setupService;
  ai.setupService = null;
  let service = $state<Service>(preset ?? (ai.status?.provider === 'Z.ai' ? 'zai' : 'groq'));
  const sv = $derived(SERVICES[service]);
  // Ключ уже есть (смена ключа) — сразу к выбору сервиса
  let step = $state(preset ? 2 : ai.ready ? 1 : 0);

  function pickService(s: Service) {
    service = s;
    opened = false;
    openFailed = false;
    error = '';
    step = 2;
  }
  let key = $state('');
  let checking = $state(false);
  let error = $state('');
  let confirmSkip = $state(false);
  let opened = $state(false);

  async function check() {
    if (checking) return;
    checking = true;
    error = '';
    // С ключом часто копируют пробелы, кавычки или перенос строки — убираем
    key = key.replace(/[\s"'«»“”]/g, '');
    try {
      await ai.setKey(key);
      step = 4;
    } catch (e) {
      error = String(e);
    } finally {
      checking = false;
    }
  }

  async function paste() {
    try {
      key = (await navigator.clipboard.readText()).trim();
      error = '';
    } catch {
      error = 'Не получилось вставить автоматически — нажмите в поле и Ctrl+V.';
    }
  }

  let openFailed = $state(false);
  let copiedLink = $state(false);
  async function openSite() {
    openFailed = !(await backend.openUrl(sv.url));
    opened = true;
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(sv.url); copiedLink = true; setTimeout(() => (copiedLink = false), 1800); } catch { /* ничего */ }
  }
</script>

<div class="setup" class:compact>
  {#if confirmSkip}
    <div class="pane" in:fly={enter}>
      <span class="ico warn"><Icon name="alert" size={22} /></span>
      <h2>Пропустить настройку?</h2>
      <p>Без ключа ИИ-помощник работать не будет. Всё остальное — правила, законы и поиск — работает как обычно.</p>
      <p class="muted">Настроить можно в любой момент: кнопка <b>«ИИ-помощник»</b> справа вверху → <b>«Настроить»</b>.</p>
      <div class="nav">
        <button class="btn ghost" onclick={() => onDone(false)}>Всё равно пропустить</button>
        <button class="btn primary" onclick={() => (confirmSkip = false)}>Вернуться к настройке</button>
      </div>
    </div>
  {:else}
    {#key step}
      <div class="pane" in:fly={enter}>
        {#if step === 0}
          <span class="ico"><Icon name="spark" size={24} /></span>
          <h2>ИИ-помощник</h2>
          <p>Спросите своими словами — например, «можно ли убить копа, если он первый достал оружие» — помощник ответит по правилам проекта или законам штата и покажет, на какие пункты опирается.</p>
          <ul class="facts">
            <li>Бесплатно: нужен личный ключ нейросети — <b>Groq</b> для Европы или <b>Z.ai</b> для России и СНГ.</li>
            <li>Займёт 2 минуты. Ключ хранится только на вашем компьютере.</li>
          </ul>
          <div class="nav">
            <button class="btn ghost skip" onclick={() => (confirmSkip = true)}>Пропустить</button>
            <button class="btn primary" onclick={() => (step = 1)}>Настроить</button>
          </div>

        {:else if step === 1}
          <p class="stepno">Шаг 1 из 3</p>
          <h2>Выберите нейросеть</h2>
          <p>Обе бесплатные. Groq не работает в России и части стран СНГ — для них есть Z.ai. Сменить можно в любой момент в настройках.</p>
          <div class="services">
            <button class="service" class:on={ai.ready && service === 'groq'} onclick={() => pickService('groq')}>
              <b>Groq — для Европы</b>
              <small>И других стран, кроме России и СНГ. Отвечает быстрее и точнее.</small>
              <Icon name="chevron" size={16} />
            </button>
            <button class="service" class:on={ai.ready && service === 'zai'} onclick={() => pickService('zai')}>
              <b>Z.ai — для России и СНГ</b>
              <small>Работает без VPN.</small>
              <Icon name="chevron" size={16} />
            </button>
          </div>
          {#if ai.ready}<p class="muted small">Сейчас подключена: <b>{ai.status?.provider}</b>.</p>{/if}
          <div class="nav">
            <button class="btn ghost" onclick={() => (step = 0)}>Назад</button>
          </div>

        {:else if step === 2}
          <p class="stepno">Шаг 2 из 3</p>
          <h2>Получите ключ на сайте {sv.name}</h2>
          <ol class="howto">
            {#if service === 'groq'}
              <li><span>1</span><div>Нажмите кнопку ниже — сайт Groq откроется в браузере.</div></li>
              <li><span>2</span><div>Войдите: <b>«Continue with Google»</b> или по почте. Регистрация бесплатная.</div></li>
              <li><span>3</span><div>Нажмите <b>«Create API Key»</b>. В поле названия напишите что угодно, например <b>NOVA</b>, и нажмите <b>«Submit»</b>.</div></li>
              <li><span>4</span><div>Нажмите <b>«Copy»</b> рядом с ключом. Он начинается с <code>gsk_</code>.<br /><small>Ключ показывается один раз. Если закрыли окно — просто создайте новый.</small></div></li>
            {:else}
              <li><span>1</span><div>Нажмите кнопку ниже — сайт Z.ai откроется в браузере.</div></li>
              <li><span>2</span><div>Войдите: <b>«Continue with Google»</b> или зарегистрируйтесь по почте. Это бесплатно.</div></li>
              <li><span>3</span><div>Нажмите <b>«Add API Key»</b> справа вверху. Название — любое, например <b>NOVA</b>.</div></li>
              <li><span>4</span><div>В строке с ключом, в столбце <b>«Action»</b>, нажмите значок копирования. Копируйте именно <b>API Key</b>, а не «API Key ID».<br /><small>Пополнять баланс не нужно: помощник использует только бесплатные модели.</small></div></li>
            {/if}
          </ol>
          <button class="btn wide open" class:primary={!opened} onclick={openSite}><Icon name="external" size={16} />Открыть сайт {sv.name}</button>
          <p class="link">
            Или вставьте в браузер адрес <code>{sv.address}</code>
            <button class="copy" onclick={copyLink}>{copiedLink ? 'Скопировано' : 'Копировать'}</button>
          </p>
          {#if openFailed}
            <p class="error" role="alert"><Icon name="alert" size={15} />Браузер не открылся. Адрес скопирован — откройте браузер и вставьте его в адресную строку (Ctrl+V).</p>
          {:else if opened}
            <p class="muted small">Сайт открылся в браузере. Если его не видно за окном программы — спрячьте программу клавишей вызова, а потом вернитесь.</p>
          {/if}
          {#if service === 'groq'}
            <p class="muted small">Сайт показал <code>Forbidden</code>? Значит, Groq недоступен в вашей стране — <button class="inline" onclick={() => pickService('zai')}>подключите Z.ai</button>.</p>
          {/if}
          <div class="nav">
            <button class="btn ghost" onclick={() => (step = 1)}>Назад</button>
            <button class="btn" class:primary={opened} onclick={() => (step = 3)}>Я скопировал ключ</button>
          </div>

        {:else if step === 3}
          <p class="stepno">Шаг 3 из 3</p>
          <h2>Вставьте ключ</h2>
          <p>Нажмите в поле и <b>Ctrl+V</b> — или кнопку «Вставить».</p>
          <div class="field" class:bad={!!error}>
            <input
              type="text"
              placeholder={sv.placeholder}
              spellcheck="false"
              autocomplete="off"
              bind:value={key}
              oninput={() => (error = '')}
              onkeydown={(e) => { if (e.key === 'Enter') check(); }}
            />
            <button class="btn sm" onclick={paste}>Вставить</button>
          </div>
          {#if error}
            <p class="error" role="alert"><Icon name="alert" size={15} />{error}</p>
            {#if error.includes('Z.ai') && service === 'groq'}
              <button class="btn sm primary switch" onclick={() => { key = ''; pickService('zai'); }}>Подключить Z.ai</button>
            {/if}
          {/if}
          <div class="nav">
            <button class="btn ghost" onclick={() => (step = 2)}>Назад</button>
            <button class="btn primary" onclick={check} disabled={checking || !key.trim()}>
              {#if checking}<span class="spinner" aria-hidden="true"></span>Проверяю…{:else}Проверить ключ{/if}
            </button>
          </div>
          <p class="muted small">Не получается? Проверьте, что скопировали ключ целиком, или создайте новый на сайте {sv.name}.</p>

        {:else}
          <span class="ico ok"><Icon name="check" size={24} /></span>
          <h2>Помощник готов</h2>
          <p>Ключ {ai.status?.keyHint} подошёл. Задавайте вопросы через кнопку <b>«ИИ-помощник»</b> справа вверху.</p>
          <p class="muted small">Ответ — подсказка по правилам. Окончательно решает администрация проекта.</p>
          <div class="nav end">
            <button class="btn primary" onclick={() => onDone(true)}>Готово</button>
          </div>
        {/if}
      </div>
    {/key}
  {/if}
</div>

<style>
  .setup { width: 100%; }
  .pane { display: flex; flex-direction: column; }
  .ico { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 14px; background: var(--accent); color: var(--on-accent); margin-bottom: 16px; }
  .ico.ok { background: var(--success-tint); color: var(--success); }
  .ico.warn { background: var(--accent-tint); color: var(--accent); }
  h2 { margin: 0 0 10px; font-size: var(--fs-xl); font-weight: 800; line-height: 1.25; }
  p { margin: 0 0 12px; color: var(--text-dim); }
  p b, li b { color: var(--text); }
  .stepno { margin: 0 0 4px; font-size: var(--fs-xs); font-weight: 700; color: var(--accent); }
  .small { font-size: var(--fs-sm); }
  .facts { margin: 0 0 6px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
  .facts li { padding: 10px 12px 10px 14px; border-left: 3px solid var(--accent); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; background: var(--surface-2); font-size: var(--fs-sm); color: var(--text-dim); }
  .howto { margin: 4px 0 14px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
  .howto li { display: flex; gap: 12px; align-items: flex-start; font-size: var(--fs-sm); color: var(--text-dim); line-height: 1.5; }
  .howto li > span { display: grid; place-items: center; flex-shrink: 0; width: 24px; height: 24px; border-radius: 50%; background: var(--accent-tint); color: var(--accent); font-weight: 800; font-size: var(--fs-xs); }
  .howto small { color: var(--text-muted); }
  code { padding: 1px 5px; border-radius: 4px; background: var(--surface-3); color: var(--accent-soft); font-size: 0.92em; }
  .open { height: 42px; }
  .link { margin: 10px 0 0; font-size: var(--fs-xs); color: var(--text-muted); display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .copy { border: 1px solid var(--border-strong); background: none; color: var(--text-dim); border-radius: var(--radius-sm); padding: 2px 8px; font-size: var(--fs-xs); }
  .copy:hover { color: var(--accent-soft); border-color: var(--accent-line); }
  .field { display: flex; gap: 8px; padding: 4px 4px 4px 12px; border-radius: var(--radius); background: var(--bg); border: 1px solid var(--border-strong); transition: border-color 0.15s, box-shadow 0.15s; }
  .field:focus-within { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-tint); }
  .field.bad { border-color: color-mix(in srgb, var(--danger-line) 60%, transparent); }
  .field input { flex: 1; min-width: 0; height: 34px; border: 0; outline: 0; background: none; color: var(--text); font-family: ui-monospace, Consolas, monospace; font-size: var(--fs-sm); }
  .error { display: flex; gap: 8px; align-items: flex-start; margin: 10px 0 0; padding: 10px 12px; border-radius: var(--radius); background: var(--danger-tint); color: var(--danger); font-size: var(--fs-sm); }
  .error :global(svg) { flex-shrink: 0; margin-top: 2px; }
  .nav { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 20px; }
  .nav.end { justify-content: flex-end; }
  .nav .btn.primary { min-width: 150px; height: 40px; }
  .skip { color: var(--text-muted); }
  .services { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
  .service { display: grid; grid-template-columns: 1fr auto; grid-template-areas: 'title arrow' 'hint arrow'; align-items: center; gap: 2px 12px; padding: 14px 16px; border-radius: var(--radius); border: 1px solid var(--border-strong); background: var(--surface-2); text-align: left; transition: border-color 0.15s var(--ease), background 0.15s var(--ease); }
  .service:hover, .service.on { border-color: var(--accent-line); background: var(--accent-tint); }
  .service > b { grid-area: title; font-size: var(--fs-md); color: var(--text); }
  .service small { grid-area: hint; font-size: var(--fs-sm); color: var(--text-dim); }
  .service :global(svg) { grid-area: arrow; color: var(--text-muted); }
  .inline { border: 0; background: none; padding: 0; color: var(--accent-soft); text-decoration: underline; font-size: inherit; }
  .switch { margin-top: 8px; align-self: flex-start; }
  .spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(0, 0, 0, 0.25); border-top-color: var(--on-accent); animation: spin 0.8s linear infinite; }
  .compact h2 { font-size: var(--fs-lg); }
  .compact .nav { flex-wrap: wrap; }
  .compact .nav .btn.primary { min-width: 0; flex: 1; }
</style>
