/**
 * Разбор сообщения «Изменение цен у скупщиков» из Discord-канала Nova RP.
 *
 * Пример текста (разметка Discord может быть любой — звёздочки, ```, эмодзи):
 *   🔔 Изменение цен у скупщиков (16.11.2026 22:05 МСК)
 *   🔷 Скупщик сырья №1
 *   - Медь: $35 ($42)
 *   ...
 *   🔶 Скупщик продуктов
 *   - Капуста: $644
 *
 * Возвращает null, если это не сообщение с ценами.
 */

const RE_TIME = /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})\s*МСК/i;
const RE_RAW = /Скупщик\s+сырья\s*(?:№|No|N)\s*(\d)/i;
const RE_PRODUCTS = /Скупщик\s+продуктов/i;
// «- Медь: $35 ($42)» или «- Капуста: $644». Пробелы и разделители тысяч допускаем.
const RE_LINE = /^[\s\-–•*]*([^:$\n]+?)\s*:\s*\$\s*([\d\s.,]+?)\s*(?:\(\s*\$\s*([\d\s.,]+?)\s*\))?\s*$/;

const num = (s) => Number(String(s).replace(/[\s.,]/g, ''));

/** Время из шапки «(16.11.2026 22:05 МСК)» → ISO-строка с часовым поясом Москвы */
export function parseTime(text) {
  const m = RE_TIME.exec(text);
  if (!m) return null;
  const [, d, mo, y, h, mi] = m;
  return `${y}-${mo}-${d}T${h.padStart(2, '0')}:${mi}:00+03:00`;
}

/** Текст сообщения Discord: содержимое + описания и поля вложений-embed */
export function messageText(msg) {
  const parts = [msg.content || ''];
  for (const e of msg.embeds || []) {
    if (e.title) parts.push(e.title);
    if (e.description) parts.push(e.description);
    for (const f of e.fields || []) parts.push(`${f.name}\n${f.value}`);
  }
  return parts.join('\n');
}

export function parsePrices(text) {
  if (!text || !/Изменение\s+цен\s+у\s+скупщиков/i.test(text)) return null;
  const time = parseTime(text);
  if (!time) return null;

  /** raw[0..2] — скупщики сырья №1–3: { товар: [мин, начальная] } */
  const raw = [{}, {}, {}];
  /** products — скупщик продуктов: { товар: цена } */
  const products = {};
  let section = null; // 0,1,2 — сырьё; 'p' — продукты

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/[*_`~|]/g, '').trim();
    if (!line) continue;
    const r = RE_RAW.exec(line);
    if (r) { const i = Number(r[1]) - 1; section = i >= 0 && i < 3 ? i : null; continue; }
    if (RE_PRODUCTS.test(line)) { section = 'p'; continue; }
    if (section === null) continue;
    const m = RE_LINE.exec(line);
    if (!m) continue;
    const name = m[1].replace(/^[^A-Za-zА-Яа-яЁё]+/, '').trim();
    const a = num(m[2]);
    const b = m[3] !== undefined ? num(m[3]) : null;
    if (!name || !Number.isFinite(a)) continue;
    if (section === 'p') products[name] = b ?? a;
    else raw[section][name] = b !== null ? [a, b] : [a, a];
  }

  let count = Object.keys(products).length;
  for (const s of raw) count += Object.keys(s).length;
  if (!count) return null;
  return { time, raw, products };
}
