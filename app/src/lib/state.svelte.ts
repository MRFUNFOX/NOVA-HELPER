import type { RuleDocument } from '@shared/types';
import { backend, checkAppUpdate, type AppUpdate, type CheckResult, type Db, type Settings } from './backend';
import { buildIndex, search, type Hit, type Index } from './search';
import type { IconName } from './components/Icon.svelte';
import { PUBLIC } from './features';

export type View =
  | { kind: 'home' }
  | { kind: 'doc'; docId: string; focus?: string }
  /** Раздел меню: карточки его документов */
  | { kind: 'category'; section: Section; category: string }
  | { kind: 'changes' }
  | { kind: 'settings' };

/** Короткие подписи разделов в левом меню (полное название — в заголовке документа) */
const CATEGORY_ORDER: [string, string, IconName][] = [
  ['Общие правила', 'Общие правила', 'book'],
  ['Общие правила мероприятий', 'Мероприятия', 'calendar'],
  ['Правила для криминальных организаций', 'Криминал', 'mask'],
  ['Правила для государственных структур', 'Госструктуры', 'building'],
  ['Правила неофициальных организаций', 'Семьи', 'users'],
  ['Правила проекта', 'Правила форума', 'chat'],
];

/** Два раздела программы: правила проекта и законы сервера */
export type Section = 'project' | 'laws';

/**
 * Законы на форуме лежат одной кучей — в меню раскладываем их по смыслу.
 * Порядок здесь — порядок в меню.
 */
const LAW_GROUPS: [string, IconName, RegExp][] = [
  ['Конституция', 'shield', /конституц/i],
  ['Кодексы', 'gavel', /кодекс/i],
  ['Госструктуры', 'building', /о\s+статусе|national guard|сенат|правительств|прокурор|госслужащ|юрисдикц/i],
  ['Законы', 'layers', /./],
];

export function lawGroup(title: string): string {
  return LAW_GROUPS.find(([, , re]) => re.test(title))![0];
}

export const sectionOf = (d: RuleDocument): Section => (d.scope === 'server' ? 'laws' : 'project');

export function categoryIcon(c: string): IconName {
  return CATEGORY_ORDER.find(([k]) => k === c)?.[2] ?? LAW_GROUPS.find(([k]) => k === c)?.[1] ?? 'book';
}

export function categoryLabel(c: string): string {
  if (LAW_GROUPS.some(([k]) => k === c)) return c;
  return CATEGORY_ORDER.find(([k]) => k === c)?.[1] ?? c.replace(/^Правила\s+(для\s+)?/i, '').replace(/^./, (x) => x.toUpperCase());
}

/** Раздел меню, в котором лежит документ */
export function docCategory(d: RuleDocument): string {
  return d.scope === 'server' ? lawGroup(d.title) : d.category;
}

/**
 * «Правила мероприятия "Cбора общих кладов"» → «Сбор общих кладов»,
 * «Уголовный Кодекс Штата San-Andreas» → «Уголовный кодекс»
 */
export function shortTitle(t: string): string {
  const s = t
    .replace(/\s*штата\s+San[\s-]*Andreas\b/gi, '')
    // «О ЗАКРЫТЫХ, ОХРАНЯЕМЫХ…» → «о закрытых, охраняемых…» (аббревиатуры латиницей не трогаем)
    .replace(/(?<!\p{L})[А-ЯЁ]{4,}(?!\p{L})/gu, (w) => w.toLowerCase())
    .replace(/(?<=\s)(О|И|В|ОБ)(?=\s+[а-яё])/gu, (m) => m.toLowerCase())
    .replace(/^Закон\s+штата\s+San[\s-]*Andreas\s+/i, 'Закон ')
    .replace(/^(Уголовный|Административный|Процессуальный|Дорожный|Гражданский|Трудовой|Этический)\s+Кодекс$/i, (_, a: string) => `${a} кодекс`)
    .replace(/^Закон\s+["«“„](.+?)["»”“]*$/i, '$1')
    .replace(/^(?:ВАЖНО\s*[-–]\s*)?/i, '')
    .replace(/^(?:Правила\s+(?:мероприяти[ея]|события|проведения)\s*[:–-]?\s*)/i, '')
    .replace(/^["«“„](.*?)["»”“]*$/, '$1')
    .replace(/C(?=[а-яё])/g, 'С') // латинская C в кириллическом слове встречается на форуме
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

class AppState {
  db = $state<Db>({ manifest: null, docs: [], changelogs: [] });
  index = $state.raw<Index>({ entries: [], byId: new Map() });
  settings = $state<Settings | null>(null);
  view = $state<View>({ kind: 'home' });
  query = $state('');
  sidebarOpen = $state(false);
  /** Меню свёрнуто до колонки иконок (запоминается между запусками) */
  sidebarCollapsed = $state(readFlag('sidebarCollapsed'));
  aiOpen = $state(false);
  /** Свёрнутые разделы документа: id узла → true */
  collapsed = $state<Record<string, boolean>>({});
  /** Фильтр пунктов в документе */
  filter = $state<'all' | 'punished' | 'severe'>('all');
  /** База ещё ни разу не загружалась в этом запуске — показываем скелет */
  loaded = $state(false);
  /** Какой раздел открыт в меню: правила проекта или законы сервера */
  section = $state<Section>('project');
  /** Последний открытый экран в каждом разделе — чтобы при переключении вернуться туда же */
  private lastView: Partial<Record<Section, View>> = {};
  version = $state('');

  /** Обновление базы правил */
  check = $state<CheckResult | null>(null);
  checking = $state(false);
  updating = $state(false);
  updateDialog = $state(false);
  updateError = $state('');
  lastChecked = $state<Date | null>(null);

  /** Обновление самой программы */
  appUpdate = $state.raw<AppUpdate | null>(null);
  appUpdateDialog = $state(false);
  appUpdateProgress = $state<number | null>(null);

  toast = $state<{ text: string; tone: 'ok' | 'error' } | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  /** Поиск — только в открытом разделе: в правилах или в законах */
  hits = $derived.by<Hit[]>(() => (this.query.trim() ? search(this.index, this.query, 60, (d) => sectionOf(d) === this.section) : []));
  /** Сколько нашлось бы в другом разделе — чтобы подсказать переключиться, если здесь пусто или мало */
  otherHits = $derived.by(() => {
    if (!this.query.trim() || !this.hasLaws) return 0;
    const other: Section = this.section === 'laws' ? 'project' : 'laws';
    return search(this.index, this.query, 60, (d) => sectionOf(d) === other).filter((h) => sectionOf(h.entry.doc) === other).length;
  });

  /** Есть ли в базе законы (у старой базы их нет — тогда переключатель разделов не нужен) */
  hasLaws = $derived(this.db.docs.some((d) => d.scope === 'server'));
  /** Название сервера для подписи раздела законов */
  serverName = $derived(this.db.manifest?.servers?.find((s) => !s.archived)?.name ?? 'сервера');

  categories = $derived.by(() => {
    const groups = new Map<string, RuleDocument[]>();
    for (const d of this.db.docs) {
      if (sectionOf(d) !== this.section) continue;
      const c = docCategory(d);
      const list = groups.get(c) ?? [];
      list.push(d);
      groups.set(c, list);
    }
    const order = (c: string) => {
      const i = CATEGORY_ORDER.findIndex(([k]) => k === c);
      const j = LAW_GROUPS.findIndex(([k]) => k === c);
      return i >= 0 ? i : j >= 0 ? j : 99;
    };
    // Внутри групп законов — по алфавиту короткого названия
    if (this.section === 'laws') for (const list of groups.values()) list.sort((a, b) => shortTitle(a.title).localeCompare(shortTitle(b.title), 'ru'));
    return [...groups.entries()]
      .sort((a, b) => order(a[0]) - order(b[0]))
      .map(([category, docs]) => ({ category, label: categoryLabel(category), icon: categoryIcon(category), docs }));
  });

  /** Сколько пунктов изменилось в последнем обновлении — бейдж «Что изменилось» */
  recentChanges = $derived(
    this.db.changelogs[0]?.documents.reduce((a, d) => a + (d.kind === 'modified' ? d.nodes.length : 1), 0) ?? 0,
  );

  get ready() { return this.db.docs.length > 0; }

  /** Режим разработчика включён кодом в настройках */
  get devMode() { return !!this.settings?.devMode; }
  /** ИИ-помощник виден: открыт для всех или включён режим разработчика */
  get aiEnabled() { return PUBLIC.ai || this.devMode; }

  async setDevMode(on: boolean) {
    if (!this.settings) return;
    this.settings = await backend.saveSettings({ ...this.settings, devMode: on });
    if (!on) this.aiOpen = false;
  }

  doc(id: string) { return this.db.docs.find((d) => d.id === id); }

  setDb(db: Db) {
    this.db = db;
    this.index = buildIndex(db.docs);
    this.loaded = true;
  }

  async start() {
    const [settings, db, version] = await Promise.all([backend.getSettings(), backend.loadDb(), backend.version()]);
    this.settings = settings;
    this.version = version;
    this.setDb(db);
    if (this.ready && this.view.kind === 'home') this.open(this.mainDocId());
    backend.on('overlay-shown', () => focusSearch());
    backend.on('check-updates', () => this.analyze(true));
    backend.on('settings-changed', (s) => { this.settings = s as Settings; });
    // Мастер первого запуска сам скачает базу; иначе — тихая проверка при старте
    if (settings.firstRunDone) {
      this.analyze(false);
      checkAppUpdate().then((u) => { if (u) { this.appUpdate = u; this.appUpdateDialog = true; } }).catch(() => {});
    }
    // Только для разработки в браузере: открыть нужный экран по адресу (?q=дм, ?view=changes, ?ai)
    if (import.meta.env.DEV) {
      const p = new URLSearchParams(location.search);
      if (p.get('q')) this.query = p.get('q')!;
      if (p.get('view') === 'changes' || p.get('view') === 'settings') this.view = { kind: p.get('view') as 'changes' };
      if (p.get('doc')) { const d = this.db.docs.find((x) => x.title.includes(p.get('doc')!)); if (d) this.open(d.id, this.index.entries.find((e) => e.doc.id === d.id && e.node.number === p.get('focus'))?.node.id); }
      if (p.has('laws')) this.setSection('laws');
      if (p.has('ai')) this.aiOpen = true;
      if (p.has('menu')) this.sidebarOpen = true;
    }
  }

  mainDocId(section: Section = 'project'): string {
    const docs = this.db.docs.filter((d) => sectionOf(d) === section);
    const main = section === 'laws'
      ? docs.find((d) => /уголовный\s+кодекс/i.test(d.title))
      : docs.find((d) => /общие правила проекта/i.test(d.title));
    return (main ?? docs[0] ?? this.db.docs[0])?.id ?? '';
  }

  /** Переключить раздел меню и открыть последний документ в нём */
  setSection(section: Section) {
    if (section === this.section && this.view.kind === 'doc') return;
    this.section = section;
    // Во время поиска только меняем, где искать, — результаты сразу пересчитаются
    if (this.query.trim()) return;
    const last = this.lastView[section];
    if (last?.kind === 'category' && this.categories.some((c) => c.category === last.category)) this.openCategory(last.category);
    else if (last?.kind === 'doc' && this.doc(last.docId)) this.open(last.docId);
    else this.open(this.mainDocId(section));
  }

  /** Открыть раздел меню: справа карточки его документов (если документ один — сразу его) */
  openCategory(category: string) {
    const group = this.categories.find((c) => c.category === category);
    if (!group) return;
    if (group.docs.length === 1) { this.open(group.docs[0]!.id); return; }
    this.view = { kind: 'category', section: this.section, category };
    this.lastView[this.section] = this.view;
    this.sidebarOpen = false;
  }

  /**
   * «Анализ правил»: сверить базу с сервером. `manual` — пользователь нажал кнопку сам:
   * тогда сообщаем и «всё актуально», и ошибки; при автопроверке молчим, если нового нет.
   */
  async analyze(manual: boolean) {
    if (this.checking) return;
    this.checking = true;
    this.updateError = '';
    try {
      this.check = await backend.checkDb();
      this.lastChecked = new Date();
      if (this.check.status === 'available' || this.check.status === 'firstInstall' || this.check.status === 'appTooOld') {
        this.updateDialog = true;
      } else if (manual) {
        this.notify('Правила актуальны — изменений на форуме нет', 'ok');
      }
    } catch (e) {
      if (manual) this.notify(String(e), 'error');
    } finally {
      this.checking = false;
    }
  }

  async applyUpdate() {
    this.updating = true;
    this.updateError = '';
    try {
      if (!this.check) this.check = await backend.checkDb();
      const db = await backend.updateDb();
      this.setDb(db);
      this.updateDialog = false;
      this.check = { ...this.check, status: 'upToDate' };
      if (this.view.kind === 'home' || (this.view.kind === 'doc' && !this.doc(this.view.docId))) {
        this.open(this.mainDocId(this.section));
      }
      this.notify('Правила обновлены', 'ok');
      return true;
    } catch (e) {
      this.updateError = String(e);
      return false;
    } finally {
      this.updating = false;
    }
  }

  async installAppUpdate() {
    if (!this.appUpdate) return;
    this.appUpdateProgress = 0;
    try {
      await this.appUpdate.install((p) => { this.appUpdateProgress = p; });
    } catch (e) {
      this.appUpdateProgress = null;
      this.notify(`Не удалось обновить программу: ${e}`, 'error');
    }
  }

  open(docId: string, focus?: string) {
    if (this.view.kind !== 'doc' || this.view.docId !== docId) this.filter = 'all';
    const d = this.doc(docId);
    if (d) { this.section = sectionOf(d); this.lastView[this.section] = { kind: 'doc', docId }; }
    if (focus) this.revealNode(docId, focus);
    this.view = { kind: 'doc', docId, focus };
    this.sidebarOpen = false;
  }

  /** Раскрыть свёрнутые разделы, внутри которых лежит пункт */
  revealNode(docId: string, nodeId: string) {
    const doc = this.doc(docId);
    if (!doc) return;
    const path: string[] = [];
    const find = (ns: typeof doc.children): boolean => ns.some((n) => {
      path.push(n.id);
      if (n.id === nodeId || find(n.children)) return true;
      path.pop();
      return false;
    });
    find(doc.children);
    for (const id of path) if (this.collapsed[id]) delete this.collapsed[id];
    // Пункт должен быть виден и при включённом фильтре
    this.filter = 'all';
  }

  /** Игрок увидел настройку ИИ-помощника (настроил или пропустил) — больше не показываем */
  async markAiSetupDone() {
    // Пока помощник скрыт, игрок настройку не видел — не отмечаем, иначе потом она ему не покажется
    if (!this.settings || this.settings.aiSetupDone || !this.aiEnabled) return;
    try { this.settings = await backend.saveSettings({ ...this.settings, aiSetupDone: true }); } catch { /* не страшно: покажем ещё раз */ }
  }

  /** Открыть ссылку (форум, поправка, картинка); не открылась — она уже в буфере обмена */
  async openLink(url: string) {
    if (!(await backend.openUrl(url))) this.notify('Браузер не открылся — ссылка скопирована, вставьте её в браузер (Ctrl+V)', 'error');
  }

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    writeFlag('sidebarCollapsed', this.sidebarCollapsed);
  }

  notify(text: string, tone: 'ok' | 'error' = 'ok') {
    this.toast = { text, tone };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), tone === 'error' ? 7000 : 3500);
  }
}

function readFlag(key: string): boolean {
  try { return localStorage.getItem(`nova.${key}`) === '1'; } catch { return false; }
}
function writeFlag(key: string, v: boolean) {
  try { localStorage.setItem(`nova.${key}`, v ? '1' : '0'); } catch { /* хранилище недоступно — не страшно */ }
}

export const app = new AppState();

export function focusSearch() {
  const el = document.getElementById('search') as HTMLInputElement | null;
  el?.focus();
  el?.select();
}

/** «2026-11-09T19:43:00Z» → «9 ноября, 22:43» (по времени компьютера игрока) */
export function formatDate(iso?: string | null, withTime = true): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return withTime ? `${date}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : date;
}

/** Версия базы «2026.11.09-1943» → ISO-время её выпуска */
export function versionDate(v?: string | null): string | undefined {
  const m = v && /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})(\d{2})$/.exec(v);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z` : undefined;
}
