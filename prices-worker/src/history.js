/**
 * prices.json — то, что скачивает программа.
 *
 * {
 *   v: 1,
 *   updatedAt: "2026-11-16T22:06:12.000Z",   // когда сборщик записал файл
 *   time: "2026-11-16T22:05:00+03:00",       // время цен из сообщения
 *   raw: [{ "Медь": [35, 42], ... }, {...}, {...}],  // скупщики сырья №1–3: [мин, начальная]
 *   products: { "Капуста": 644, ... },
 *   prev: { time, raw: [{ "Медь": 37 }, ...], products: {...} },  // начальные цены прошлого часа — для стрелок
 *   rareFrom: { "Медь": 58, "Капуста": 900, ... },  // начальная цена от которой цена «редкая» (верхние 10% за 7 дней)
 *   rareHours: 168,                          // сколько часов истории учтено в rareFrom
 *   history: [{ t, raw: [{ "Медь": 42 }, ...], products: {...} }, ...]  // только начальные цены, 30 дней
 * }
 */

export const HISTORY_DAYS = 30;
export const RARE_DAYS = 7;
export const RARE_SHARE = 0.1;
/** Меньше этого числа часов в истории — «редкую цену» не считаем, мало данных */
export const RARE_MIN_HOURS = 24;

const startOnly = (snap) => ({
  t: snap.time,
  raw: snap.raw.map((s) => Object.fromEntries(Object.entries(s).map(([k, [, b]]) => [k, b]))),
  products: { ...snap.products },
});

/** Добавить снимок в историю (без повторов по времени), отрезать старше 30 дней */
export function addToHistory(history, snap) {
  const h = (history || []).filter((x) => x.t !== snap.time);
  h.push(startOnly(snap));
  h.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const edge = Date.parse(snap.time) - HISTORY_DAYS * 864e5;
  return h.filter((x) => Date.parse(x.t) >= edge);
}

/** Порог «редкой» цены по каждому товару: верхние 10% начальных цен всех скупщиков за 7 дней */
export function rareThresholds(history, now) {
  const edge = Date.parse(now) - RARE_DAYS * 864e5;
  const recent = history.filter((x) => Date.parse(x.t) >= edge && Date.parse(x.t) <= Date.parse(now));
  const values = {};
  for (const h of recent) {
    for (const s of h.raw) for (const [k, v] of Object.entries(s)) (values[k] ||= []).push(v);
    for (const [k, v] of Object.entries(h.products)) (values[k] ||= []).push(v);
  }
  const out = {};
  for (const [k, arr] of Object.entries(values)) {
    arr.sort((a, b) => b - a);
    const i = Math.max(0, Math.ceil(arr.length * RARE_SHARE) - 1);
    out[k] = arr[i];
  }
  return { rareFrom: recent.length >= RARE_MIN_HOURS ? out : {}, hours: recent.length };
}

/** Собрать prices.json из последнего снимка и истории */
export function buildFile(history, snap) {
  const idx = history.findIndex((x) => x.t === snap.time);
  const prev = idx > 0 ? history[idx - 1] : null;
  const { rareFrom, hours } = rareThresholds(history, snap.time);
  return {
    v: 1,
    updatedAt: new Date().toISOString(),
    time: snap.time,
    raw: snap.raw,
    products: snap.products,
    prev: prev ? { time: prev.t, raw: prev.raw, products: prev.products } : null,
    rareFrom,
    rareHours: hours,
    history,
  };
}
