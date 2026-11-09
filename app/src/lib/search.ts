import type { RuleDocument, RuleNode } from '@shared/types';
import { stem } from './stem';

/**
 * Поиск по правилам. Всё в памяти: правил ~1 200 пунктов, полный перебор занимает
 * пару миллисекунд и не держит лишних индексов.
 */

/** Сленг игроков → как это написано в правилах (собрано из реальных текстов правил NOVA RP) */
const SLANG: Record<string, string[]> = {
  дм: ['dm', 'deathmatch'],
  дб: ['db', 'driveby'],
  пг: ['pg', 'powergaming'],
  мг: ['mg', 'metagaming'],
  рк: ['rk', 'revenge', 'repeat'],
  ск: ['sk', 'spawnkill', 'spawn'],
  тк: ['tk', 'teamkill', 'team'],
  нлр: ['nlr'],
  нрд: ['nrd'],
  нрф: ['nrf'],
  нрп: ['nonrp', 'nrp'],
  нонрп: ['nonrp', 'nrp'],
  ооц: ['ooc', 'оос'],
  оос: ['ooc', 'оос'],
  ик: ['ic'],
  рп: ['rp', 'рп', 'roleplay'],
  афк: ['afk'],
  бан: ['ban', 'блокир'],
  варн: ['warn'],
  джейл: ['jail', 'деморган'],
  деморган: ['jail', 'деморган'],
  мут: ['mute', 'rmute'],
  кик: ['kick'],
  чс: ['чс', 'черн'],
};
// И в обратную сторону: «dm» ищет и «дм»
for (const [ru, list] of Object.entries(SLANG)) {
  for (const en of list) if (/^[a-z]+$/.test(en)) SLANG[en] ??= [...list, ru];
}

export function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е');
}

const WORD = /[\p{L}\p{N}]+/gu;

/** Основы слов текста: русские — через стеммер, латиница и числа — как есть */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const m of normalize(text).matchAll(WORD)) {
    const w = m[0];
    out.push(/[а-я]/.test(w) ? stem(w) : w);
  }
  return out;
}

export interface Entry {
  node: RuleNode;
  doc: RuleDocument;
  /** Цепочка заголовков над пунктом — для подписи в результатах */
  path: string[];
  /** Основы слов номера и первой строки — совпадение здесь весит больше */
  head: Set<string>;
  body: Set<string>;
  /** Весь текст пункта одной строкой (для подсветки фрагмента) */
  plain: string;
}

export interface Index {
  entries: Entry[];
  byId: Map<string, Entry>;
}

export function nodeLabel(n: RuleNode): string {
  if (n.kind === 'heading') return n.text.split('\n')[0] ?? '';
  const word = n.label ?? (n.kind === 'section' ? 'Раздел' : n.kind === 'chapter' ? 'Глава' : n.kind === 'article' ? 'Статья' : n.kind === 'part' ? 'ч.' : '');
  return [word, n.number].filter(Boolean).join(' ');
}

export function buildIndex(docs: RuleDocument[]): Index {
  const entries: Entry[] = [];
  const byId = new Map<string, Entry>();
  for (const doc of docs) {
    const walk = (nodes: RuleNode[], path: string[]) => {
      for (const node of nodes) {
        const firstLine = node.text.split('\n')[0] ?? '';
        const extra = [
          ...node.punishments.map((p) => p.raw),
          ...node.annotations.map((a) => a.text),
          ...node.amendments.map((a) => a.newText ?? a.message ?? ''),
        ].join(' ');
        const entry: Entry = {
          node, doc, path,
          head: new Set(terms(`${node.number ?? ''} ${firstLine}`)),
          body: new Set(terms(`${node.text} ${extra}`)),
          plain: [node.text, extra].filter(Boolean).join('\n'),
        };
        entries.push(entry);
        byId.set(node.id, entry);
        const label = node.kind === 'point' || node.kind === 'part' ? path : [...path, node.kind === 'heading' ? firstLine : `${nodeLabel(node)}. ${firstLine}`.trim()];
        walk(node.children, label);
      }
    };
    walk(doc.children, []);
  }
  return { entries, byId };
}

export interface Hit {
  entry: Entry;
  score: number;
}

const NUMBER_QUERY = /^(?:п\.?|пункт|статья|ст\.?)?\s*(\d+(?:\.\d+)*)\.?$/i;

export function search(index: Index, query: string, limit = 60): Hit[] {
  const q = query.trim();
  if (!q) return [];

  // «4.5», «п. 4.5», «статья 6» — переход к пункту по номеру
  const num = NUMBER_QUERY.exec(q);
  if (num) {
    const n = num[1]!;
    return index.entries
      .filter((e) => e.node.number === n || e.node.number?.startsWith(`${n}.`))
      .map((e) => ({ entry: e, score: e.node.number === n ? 100 : 50 - (e.node.number!.split('.').length) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  const words = terms(q).filter((t) => t.length >= 2 || /\d/.test(t));
  if (!words.length) return [];
  // Каждое слово запроса — набор вариантов (само слово + сленг)
  const groups = words.map((w) => [w, ...(SLANG[w] ?? [])]);

  const hits: Hit[] = [];
  for (const e of index.entries) {
    let score = 0;
    let all = true;
    for (const variants of groups) {
      let best = 0;
      for (const v of variants) {
        for (const t of e.head) {
          if (t === v) best = Math.max(best, 6);
          else if (t.startsWith(v)) best = Math.max(best, 4);
        }
        if (best >= 6) break;
        for (const t of e.body) {
          if (t === v) best = Math.max(best, 3);
          else if (v.length >= 3 && t.startsWith(v)) best = Math.max(best, 2);
        }
      }
      if (!best) { all = false; break; }
      score += best;
    }
    if (!all) continue;
    // Пункт с наказанием игроку нужнее, чем общее положение; заголовки — ниже пунктов
    if (e.node.punishments.length) score += 1;
    // Общие правила проекта — главный документ: при равенстве они выше правил отдельных мероприятий
    if (e.doc.category === 'Общие правила') score += 1;
    if (e.node.kind === 'heading' || e.node.kind === 'section' || e.node.kind === 'chapter') score -= 2;
    hits.push({ entry: e, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Фрагмент текста вокруг первого совпадения и участки для подсветки */
export function snippet(text: string, query: string, max = 160): { text: string; marks: [number, number][] } {
  const flat = text.replace(/^-\s+/, '').replace(/\s*\n(?:-\s+)?\s*/g, ' · ');
  const qs = terms(query).filter((t) => t.length >= 2);
  const variants = qs.flatMap((w) => [w, ...(SLANG[w] ?? [])]).filter((v) => v.length >= 2);
  const lower = normalize(flat);
  const found: [number, number][] = [];
  for (const m of lower.matchAll(WORD)) {
    const w = m[0];
    const s = /[а-я]/.test(w) ? stem(w) : w;
    if (variants.some((v) => s.startsWith(v) || w.startsWith(v))) found.push([m.index!, m.index! + w.length]);
  }
  const first = found[0]?.[0] ?? 0;
  const start = flat.length <= max || first < max * 0.4 ? 0 : Math.max(0, first - Math.floor(max * 0.35));
  const end = Math.min(flat.length, start + max);
  const cut = flat.slice(start, end);
  const marks = found.filter(([a, b]) => a >= start && b <= end).map(([a, b]) => [a - start + (start ? 1 : 0), b - start + (start ? 1 : 0)] as [number, number]);
  return { text: (start ? '…' : '') + cut + (end < flat.length ? '…' : ''), marks };
}
