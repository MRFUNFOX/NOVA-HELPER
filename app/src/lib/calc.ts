// Калькулятор прибыли: чистые функции (без Svelte) — сводки, дни, категории, график.
// Утверждённый дизайн — прототип «Калькулятор прибыли» в Claude Design.

export type Kind = 'inc' | 'exp';
export type Period = 'day' | 'week' | 'month' | 'all';

export interface Entry {
  id: string;
  /** Время записи, мс */
  at: number;
  k: Kind;
  cat: string;
  sum: number;
  note?: string;
}

export interface Profile {
  id: string;
  name: string;
  /** Баланс, с которого начали считать */
  start: number;
  created: number;
  /** Записи, свежие первыми */
  entries: Entry[];
}

export const MAX_PROFILES = 10;

/** Категория: название, иконка (контур 24×24), цвет */
export interface Cat { name: string; icon: string; color: string }
const I = {
  work: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  buyer: 'M3 3v18h18M7 14l4-4 4 4 5-6',
  market: 'M4 10v10h16V10M3 10l2-6h14l2 6zM9 20v-5h6v5',
  player: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  biz: 'M5 21V4h10v17M15 9h4v12M8 8h4M8 12h4M8 16h4M3 21h18',
  casino: 'M5 4h14v16H5zM9 8.5h.01M15 8.5h.01M12 12h.01M9 15.5h.01M15 15.5h.01',
  box: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8',
  other: 'M6 12h.01M12 12h.01M18 12h.01',
  bag: 'M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2',
  key: 'M10 14a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM13 13l7 7M17 17l2-2',
  fine: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  fuel: 'M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h14M5 10h10M15 8l3 3v7a1.5 1.5 0 0 0 3 0V9l-3-3',
  tune: 'M14.5 5.5a4 4 0 0 0 4.9 4.9l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 1-1.9-1.9z',
};
export const CATS: Record<Kind, Cat[]> = {
  inc: [
    { name: 'Работа', icon: I.work, color: '#7aa2ff' }, { name: 'Скупщик', icon: I.buyer, color: '#ffc300' },
    { name: 'Рынок', icon: I.market, color: '#b48cff' }, { name: 'Игроку', icon: I.player, color: '#5ad1c8' },
    { name: 'Бизнес', icon: I.biz, color: '#ff9f5a' }, { name: 'Казино', icon: I.casino, color: '#ff6fae' },
    { name: 'Кейсы', icon: I.box, color: '#9adf6f' }, { name: 'Другое', icon: I.other, color: '#9a9ea6' },
  ],
  exp: [
    { name: 'Покупка', icon: I.bag, color: '#7aa2ff' }, { name: 'Рынок', icon: I.market, color: '#b48cff' },
    { name: 'Казино', icon: I.casino, color: '#ff6fae' }, { name: 'Аренда', icon: I.key, color: '#5ad1c8' },
    { name: 'Штраф', icon: I.fine, color: '#ff8a8a' }, { name: 'Бензин', icon: I.fuel, color: '#ff9f5a' },
    { name: 'Тюнинг', icon: I.tune, color: '#ffc300' }, { name: 'Другое', icon: I.other, color: '#9a9ea6' },
  ],
};
export const catOf = (k: Kind, name: string): Cat => CATS[k].find((c) => c.name === name) ?? CATS[k][CATS[k].length - 1]!;

export const val = (e: Entry) => (e.k === 'inc' ? e.sum : -e.sum);

/** Полночь дня, в котором время t (по часам компьютера) */
export function dayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
/** Сколько календарных дней назад было время t (0 — сегодня) */
export function daysAgo(t: number, now: number): number {
  return Math.round((dayStart(now) - dayStart(t)) / 86400e3);
}

export const PERIOD_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30, all: Infinity };
export function inPeriod(entries: Entry[], p: Period, now: number): Entry[] {
  const n = PERIOD_DAYS[p];
  return n === Infinity ? entries : entries.filter((e) => daysAgo(e.at, now) < n);
}

export function totals(entries: Entry[]) {
  let inc = 0, exp = 0;
  for (const e of entries) { if (e.k === 'inc') inc += e.sum; else exp += e.sum; }
  return { inc, exp, net: inc - exp };
}

export const balanceOf = (p: Profile) => p.start + p.entries.reduce((a, e) => a + val(e), 0);

/** Записи по дням: свежие дни первыми, внутри дня — свежие первыми */
export function byDay(entries: Entry[], now: number) {
  const m = new Map<number, Entry[]>();
  for (const e of [...entries].sort((a, b) => b.at - a.at)) {
    const d = daysAgo(e.at, now);
    if (!m.has(d)) m.set(d, []);
    m.get(d)!.push(e);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([ago, items]) => ({ ago, at: items[0]!.at, items, ...totals(items) }));
}

/** Суммы по категориям, от большей */
export function byCat(entries: Entry[], k: Kind) {
  const m = new Map<string, number>();
  for (const e of entries) if (e.k === k) m.set(e.cat, (m.get(e.cat) ?? 0) + e.sum);
  return [...m.entries()].map(([cat, sum]) => ({ cat, sum })).sort((a, b) => b.sum - a.sum);
}

/** Прибыль по каждому из n последних дней, от старого к сегодняшнему */
export function perDay(entries: Entry[], n: number, now: number) {
  const out = Array.from({ length: n }, (_, i) => ({ ago: n - 1 - i, inc: 0, exp: 0, net: 0, items: [] as Entry[] }));
  for (const e of entries) {
    const d = daysAgo(e.at, now);
    if (d < 0 || d >= n) continue;
    const x = out[n - 1 - d]!;
    if (e.k === 'inc') x.inc += e.sum; else x.exp += e.sum;
    x.net = x.inc - x.exp;
    x.items.push(e);
  }
  return out;
}

/** Деньги: $1 250 000, −$4 200 */
export const money = (n: number) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('ru-RU');
export const signed = (n: number) => (n > 0 ? '+' : '') + money(n);
/** Коротко для шкалы графика: 186к, 1,2М */
export function short(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1e6 ? (a / 1e6).toFixed(1).replace(/\.0$/, '').replace('.', ',') + 'М' : a >= 1000 ? Math.round(a / 1000) + 'к' : String(Math.round(a));
  return (n < 0 ? '−' : '') + s;
}
/** Цифры из строки ввода («1 250 000», «$5к» → 1250000, 5) */
export function digits(v: string): number {
  const n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}
export const groupDigits = (n: number) => (n ? n.toLocaleString('ru-RU') : '');

export function plural(n: number, one: string, few: string, many: string) {
  const a = n % 100, b = n % 10;
  if (a >= 11 && a <= 14) return many;
  return b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}
export const recWord = (n: number) => `${n} ${plural(n, 'запись', 'записи', 'записей')}`;

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEK = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WEEKF = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export const dateOfAgo = (ago: number, now: number) => { const d = new Date(dayStart(now)); d.setDate(d.getDate() - ago); return d; };
export const dayMonth = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
export const weekdayShort = (d: Date) => WEEK[d.getDay()];
export const weekdayFull = (d: Date) => WEEKF[d.getDay()];
/** «Сегодня», «Вчера», «17 ноября» */
export const dayName = (ago: number, now: number) => (ago === 0 ? 'Сегодня' : ago === 1 ? 'Вчера' : dayMonth(dateOfAgo(ago, now)));
export const hhmm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** Проверка и починка данных из хранилища: битое отбрасываем, лишние профили обрезаем */
export function sanitize(raw: unknown): Profile[] {
  if (!Array.isArray(raw)) return [];
  const out: Profile[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.name !== 'string' || typeof o.start !== 'number' || !Number.isFinite(o.start)) continue;
    const entries = (Array.isArray(o.entries) ? o.entries : []).filter((e): e is Entry => {
      const x = e as Record<string, unknown>;
      return !!x && typeof x.id === 'string' && typeof x.at === 'number' && (x.k === 'inc' || x.k === 'exp') && typeof x.cat === 'string' && typeof x.sum === 'number' && Number.isFinite(x.sum) && x.sum > 0;
    });
    out.push({ id: o.id, name: o.name.slice(0, 40), start: o.start, created: typeof o.created === 'number' ? o.created : 0, entries });
    if (out.length >= MAX_PROFILES) break;
  }
  return out;
}
