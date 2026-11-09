import type { RuleDocument } from '@shared/types';
import { backend, checkAppUpdate, type AppUpdate, type CheckResult, type Db, type Settings } from './backend';
import { buildIndex, search, type Hit, type Index } from './search';

export type View =
  | { kind: 'home' }
  | { kind: 'doc'; docId: string; focus?: string }
  | { kind: 'changes' }
  | { kind: 'settings' };

/** Короткие подписи разделов в левом меню (полное название — в заголовке документа) */
const CATEGORY_ORDER: [string, string][] = [
  ['Общие правила', 'Общие правила'],
  ['Общие правила мероприятий', 'Мероприятия'],
  ['Правила для криминальных организаций', 'Криминальные организации'],
  ['Правила для государственных структур', 'Госструктуры'],
  ['Правила неофициальных организаций', 'Семьи и неофициальные'],
  ['Правила проекта', 'Правила форума'],
];

export function categoryLabel(c: string): string {
  return CATEGORY_ORDER.find(([k]) => k === c)?.[1] ?? c.replace(/^Правила\s+(для\s+)?/i, '').replace(/^./, (x) => x.toUpperCase());
}

/** «Правила мероприятия "Cбора общих кладов"» → «Сбор общих кладов» в меню */
export function shortTitle(t: string): string {
  const s = t
    .replace(/^(?:ВАЖНО\s*[-–]\s*)?/i, '')
    .replace(/^(?:Правила\s+(?:мероприяти[ея]|события|проведения)\s*[:–-]?\s*)/i, '')
    .replace(/^["«“„]|["»”“]$/g, '')
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
  aiOpen = $state(false);
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

  hits = $derived.by<Hit[]>(() => (this.query.trim() ? search(this.index, this.query) : []));

  categories = $derived.by(() => {
    const groups = new Map<string, RuleDocument[]>();
    for (const d of this.db.docs) {
      const list = groups.get(d.category) ?? [];
      list.push(d);
      groups.set(d.category, list);
    }
    const order = (c: string) => { const i = CATEGORY_ORDER.findIndex(([k]) => k === c); return i < 0 ? 99 : i; };
    return [...groups.entries()]
      .sort((a, b) => order(a[0]) - order(b[0]))
      .map(([category, docs]) => ({ category, label: categoryLabel(category), docs }));
  });

  /** Сколько пунктов изменилось в последнем обновлении — бейдж «Что изменилось» */
  recentChanges = $derived(
    this.db.changelogs[0]?.documents.filter((d) => d.docId.startsWith('project/')).reduce((a, d) => a + d.nodes.length, 0) ?? 0,
  );

  get ready() { return this.db.docs.length > 0; }

  doc(id: string) { return this.db.docs.find((d) => d.id === id); }

  setDb(db: Db) {
    this.db = db;
    this.index = buildIndex(db.docs);
  }

  async start() {
    const [settings, db, version] = await Promise.all([backend.getSettings(), backend.loadDb(), backend.version()]);
    this.settings = settings;
    this.version = version;
    this.setDb(db);
    if (this.ready && this.view.kind === 'home') this.view = { kind: 'doc', docId: this.mainDocId() };
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
      if (p.get('doc')) { const d = this.db.docs.find((x) => x.title.includes(p.get('doc')!)); if (d) this.view = { kind: 'doc', docId: d.id, focus: p.get('focus') ? `${d.id}#p${p.get('focus')}` : undefined }; }
      if (p.has('ai')) this.aiOpen = true;
      if (p.has('menu')) this.sidebarOpen = true;
    }
  }

  mainDocId(): string {
    const general = this.db.docs.find((d) => /общие правила проекта/i.test(d.title)) ?? this.db.docs[0];
    return general?.id ?? '';
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
        this.view = { kind: 'doc', docId: this.mainDocId() };
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
    this.view = { kind: 'doc', docId, focus };
    this.sidebarOpen = false;
  }

  notify(text: string, tone: 'ok' | 'error' = 'ok') {
    this.toast = { text, tone };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), tone === 'error' ? 7000 : 3500);
  }
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
