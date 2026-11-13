/**
 * ИИ-помощник: вопрос своими словами → подбор пунктов правил и законов → ответ нейросети (Groq или Z.ai)
 * со ссылками на эти пункты. Нейросеть видит только подобранные пункты и обязана на них
 * ссылаться, поэтому отвечает по нашим правилам, а не «из головы».
 */
import type { RuleDocument } from '@shared/types';
import { backend, type AiProvider, type AiStatus, type ChatMsg } from './backend';
import { app, sectionOf, shortTitle, type Section } from './state.svelte';
import { nodeBadge, rank, type Entry } from './search';
import { slang } from './slang';
import { errorKind, track } from './stats';

export interface Source { n: number; entry: Entry }
export interface Turn {
  id: string;
  q: string;
  a: string;
  sources: Source[];
  pending: boolean;
  error?: string;
  /** Где искать ответ; пока не выбрано — игрок видит выбор «Правила / Законы» */
  scope?: Section;
  /** Что выбрала нейросеть перед поиском — показываем в режиме разработчика */
  plan?: { docs: string[]; keywords: string };
  /** Сколько заняли шаги, в секундах — для режима разработчика */
  time?: { plan?: number; first?: number; total?: number; start?: number };
  /** Какая модель отвечала */
  model?: string;
}

/** Инструкция для ответа. Отдельная часть — для правил проекта и для законов штата */
function system(scope: Section) {
  const where = scope === 'laws'
    ? `Ты отвечаешь только по законам штата — по ним в игре работают полиция, суд и прокуратура. Называй статью и что грозит персонажу (срок, штраф, лишение лицензии).
Правила проекта и наказания администрации (JAIL, WARN, BAN) здесь не обсуждай.`
    : `Ты отвечаешь только по правилам проекта NOVA RP — за их нарушение наказывает администрация (JAIL, WARN, BAN).
Законы штата (статьи, сроки, штрафы) здесь не обсуждай.`;
  const nothing = scope === 'laws' ? 'В законах об этом ничего не нашлось' : 'В правилах об этом ничего не нашлось';
  return `Ты — помощник программы NOVA HELPER для игроков GTA 5 RP-проекта NOVA RP (сервер Horizon).
${where}

Как отвечать:
- Коротко и простыми словами, как опытный игрок другу: 2–4 коротких предложения, не больше 60 слов.
- Первое предложение — прямой ответ: «Да, можно», «Нет, это нарушение», «Нарушил грабитель, а не охранник» и т. п.
- Дальше одно-два предложения: какой пункт нарушен и какое наказание. Упоминай только 1–2 самых важных пункта, остальные не пересказывай.
- Термины поясняй в скобках: DM (убийство без причины), PG (действия, невозможные в реальной жизни).
- Без списков, нумерации, заголовков и таблиц. Самое главное выдели **жирным** — одно-два места.
- После утверждения ставь ссылку на фрагмент: [S2]. Только номера из списка фрагментов.
- Сленг: «растулил», «завалил», «положил» = убил; «коп» = сотрудник полиции; «РП» = RolePlay.
- Читай пункт внимательно и не приписывай ему то, чего в нём нет. Если прямого пункта нет — ответь по близкому и скажи «скорее всего».
- Если во фрагментах ничего по теме — скажи «${nothing}» и что стоит уточнить. Ничего не выдумывай.`;
}

/** Первый шаг: нейросеть видит список документов раздела и выбирает подходящие к вопросу */
const PLAN = `Игрок GTA 5 RP-проекта NOVA RP задаёт вопрос или описывает игровую ситуацию. Ниже — список документов.
1. Выбери 1–4 документа, в которых, скорее всего, есть ответ. Если речь о нарушении правил проекта (DM, NonRP, PG, MG и т. п.), общие правила проекта подходят почти всегда.
2. Составь 5–12 слов для поиска по тексту: официальные термины и сокращения (DeathMatch DM, NonRP, PowerGaming PG, MetaGaming MG, RevengeKill RK, DriveBy DB, TeamKill TK, ООС, IC, ограбление, похищение, задержание),
   как это пишется в документах (например «растулил»/«завалил» → «убийство», «коп» → «сотрудник полиции LSPD»), номера пунктов и статей из вопроса.
Ответ строго в JSON: {"docs": ["D3", "D12"], "keywords": ["…"]}`;

export const SCOPES: Record<Section, { label: string; hint: string }> = {
  project: { label: 'Правила проекта', hint: 'Накажет ли администрация: JAIL, WARN, BAN' },
  laws: { label: 'Законы штата', hint: 'Что грозит в игре: статья, срок, штраф' },
};

class Assistant {
  status = $state<AiStatus | null>(null);
  turns = $state<Turn[]>([]);
  busy = $state(false);
  /** Открыта пошаговая настройка (разовая после обновления или по кнопке «Настроить») */
  setupOpen = $state(false);
  /** С какой нейросети начать настройку (выбрали в списке ту, для которой нет ключа) */
  setupService = $state<AiProvider | null>(null);
  private chunkOff: (() => void) | null = null;

  get ready() { return !!this.status?.hasKey; }

  async init() {
    try { this.status = await backend.aiStatus(); } catch { this.status = { hasKey: false, keyHint: '', model: null }; }
    this.chunkOff ??= await backend.on('ai-chunk', (p) => {
      const { id, delta } = p as { id: string; delta: string };
      const t = this.turns.find((x) => x.id === id);
      if (!t) return;
      if (t.time?.start && t.time.first === undefined) t.time.first = Math.round((performance.now() - t.time.start) / 100) / 10;
      t.a += delta;
    });
  }

  async setKey(key: string) {
    this.status = await backend.aiSetKey(key);
    return this.status;
  }

  get provider(): AiProvider { return this.status?.provider === 'Z.ai' ? 'zai' : 'groq'; }
  has(p: AiProvider) { return p === 'zai' ? !!this.status?.hasZai : !!this.status?.hasGroq; }

  /** Выбор нейросети в списке: есть ключ — переключаемся, нет — открываем настройку для неё */
  async use(p: AiProvider) {
    if (p === this.provider && this.ready) return;
    if (!this.has(p)) { this.setupService = p; this.setupOpen = true; return; }
    this.status = await backend.aiUse(p);
  }

  async clearKey() {
    this.status = await backend.aiClearKey();
    this.turns = [];
  }

  clear() { this.turns = []; }

  /** Вопрос игрока. Отвечаем по разделу, выбранному в меню слева: «Правила» или «Законы» */
  ask(question: string) {
    const q = question.trim();
    if (!q || this.busy) return;
    const scope: Section = app.hasLaws ? app.section : 'project';
    this.turns.push({ id: `${Date.now()}`, q, a: '', sources: [], pending: true, scope });
    void this.answer(this.turns[this.turns.length - 1]!); // реактивная копия
  }

  private async answer(t: Turn) {
    const q = t.q;
    const scope = t.scope!;
    this.busy = true;
    try {
      const i = this.turns.indexOf(t);
      // Прошлый вопрос того же раздела — для уточнений «а если…»
      const before = this.turns.slice(0, i).filter((x) => x.scope === scope && x.a && !x.error);
      const prev = before.at(-1)?.q ?? '';
      const inScope = (d: RuleDocument) => sectionOf(d) === scope;

      const t0 = performance.now();
      const sec = () => Math.round((performance.now() - t0) / 100) / 10;
      t.time = { start: t0 };
      // Бесплатные модели Z.ai медленные — для них пропускаем шаг выбора документов (минус один запрос),
      // а разговорные слова переводим сами
      const fast = this.provider === 'zai';

      // 1. Нейросеть выбирает подходящие документы и переводит разговорный вопрос на язык правил
      const docs = app.db.docs.filter(inScope);
      const catalog = docs.map((d, n) => `D${n + 1} ${shortTitle(d.title)}`).join('\n');
      let extra = slang(`${q} ${prev}`);
      const boost = new Set<string>();
      if (!fast) try {
        const raw = await backend.aiComplete([
          { role: 'system', content: PLAN },
          { role: 'user', content: `Документы (${SCOPES[scope].label.toLowerCase()}):\n${catalog}\n\n${prev ? `Предыдущий вопрос: ${prev}\n` : ''}Вопрос: ${q}` },
        ]);
        const plan = JSON.parse(raw) as { docs?: unknown; keywords?: unknown };
        if (Array.isArray(plan.keywords)) extra += ' ' + plan.keywords.filter((x) => typeof x === 'string').join(' ');
        if (Array.isArray(plan.docs)) {
          for (const id of plan.docs) {
            const d = docs[Number(String(id).replace(/\D/g, '')) - 1];
            if (d) boost.add(d.id);
          }
        }
      } catch { /* без подсказки ищем по самому вопросу */ }
      if (!fast) t.time.plan = sec();
      t.plan = { docs: [...boost].map((id) => shortTitle(app.doc(id)?.title ?? id)), keywords: extra.trim() };

      // 2. Подбор пунктов только в выбранном разделе: по вопросу, словам-подсказкам и прошлому вопросу
      const entries = rank(app.index, `${q} ${extra} ${prev}`, fast ? 10 : 14, inScope, boost);
      t.sources = entries.map((entry, n) => ({ n: n + 1, entry }));

      // 3. Ответ: пункты + последние пару вопросов-ответов того же раздела
      const history: ChatMsg[] = before.slice(-2).flatMap((x) => [
        { role: 'user' as const, content: x.q },
        { role: 'assistant' as const, content: x.a.replace(/\s*\[S\d+(?:\s*,\s*S\d+)*\]/g, '') },
      ]);
      const context = t.sources.length
        ? t.sources.map((s) => fragment(s, fast ? 420 : 550)).join('\n\n')
        : '(подходящих фрагментов не найдено)';
      await backend.aiChat(t.id, [
        { role: 'system', content: system(scope) },
        ...history,
        { role: 'user', content: `Фрагменты:\n\n${context}\n\nВопрос игрока: ${q}\n\n(Ответь коротко: 2–4 предложения.)` },
      ]).then((r) => { if (!t.a) t.a = r.text; t.model = r.model; });
      t.time.total = sec();
      track('ai_answer', { provider: this.provider, scope, model: t.model ?? '', first: t.time.first ?? t.time.total, total: t.time.total, sources: t.sources.length });
    } catch (e) {
      t.error = String(e);
      track('ai_error', { provider: this.provider, scope, kind: errorKind(t.error) });
    } finally {
      t.pending = false;
      this.busy = false;
    }
  }
}

/** Фрагмент для нейросети: откуда пункт, номер, текст, наказание, примечания */
function fragment(s: Source, max = 550): string {
  const e = s.entry;
  const law = e.doc.scope === 'server';
  const where = [law ? 'Законы штата' : 'Правила проекта', shortTitle(e.doc.title), ...e.path.slice(-2)].join(' › ');
  const num = e.article ? `ст. ${e.article}, ч. ${e.node.number}` : nodeBadge(e.node, law) || '';
  const lines = [`[S${s.n}] ${where}${num ? ` › ${law ? num : `п. ${num}`}` : ''}`, cut(e.node.text, max)];
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
