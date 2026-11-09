import { htmlToLines, type Line } from './text.js';
import { parseStructure, nodeHash, norm } from './structure.js';
import type { Post } from './forum.js';
import type { Amendment, RuleNode } from './types.js';

/*
 * Поправки к правилам публикуются отдельными сообщениями в той же теме:
 *   «Было: <пункт> Стало: <пункт> … Изменения вступают с 19.10.26 в 04:00»
 * или целым блоком новой редакции («Были внесены правки: 2.6 … 2.12 …»),
 * или словами («В пункт 2.13 был добавлен дополнительный запрет. • …»).
 * Основное сообщение темы обновляют не всегда — проверено на «Общих правилах проекта».
 */

const RE_BEFORE = /^(было|старая редакция|прежняя редакция)\s*:?\s*(.*)$/i;
const RE_AFTER = /^(стало|новая редакция|теперь)\s*:?\s*(.*)$/i;
const RE_EFFECTIVE = /вступа\p{L}*\s+(?:в\s+силу\s+)?(?:с\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\s*(?:г\.?)?\s*(?:в|с)?\s*(\d{1,2}):(\d{2}))?/iu;
const RE_FROM_PUBLISH = /вступа\p{L}*.{0,30}с\s+момента\s+публикации/iu;
const RE_NOTICE = /^(?:в|из)\s+(?:пункт|статью|стать[ею])\p{L}*\s+(\d+(?:\.\d+)*)(?![\d.]\d).*$/iu;
const RE_INTRO = /^(добавлены изменения|были внесены (?:правки|изменения)|внесены (?:правки|изменения)|изменения)\s*:?$/i;

interface Version {
  /** Подпись содержимого для сравнения */
  sig: string;
  node: RuleNode;
  postIdx: number;
}

interface ParsedAmendment {
  post: Post;
  postIdx: number;
  effectiveAt?: string;
  before: RuleNode[];
  after: RuleNode[];
  notices: { number: string; lines: string[] }[];
}

/** Время форума — московское (UTC+3). */
function mskIso(d: number, m: number, y: number, hh = 0, mm = 0): string {
  const year = y < 100 ? 2000 + y : y;
  return new Date(Date.UTC(year, m - 1, d, hh - 3, mm)).toISOString();
}

export function parseAmendmentPost(post: Post, postIdx: number): ParsedAmendment | undefined {
  const lines = htmlToLines(post.bodyHtml);
  const text = lines.map((l) => l.text).join('\n');
  const eff = RE_EFFECTIVE.exec(text);
  let effectiveAt: string | undefined;
  if (eff) effectiveAt = mskIso(+eff[1]!, +eff[2]!, +eff[3]!, eff[4] ? +eff[4] : 0, eff[5] ? +eff[5] : 0);
  else if (RE_FROM_PUBLISH.test(text)) effectiveAt = post.postedAt;

  const beforeLines: Line[][] = [];
  const afterLines: Line[] = [];
  const notices: { number: string; lines: string[] }[] = [];
  let mode: 'free' | 'before' | 'after' | 'notice' = 'free';
  let current: Line[] = [];
  let hasMarkers = false;

  const asLine = (t: string, src: Line): Line => ({ ...src, text: t });

  for (const line of lines) {
    const t = line.text;
    if (!t) continue;
    if (RE_EFFECTIVE.test(t) || RE_FROM_PUBLISH.test(t) || RE_INTRO.test(t)) { mode = 'free'; continue; }
    let m: RegExpExecArray | null;
    if ((m = RE_BEFORE.exec(t))) {
      hasMarkers = true;
      mode = 'before';
      current = [];
      beforeLines.push(current);
      if (m[2]) current.push(asLine(m[2], line));
      continue;
    }
    if ((m = RE_AFTER.exec(t))) {
      hasMarkers = true;
      mode = 'after';
      if (m[2]) afterLines.push(asLine(m[2], line));
      continue;
    }
    if ((m = RE_NOTICE.exec(t)) && mode !== 'before') {
      notices.push({ number: m[1]!, lines: [t] });
      mode = 'notice';
      continue;
    }
    if (mode === 'before') current.push(line);
    else if (mode === 'notice' && line.bullet) notices[notices.length - 1]!.lines.push(t);
    else if (mode === 'after' || mode === 'free') {
      // Пост-«новая редакция» без маркеров: каждый нумерованный пункт — новая версия
      if (mode === 'free' && /^(\d+(?:\.\d+)+|статья\s+\d)/i.test(t)) mode = 'after';
      if (mode === 'after') afterLines.push(line);
    } else mode = 'free';
  }

  const parse = (ls: Line[]) => flatten(parseStructure(ls, { docId: `amend-${post.id}` }));
  const before = beforeLines.flatMap(parse);
  const after = parse(afterLines);
  if (!after.length && !notices.length) return undefined;
  void hasMarkers;
  return { post, postIdx, effectiveAt, before, after, notices };
}

/** Только нумерованные узлы (пункты, статьи) — их можно сопоставить с основным текстом. */
function flatten(nodes: RuleNode[]): RuleNode[] {
  const out: RuleNode[] = [];
  const walk = (ns: RuleNode[]) => {
    for (const n of ns) {
      if (n.number && (n.kind === 'point' || n.kind === 'article')) out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function signature(n: RuleNode): string {
  return norm([n.text, ...n.punishments.map((p) => p.raw), ...n.annotations.map((a) => a.text)].join(' '));
}

/** Похожесть по словам (коэффициент Дайса) — терпима к мелкой правке пробелов и кавычек. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const A = a.split(' ');
  const B = b.split(' ');
  if (!A.length || !B.length) return 0;
  const count = new Map<string, number>();
  for (const w of A) count.set(w, (count.get(w) ?? 0) + 1);
  let inter = 0;
  for (const w of B) {
    const c = count.get(w) ?? 0;
    if (c > 0) { inter++; count.set(w, c - 1); }
  }
  return (2 * inter) / (A.length + B.length);
}

const SAME = 0.97;

/**
 * Совпадает ли пункт с версией из поправки. Примечания сравниваются, только если
 * админ привёл их в поправке: в «Было» часто цитируют один текст пункта без примечаний.
 */
export function sameContent(main: RuleNode, ver: RuleNode): boolean {
  const core = (n: RuleNode) => norm([n.text, ...n.punishments.map((p) => p.raw)].join(' '));
  if (similarity(core(main), core(ver)) < SAME) return false;
  if (!ver.annotations.length) return true;
  const ann = (n: RuleNode) => norm(n.annotations.map((a) => a.text).join(' '));
  return similarity(ann(main), ann(ver)) >= 0.9;
}

function plain(n: RuleNode): string {
  const parts = [n.number ? `${n.number} ${n.text}` : n.text];
  for (const p of n.punishments) parts.push(`Наказание: ${p.raw}`);
  for (const a of n.annotations) parts.push(a.text);
  return parts.join('\n');
}

export interface ApplyReport {
  applied: number;
  overlaid: number;
  unmerged: string[];
  conflicts: string[];
  pending: number;
  notices: number;
  added: number;
}

/**
 * Накладывает поправки из сообщений темы на дерево основного сообщения.
 * `now` — время сборки базы: не вступившие в силу поправки помечаются 'pending'.
 */
export function applyAmendments(
  roots: RuleNode[],
  mainPost: Post,
  posts: Post[],
  now: Date,
  loose: Amendment[],
): ApplyReport {
  const report: ApplyReport = { applied: 0, overlaid: 0, unmerged: [], conflicts: [], pending: 0, notices: 0, added: 0 };
  const parsed = posts.map((p, i) => parseAmendmentPost(p, i)).filter((x): x is ParsedAmendment => !!x);
  if (!parsed.length) return report;

  const byNumber = new Map<string, RuleNode>();
  const index = (ns: RuleNode[]) => ns.forEach((n) => {
    if (n.number && (n.kind === 'point' || n.kind === 'article') && !byNumber.has(n.number)) byNumber.set(n.number, n);
    index(n.children);
  });
  index(roots);

  // Цепочки версий по номеру пункта в хронологическом порядке
  type Chain = { versions: Version[]; firstBefore?: Version; amendments: { pa: ParsedAmendment; node: RuleNode }[] };
  const chains = new Map<string, Chain>();
  for (const pa of parsed) {
    for (const b of pa.before) {
      const c = chains.get(b.number!) ?? { versions: [], amendments: [] };
      if (!c.firstBefore) c.firstBefore = { sig: signature(b), node: b, postIdx: pa.postIdx };
      chains.set(b.number!, c);
    }
    for (const a of pa.after) {
      const c = chains.get(a.number!) ?? { versions: [], amendments: [] };
      c.versions.push({ sig: signature(a), node: a, postIdx: pa.postIdx });
      c.amendments.push({ pa, node: a });
      chains.set(a.number!, c);
    }
  }

  const mainEdited = mainPost.editedAt ? new Date(mainPost.editedAt) : undefined;

  for (const [number, chain] of chains) {
    const latest = chain.amendments[chain.amendments.length - 1];
    if (!latest) continue;
    const { pa, node: newNode } = latest;
    const target = byNumber.get(number);
    const base: Omit<Amendment, 'status'> = {
      effectiveAt: pa.effectiveAt,
      postId: pa.post.id,
      postUrl: pa.post.url,
      newText: plain(newNode),
    };

    if (!target) {
      // Новый пункт, которого нет в основном тексте
      const parentNum = number.split('.').slice(0, -1).join('.');
      const parent = byNumber.get(parentNum);
      const pending = pa.effectiveAt && new Date(pa.effectiveAt) > now;
      const status = pending ? 'pending' : 'overlaid';
      if (parent && !pending) {
        const inserted: RuleNode = { ...newNode, id: `${parent.id.split('#')[0]}#p${number}`, children: [], amendments: [{ ...base, status }] };
        inserted.hash = nodeHash(inserted);
        parent.children.push(inserted);
        byNumber.set(number, inserted);
        report.added++;
      } else {
        loose.push({ ...base, status, message: `Поправка добавляет пункт ${number}, которого нет в основном тексте` });
        if (pending) report.pending++; else report.conflicts.push(number);
      }
      continue;
    }

    const previousText = plain(target);
    if (pa.effectiveAt && new Date(pa.effectiveAt) > now) {
      target.amendments.push({ ...base, status: 'pending', previousText });
      report.pending++;
      continue;
    }
    if (sameContent(target, newNode)) {
      target.amendments.push({ ...base, status: 'applied' });
      report.applied++;
      continue;
    }
    const olderVersions = [chain.firstBefore, ...chain.versions.slice(0, -1)].filter((v): v is Version => !!v);
    const matchesOlder = olderVersions.some((v) => sameContent(target, v.node));
    if (!matchesOlder) {
      target.amendments.push({ ...base, status: 'conflict', previousText });
      report.conflicts.push(number);
      continue;
    }
    const postedAt = pa.post.postedAt ? new Date(pa.post.postedAt) : undefined;
    if (mainEdited && postedAt && mainEdited > postedAt) {
      // Основной текст правили уже после поправки, но пункт остался старым
      target.amendments.push({ ...base, status: 'unmerged', previousText });
      report.unmerged.push(number);
      continue;
    }
    // Основной текст устарел — показываем редакцию из поправки
    target.text = newNode.text;
    target.punishments = newNode.punishments;
    target.annotations = newNode.annotations;
    target.wanted = newNode.wanted ?? target.wanted;
    target.jurisdiction = newNode.jurisdiction ?? target.jurisdiction;
    target.amendments.push({ ...base, status: 'overlaid', previousText });
    target.hash = nodeHash(target);
    report.overlaid++;
  }

  // Поправки, описанные словами
  for (const pa of parsed) {
    for (const notice of pa.notices) {
      const target = byNumber.get(notice.number);
      const message = notice.lines.join('\n');
      const added = notice.lines.slice(1).map(norm).filter(Boolean);
      const inMain = target && added.length > 0 && added.every((l) => norm(target.text + ' ' + target.annotations.map((a) => a.text).join(' ')).includes(l));
      const a: Amendment = { status: inMain ? 'applied' : 'notice', effectiveAt: pa.effectiveAt, postId: pa.post.id, postUrl: pa.post.url, message };
      if (target) target.amendments.push(a);
      else loose.push(a);
      report.notices++;
    }
  }
  return report;
}
