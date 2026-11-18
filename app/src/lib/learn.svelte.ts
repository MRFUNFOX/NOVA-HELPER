/**
 * Обучение ИИ-помощника.
 *
 * Для всех игроков: принятые разъяснения (проверенные толкования правил и законов) скачиваются
 * с нашего сервера и подкладываются нейросети вместе с пунктами. Если нейросеть в споре
 * согласилась или не согласилась с доводом игрока, довод уходит на проверку команде.
 *
 * Для команды (Dev и Admin): скрытый вход по личному коду и раздел «Управление».
 * Сервер — тот же Cloudflare Worker, что собирает цены скупщиков (адреса /learn/…).
 */
import { checkDevCode } from './features';

const DEFAULT_URL = 'https://nova-prices.mediaidea2003.workers.dev/learn';
/** В тестовой версии в браузере можно указать свой сервер: ?learn=http://localhost:8787/learn */
const URL_BASE = (() => {
  try { return new URLSearchParams(location.search).get('learn') || DEFAULT_URL; } catch { return DEFAULT_URL; }
})();
const REFRESH = 60 * 60e3; // разъяснения обновляем раз в час

export interface Note { id: string; scope: 'project' | 'laws'; text: string; keywords: string[] }
export interface FullNote extends Note {
  by?: string; byName?: string; at?: string; edited?: string;
  from?: { q: string; arg: string; before: string; answer: string; at: string };
}
export type Role = 'dev' | 'admin';
export interface Me { id: string; role: Role; name: string }
export interface QueueItem {
  id: string; at: string; scope: 'project' | 'laws'; q: string; before: string; arg: string; answer: string;
  verdict: { ok: boolean; refs: string; reason: string }; note: { text: string; keywords: string[] }; app: string;
}
export interface Member {
  id: string; role: Role; name: string; created: string; lastLogin: string | null; blocked: boolean; blockedAt: string | null;
  stats: { accepted: number; rejected: number };
  sessions: { id: string; label: string; created: string; seen: string; isNew: boolean }[];
}
export interface LogEntry { at: string; kind: string; uid?: string; who: string; text: string }

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* без памяти */ } },
};

/** Случайный номер этого компьютера — чтобы отличать «новый компьютер» при входе */
function deviceId() {
  let id = store.get('nh-device');
  if (!id) { id = crypto.randomUUID(); store.set('nh-device', id); }
  return id;
}

export class LearnError extends Error {
  constructor(public code: string, public status: number, public data: Record<string, unknown> = {}) { super(code); }
}

async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let r: Response;
  try {
    r = await fetch(`${URL_BASE}/${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, cache: 'no-store' });
  } catch { throw new LearnError('network', 0); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new LearnError(String(data.error ?? 'server'), r.status, data);
  return data as T;
}

class Learn {
  /** Принятые разъяснения — у всех игроков */
  notes = $state<Note[]>([]);
  /** Принимает ли команда доводы игроков сейчас */
  learning = $state(true);
  /** Кто вошёл в «Управление» (null — обычный игрок) */
  me = $state<Me | null>(null);
  /** Сколько доводов ждёт проверки — для значка в меню */
  pending = $state(0);
  private token: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  get staff() { return !!this.me; }
  get isDev() { return this.me?.role === 'dev'; }

  init() {
    try {
      const cached = JSON.parse(store.get('nh-notes') || 'null');
      if (cached?.notes) { this.notes = cached.notes; this.learning = cached.learning !== false; }
    } catch { /* нет кэша */ }
    this.token = store.get('nh-staff-token');
    try { this.me = JSON.parse(store.get('nh-staff-me') || 'null'); } catch { this.me = null; }
    void this.refresh();
    if (this.token) void this.checkSession();
    this.timer ??= setInterval(() => void this.refresh(), REFRESH);
  }

  async refresh() {
    try {
      const r = await api<{ learning: boolean; notes: Note[] }>('notes');
      this.notes = r.notes; this.learning = r.learning;
      store.set('nh-notes', JSON.stringify(r));
    } catch { /* без связи — работаем с сохранёнными */ }
  }

  /** Разъяснения к вопросу: совпадение слова-признака с началом слова в тексте */
  relevant(text: string, scope: 'project' | 'laws', limit = 3): Note[] {
    const words = text.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9.]+/i).filter(Boolean);
    const score = (n: Note) => n.keywords.reduce((s, k) => {
      const kw = k.toLowerCase().replace(/ё/g, 'е');
      const stem = kw.length > 5 ? kw.slice(0, kw.length - 2) : kw;
      return s + (kw.includes(' ') ? (text.toLowerCase().includes(kw) ? 2 : 0) : words.some((w) => w.startsWith(stem)) ? 1 : 0);
    }, 0);
    return this.notes.filter((n) => n.scope === scope).map((n) => ({ n, s: score(n) })).filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.n);
  }

  /** Отправить довод игрока на проверку. false — приём выключен или не получилось. */
  async submit(item: Omit<QueueItem, 'id' | 'at'>): Promise<'sent' | 'off' | 'error'> {
    if (!this.learning) return 'off';
    try { await api('submit', { body: item }); return 'sent'; } catch (e) {
      if (e instanceof LearnError && e.code === 'off') { this.learning = false; return 'off'; }
      return 'error';
    }
  }

  // ── вход команды ──
  async login(code: string): Promise<Me> {
    const r = await api<Me & { token: string; learning: boolean }>('login', { body: { code: code.trim(), device: deviceId() } });
    this.token = r.token;
    this.me = { id: r.id, role: r.role, name: r.name };
    this.learning = r.learning;
    store.set('nh-staff-token', r.token);
    store.set('nh-staff-me', JSON.stringify(this.me));
    void this.queue().then((q) => (this.pending = q.length)).catch(() => {});
    return this.me;
  }

  /** Вход ещё действует? Если Dev отозвал его — выходим. Без связи ничего не меняем. */
  async checkSession() {
    try {
      const r = await api<Me & { learning: boolean }>('me', { token: this.token });
      this.me = { id: r.id, role: r.role, name: r.name }; this.learning = r.learning;
      store.set('nh-staff-me', JSON.stringify(this.me));
      void this.queue().then((q) => (this.pending = q.length)).catch(() => {});
    } catch (e) { if (e instanceof LearnError && e.status === 401) this.forget(); }
  }

  async logout() {
    try { await api('logout', { method: 'POST', body: {}, token: this.token }); } catch { /* всё равно выходим */ }
    this.forget();
  }

  private forget() {
    this.token = null; this.me = null; this.pending = 0;
    store.set('nh-staff-token', null); store.set('nh-staff-me', null);
  }

  /** Запрос от имени команды; если вход закрыли — выходим */
  async staffApi<T>(path: string, body?: unknown): Promise<T> {
    try { return await api<T>(path, { body, token: this.token }); } catch (e) {
      if (e instanceof LearnError && e.status === 401) this.forget();
      throw e;
    }
  }

  queue() { return this.staffApi<{ items: QueueItem[] }>('queue').then((r) => r.items); }
  allNotes() { return this.staffApi<{ notes: FullNote[] }>('notes/all').then((r) => r.notes); }
  async decide(id: string, action: 'accept' | 'reject', edit?: { text?: string; keywords?: string; scope?: string }) {
    await this.staffApi('decide', { id, action, ...edit });
    if (action === 'accept') void this.refresh();
  }
  async editNote(id: string, patch: { text?: string; keywords?: string; delete?: boolean }) {
    await this.staffApi('note', { id, ...patch });
    void this.refresh();
  }
  async toggle(on: boolean) {
    const r = await this.staffApi<{ learning: boolean }>('toggle', { on });
    this.learning = r.learning;
    void this.refresh();
  }
  team() { return this.staffApi<{ users: Member[]; me: string }>('team'); }
  teamAction(body: { action: 'create' | 'newcode' | 'block' | 'unblock' | 'delete' | 'end'; id?: string; name?: string; session?: string }) {
    return this.staffApi<{ ok: true; code?: string; id?: string }>('team', body);
  }
  journal(days = 7) { return this.staffApi<{ entries: LogEntry[]; stats: { submits: number; accepted: number; badToday: number } }>(`log?days=${days}`); }
}

export const learn = new Learn();

/** Без связи с сервером Dev всё равно может включить режим разработчика своим кодом */
export const offlineDevCheck = checkDevCode;
