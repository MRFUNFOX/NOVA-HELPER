import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { ImageRef } from './types.js';

/** Одна логическая строка поста после «расплющивания» HTML. */
export interface Line {
  text: string;
  /** Вся строка жирная/цветная/заголовок — признак заголовка без номера. */
  emphasized: boolean;
  /** Строка — элемент списка (<li>) или начинается с маркера «•». */
  bullet: boolean;
  /** Строка — ряд таблицы; разделитель « | » в ней не означает наказание. */
  tableRow: boolean;
  images: ImageRef[];
}

const BLOCK = new Set([
  'br', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol',
  'table', 'tr', 'blockquote', 'hr', 'section', 'article', 'pre',
]);
const EMPH = new Set(['b', 'strong', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'u']);

/** Баннеры-разделители (2171×76 на форуме) не несут смысла — пропускаем. */
export function isDecorativeImage(w?: number, h?: number): boolean {
  if (!w || !h) return false;
  return w / h >= 8 && h <= 160;
}

export function cleanText(s: string): string {
  return s
    .replace(/[​‌‍﻿]/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

interface Acc {
  text: string;
  emphChars: number;
  totalChars: number;
  bullet: boolean;
  tableRow: boolean;
  images: ImageRef[];
}

/**
 * Превращает HTML тела сообщения XenForo (.bbWrapper) в список строк.
 * Структуру (пункты, примечания, наказания) отсюда не извлекаем — это делает structure.ts.
 */
export function htmlToLines(html: string, baseUrl = 'https://forum.nova-rp.com'): Line[] {
  const $ = cheerio.load(html, {}, false);
  const lines: Line[] = [];
  let acc: Acc = fresh();

  function fresh(): Acc {
    return { text: '', emphChars: 0, totalChars: 0, bullet: false, tableRow: false, images: [] };
  }

  function flush() {
    const text = cleanText(acc.text);
    if (text || acc.images.length) {
      const visible = text.replace(/\s/g, '').length;
      lines.push({
        text,
        emphasized: visible > 0 && acc.emphChars >= visible * 0.9,
        bullet: acc.bullet || /^[•●▪◦·-]\s/.test(text),
        tableRow: acc.tableRow,
        images: acc.images,
      });
    }
    acc = fresh();
  }

  function isEmphasizedStyle(el: Element): boolean {
    const style = (el.attribs?.style ?? '').toLowerCase();
    return /color\s*:/.test(style) || /font-weight\s*:\s*(bold|[6-9]00)/.test(style);
  }

  function walk(node: AnyNode, emph: boolean) {
    if (node.type === 'text') {
      const t = (node as unknown as { data: string }).data;
      acc.text += t;
      const visible = t.replace(/[\s​]/g, '').length;
      acc.totalChars += visible;
      if (emph) acc.emphChars += visible;
      return;
    }
    if (node.type !== 'tag') return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const cls = el.attribs?.class ?? '';

    // Служебные элементы XenForo: якоря заголовков, кнопки, подписи лайтбокса
    if (cls.includes('hoverLink') || cls.includes('u-anchorTarget') || tag === 'script' || tag === 'style') return;
    if (tag === 'button' && !cls.includes('bbCodeSpoiler-button')) return;

    if (tag === 'img') {
      if (cls.includes('smilie')) {
        acc.text += el.attribs.alt ?? '';
        return;
      }
      const w = Number(el.attribs.width) || undefined;
      const h = Number(el.attribs.height) || undefined;
      if (isDecorativeImage(w, h)) return;
      const src = el.attribs['data-src'] || el.attribs.src;
      if (src) acc.images.push({ src: new URL(src, baseUrl).href, alt: el.attribs.alt, width: w, height: h });
      return;
    }

    if (tag === 'a' && cls.includes('js-lbImage') === false && el.attribs.href && !cls.includes('bbImageWrapper')) {
      const href = el.attribs.href;
      const label = cleanText($(el).text());
      const isInternalAnchor = href.includes('#') && href.includes('/threads/') && !label;
      if (!isInternalAnchor && label && /^https?:/.test(href) && label !== href) {
        acc.text += `[${label}](${href})`;
        acc.totalChars += label.length;
        if (emph) acc.emphChars += label.length;
        return;
      }
    }

    // Спойлер: заголовок кнопки отдельной выделенной строкой, затем содержимое
    if (cls.includes('bbCodeSpoiler-button')) {
      flush();
      const title = cleanText($(el).find('.bbCodeSpoiler-button-title').text()) || 'Спойлер';
      acc.text = title;
      acc.totalChars = acc.emphChars = title.length;
      flush();
      return;
    }

    if (tag === 'tr') {
      flush();
      const cells = $(el).children('td,th').map((_, c) => cleanText($(c).text())).get();
      acc.text = cells.filter(Boolean).join(' | ');
      acc.totalChars = acc.text.length;
      acc.tableRow = true;
      flush();
      return;
    }

    const block = BLOCK.has(tag);
    if (block) flush();
    if (tag === 'li') acc.bullet = true;
    const childEmph = emph || EMPH.has(tag) || ((tag === 'span' || tag === 'div') && isEmphasizedStyle(el));
    for (const child of el.children) walk(child, childEmph);
    if (block) flush();
  }

  const root = $.root();
  for (const child of root.contents().toArray()) walk(child, false);
  flush();

  // «•» в начале строки — маркер списка, сам символ в тексте не нужен
  return lines.map((l) => ({ ...l, text: l.text.replace(/^[•●▪◦·]\s*/, '') }));
}
