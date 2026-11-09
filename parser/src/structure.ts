import { createHash } from 'node:crypto';
import type { Line } from './text.js';
import type { Annotation, AnnotationType, NodeKind, Punishment, RuleNode } from './types.js';
import { classifyPunishment, inlinePunishment, splitPipePunishments } from './punishments.js';

/*
 * Грамматика документов NOVA RP. Встречаются два стиля:
 *  — кодексы и законы: «Раздел I» → «Глава VI» → «Статья 6.1 ★★★ [Федеральная]» → «ч. 1», строки «Наказание: …»;
 *  — правила проекта: «2. Заголовок» → «2.7» → «2.7.1», наказание после « | ».
 * В обоих стилях встречаются «Примечание / Исключение / Пояснение / Уточнение» и подзаголовки без номера.
 */

const RE_SECTION_WORD = /^(?:раздел)\s+([IVXLC]+|\d+)\s*[.:]?\s*(.*)$/i;
/** «Часть I. Общие положения» (крупнее раздела) и «Подраздел 1» (между разделом и главой) */
const RE_BOOK = /^часть\s+([IVXLC]+|\d+)\s*[.:]?\s*(.*)$/i;
const RE_SUBSECTION = /^подраздел\s+([IVXLC]+|\d+)\s*[.:]?\s*(.*)$/i;
const RE_CHAPTER = /^глава\s+([IVXLC]+|\d+)\s*[.:]?\s*(.*)$/i;
const RE_ARTICLE = /^статья\s+(\d+(?:\.\d+)*)\s*\.?\s*(.*)$/i;
/** «2 Статья. Правонарушения в сфере …» — группа пунктов 2.1, 2.2… (АК и ДК Mirage/New Era) */
const RE_ARTICLE_GROUP = /^(\d+)\s+статья\s*[.:]?\s*(.*)$/i;
const RE_PART = /^ч\.\s*(\d+(?:\.\d+)?)\s*\.?\s*(.*)$/i;
const RE_POINT = /^(\d+(?:\.\d+)+)\s*\.?\s*(\S.*)?$/;
const RE_SECTION_NUM = /^(\d{1,2})\.\s+(\S.*)$/;
const RE_ANNOTATION = /^(примечани[ея]|исключени[ея]|пояснени[ея]|уточнени[ея]|комментари[йи])\s*(?:№?\s*\d+)?\s*(?::\s*(.*)|$)/i;
/** «Наказание: …», «Санкция: …» (Horizon, New Era) и «Наказывается лишением свободы…» (Mirage) */
const RE_PUNISHMENT_LINE = /^(?:наказани[ея]|санкци[яи]|меры?\s+наказани[яе])\s*[:—–-]\s*(.+)$/i;
/** «Санкции водителю: штраф 10.000$» / «Санкции пешеходу: …» (дорожные кодексы Mirage/New Era) */
const RE_SANCTION_TO = /^санкци[яи]\s+([а-яё]+)\s*[:—–-]\s*(.+)$/i;
const RE_PUNISHABLE_LINE = /^(?:наказыва[её]тся|карается)\s+\S/i;
/** «Приоритет розыска: 3.» / «Уровень розыска: 1-2» (Mirage) */
const RE_WANTED_LINE = /^(?:приоритет|уровень)\s+розыска\s*[:—–-]?\s*(\d)(?:\s*[-–]\s*(\d))?\.?\s*$/i;
/** «(F)», «(R)», «(F/R)» сразу после номера статьи (Mirage) */
const RE_JURISDICTION_SHORT = /^\(([FR](?:\s*\/\s*[FR])?)\)\s*/;
const JURISDICTION_SHORT: Record<string, string> = { F: 'Федеральная', R: 'Региональная' };
const RE_STARS = /^(★+)(?:\s*\/\s*(★+))?\s*/;
const RE_JURISDICTION = /^\[([^\]]{3,60})\]\s*/;

const ANNOTATION_TYPES: Record<string, AnnotationType> = {
  примечани: 'note',
  исключени: 'exception',
  пояснени: 'explanation',
  уточнени: 'clarification',
  комментари: 'explanation',
};

/** Ранг определяет вложенность: узел становится ребёнком ближайшего узла с меньшим рангом. */
function pointRank(number: string) {
  return 10 + number.split('.').length;
}

interface Draft {
  node: RuleNode;
  rank: number;
  body: string[];
  /** Открытая аннотация без текста («Исключение:») собирает следующие пункты списка. */
  openAnnotation?: { a: Annotation; lines: string[] };
}

export interface ParseOptions {
  docId: string;
  /** Заголовок темы — первая строка поста с тем же текстом не превращается в узел. */
  title?: string;
}

export function parseStructure(lines: Line[], opts: ParseOptions): RuleNode[] {
  const roots: RuleNode[] = [];
  const stack: Draft[] = [];
  const usedIds = new Map<string, number>();
  let preamble: Draft | undefined;

  const top = () => stack[stack.length - 1];

  function makeNode(kind: NodeKind, number: string | undefined, text: string): RuleNode {
    return { id: '', kind, number, text, punishments: [], annotations: [], images: [], amendments: [], children: [], hash: '' };
  }

  function closeAnnotation(d: Draft | undefined) {
    if (!d?.openAnnotation) return;
    const { a, lines } = d.openAnnotation;
    a.text = [a.text, ...lines.map((l) => `- ${l}`)].filter(Boolean).join('\n');
    if (a.text) d.node.annotations.push(a);
    d.openAnnotation = undefined;
  }

  function push(kind: NodeKind, number: string | undefined, rawText: string, rank: number, label?: string) {
    closeAnnotation(top());
    while (stack.length && top()!.rank >= rank) stack.pop();
    const node = makeNode(kind, number, '');
    if (label) node.label = label;
    const d: Draft = { node, rank, body: [] };
    draftOf.set(node, d);
    applyHeadText(d, rawText);
    const parent = top();
    if (parent) parent.node.children.push(node);
    else roots.push(node);
    stack.push(d);
    return d;
  }

  /** Первая строка узла: звёзды розыска, юрисдикция, наказание после « | ». */
  function applyHeadText(d: Draft, raw: string) {
    let text = raw.trim();
    // Звёзды и «[юрисдикция]» бывают только у статей и их частей; в заголовках «[Лидер]» — это сам заголовок
    const legal = d.node.kind === 'article' || d.node.kind === 'part' || d.node.kind === 'point';
    for (let guard = 0; legal && guard < 4; guard++) {
      const stars = RE_STARS.exec(text);
      if (stars) {
        const a = stars[1]!.length;
        const b = stars[2]?.length ?? a;
        d.node.wanted = [Math.min(a, b), Math.max(a, b)];
        text = text.slice(stars[0].length);
        continue;
      }
      const jur = RE_JURISDICTION.exec(text);
      if (jur) {
        d.node.jurisdiction = jur[1]!.trim();
        text = text.slice(jur[0].length);
        continue;
      }
      const short = RE_JURISDICTION_SHORT.exec(text);
      if (short) {
        d.node.jurisdiction = short[1]!.split('/').map((x) => JURISDICTION_SHORT[x.trim().toUpperCase()] ?? x.trim()).join('/');
        text = text.slice(short[0].length);
        continue;
      }
      break;
    }
    const { text: clean, punishments } = splitPipePunishments(text);
    d.node.text = clean.replace(/,\s*$/, '');
    d.node.punishments.push(...punishments);
    if (legal && !punishments.length) {
      const inline = inlinePunishment(d.node.text);
      if (inline) d.node.punishments.push(inline);
    }
  }

  function addBody(line: Line) {
    let d = top();
    if (!d) {
      if (!preamble) {
        preamble = { node: makeNode('heading', undefined, ''), rank: 0, body: [] };
      }
      d = preamble;
    }
    for (const img of line.images) d.node.images.push(img);
    if (!line.text) return;

    // Открытая аннотация («Комментарий:» без текста) забирает следующие строки до нового пункта
    if (d.openAnnotation) {
      d.openAnnotation.lines.push(line.text);
      return;
    }
    closeAnnotation(d);

    if (!line.tableRow && (d.node.kind === 'point' || d.node.kind === 'part' || d.node.kind === 'article')) {
      const { text, punishments } = splitPipePunishments(line.text);
      if (punishments.length) {
        d.node.punishments.push(...punishments);
        if (text) d.body.push(line.bullet ? `- ${text}` : text);
        return;
      }
      const inline = inlinePunishment(line.text);
      if (inline) d.node.punishments.push(inline);
    }
    d.body.push(line.bullet ? `- ${line.text}` : line.text);
  }

  const titleNorm = norm(opts.title ?? '');
  const textLines = lines.filter((l) => l.text);
  const emphRatio = textLines.length ? textLines.filter((l) => l.emphasized).length / textLines.length : 0;

  for (const line of lines) {
    const t = line.text;
    if (!t) {
      if (line.images.length) addBody(line);
      continue;
    }
    // Заголовок документа, продублированный в посте
    if (titleNorm && line.emphasized && similar(norm(t), titleNorm)) continue;

    let m: RegExpExecArray | null;

    if ((m = RE_ANNOTATION.exec(t))) {
      const d = top() ?? preamble;
      if (d) {
        closeAnnotation(d);
        const word = m[1]!.toLowerCase();
        const type = Object.entries(ANNOTATION_TYPES).find(([k]) => word.startsWith(k))?.[1] ?? 'note';
        const rest = (m[2] ?? '').trim();
        const a: Annotation = { type, text: rest };
        if (rest) d.node.annotations.push(a);
        else d.openAnnotation = { a, lines: [] };
        continue;
      }
    }
    if ((m = RE_PUNISHMENT_LINE.exec(t)) && top()) {
      closeAnnotation(top());
      top()!.node.punishments.push(classifyPunishment(m[1]!));
      continue;
    }
    if ((m = RE_SANCTION_TO.exec(t)) && top()) {
      closeAnnotation(top());
      const who = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
      top()!.node.punishments.push(classifyPunishment(`${who}: ${m[2]!}`));
      continue;
    }
    if (RE_PUNISHABLE_LINE.test(t) && top()) {
      closeAnnotation(top());
      top()!.node.punishments.push(classifyPunishment(t));
      continue;
    }
    if ((m = RE_WANTED_LINE.exec(t)) && top()) {
      closeAnnotation(top());
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      top()!.node.wanted = [Math.min(a, b), Math.max(a, b)];
      continue;
    }
    if ((m = RE_BOOK.exec(t))) { push('section', m[1], m[2] ?? '', 0.5, 'Часть'); continue; }
    if ((m = RE_SECTION_WORD.exec(t))) { push('section', m[1], m[2] ?? '', 1, 'Раздел'); continue; }
    if ((m = RE_SUBSECTION.exec(t))) { push('section', m[1], m[2] ?? '', 1.5, 'Подраздел'); continue; }
    if ((m = RE_CHAPTER.exec(t))) { push('chapter', m[1], m[2] ?? '', 2); continue; }
    if ((m = RE_ARTICLE.exec(t))) { push('article', m[1], m[2] ?? '', 3); continue; }
    if ((m = RE_ARTICLE_GROUP.exec(t))) { push('chapter', m[1], m[2] ?? '', 2, 'Статья'); continue; }
    if ((m = RE_PART.exec(t))) { push('part', m[1], m[2] ?? '', 20); continue; }
    if ((m = RE_POINT.exec(t)) && !line.tableRow) { push('point', m[1], m[2] ?? '', pointRank(m[1]!)); continue; }
    // «1. Общее положение» — раздел, только если это выделенный короткий заголовок: в законах
    // «1. Участие в преступном объединении, …» бывает нумерованным подпунктом статьи
    if ((m = RE_SECTION_NUM.exec(t)) && !line.tableRow && line.emphasized && t.length < 80 && !/[.;,:]$/.test(t)) {
      push('section', m[1], m[2]!, 1);
      continue;
    }
    // Подзаголовок без номера: выделенная короткая строка, не вводная к списку («Запрещены:»).
    // Если жирным набран почти весь документ (так оформлены кодексы Mirage), жирность
    // ничего не значит — тогда заголовком считаем только строку ЗАГЛАВНЫМИ буквами.
    const isPartHeading = line.emphasized && t.length < 40 && /часть\.?$/i.test(t);
    const emphasisMeaningful = emphRatio < 0.5 || t === t.toUpperCase() || isPartHeading;
    if (line.emphasized && emphasisMeaningful && !line.bullet && t.length < 140 && !/[:;,]$/.test(t)) {
      closeAnnotation(top());
      if (/часть$/i.test(t)) {
        stack.length = 0;
        push('heading', undefined, t, 0.5);
      } else {
        while (stack.length && (top()!.rank >= 3 || top()!.node.kind === 'heading' && top()!.rank > 0.5)) stack.pop();
        push('heading', undefined, t, (top()?.rank ?? 0) + 0.5);
      }
      continue;
    }
    addBody(line);
  }

  // Финализация: тело → text, ID, хеши
  return finalize();

  function finalize(): RuleNode[] {
    if (preamble) {
      closeAnnotation(preamble);
      if (preamble.body.length || preamble.node.annotations.length || preamble.node.images.length) {
        preamble.node.text = '';
        roots.unshift(preamble.node);
        draftOf.set(preamble.node, preamble);
      }
    }
    dropTocDuplicates(roots);
    walk(roots, undefined);
    return roots;
  }

  /**
   * Оглавление в начале кодекса («Глава 1 … Глава 13») даёт пустые главы. Если у пустой главы
   * или раздела ниже есть «настоящий» двойник с тем же номером — пустую убираем.
   */
  function dropTocDuplicates(nodes: RuleNode[]) {
    const key = (n: RuleNode) => `${n.kind}|${n.label ?? ''}|${n.number}`;
    const all: RuleNode[] = [];
    (function collect(ns: RuleNode[]) { for (const n of ns) { all.push(n); collect(n.children); } })(nodes);
    // Повторяющиеся картинки — разделители, содержимым узла не считаются
    const imgCount = new Map<string, number>();
    for (const n of all) for (const i of n.images) imgCount.set(i.src, (imgCount.get(i.src) ?? 0) + 1);
    const realImages = (n: RuleNode) => n.images.some((i) => (imgCount.get(i.src) ?? 0) < 3);
    const isEmpty = (n: RuleNode) => !n.children.length && !(draftOf.get(n)?.body.length) && !n.annotations.length && !n.punishments.length;
    const full = new Set(all.filter((n) => (n.kind === 'chapter' || n.kind === 'section') && n.number && (!isEmpty(n) || realImages(n))).map(key));
    (function prune(ns: RuleNode[]) {
      for (let i = ns.length - 1; i >= 0; i--) {
        const n = ns[i]!;
        prune(n.children); // сначала дети: заголовок оглавления пустеет, когда из него ушли главы
        const tocChapter = (n.kind === 'chapter' || n.kind === 'section') && n.number && isEmpty(n) && full.has(key(n));
        // Подзаголовок без текста (строка оглавления, повтор названия, логотип) ничего не даёт игроку
        const emptyHeading = n.kind === 'heading' && isEmpty(n);
        if (tocChapter || emptyHeading) ns.splice(i, 1);
      }
    })(nodes);
  }

  /**
   * ID строится только из собственного номера (и номера статьи/пункта для «ч.»),
   * а не из всей цепочки глав: перенумерация глав на форуме не ломает закладки и ссылки.
   */
  function walk(nodes: RuleNode[], anchorId: string | undefined) {
    for (const n of nodes) {
      const d = draftOf.get(n);
      if (d) {
        closeAnnotation(d);
        if (d.body.length) n.text = [n.text, ...d.body].filter(Boolean).join('\n');
      }
      const seg = segment(n);
      const base = n.kind === 'part' && anchorId ? `${anchorId}/${seg}` : `${opts.docId}#${seg}`;
      const count = usedIds.get(base) ?? 0;
      usedIds.set(base, count + 1);
      n.id = count ? `${base}~${count + 1}` : base;
      const childAnchor = n.kind === 'article' || n.kind === 'point' ? n.id : anchorId;
      walk(n.children, childAnchor);
      n.hash = nodeHash(n);
    }
  }
}

// Черновик хранится рядом с узлом, чтобы финализация видела накопленное тело
const draftOf = new WeakMap<RuleNode, Draft>();

function segment(n: RuleNode): string {
  switch (n.kind) {
    case 'section': return n.label === 'Часть' ? `pt${n.number}` : n.label === 'Подраздел' ? `ps${n.number}` : `s${n.number}`;
    case 'chapter': return `g${n.number}`;
    case 'article': return `a${n.number}`;
    case 'point': return `p${n.number}`;
    case 'part': return `c${n.number}`;
    case 'heading': return `h-${createHash('sha1').update(norm(n.text.split('\n')[0] ?? '')).digest('hex').slice(0, 6)}`;
  }
}

export function nodeHash(n: RuleNode): string {
  const own = {
    k: n.kind, n: n.number, t: n.text, w: n.wanted, j: n.jurisdiction,
    p: n.punishments.map((p) => p.raw), a: n.annotations, i: n.images.map((i) => i.src),
  };
  return createHash('sha256').update(JSON.stringify(own)).digest('hex').slice(0, 16);
}

export function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„'`’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function similar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  return short.length > 10 && long.includes(short);
}
