/**
 * ИИ-помощник: вопрос своими словами → подбор пунктов правил и законов → ответ Groq
 * со ссылками на эти пункты. Нейросеть видит только подобранные пункты и обязана на них
 * ссылаться, поэтому отвечает по нашим правилам, а не «из головы».
 */
import { backend, type AiStatus, type ChatMsg } from './backend';
import { app, shortTitle } from './state.svelte';
import { nodeBadge, rank, type Entry } from './search';

export interface Source { n: number; entry: Entry }
export interface Turn {
  id: string;
  q: string;
  a: string;
  sources: Source[];
  pending: boolean;
  error?: string;
}

const SYSTEM = `Ты — ИИ-помощник программы NOVA HELPER для игроков GTA 5 RP-проекта NOVA RP (сервер Horizon).
Отвечай на вопрос игрока ТОЛЬКО по фрагментам правил и законов, которые даны в сообщении.

Как отвечать:
- По-русски, коротко: 2–5 предложений, без вступлений и без повторения вопроса.
- После каждого утверждения ставь ссылку на фрагмент в квадратных скобках: [S2]. Ссылайся только на номера из списка фрагментов.
- Если важно наказание — назови его.
- «Правила проекта» — правила NOVA RP, за нарушение которых наказывает администрация (JAIL, WARN, BAN).
  «Законы» — законы штата внутри игры: по ним работают полиция, суд и прокуратура. Если подходит и то и другое — скажи про оба.
- Если во фрагментах нет ответа — так и скажи: «В правилах об этом ничего не нашлось» — и подскажи, как переспросить. Ничего не придумывай и не опирайся на правила других проектов.
- Без заголовков, списков и таблиц. Главное можно выделить **жирным**.`;

const KEYWORDS = `Игрок задаёт вопрос о правилах GTA 5 RP-проекта (NOVA RP). Составь 4–10 слов и сокращений для поиска по тексту правил:
официальные термины и их сокращения (DeathMatch DM, NonRP, PowerGaming PG, MetaGaming MG, RevengeKill RK, DriveBy DB, TeamKill TK, ООС, IC),
синонимы и формы слов, как они пишутся в правилах (например «убить» → «убийство», «коп» → «сотрудник полиции LSPD»),
номера пунктов и статей, если они есть в вопросе. Ответ строго в JSON: {"keywords": ["…"]}`;

class Assistant {
  status = $state<AiStatus | null>(null);
  turns = $state<Turn[]>([]);
  busy = $state(false);
  /** Открыта пошаговая настройка (разовая после обновления или по кнопке «Настроить») */
  setupOpen = $state(false);
  private chunkOff: (() => void) | null = null;

  get ready() { return !!this.status?.hasKey; }

  async init() {
    try { this.status = await backend.aiStatus(); } catch { this.status = { hasKey: false, keyHint: '', model: null }; }
    this.chunkOff ??= await backend.on('ai-chunk', (p) => {
      const { id, delta } = p as { id: string; delta: string };
      const t = this.turns.find((x) => x.id === id);
      if (t) t.a += delta;
    });
  }

  async setKey(key: string) {
    this.status = await backend.aiSetKey(key);
    return this.status;
  }

  async clearKey() {
    this.status = await backend.aiClearKey();
    this.turns = [];
  }

  clear() { this.turns = []; }

  async ask(question: string) {
    const q = question.trim();
    if (!q || this.busy) return;
    const turn: Turn = { id: `${Date.now()}`, q, a: '', sources: [], pending: true };
    this.turns.push(turn);
    const t = this.turns[this.turns.length - 1]!; // реактивная копия
    this.busy = true;
    try {
      // 1. Слова для поиска: нейросеть переводит разговорный вопрос на язык правил
      let extra = '';
      try {
        const raw = await backend.aiComplete([{ role: 'system', content: KEYWORDS }, { role: 'user', content: q }]);
        const kw = (JSON.parse(raw) as { keywords?: unknown }).keywords;
        if (Array.isArray(kw)) extra = kw.filter((x) => typeof x === 'string').join(' ');
      } catch { /* без подсказки ищем по самому вопросу */ }

      // 2. Подбор пунктов: по вопросу, словам-подсказкам и прошлому вопросу (для уточнений «а если…»)
      const prev = this.turns.length > 1 ? this.turns[this.turns.length - 2]!.q : '';
      const entries = rank(app.index, `${q} ${extra} ${prev}`, 12);
      t.sources = entries.map((entry, i) => ({ n: i + 1, entry }));

      // 3. Ответ: пункты + последние пару вопросов-ответов, чтобы понимать уточнения
      const history: ChatMsg[] = this.turns.slice(-3, -1).flatMap((x) => (x.a && !x.error ? [
        { role: 'user' as const, content: x.q },
        { role: 'assistant' as const, content: x.a.replace(/\s*\[S\d+(?:\s*,\s*S\d+)*\]/g, '') },
      ] : []));
      const context = t.sources.length
        ? t.sources.map((s) => fragment(s)).join('\n\n')
        : '(подходящих фрагментов не найдено)';
      await backend.aiChat(t.id, [
        { role: 'system', content: SYSTEM },
        ...history,
        { role: 'user', content: `Фрагменты:\n\n${context}\n\nВопрос игрока: ${q}` },
      ]).then((r) => { if (!t.a) t.a = r.text; });
    } catch (e) {
      t.error = String(e);
    } finally {
      t.pending = false;
      this.busy = false;
    }
  }
}

/** Фрагмент для нейросети: откуда пункт, номер, текст, наказание, примечания */
function fragment(s: Source): string {
  const e = s.entry;
  const law = e.doc.scope === 'server';
  const where = [law ? 'Законы штата' : 'Правила проекта', shortTitle(e.doc.title), ...e.path.slice(-2)].join(' › ');
  const num = e.article ? `ст. ${e.article}, ч. ${e.node.number}` : nodeBadge(e.node, law) || '';
  const lines = [`[S${s.n}] ${where}${num ? ` › ${law ? num : `п. ${num}`}` : ''}`, cut(e.node.text, 700)];
  for (const p of e.node.punishments) lines.push(`Наказание: ${p.raw}`);
  for (const a of e.node.annotations) lines.push(`${a.type === 'exception' ? 'Исключение' : 'Примечание'}: ${cut(a.text, 300)}`);
  return lines.join('\n');
}

function cut(t: string, max: number) {
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export const ai = new Assistant();

/** Подпись ссылки в ответе: «4.1» или «ст. 12.1» и короткое название документа */
export function sourceLabel(s: Source) {
  const e = s.entry;
  const law = e.doc.scope === 'server';
  const num = e.article ? `ст. ${e.article} ч. ${e.node.number}` : nodeBadge(e.node, law);
  return { num: num || '§', doc: shortTitle(e.doc.title) };
}

/** Ответ на кусочки: текст, **жирное** и ссылки [S3] / [S1, S4] */
export type Piece = { t: 'text' | 'bold'; v: string } | { t: 'ref'; n: number };
export function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  const re = /\*\*(.+?)\*\*|\[(S\d+(?:\s*[,;]\s*S\d+)*)\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    if (m[1]) out.push({ t: 'bold', v: m[1] });
    else for (const r of m[2]!.split(/[,;]/)) out.push({ t: 'ref', n: Number(r.trim().slice(1)) });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}
