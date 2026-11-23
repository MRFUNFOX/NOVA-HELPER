// ИИ-помощник: история вопросов и проверка ника. Чистые функции — их проверяют тесты.

/** Сколько вопросов хранить в истории */
export const HISTORY_MAX = 200;
export const HISTORY_KEY = 'nova.aiHistory';

export type Rating = 'up' | 'down';
export type Scope = 'project' | 'laws';

/** Проверка ника: что видно сразу (формат) и что решила нейросеть (смысл) */
export interface NickCheck {
  nick: string;
  /** Проверки формата — без нейросети */
  format: { label: string; ok: boolean }[];
  /** Итог: подходит, не подходит, спорно; пока нейросеть думает — null */
  verdict: 'ok' | 'bad' | 'doubt' | null;
  /** Что не так по смыслу (по пунктам правила) */
  issues: string[];
  /** Сколько людей носят имя и фамилию (forebears.io): null — сайт не ответил, 0 — не нашлось */
  names?: { first: number | null; last: number | null };
}

/** Вопрос в истории: всё, чтобы открыть его снова без нейросети */
export interface HistItem {
  id: string;
  at: number;
  q: string;
  a: string;
  scope: Scope;
  /** Ссылки ответа: номер [S n] → пункт */
  refs: { n: number; node: string }[];
  rating?: Rating;
  nick?: NickCheck;
}

/** Битые записи отбрасываем, лишние — обрезаем */
export function sanitizeHistory(raw: unknown): HistItem[] {
  if (!Array.isArray(raw)) return [];
  const out: HistItem[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const h = x as Partial<HistItem>;
    if (typeof h.id !== 'string' || typeof h.q !== 'string' || typeof h.a !== 'string' || typeof h.at !== 'number') continue;
    out.push({
      id: h.id, at: h.at, q: h.q, a: h.a,
      scope: h.scope === 'laws' ? 'laws' : 'project',
      refs: Array.isArray(h.refs) ? h.refs.filter((r) => r && typeof r.n === 'number' && typeof r.node === 'string') : [],
      ...(h.rating === 'up' || h.rating === 'down' ? { rating: h.rating } : {}),
      ...(h.nick && typeof h.nick.nick === 'string' ? { nick: h.nick } : {}),
    });
    if (out.length >= HISTORY_MAX) break;
  }
  return out;
}

/** Новый вопрос — в начало; тот же id — заменить */
export function pushHistory(list: HistItem[], item: HistItem): HistItem[] {
  return [item, ...list.filter((h) => h.id !== item.id)].slice(0, HISTORY_MAX);
}

/** Поиск по истории: все слова запроса есть в вопросе или ответе */
export function searchHistory(list: HistItem[], query: string): HistItem[] {
  const words = query.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((h) => {
    const s = `${h.q} ${h.a} ${h.nick?.nick ?? ''}`.toLowerCase().replace(/ё/g, 'е');
    return words.every((w) => s.includes(w));
  });
}

/** Группы для списка: «Сегодня», «Вчера», «12 ноября» */
export function dayLabel(at: number, now = Date.now()): string {
  const d = new Date(at), n = new Date(now);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(n) - start(d)) / 86400e3);
  if (days === 0) return 'Сегодня';
  if (days === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(d.getFullYear() !== n.getFullYear() ? { year: 'numeric' } : {}) });
}

// ── Проверка ника ──

/**
 * Похоже ли сообщение на ник для проверки: «Ivan_Petrov», «ник Ivan_Petrov», «проверь ник Ivan Petrov».
 * Возвращает сам ник или null.
 */
export function nickIn(text: string): string | null {
  const t = text.trim();
  const said = /^(?:проверь(?:те)?\s+)?(?:мой\s+)?ник(?:нейм)?\s*[:\-—]?\s*(.+)$/i.exec(t);
  const cand = (said ? said[1]! : t).trim().replace(/^[«"']|[»"'?.!]$/g, '');
  if (said && /^[\p{L}\d]+(?:[_ ][\p{L}\d]+)?$/u.test(cand)) return cand.replace(' ', '_');
  // Без слова «ник» — только явный формат Имя_Фамилия латиницей
  return /^[A-Za-z]+_[A-Za-z]+$/.test(cand) ? cand : null;
}

/** Проверки формата по п. 2.13 ОП NOVA RP, которые видны без нейросети */
export function nickFormat(nick: string): { label: string; ok: boolean }[] {
  const parts = nick.split('_');
  const two = parts.length === 2 && parts.every((p) => /^\p{L}{2,}$/u.test(p));
  const letters = nick.replace(/_/g, '');
  return [
    { label: 'Формат Имя_Фамилия, только буквы', ok: two },
    { label: 'Не целиком заглавными или строчными (IVAN_IVANOV, ivan_ivanov)', ok: letters !== letters.toUpperCase() && letters !== letters.toLowerCase() },
  ];
}

/** «4 212 000» → «4,2 млн»; для строки «встречается у …» */
export function people(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',').replace(',0', '')} млн`;
  if (n >= 1e4) return `${Math.round(n / 1e3)} тыс.`;
  return n.toLocaleString('ru-RU');
}
