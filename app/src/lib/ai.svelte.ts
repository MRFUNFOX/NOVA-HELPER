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
  /** Что выбрала нейросеть перед поиском — показываем в режиме разработчика */
  plan?: { docs: string[]; keywords: string };
}

const SYSTEM = `Ты — ИИ-помощник программы NOVA HELPER для игроков и администраторов GTA 5 RP-проекта NOVA RP (сервер Horizon).
Ты разбираешь игровые ситуации как опытный администратор проекта, опираясь на фрагменты правил и законов из сообщения.

Как отвечать:
- По-русски, по делу, без вступлений. Обычно 3–7 предложений.
- Если вопрос — ситуация, разбери её: кто из участников что нарушил или не нарушил и почему, какое наказание грозит.
  Применяй правила к ситуации, даже если она описана другими словами: «растулил», «завалил», «положил» = убил; «коп» = сотрудник полиции; «РП» = RolePlay и т. п.
- После каждого утверждения ставь ссылку на фрагмент в квадратных скобках: [S2]. Ссылайся только на номера из списка фрагментов.
- Если прямого правила нет, но есть близкие — ответь по ним и прямо скажи, что это толкование.
- Только если во фрагментах совсем ничего по теме — скажи «В правилах об этом ничего не нашлось» и подскажи, что уточнить. Ничего не выдумывай и не бери правила других проектов.
- «Правила проекта» — правила NOVA RP, за нарушение которых наказывает администрация (JAIL, WARN, BAN).
  «Законы» — законы штата внутри игры: по ним работают полиция, суд и прокуратура. Если подходит и то и другое — скажи про оба.
- Без заголовков и таблиц. Главное можно выделить **жирным**.`;

/** Первый шаг: нейросеть видит список всех документов и выбирает подходящие к вопросу */
const PLAN = `Игрок GTA 5 RP-проекта NOVA RP задаёт вопрос или описывает игровую ситуацию. Ниже — список документов с правилами проекта и законами штата.
1. Выбери 1–5 документов, в которых, скорее всего, есть ответ. Общие правила проекта подходят почти всегда, если речь о нарушении (DM, NonRP, PG, MG и т. п.).
2. Составь 5–12 слов для поиска по тексту правил: официальные термины и сокращения (DeathMatch DM, NonRP, PowerGaming PG, MetaGaming MG, RevengeKill RK, DriveBy DB, TeamKill TK, ООС, IC, ограбление, похищение, задержание),
   как это пишется в правилах (например «растулил»/«завалил» → «убийство», «коп» → «сотрудник полиции LSPD»), номера пунктов и статей из вопроса.
Ответ строго в JSON: {"docs": ["D3", "D12"], "keywords": ["…"]}`;

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
      const prev = this.turns.length > 1 ? this.turns[this.turns.length - 2]!.q : '';

      // 1. Нейросеть выбирает подходящие документы и переводит разговорный вопрос на язык правил
      const docs = app.db.docs;
      const catalog = docs.map((d, i) => `D${i + 1} [${d.scope === 'server' ? 'Законы' : 'Правила'}] ${shortTitle(d.title)}`).join('\n');
      let extra = '';
      const boost = new Set<string>();
      try {
        const raw = await backend.aiComplete([
          { role: 'system', content: PLAN },
          { role: 'user', content: `Документы:\n${catalog}\n\n${prev ? `Предыдущий вопрос: ${prev}\n` : ''}Вопрос: ${q}` },
        ]);
        const plan = JSON.parse(raw) as { docs?: unknown; keywords?: unknown };
        if (Array.isArray(plan.keywords)) extra = plan.keywords.filter((x) => typeof x === 'string').join(' ');
        if (Array.isArray(plan.docs)) {
          for (const id of plan.docs) {
            const d = docs[Number(String(id).replace(/\D/g, '')) - 1];
            if (d) boost.add(d.id);
          }
        }
      } catch { /* без подсказки ищем по самому вопросу */ }
      t.plan = { docs: [...boost].map((id) => shortTitle(app.doc(id)?.title ?? id)), keywords: extra };

      // 2. Подбор пунктов: по вопросу, словам-подсказкам и прошлому вопросу (для уточнений «а если…»)
      const entries = rank(app.index, `${q} ${extra} ${prev}`, 16, undefined, boost);
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
  const lines = [`[S${s.n}] ${where}${num ? ` › ${law ? num : `п. ${num}`}` : ''}`, cut(e.node.text, 550)];
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
