<script lang="ts">
  import Icon from './Icon.svelte';
  import { app } from '../state.svelte';
  import { learn, LearnError, type FullNote, type LogEntry, type Member, type QueueItem } from '../learn.svelte';
  import { releases, cmpVersion, CHANNEL_REPO } from '../releases.svelte';

  type Tab = 'queue' | 'notes' | 'rel' | 'team' | 'log';
  let tab = $state<Tab>('queue');
  const tabs = $derived<[Tab, string][]>(learn.isDev
    ? [['queue', 'Проверка'], ['notes', 'Принятые'], ['rel', 'Выпуски'], ['team', 'Команда'], ['log', 'Журнал']]
    : [['queue', 'Проверка'], ['notes', 'Принятые'], ['rel', 'Выпуски']]);

  let items = $state<QueueItem[] | null>(null);
  let notes = $state<FullNote[] | null>(null);
  let members = $state<Member[] | null>(null);
  let journal = $state<{ entries: LogEntry[]; stats: { submits: number; accepted: number; badToday: number } } | null>(null);
  let error = $state('');
  let busy = $state(false);

  const why = (e: unknown) => {
    if (e instanceof LearnError) {
      if (e.code === 'network') return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
      if (e.status === 401) return 'Вход закрыт. Войдите снова: 7 нажатий на номер версии в настройках.';
      if (e.code === 'exists') return 'Человек с таким именем уже есть.';
      if (e.code === 'gone') return 'Этого уже нет — его обработал кто-то другой. Список обновлён.';
      if (e.code === 'full') return 'Разъяснений слишком много (500). Удалите устаревшие.';
    }
    return 'Сервер не ответил. Попробуйте ещё раз.';
  };

  async function load(which: Tab = tab) {
    error = '';
    try {
      if (which === 'queue') { items = await learn.queue(); learn.pending = items.length; }
      else if (which === 'notes') notes = (await learn.allNotes()).slice().reverse();
      else if (which === 'team') members = (await learn.team()).users;
      else if (which === 'rel') await releases.load();
      else journal = await learn.journal(7);
    } catch (e) { error = why(e); }
  }
  $effect(() => { void tab; void load(tab); });
  // Admin не видит вкладки Dev: если роль сменилась — на «Проверку»
  $effect(() => { if (!learn.isDev && (tab === 'team' || tab === 'log')) tab = 'queue'; });

  async function act(fn: () => Promise<unknown>, reload: Tab[] = [tab]) {
    if (busy) return;
    busy = true; error = '';
    try { await fn(); } catch (e) { error = why(e); }
    busy = false;
    for (const t of reload) void load(t);
  }

  // ── Проверка ──
  type QFilter = 'all' | 'ok' | 'no' | 'laws' | 'project';
  let qf = $state<QFilter>('all');
  const shown = $derived((items ?? []).filter((x) => qf === 'all' || (qf === 'ok' ? x.verdict.ok : qf === 'no' ? !x.verdict.ok : x.scope === qf)));
  let editing = $state<string | null>(null);
  let editText = $state('');
  let editWords = $state('');
  let opened = $state<Set<string>>(new Set());
  function startEdit(id: string, text: string, words: string[]) { editing = id; editText = text; editWords = words.join(', '); }
  const accept = (x: QueueItem) => act(() => learn.decide(x.id, 'accept', editing === x.id ? { text: editText, keywords: editWords } : undefined).then(() => { editing = null; }), ['queue']);
  const reject = (x: QueueItem) => act(() => learn.decide(x.id, 'reject'), ['queue']);

  // ── Принятые ──
  let search = $state('');
  type NFilter = 'all' | 'laws' | 'project';
  let nf = $state<NFilter>('all');
  const shownNotes = $derived((notes ?? []).filter((n) => (nf === 'all' || n.scope === nf)
    && (!search.trim() || `${n.text} ${n.keywords.join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()))));
  let source = $state<string | null>(null);
  const saveNote = (n: FullNote) => act(() => learn.editNote(n.id, { text: editText, keywords: editWords }).then(() => { editing = null; }), ['notes']);

  // Удаление и блокировка — со вторым нажатием
  let confirming = $state<string | null>(null);
  function twice(key: string, fn: () => void) {
    if (confirming === key) { confirming = null; fn(); } else confirming = key;
  }

  // ── Команда ──
  let newName = $state('');
  let creating = $state(false);
  let issued = $state<{ name: string; code: string } | null>(null);
  let copied = $state(false);
  function createAdmin() {
    const name = newName.trim();
    if (!name) return;
    void act(async () => {
      const r = await learn.teamAction({ action: 'create', name });
      issued = { name, code: r.code! }; newName = ''; creating = false; copied = false;
    }, ['team']);
  }
  function newCode(m: Member) {
    void act(async () => {
      const r = await learn.teamAction({ action: 'newcode', id: m.id });
      issued = { name: m.name, code: r.code! }; copied = false;
    }, ['team']);
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); copied = true; } catch { copied = false; }
  }

  // ── Журнал ──
  type LFilter = 'all' | 'login' | 'notes' | 'team' | `who:${string}`;
  let lf = $state<LFilter>('all');
  const people = $derived([...new Set((journal?.entries ?? []).filter((e) => e.uid).map((e) => e.uid!))]);
  const nameOf = (uid: string) => (journal?.entries.find((e) => e.uid === uid)?.who ?? uid);
  const shownLog = $derived((journal?.entries ?? []).filter((e) => lf === 'all'
    || (lf === 'login' ? ['login', 'bad', 'locked'].includes(e.kind) : lf === 'notes' ? ['note', 'submit'].includes(e.kind) : lf === 'team' ? e.kind === 'team' : e.uid === lf.slice(4))));

  const who = (uid: string | undefined, name: string) => (uid && uid === learn.me?.id ? 'Вы' : name);
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  function when(at: string | null | undefined, withTime = true) {
    if (!at) return '—';
    const d = new Date(at);
    const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const diff = Math.round((now.getTime() - day.getTime()) / 864e5);
    const date = diff === 0 ? 'Сегодня' : diff === 1 ? 'Вчера' : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
    return withTime ? `${date} ${t}` : date;
  }
  // ── Выпуски ──
  const pend = $derived(releases.pending);
  const mineOk = $derived(!!pend && !!app.version && cmpVersion(app.version, pend.version) >= 0);
  const liveInfo = $derived(releases.channel?.public && releases.channel.public.version === releases.live ? releases.channel.public : null);
  let mand = $state(false);
  let confirmPub = $state(false);
  let keyInput = $state('');
  let keyHelp = $state(false);
  async function publishNow() {
    if (!pend || busy) return;
    busy = true; error = '';
    try {
      await releases.publish(pend.version, mand, learn.me?.name ?? 'Команда');
      app.notify(`Версия ${pend.version} открыта игрокам${mand ? ' — обязательное обновление' : ''}`, 'ok');
      confirmPub = false; mand = false;
      await releases.load();
    } catch (e) {
      const m = String((e as Error).message);
      error = m === 'badkey' ? 'Ключ публикации не подходит или истёк. Вставьте новый ниже.' : m === 'conflict' ? 'Кто-то из команды опубликовал одновременно с вами. Список обновлён — проверьте и нажмите ещё раз.' : 'Не получилось опубликовать: ' + m;
      if (m === 'badkey') releases.setKey('');
    }
    busy = false;
  }
  const relStatus = (v: string, test: boolean, at: string) => {
    const h = releases.channel?.history.find((x) => x.version === v);
    if (h) return `${when(h.at)} · опубликовал(а) ${h.by === learn.me?.name ? 'вы' : h.by}${h.mandatory ? ' · обязательное' : ''}`;
    if (!test) return `${when(at)} · обычный выпуск — сразу всем`;
    return `${when(at, false)} · не публиковалась — вошла в следующую`;
  };

  const scopeName = (s: string) => (s === 'project' ? 'правила проекта' : 'законы штата');
  const toggleOpen = (id: string) => { const s = new Set(opened); if (s.has(id)) s.delete(id); else s.add(id); opened = s; };
</script>

<div class="admin">
  <header class="ph">
    <h1>Управление</h1>
    <span class="role" class:dev={learn.isDev}>{learn.isDev ? 'Dev' : 'Admin'}</span>
    <span class="who"><b>{learn.isDev ? 'Вы' : learn.me?.name}</b>
      <button class="btn sm" onclick={async () => { await learn.logout(); app.view = { kind: 'settings' }; app.notify('Вы вышли из «Управления»', 'ok'); }}>Выйти</button>
    </span>
  </header>

  {#if learn.isDev}
    <label class="toggle">
      <input type="checkbox" checked={learn.learning} disabled={busy} onchange={(e) => act(() => learn.toggle(e.currentTarget.checked), [])} />
      <span><b>Принимать доводы игроков</b><small>Действует сразу для всех. Выключено — игроки ничего не отправляют, принятые разъяснения продолжают работать.</small></span>
    </label>
  {:else if !learn.learning}
    <p class="info">Приём доводов сейчас выключен разработчиком. Новых доводов не будет, пока его не включат.</p>
  {/if}

  <div class="tabs" role="tablist">
    {#each tabs as [id, label] (id)}
      <button role="tab" class="tab" class:on={tab === id} aria-selected={tab === id} onclick={() => { tab = id; editing = null; confirming = null; }}>
        {label}{#if id === 'queue' && items}<b>{items.length}</b>{:else if id === 'notes' && notes}<b>{notes.length}</b>{/if}
      </button>
    {/each}
    <button class="tab refresh" title="Обновить" aria-label="Обновить" onclick={() => load()}><Icon name="refresh" size={15} /></button>
  </div>

  {#if error}<p class="err"><Icon name="alert" size={15} />{error}</p>{/if}

  {#if tab === 'queue'}
    {#if items === null}<p class="empty">Загружаю…</p>
    {:else if !items.length}<p class="empty">Новых доводов нет. Они появятся, когда игрок поспорит с помощником.</p>
    {:else}
      <div class="filters">
        {#each [['all', `Все ${items.length}`], ['ok', `Подтверждаются ${items.filter((x) => x.verdict.ok).length}`], ['no', `Не подтверждаются ${items.filter((x) => !x.verdict.ok).length}`], ['laws', 'Законы'], ['project', 'Правила проекта']] as [id, label] (id)}
          <button class="chip" class:on={qf === id} onclick={() => (qf = id as QFilter)}>{label}</button>
        {/each}
      </div>
      {#each shown as x (x.id)}
        <article class="card" class:dim={!x.verdict.ok && !opened.has(x.id)}>
          <dl><dt>Вопрос игрока · {scopeName(x.scope)} · {when(x.at)}</dt><dd>{x.q}</dd></dl>
          {#if x.verdict.ok || opened.has(x.id)}
            <dl><dt>Ответ помощника до спора</dt><dd class="clip">{x.before}</dd></dl>
            <dl><dt>Довод игрока</dt><dd>{x.arg}</dd></dl>
            <dl><dt>Ответ помощника в споре</dt><dd class="clip">{x.answer}</dd></dl>
          {/if}
          <dl><dt>Мнение нейросети игрока</dt>
            <dd class:ok={x.verdict.ok} class:no={!x.verdict.ok}>{x.verdict.ok ? 'Подтверждается' : 'Не подтверждается'}{x.verdict.refs ? `: ${x.verdict.refs}` : ''}</dd>
            {#if x.verdict.reason}<dd class="small">{x.verdict.reason}</dd>{/if}
          </dl>
          {#if x.verdict.ok || opened.has(x.id)}
            <dl class="last"><dt>Разъяснение для помощника</dt>
              {#if editing === x.id}
                <textarea bind:value={editText} rows="4"></textarea>
                <label class="words">Слова для поиска, через запятую<input bind:value={editWords} /></label>
              {:else}
                <dd class="exp">{x.note.text}</dd>
                {#if x.note.keywords.length}<dd class="small">Слова для поиска: {x.note.keywords.join(', ')}</dd>{/if}
              {/if}
            </dl>
            <p class="small warn">Нейросеть могла ошибиться. Прежде чем принять, откройте статьи и проверьте сами.</p>
            <div class="btns">
              <button class="btn primary" disabled={busy} onclick={() => accept(x)}>Принять</button>
              {#if editing === x.id}<button class="btn" onclick={() => (editing = null)}>Отменить правку</button>
              {:else}<button class="btn" onclick={() => startEdit(x.id, x.note.text, x.note.keywords)}>Изменить текст</button>{/if}
              <button class="btn ghost danger" disabled={busy} onclick={() => reject(x)}>Отклонить</button>
            </div>
          {:else}
            <div class="btns">
              <button class="btn sm" onclick={() => toggleOpen(x.id)}>Открыть</button>
              <button class="btn sm ghost danger" disabled={busy} onclick={() => reject(x)}>Отклонить</button>
            </div>
          {/if}
        </article>
      {/each}
    {/if}

  {:else if tab === 'notes'}
    {#if notes === null}<p class="empty">Загружаю…</p>
    {:else}
      <div class="filters">
        <input class="search" placeholder="Поиск по разъяснениям" bind:value={search} />
        {#each [['all', `Все ${notes.length}`], ['laws', `Законы ${notes.filter((n) => n.scope === 'laws').length}`], ['project', `Правила ${notes.filter((n) => n.scope === 'project').length}`]] as [id, label] (id)}
          <button class="chip" class:on={nf === id} onclick={() => (nf = id as NFilter)}>{label}</button>
        {/each}
      </div>
      {#if !shownNotes.length}<p class="empty">{notes.length ? 'Ничего не нашлось.' : 'Пока ни одного разъяснения.'}</p>{/if}
      {#each shownNotes as n (n.id)}
        <article class="note">
          <div class="top"><span class="num">Разъяснение</span><span class="meta">{scopeName(n.scope)} · {n.by === learn.me?.id ? 'приняли вы' : `принял(а) ${n.byName ?? '—'}`} {when(n.at, false).toLowerCase()}{n.edited ? ' · изменено' : ''}</span></div>
          {#if editing === n.id}
            <textarea bind:value={editText} rows="4"></textarea>
            <label class="words">Слова для поиска, через запятую<input bind:value={editWords} /></label>
            <div class="btns"><button class="btn sm primary" disabled={busy} onclick={() => saveNote(n)}>Сохранить</button><button class="btn sm" onclick={() => (editing = null)}>Отмена</button></div>
          {:else}
            <p>{n.text}</p>
            {#if n.keywords.length}<p class="small">Слова для поиска: {n.keywords.join(', ')}</p>{/if}
            {#if source === n.id && n.from}
              <div class="from">
                <dl><dt>Вопрос игрока</dt><dd>{n.from.q}</dd></dl>
                <dl><dt>Довод игрока</dt><dd>{n.from.arg}</dd></dl>
                <dl class="last"><dt>Ответ помощника в споре</dt><dd>{n.from.answer}</dd></dl>
              </div>
            {/if}
            <div class="btns">
              <button class="btn sm" onclick={() => startEdit(n.id, n.text, n.keywords)}>Изменить</button>
              {#if n.from}<button class="btn sm" onclick={() => (source = source === n.id ? null : n.id)}>{source === n.id ? 'Скрыть спор' : 'Исходный спор'}</button>{/if}
              <button class="btn sm ghost danger" disabled={busy} onclick={() => twice(`del:${n.id}`, () => act(() => learn.editNote(n.id, { delete: true }), ['notes']))}>{confirming === `del:${n.id}` ? 'Точно удалить?' : 'Удалить'}</button>
            </div>
          {/if}
        </article>
      {/each}
    {/if}

  {:else if tab === 'rel'}
    {#if releases.error}<p class="err"><Icon name="alert" size={15} />{releases.error}</p>{/if}
    {#if releases.builds === null}{#if !releases.error}<p class="empty">Загружаю…</p>{/if}
    {:else}
      <div class="live">
        <span class="ldot" aria-hidden="true"></span>
        <span class="lt">У игроков сейчас <b>{releases.live || '—'}</b></span>
        <span class="lm">{liveInfo ? `опубликовал(а) ${liveInfo.by === learn.me?.name ? 'вы' : liveInfo.by} · ${when(liveInfo.at).toLowerCase()}` : 'обычный выпуск'}</span>
      </div>

      {#if pend}
        <section class="rel">
          <div class="rtop">
            <span class="badge">Ждёт публикации</span>
            <b>Версия {pend.version}</b>
            <span class="meta">собрана {when(pend.at).toLowerCase()}</span>
          </div>
          {#if pend.notes}<p class="rnotes">{pend.notes}</p>{/if}
          <div class="mine" class:ok={mineOk}>
            {#if mineOk}
              <Icon name="check" size={15} /><span>У вас стоит {app.version} — можно проверять.</span>
            {:else}
              <span>У вас {app.version || 'старая версия'}. Сначала обновитесь сами и проверьте, что всё работает.</span>
              <button class="btn sm" onclick={() => app.checkTestUpdate()}><Icon name="download" size={14} />Обновить у себя</button>
            {/if}
          </div>
          {#if releases.key}
            <label class="toggle mand">
              <input type="checkbox" bind:checked={mand} />
              <span><b>Обязательное обновление</b><small>У игроков обновится само, без кнопки «Позже». Только для важных исправлений.</small></span>
            </label>
            {#if confirmPub}
              <div class="confirm">
                <p>Игроки увидят окно «Обновить» в течение получаса{mand ? ', а программа обновится сама' : ''}. Опубликовать {pend.version} для всех?</p>
                <div class="btns">
                  <button class="btn primary" disabled={busy} onclick={publishNow}>{busy ? 'Публикую…' : 'Да, опубликовать'}</button>
                  <button class="btn" disabled={busy} onclick={() => (confirmPub = false)}>Отмена</button>
                </div>
              </div>
            {:else}
              <button class="btn primary pub" onclick={() => (confirmPub = true)}><Icon name="upload" size={16} />Опубликовать для всех</button>
            {/if}
          {:else}
            <div class="keybox">
              <b>Чтобы публиковать, нужен ключ публикации</b>
              <small>Его создаёт Dev один раз и передаёт команде. Ключ умеет менять только номер версии для игроков — больше ничего.</small>
              <div class="krow">
                <input type="password" placeholder="github_pat_…" bind:value={keyInput} aria-label="Ключ публикации" />
                <button class="btn" disabled={!keyInput.trim()} onclick={() => { releases.setKey(keyInput); keyInput = ''; }}>Сохранить</button>
              </div>
              <button class="link" onclick={() => (keyHelp = !keyHelp)}>{keyHelp ? 'Скрыть' : 'Где взять ключ?'}</button>
              {#if keyHelp}
                <ol class="howto">
                  <li>GitHub → ваш аватар → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token.</li>
                  <li>Repository access: <b>Only select repositories</b> → <b>{CHANNEL_REPO}</b>.</li>
                  <li>Permissions → Repository permissions → <b>Contents: Read and write</b>. Остальное не трогать.</li>
                  <li>Generate token → скопировать ключ и вставить сюда.</li>
                </ol>
              {/if}
            </div>
          {/if}
        </section>
      {:else}
        <p class="empty">Новых версий нет — у игроков самая свежая. Как только я соберу новую, она появится здесь, а у команды — окно «Обновить».</p>
      {/if}

      <h2 class="rh">Раньше</h2>
      <div class="rlist">
        {#each (releases.builds ?? []).filter((b) => b.version !== pend?.version).sort((a, b) => cmpVersion(b.version, a.version)).slice(0, 8) as b (b.version)}
          <div class="rrow">
            <b>{b.version}</b>
            {#if b.version === releases.live}<span class="chip on">у игроков</span>{/if}
            <span class="rs">{relStatus(b.version, b.test, b.at)}</span>
          </div>
        {/each}
      </div>
      {#if releases.key}
        <p class="keyline">Ключ публикации сохранён на этом компьютере. <button class="link" onclick={() => releases.setKey('')}>Удалить</button></p>
      {/if}
    {/if}
  {:else if tab === 'team' && learn.isDev}
    {#if issued}
      <div class="issued">
        <p>Код для «{issued.name}» — показывается один раз. Сохраните и передайте лично:</p>
        <div class="coderow"><code class="selectable">{issued.code}</code><button class="btn sm" onclick={() => copy(issued!.code)}><Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? 'Скопировано' : 'Скопировать'}</button></div>
        <p class="small">На сервере хранится только его отпечаток. Потеряли — выдайте новый, старый перестанет работать.</p>
        <button class="btn sm" onclick={() => (issued = null)}>Я сохранил код</button>
      </div>
    {/if}
    {#if members === null}<p class="empty">Загружаю…</p>
    {:else}
      {#each members.slice().sort((a, b) => (a.role === 'dev' ? -1 : b.role === 'dev' ? 1 : a.created < b.created ? -1 : 1)) as m (m.id)}
        <article class="acct" class:blk={m.blocked}>
          <div class="top">
            <b>{m.role === 'dev' ? 'Вы' : m.name}</b>
            <span class="role" class:dev={m.role === 'dev'} class:off={m.blocked}>{m.blocked ? 'Заблокирован' : m.role === 'dev' ? 'Dev' : 'Admin'}</span>
          </div>
          <p class="small">
            {#if m.blocked}Заблокирован {when(m.blockedAt, false).toLowerCase()}
            {:else}{m.lastLogin ? `Последний вход: ${when(m.lastLogin).toLowerCase()}` : 'Ещё не входил'}{m.role === 'dev' ? ' · единственный Dev, удалить или заблокировать нельзя' : ` · принято ${m.stats.accepted}, отклонено ${m.stats.rejected}`}{/if}
          </p>
          {#if m.sessions.length && !m.blocked}
            <div class="sess">
              {#each m.sessions as s (s.id)}
                <div><span>{s.label}, вход {when(s.created, false).toLowerCase()}{#if s.isNew && Date.now() - Date.parse(s.created) < 7 * 864e5}<em>новый</em>{/if}</span>
                  <button class="link" disabled={busy} onclick={() => act(() => learn.teamAction({ action: 'end', id: m.id, session: s.id }), m.role === 'dev' ? [] : ['team'])}>Завершить</button></div>
              {/each}
            </div>
          {/if}
          {#if m.role !== 'dev'}
            <div class="btns">
              {#if m.blocked}
                <button class="btn sm" disabled={busy} onclick={() => act(() => learn.teamAction({ action: 'unblock', id: m.id }), ['team'])}>Разблокировать</button>
              {:else}
                <button class="btn sm" disabled={busy} onclick={() => twice(`code:${m.id}`, () => newCode(m))}>{confirming === `code:${m.id}` ? 'Старый код перестанет работать. Выдать?' : 'Новый код'}</button>
                <button class="btn sm" onclick={() => { tab = 'log'; lf = `who:${m.id}`; }}>Действия в журнале</button>
                {#if m.sessions.length}<button class="btn sm" disabled={busy} onclick={() => act(() => learn.teamAction({ action: 'end', id: m.id }), ['team'])}>Завершить все входы</button>{/if}
                <button class="btn sm danger" disabled={busy} onclick={() => twice(`block:${m.id}`, () => act(() => learn.teamAction({ action: 'block', id: m.id }), ['team']))}>{confirming === `block:${m.id}` ? 'Точно заблокировать?' : 'Заблокировать'}</button>
              {/if}
              <button class="btn sm ghost danger" disabled={busy} onclick={() => twice(`delete:${m.id}`, () => act(() => learn.teamAction({ action: 'delete', id: m.id }), ['team']))}>{confirming === `delete:${m.id}` ? 'Точно удалить?' : 'Удалить'}</button>
            </div>
          {/if}
        </article>
      {/each}
      {#if creating}
        <article class="card">
          <h2>Новый админ</h2>
          <label class="words">Имя в журнале<input bind:value={newName} maxlength="40" placeholder="Например, Помощница" onkeydown={(e) => { if (e.key === 'Enter') createAdmin(); }} /></label>
          <p class="small">Программа сама создаст надёжный код. Он покажется один раз.</p>
          <div class="btns"><button class="btn primary" disabled={busy || !newName.trim()} onclick={createAdmin}>Создать</button><button class="btn" onclick={() => (creating = false)}>Отмена</button></div>
        </article>
      {:else}
        <div class="btns"><button class="btn primary" onclick={() => { creating = true; issued = null; }}>Новый админ</button></div>
      {/if}
    {/if}

  {:else if tab === 'log' && learn.isDev}
    {#if journal === null}<p class="empty">Загружаю…</p>
    {:else}
      <div class="stats">
        <div><b>{journal.stats.submits}</b><span>доводов за неделю</span></div>
        <div><b>{journal.stats.accepted}</b><span>принято за неделю</span></div>
        <div><b class:bad={journal.stats.badToday > 0}>{journal.stats.badToday}</b><span>неверных входов сегодня</span></div>
      </div>
      <div class="filters">
        {#each [['all', 'Все'], ['login', 'Входы'], ['notes', 'Разъяснения'], ['team', 'Команда']] as [id, label] (id)}
          <button class="chip" class:on={lf === id} onclick={() => (lf = id as LFilter)}>{label}</button>
        {/each}
        {#each people as uid (uid)}
          <button class="chip" class:on={lf === `who:${uid}`} onclick={() => (lf = `who:${uid}`)}>{who(uid, nameOf(uid))}</button>
        {/each}
      </div>
      {#if !shownLog.length}<p class="empty">Записей нет.</p>{/if}
      <div class="log">
        {#each shownLog as e, i (i)}
          <div class="row"><span class="t">{when(e.at)}</span><span class="w">{who(e.uid, e.who)}</span><span class="d" class:bad={e.kind === 'bad' || e.kind === 'locked'}>{e.text}</span></div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .admin { max-width: 760px; padding: 22px 24px 64px; }
  .ph { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  h1 { margin: 0; font-size: var(--fs-2xl); font-weight: 800; letter-spacing: -0.01em; }
  h2 { margin: 0 0 10px; font-size: var(--fs-md); font-weight: 800; }
  .who { margin-left: auto; display: flex; align-items: center; gap: 10px; font-size: var(--fs-xs); color: var(--text-muted); }
  .who b { color: var(--text-dim); }
  .role { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 5px; font-size: 11px; font-weight: 800; background: var(--info-tint); color: var(--info); }
  .role.dev { background: var(--accent); color: var(--on-accent); }
  .role.off { background: var(--surface-3); color: var(--text-muted); }

  .toggle { display: flex; gap: 12px; align-items: flex-start; padding: 14px 16px; margin-bottom: 4px; border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--border); cursor: pointer; }
  .toggle b { display: block; font-size: var(--fs-sm); }
  .toggle small { display: block; margin-top: 2px; font-size: var(--fs-xs); color: var(--text-muted); line-height: 1.45; }
  .toggle input { appearance: none; flex-shrink: 0; width: 36px; height: 20px; margin: 1px 0 0; border-radius: 999px; background: var(--surface-3); position: relative; cursor: pointer; transition: background 0.15s; }
  .toggle input::after { content: ''; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--text-dim); transition: transform 0.2s var(--ease), background 0.15s; }
  .toggle input:checked { background: var(--accent); }
  .toggle input:checked::after { transform: translateX(16px); background: var(--on-accent); }
  .info { margin: 0 0 4px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--accent-tint); color: var(--accent-soft); font-size: var(--fs-xs); }

  .tabs { display: flex; gap: 4px; margin: 14px 0 14px; border-bottom: 1px solid var(--border); }
  .tab { position: relative; padding: 9px 12px; border: 0; background: none; font-size: 13.5px; font-weight: 700; color: var(--text-muted); }
  .tab b { margin-left: 5px; font-weight: 800; }
  .tab.on { color: var(--text); }
  .tab.on::after { content: ''; position: absolute; left: 8px; right: 8px; bottom: -1px; height: 2px; border-radius: 2px; background: var(--accent); }
  .tab:hover { color: var(--text); }
  .tab.refresh { margin-left: auto; display: grid; place-items: center; }

  .filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .chip { height: 28px; padding: 0 11px; border-radius: 99px; background: var(--surface-2); border: 1px solid var(--border); font-size: 12px; font-weight: 700; color: var(--text-dim); }
  .chip.on { background: var(--accent-tint); border-color: var(--accent-line); color: var(--accent-soft); }
  .search { flex: 1; min-width: 180px; height: 30px; padding: 0 10px; border-radius: var(--radius-sm); background: var(--bg); border: 1px solid var(--border-strong); color: var(--text); font: inherit; font-size: 12.5px; }
  .search:focus { outline: 0; border-color: var(--accent-line); }

  .empty { color: var(--text-muted); font-size: var(--fs-sm); margin: 18px 2px; }
  .err { display: flex; gap: 8px; align-items: flex-start; margin: 0 0 12px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--danger-tint); color: var(--danger); font-size: var(--fs-xs); }
  .err :global(svg) { flex-shrink: 0; margin-top: 1px; }

  .card, .note, .acct { padding: 14px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); margin-bottom: 8px; }
  .card.dim { opacity: 0.6; }
  dl { margin: 0 0 10px; }
  dl.last { margin: 0; }
  dt { font-size: 11.5px; font-weight: 800; color: var(--text-muted); margin-bottom: 2px; }
  dd { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-dim); white-space: pre-wrap; overflow-wrap: anywhere; }
  dd.clip { display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  dd.ok { color: var(--success); font-weight: 700; }
  dd.no { color: var(--danger); font-weight: 700; }
  dd.exp { padding: 10px 12px; border-radius: var(--radius-sm); background: var(--bg); border: 1px solid var(--border-strong); color: var(--text); }
  .small { margin: 4px 0 0; font-size: 12px; color: var(--text-muted); line-height: 1.45; }
  .warn { margin-top: 10px; }
  textarea, .words input { width: 100%; box-sizing: border-box; padding: 9px 11px; border-radius: var(--radius-sm); background: var(--bg); border: 1px solid var(--accent-line); color: var(--text); font: inherit; font-size: 13px; line-height: 1.5; resize: vertical; }
  .words { display: block; margin-top: 8px; font-size: 11.5px; font-weight: 800; color: var(--text-muted); }
  .words input { margin-top: 4px; height: 34px; border-color: var(--border-strong); }
  textarea:focus, .words input:focus { outline: 0; border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-tint); }
  .btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .btn.danger { color: var(--danger); }

  .note .top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .num { padding: 2px 6px; border-radius: 5px; background: var(--info-tint); color: var(--info); font-weight: 800; font-size: 11.5px; }
  .meta { font-size: 12px; color: var(--text-muted); }
  .note p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-dim); }
  .note p.small { margin-top: 6px; font-size: 12px; color: var(--text-muted); }
  .from { margin-top: 10px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); }

  .acct .top { display: flex; align-items: center; gap: 10px; }
  .acct .top b { font-size: 14px; }
  .acct .top .role { margin-left: auto; }
  .acct.blk { opacity: 0.6; }
  .sess { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-dim); }
  .sess div { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .sess em { margin-left: 6px; font-style: normal; color: var(--danger); font-weight: 700; }
  .link { border: 0; background: none; padding: 0; font: inherit; font-size: 12px; font-weight: 700; color: var(--text-muted); }
  .link:hover { color: var(--text); }
  .issued { margin-bottom: 12px; padding: 14px; border-radius: 12px; border: 1px dashed var(--accent-line); background: var(--accent-tint); color: var(--accent-soft); font-size: 12.5px; line-height: 1.5; }
  .issued p { margin: 0; }
  .issued .small { color: var(--accent-soft); opacity: 0.85; margin: 8px 0 10px; }
  .coderow { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .issued code { padding: 6px 10px; border-radius: 6px; background: var(--bg); color: var(--text); font-family: inherit; font-weight: 800; font-size: 14px; letter-spacing: 0.04em; }

  /* Выпуски */
  .live { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); margin-bottom: 10px; font-size: 13.5px; }
  .ldot { width: 9px; height: 9px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 4px rgba(111, 220, 154, 0.15); flex-shrink: 0; }
  .lt b { font-size: 15px; }
  .lm { margin-left: auto; font-size: 12px; color: var(--text-muted); text-align: right; }
  .rel { padding: 16px; border-radius: 14px; background: var(--surface); border: 1px solid var(--accent-line); margin-bottom: 18px; }
  .rtop { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .rtop b { font-size: 16px; }
  .badge { padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 800; background: var(--accent); color: var(--on-accent); }
  .rnotes { margin: 10px 0 0; font-size: 13px; line-height: 1.55; color: var(--text-dim); white-space: pre-wrap; }
  .mine { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: var(--surface-2); font-size: 12.5px; color: var(--text-dim); }
  .mine span { flex: 1; }
  .mine.ok { background: rgba(111, 220, 154, 0.1); color: var(--success); font-weight: 700; }
  .mand { margin: 12px 0 0; background: var(--bg); }
  .pub { width: 100%; justify-content: center; height: 46px; margin-top: 12px; font-size: 14px; }
  .confirm { margin-top: 12px; padding: 12px 14px; border-radius: 10px; background: var(--accent-tint); border: 1px solid var(--accent-line); }
  .confirm p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text); }
  .keybox { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; padding: 12px 14px; border-radius: 10px; border: 1px dashed var(--border-strong); }
  .keybox b { font-size: 13px; }
  .keybox small { font-size: 12px; color: var(--text-muted); line-height: 1.45; }
  .krow { display: flex; gap: 8px; margin-top: 4px; }
  .krow input { flex: 1; height: 34px; padding: 0 10px; border-radius: var(--radius-sm); background: var(--bg); border: 1px solid var(--border-strong); color: var(--text); font: inherit; font-size: 12.5px; }
  .krow input:focus { outline: 0; border-color: var(--accent-line); }
  .keybox .link { align-self: flex-start; }
  .howto { margin: 4px 0 0; padding-left: 18px; font-size: 12px; line-height: 1.6; color: var(--text-dim); }
  .rh { margin-top: 6px; }
  .rrow { display: flex; align-items: center; gap: 10px; padding: 9px 2px; border-bottom: 1px solid var(--border); font-size: 12.5px; }
  .rrow b { width: 52px; font-size: 13.5px; }
  .rrow .chip { height: 22px; display: inline-flex; align-items: center; }
  .rs { color: var(--text-muted); }
  .keyline { margin: 12px 2px 0; font-size: 12px; color: var(--text-muted); }

  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; }
  .stats div { padding: 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); }
  .stats b { display: block; font-size: 20px; font-weight: 800; }
  .stats b.bad { color: var(--danger); }
  .stats span { font-size: 12px; color: var(--text-muted); }
  .log .row { display: grid; grid-template-columns: 118px 92px 1fr; gap: 10px; padding: 8px 2px; border-bottom: 1px solid var(--border); font-size: 12.5px; align-items: baseline; }
  .log .t { color: var(--text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .log .w { font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .log .d { color: var(--text-dim); overflow-wrap: anywhere; }
  .log .d.bad { color: var(--danger); }
</style>
