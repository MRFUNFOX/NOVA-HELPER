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
  /** Для части статьи закона — номер самой статьи */
  article?: string;
}

export interface Index {
  entries: Entry[];
  byId: Map<string, Entry>;
  /** Обратный индекс: основа слова → номера пунктов (в первой строке и во всём тексте) */
  head?: Map<string, number[]>;
  body?: Map<string, number[]>;
  /** Все основы слов по алфавиту — для быстрого поиска по началу слова */
  vocab?: string[];
}

export function nodeLabel(n: RuleNode): string {
  if (n.kind === 'heading') return n.text.split('\n')[0] ?? '';
  const word = n.label ?? (n.kind === 'section' ? 'Раздел' : n.kind === 'chapter' ? 'Глава' : n.kind === 'article' ? 'Статья' : n.kind === 'part' ? 'ч.' : '');
  return [word, n.number].filter(Boolean).join(' ');
}

/** «ПРАВОНАРУШЕНИЯ, ПОСЯГАЮЩИЕ НА…» → «Правонарушения, посягающие на…» — заголовки капсом трудно читать */
export function tameCaps(t: string): string {
  if (t.length < 12 || /[а-яё]/.test(t) || !/[А-ЯЁ]{3}/.test(t)) return t;
  const low = t.replace(/[А-ЯЁ]+/g, (w) => w.toLowerCase());
  return low.charAt(0).toUpperCase() + low.slice(1);
}

/** Подпись на плашке номера: «4.1» в правилах, «ст. 12.1» и «ч. 2» в законах */
export function nodeBadge(n: RuleNode, law: boolean): string {
  if (!n.number) return '';
  if (n.kind === 'article') return `ст. ${n.number}`;
  if (n.kind === 'part' && law) return `ч. ${n.number}`;
  return n.number;
}

export function buildIndex(docs: RuleDocument[]): Index {
  const entries: Entry[] = [];
  const byId = new Map<string, Entry>();
  for (const doc of docs) {
    const walk = (nodes: RuleNode[], path: string[], parent?: RuleNode) => {
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
          article: node.kind === 'part' && parent?.kind === 'article' ? parent.number : undefined,
        };
        entries.push(entry);
        byId.set(node.id, entry);
        const title = tameCaps(firstLine);
        const label = node.kind === 'point' || node.kind === 'part' ? path : [...path, node.kind === 'heading' ? title : `${nodeLabel(node)}. ${title}`.trim()];
        walk(node.children, label, node);
      }
    };
    walk(doc.children, []);
  }
  const head = new Map<string, number[]>();
  const body = new Map<string, number[]>();
  entries.forEach((e, i) => {
    for (const t of e.head) (head.get(t) ?? head.set(t, []).get(t)!).push(i);
    for (const t of e.body) (body.get(t) ?? body.set(t, []).get(t)!).push(i);
  });
  const vocab = [...new Set([...head.keys(), ...body.keys()])].sort();
  return { entries, byId, head, body, vocab };
}

/** Основы слов словаря, начинающиеся с `v` (словарь отсортирован — ищем границу делением пополам) */
function withPrefix(vocab: string[], v: string): string[] {
  let lo = 0, hi = vocab.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (vocab[mid]! < v) lo = mid + 1; else hi = mid; }
  const out: string[] = [];
  for (let i = lo; i < vocab.length && vocab[i]!.startsWith(v); i++) out.push(vocab[i]!);
  return out;
}

export interface Hit {
  entry: Entry;
  score: number;
}

const NUMBER_QUERY = /^(?:п\.?|пункт|статья|ст\.?)?\s*(\d+(?:\.\d+)*)\.?$/i;

/** Сокращения кодексов: «ук 12.1», «ст. 5 ак», «12.1 УК» — статья конкретного кодекса */
const CODES: Record<string, RegExp> = {
  ук: /уголовн\p{L}*\s+кодекс/iu,
  ак: /административн\p{L}*\s+кодекс/iu,
  коап: /административн\p{L}*\s+кодекс/iu,
  пк: /процессуальн\p{L}*\s+кодекс/iu,
  упк: /процессуальн\p{L}*\s+кодекс/iu,
  дк: /дорожн\p{L}*\s+кодекс/iu,
  гк: /гражданск\p{L}*\s+кодекс/iu,
  тк: /трудов\p{L}*\s+кодекс/iu,
  эк: /этическ\p{L}*\s+кодекс/iu,
  конституция: /конституц/iu,
};
const CODE_WORDS = Object.keys(CODES).join('|');
const CODE_QUERY = new RegExp(
  `^(?:(${CODE_WORDS})\\s*(?:ст\\.?|статья)?\\s*(\\d+(?:\\.\\d+)*)|(?:ст\\.?|статья)?\\s*(\\d+(?:\\.\\d+)*)\\s*(${CODE_WORDS}))\\.?$`,
  'iu',
);

/**
 * `only` — искать только в этих документах (в открытом разделе: правила или законы).
 * Запрос со сокращением кодекса («ук 12.1») всегда ищет в законах — там понятно, что нужно.
 */
export function search(index: Index, query: string, limit = 60, only?: (d: RuleDocument) => boolean): Hit[] {
  const q = query.trim();
  if (!q) return [];

  // «ук 12.1», «ст. 5 ак» — статья конкретного кодекса
  const code = CODE_QUERY.exec(normalize(q));
  // «4.5», «п. 4.5», «статья 6» — переход к пункту по номеру
  const num = code ? null : NUMBER_QUERY.exec(q);
  if (code || num) {
    const n = code ? (code[2] ?? code[3])! : num![1]!;
    const docRe = code ? CODES[(code[1] ?? code[4])!]! : null;
    return index.entries
      .filter((e) => (docRe ? docRe.test(e.doc.title) : !only || only(e.doc)))
      .filter((e) => e.node.kind !== 'part' || !code)
      .filter((e) => e.node.number === n || e.node.number?.startsWith(`${n}.`))
      .map((e) => ({ entry: e, score: e.node.number === n ? 100 : 50 - (e.node.number!.split('.').length) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  const words = terms(q).filter((t) => t.length >= 2 || /\d/.test(t));
  if (!words.length) return [];
  // Каждое слово запроса — набор вариантов (само слово + сленг)
  const groups = words.map((w) => [w, ...(SLANG[w] ?? [])]);

  const n = index.entries.length;
  if (!index.vocab) return [];
  const total = new Float32Array(n);
  const alive = new Uint8Array(n).fill(1);
  for (const variants of groups) {
    // Лучшее совпадение слова в каждом пункте: первая строка точно 6 / по началу 4, текст точно 3 / по началу 2
    const best = new Uint8Array(n);
    for (const v of variants) {
      for (const t of withPrefix(index.vocab!, v)) {
        const exact = t === v;
        for (const i of index.head!.get(t) ?? []) best[i] = Math.max(best[i]!, exact ? 6 : 4);
        if (exact || v.length >= 3) for (const i of index.body!.get(t) ?? []) best[i] = Math.max(best[i]!, exact ? 3 : 2);
      }
    }
    for (let i = 0; i < n; i++) { if (!best[i]) alive[i] = 0; else total[i]! += best[i]!; }
  }

  const hits: Hit[] = [];
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const e = index.entries[i]!;
    if (only && !only(e.doc)) continue;
    let score = total[i]!;
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

/** Служебные слова вопроса — по ним искать бесполезно */
const STOP = new Set(
  ('и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между ' +
    'можно ли если ли меня мне могу можно ли будет будут что-то кто-то почему зачем сколько какое какие который которая которое которые это эта')
    .split(/\s+/).filter(Boolean).map((w) => stem(w)),
);

/**
 * Подбор пунктов для ИИ-помощника. В отличие от поиска, здесь вопрос своими словами
 * («можно ли убить копа, если он первый достал оружие»), поэтому пункту не обязательно
 * содержать все слова: чем больше редких слов вопроса в пункте — тем он выше (как BM25).
 */
export function rank(index: Index, text: string, k = 12, only?: (d: RuleDocument) => boolean, boost?: Set<string>): Entry[] {
  if (!index.vocab) return [];
  const n = index.entries.length;
  const score = new Float32Array(n);
  const words = [...new Set(terms(text).filter((t) => (t.length >= 3 || /\d/.test(t) || SLANG[t]) && !STOP.has(t)))];
  for (const w of words) {
    const variants = [w, ...(SLANG[w] ?? [])];
    const hitHead = new Map<number, number>();
    const hitBody = new Map<number, number>();
    for (const v of variants) {
      // По началу слова — только для достаточно длинных основ, иначе «до» найдёт всё подряд
      const forms = v.length >= 4 ? withPrefix(index.vocab, v) : index.body!.has(v) || index.head!.has(v) ? [v] : [];
      for (const t of forms) {
        for (const i of index.head!.get(t) ?? []) hitHead.set(i, 1);
        for (const i of index.body!.get(t) ?? []) hitBody.set(i, 1);
      }
    }
    const df = new Set([...hitHead.keys(), ...hitBody.keys()]).size;
    if (!df) continue;
    const idf = Math.log(1 + n / df);
    for (const i of hitBody.keys()) score[i]! += idf;
    for (const i of hitHead.keys()) score[i]! += idf * 0.8;
  }
  // Номера пунктов прямо в вопросе («по 4.1 можно…») — такие пункты берём обязательно
  for (const m of text.matchAll(/(?<![\d.])(\d+(?:\.\d+)+)(?![\d.])/g)) {
    index.entries.forEach((e, i) => { if (e.node.number === m[1]) score[i]! += 50; });
  }
  const out: { e: Entry; s: number }[] = [];
  for (let i = 0; i < n; i++) {
    const e = index.entries[i]!;
    if (!score[i] || (only && !only(e.doc))) continue;
    // Заголовки разделов сами по себе ответа не содержат
    if (e.node.kind === 'heading' || e.node.kind === 'section' || e.node.kind === 'chapter') continue;
    // Короткие пункты с совпадением весят больше длинных простыней с тем же словом
    const len = e.plain.length;
    // Документы, которые нейросеть сочла подходящими к ситуации, — в приоритете
    const prefer = boost?.has(e.doc.id) ? 3 : 1;
    out.push({ e, s: prefer * score[i]! * (1 + (e.node.punishments.length ? 0.15 : 0)) / Math.pow(Math.max(len, 120) / 300, 0.25) });
  }
  out.sort((a, b) => b.s - a.s);
  if (boost?.size) {
    // Из выбранных документов берём не меньше половины выборки, остальное — лучшее из прочих
    const inDocs = out.filter((x) => boost.has(x.e.doc.id)).slice(0, Math.ceil(k * 0.6));
    const rest = out.filter((x) => !boost.has(x.e.doc.id)).slice(0, k - inDocs.length);
    return [...inDocs, ...rest].sort((a, b) => b.s - a.s).map((x) => x.e);
  }
  // Вопрос часто касается и правил проекта, и законов штата: берём лучшее из обоих,
  // чтобы длинный Уголовный кодекс не вытеснил короткое правило проекта (и наоборот)
  const project = out.filter((x) => x.e.doc.scope !== 'server');
  const laws = out.filter((x) => x.e.doc.scope === 'server');
  if (!project.length || !laws.length) return out.slice(0, k).map((x) => x.e);
  const half = Math.ceil(k / 2);
  const a = project.slice(0, Math.max(half, k - laws.length));
  const b = laws.slice(0, k - a.length);
  return [...a, ...b].sort((x, y) => y.s - x.s).map((x) => x.e);
}
