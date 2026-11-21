// Калькулятор прибыли: профили и записи игрока. Хранятся на компьютере (localStorage),
// общие для большого окна и меню в игре — второе окно подхватывает изменения само.
import { MAX_PROFILES, sanitize, type Entry, type Goal, type Kind, type Profile } from './calc';

const KEY = 'nova.calc';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

class Calc {
  profiles = $state<Profile[]>([]);
  /** Открытый профиль; пусто — список профилей (с него калькулятор начинается) */
  cur = $state('');
  private started = false;

  get profile(): Profile | undefined { return this.profiles.find((p) => p.id === this.cur); }
  get atLimit() { return this.profiles.length >= MAX_PROFILES; }

  /** Прочитать сохранённое и следить за изменениями из другого окна программы */
  start() {
    if (this.started) return;
    this.started = true;
    this.load();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => { if (e.key === KEY) this.load(); });
    }
  }

  private load() {
    try {
      const raw = localStorage.getItem(KEY);
      this.profiles = raw ? sanitize(JSON.parse(raw)) : [];
    } catch { this.profiles = []; }
    if (this.cur && !this.profile) this.cur = '';
  }

  private save() {
    try { localStorage.setItem(KEY, JSON.stringify($state.snapshot(this.profiles))); } catch { /* место кончилось — данные останутся до перезапуска */ }
  }

  open(id: string) { this.cur = id; }
  toList() { this.cur = ''; }

  /** Новый профиль с текущим балансом игрока. null — лимит */
  create(name: string, start: number, goal: Goal | null = null): string | null {
    if (this.atLimit) return null;
    const id = uid();
    this.profiles = [...this.profiles, { id, name: name.trim().slice(0, 40) || `Профиль ${this.profiles.length + 1}`, start: Math.max(0, Math.round(start)), goal, created: Date.now(), entries: [] }];
    this.save();
    this.cur = id;
    return id;
  }

  rename(id: string, name: string) {
    const n = name.trim().slice(0, 40);
    if (!n) return;
    this.profiles = this.profiles.map((p) => (p.id === id ? { ...p, name: n } : p));
    this.save();
  }

  setGoal(id: string, goal: Goal | null) {
    this.profiles = this.profiles.map((p) => (p.id === id ? { ...p, goal } : p));
    this.save();
  }

  remove(id: string) {
    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (this.cur === id) this.cur = '';
    this.save();
  }

  /** Запись в открытый профиль или в указанный (быстрая запись у закреплённого итога) */
  add(e: { at: number; k: Kind; cat: string; sum: number; note?: string }, profId?: string) {
    const p = profId ? this.profiles.find((x) => x.id === profId) : this.profile;
    if (!p || !(e.sum > 0)) return;
    const entry: Entry = { id: uid(), at: e.at, k: e.k, cat: e.cat, sum: Math.round(e.sum), ...(e.note?.trim() ? { note: e.note.trim().slice(0, 80) } : {}) };
    this.profiles = this.profiles.map((x) => (x.id === p.id ? { ...x, entries: [entry, ...x.entries] } : x));
    this.save();
  }

  del(entryId: string) {
    const p = this.profile;
    if (!p) return;
    this.profiles = this.profiles.map((x) => (x.id === p.id ? { ...x, entries: x.entries.filter((e) => e.id !== entryId) } : x));
    this.save();
  }
}

export const calc = new Calc();
