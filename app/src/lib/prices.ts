/**
 * Цены скупщиков NOVA RP: что скачиваем и как считаем подсветку.
 *
 * Цены раз в час (в :05 по Москве) публикуются в Discord. Сборщик (prices-worker, Cloudflare)
 * каждую минуту забирает новое сообщение и кладёт файл prices.json в репозиторий MRFUNFOX/nova-prices.
 * Программа читает этот файл через GitHub API — без Cloudflare, он в России работает с перебоями.
 */
import type { Pin } from './pins';

export const PRICES_URL = 'https://api.github.com/repos/MRFUNFOX/nova-prices/contents/prices.json';

export interface PricesFile {
  v: number;
  updatedAt: string;
  /** Время цен из сообщения, «2026-11-17T00:05:00+03:00» */
  time: string;
  /** Скупщики сырья №1–3: товар → [минимальная, начальная] */
  raw: Record<string, [number, number]>[];
  /** Скупщик продуктов: товар → цена */
  products: Record<string, number>;
  /** Начальные цены прошлого часа — для стрелок */
  prev: { time: string; raw: Record<string, number>[]; products: Record<string, number> } | null;
  /** С какой начальной цены цена «редкая» (верхние 10% за неделю). Пусто, если истории мало. */
  rareFrom: Record<string, number>;
  rareHours: number;
}

export type Group = 'raw' | 'products';

export interface Cell {
  /** Номер скупщика 1–3; у продуктов 0 */
  n: number;
  /** Цена сразу после обновления — её показываем крупно, по ней всё и считаем */
  start: number;
  /** Нижний порог (при массовых продажах); у продуктов нет */
  min: number | null;
  /** Изменение к прошлому часу, %, или null */
  delta: number | null;
  best: boolean;
  rare: boolean;
  goal: boolean;
}

export interface Row {
  item: string;
  group: Group;
  cells: Cell[];
  goal: number | null;
  /** Цель достигнута хотя бы у одного скупщика */
  reached: boolean;
}

/** Данные окна скупщика поверх игры (уходят в слой окон вместе с остальными закрепками) */
export interface BuyerPinData {
  item: string;
  group: Group;
  time: string;
  cells: Cell[];
  goal: number | null;
}

/** Порядок товаров, как в Discord (если в файле какого-то нет — просто пропускаем) */
export const RAW_ORDER = ['Медь', 'Изумруд', 'Рубин', 'Алмаз', 'Бензин', 'Солярка', 'Керосин', 'Фальшивые деньги', 'Окунь', 'Карп', 'Форель', 'Лосось', 'Жемчуг', 'Шкура', 'Идеальное мясо', 'Хорошее мясо'];
export const PRODUCT_ORDER = ['Капуста', 'Тыква', 'Мандарины', 'Ананасы'];

function ordered(keys: Iterable<string>, order: string[]) {
  const set = new Set(keys);
  return [...order.filter((k) => set.has(k)), ...[...set].filter((k) => !order.includes(k))];
}

const pct = (now: number, before: number | undefined) =>
  before && before > 0 ? Math.round(((now - before) / before) * 100) : null;

export function isRare(file: PricesFile, item: string, price: number) {
  const from = file.rareFrom?.[item];
  return typeof from === 'number' && price >= from;
}

/** Строки таблицы для всех товаров */
export function rowsOf(file: PricesFile, goals: Record<string, number>): Row[] {
  const rows: Row[] = [];
  const rawItems = ordered(file.raw.flatMap((s) => Object.keys(s)), RAW_ORDER);
  for (const item of rawItems) {
    const goal = goals[item] ?? null;
    const cells: Cell[] = [];
    file.raw.forEach((s, i) => {
      const v = s[item];
      if (!v) return;
      const [min, start] = v;
      cells.push({
        n: i + 1, start, min, delta: pct(start, file.prev?.raw[i]?.[item]),
        best: false, rare: isRare(file, item, start), goal: goal !== null && start >= goal,
      });
    });
    if (!cells.length) continue;
    const top = Math.max(...cells.map((c) => c.start));
    const best = cells.find((c) => c.start === top);
    if (best && cells.length > 1) best.best = true;
    rows.push({ item, group: 'raw', cells, goal, reached: cells.some((c) => c.goal) });
  }
  for (const item of ordered(Object.keys(file.products), PRODUCT_ORDER)) {
    const goal = goals[item] ?? null;
    const start = file.products[item]!;
    const cell: Cell = {
      n: 0, start, min: null, delta: pct(start, file.prev?.products[item]),
      best: false, rare: isRare(file, item, start), goal: goal !== null && start >= goal,
    };
    rows.push({ item, group: 'products', cells: [cell], goal, reached: cell.goal });
  }
  return rows;
}

export const buyerKey = (item: string) => `buyer:${item}`;
export const isBuyerPin = (p: Pin) => p.kind === 'buyer';

/** Окно скупщика для слоя поверх игры */
export function buyerPin(row: Row, time: string): Pin {
  return {
    key: buyerKey(row.item), docId: '', nodeId: '', badge: row.item, doc: 'Скупщики', law: false, text: '', punish: [],
    kind: 'buyer',
    buyer: { item: row.item, group: row.group, time, cells: row.cells, goal: row.goal },
  };
}

/** «22:05» из «2026-11-16T22:05:00+03:00» (время всегда московское) */
export const timeLabel = (iso: string) => iso.slice(11, 16);

/** Когда ждать следующие цены: через час после текущих */
export const nextTime = (iso: string) => Date.parse(iso) + 3600e3;

/** Сколько минут до следующих цен (не меньше 0) */
export function minutesLeft(iso: string, now = Date.now()) {
  return Math.max(0, Math.ceil((nextTime(iso) - now) / 60e3));
}

/** Самое свежее время публикации, которое уже должно быть: последнее «:05 по Москве» (= :05 по UTC) */
export function expectedTime(now = Date.now()) {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  if (d.getUTCMinutes() < 5) d.setUTCHours(d.getUTCHours() - 1);
  d.setUTCMinutes(5);
  return d.getTime();
}

/**
 * Через сколько миллисекунд снова проверить файл.
 * Цены устарели (новые уже должны были выйти): первые 5 минут — каждые 20 секунд,
 * до 25 минут — раз в 2 минуты, дальше — раз в 5 минут. GitHub без входа даёт 60 запросов в час
 * с одного компьютера, а ответ «не изменилось» (304) в этот лимит не считается.
 * Свежие — ждём следующего часа (+20 секунд на работу сборщика).
 */
/** Цены появляются в Discord около :05:50–:06:10, сборщик кладёт их на GitHub через ~5 с (так по истории коммитов):
 *  раньше :05:50 ходить незачем, а с этого момента — часто, чтобы игрок увидел цены через секунды после сборщика. */
export const FIRST_CHECK = 50e3;

export function nextCheckIn(file: PricesFile | null, now = Date.now()) {
  const due = expectedTime(now);
  if (!file || Date.parse(file.time) < due) {
    const late = now - due;
    if (late < FIRST_CHECK) return FIRST_CHECK - late;
    // До :07 — каждые 5 с (цены выходят в Discord около :05:50–:06:10, сборщик кладёт их через ~5 с)
    return late < 2 * 60e3 ? 5e3 : late < 10 * 60e3 ? 30e3 : late < 25 * 60e3 ? 2 * 60e3 : 5 * 60e3;
  }
  return Math.max(10e3, due + 3600e3 + FIRST_CHECK - now);
}

export const fmtPrice = (n: number) => `$${n}`;
