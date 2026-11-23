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
import { learn, type Note } from './learn.svelte';
import { HISTORY_KEY, nickFormat, nickIn, people, pushHistory, sanitizeHistory, type HistItem, type NickCheck, type Rating } from './aiExtras';

export interface Source { n: number; entry: Entry }
/** Принятое разъяснение в ответе: ссылка [N1] */
export interface NoteSource { n: number; note: Note }
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
  /** Разъяснения, которые видела нейросеть */
  notes?: NoteSource[];
  /** Игрок спорит с прошлым ответом — нейросеть разбирает его довод */
  debate?: boolean;
  /** Итог разбора: согласилась ли нейросеть и какое правило из этого следует */
  verdict?: Verdict;
  /** Отправка довода на проверку команде */
  learnState?: 'checking' | 'sent' | 'off' | 'error';
  /** Когда задан */
  at?: number;
  /** «Помог / Не помог» */
  rating?: Rating;
  /** Проверка ника вместо обычного ответа */
  nick?: NickCheck;
  /** Открыт из истории — не пишем в историю повторно */
  fromHistory?: boolean;
  /** Вопрос задан голосом — нейросеть дописывает короткий вариант для озвучки */
  voice?: boolean;
  /** Что сказать вслух: 1–2 разговорные фразы (в окне ИИ — полный ответ) */
  spoken?: string;
}

export interface Verdict { agree: boolean; refs: string; note: string; keywords: string[] }

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
- Первое предложение — прямой ответ на вопрос. На вопросы «можно ли», «нарушение ли», «накажут ли» начинай с «Да» или «Нет»: «Да, можно», «Нет, это нарушение», «Нарушил грабитель, а не охранник».
  На вопросы «зачем», «почему», «что даёт», «как», «что такое» отвечай по сути, без «Да» и «Нет» в начале.
- Дальше одно-два предложения: какой пункт нарушен и какое наказание. Упоминай только 1–2 самых важных пункта, остальные не пересказывай.
- Термины поясняй в скобках: DM (убийство без причины), PG (действия, невозможные в реальной жизни).
- Без списков, нумерации, заголовков и таблиц. Самое главное выдели **жирным** — одно-два места.
- После утверждения ставь ссылку на фрагмент в квадратных скобках: [S2]. Только номера из списка фрагментов.
- Фрагменты [N1], [N2] — проверенные разъяснения команды программы: как правильно толковать пункты. Если разъяснение относится к вопросу, опирайся на него и ставь ссылку [N1].
- Не путай понятия: например, оружие и спецсредства (бронежилет, тайзер, дубинка, наручники) — разные вещи, правило для одного не переноси на другое.
- Сленг: «растулил», «завалил», «положил» = убил; «коп» = сотрудник полиции; «РП» = RolePlay.
- Читай пункт внимательно и не приписывай ему то, чего в нём нет. Если прямого пункта нет — ответь по близкому и скажи «скорее всего».
- Если во фрагментах ничего по теме — скажи «${nothing}» и что стоит уточнить. Ничего не выдумывай.`;
}

/** Первый шаг: нейросеть видит список документов раздела и выбирает подходящие к вопросу */
const PLAN = `Игрок GTA 5 RP-проекта NOVA RP задаёт вопрос или описывает игровую ситуацию. Ниже — список документов.
1. Выбери 1–4 документа, в которых, скорее всего, есть ответ. Если речь о нарушении правил проекта (DM, NonRP, PG, MG и т. п.), общие правила проекта подходят почти всегда.
2. Составь 5–12 слов для поиска по тексту: официальные термины и сокращения (DeathMatch DM, NonRP, PowerGaming PG, MetaGaming MG, RevengeKill RK, DriveBy DB, TeamKill TK, ООС, IC, ограбление, похищение, задержание),
   как это пишется в документах (например «растулил»/«завалил» → «убийство», «коп» → «сотрудник полиции LSPD»), номера пунктов и статей из вопроса.
3. "dispute": true, если игрок не согласен с прошлым ответом помощника или приводит довод, что тот ошибся («но ведь…», «там не сказано…», «ты не прав»); иначе false.
Ответ строго в JSON: {"docs": ["D3", "D12"], "keywords": ["…"], "dispute": false}`;

/** Игрок спорит с прошлым ответом: честная проверка довода по тексту */
function debateSystem(scope: Section) {
  const where = scope === 'laws' ? 'законам штата' : 'правилам проекта NOVA RP';
  return `Ты — помощник программы NOVA HELPER для игроков GTA 5 RP-проекта NOVA RP (сервер Horizon). Отвечаешь по ${where}.
Игрок не согласен с твоим прошлым ответом и приводит довод. Проверь довод честно, только по тексту фрагментов:
1. Что именно запрещает или разрешает пункт, на который ссылаются. Если наказание — за «незаконное» действие, найди, какая норма делает его незаконным. Нет такой нормы — значит, действие не запрещено.
2. Есть ли во фрагментах пункт, который прямо делает это действие нарушением.
3. Не путаются ли понятия (например, оружие и спецсредство) и нет ли исключений.
Соглашайся только если довод подтверждается текстом. Уверенный тон игрока — не аргумент. Если довод неверен — назови пункт, который ему противоречит.
Если твой прошлый ответ был неверным — прямо скажи об этом.

Как отвечать:
- Первое предложение: «Вы правы.», «Вы не правы.» или «Отчасти правы.»
- Затем 3–6 коротких предложений объяснения простыми словами, не больше 120 слов. Без списков и заголовков. Главное выдели **жирным**.
- После утверждения ставь ссылку в квадратных скобках: [S2] или [N1]. Только номера из списка фрагментов.
- В самом конце, с новой строки, служебная строка (игрок её не увидит), строго в таком виде:
ИТОГ: {"agree": true, "refs": "ст. 4 ч. 1, ст. 11", "note": "…", "keywords": ["…"]}
  agree — прав ли игрок; refs — номера пунктов, на которых держится вывод; note — правильное толкование общим правилом в 1–3 предложениях, без «вы», с номерами пунктов и названием документа; keywords — 3–8 слов, по которым это правило искать (разные формы и сленг).`;
}

/** Повторная проверка толкования перед отправкой команде */
const VERIFY = `Ты проверяешь толкование правил GTA 5 RP-проекта. Ниже фрагменты правил или законов и предложенное толкование.
Подтверждается ли толкование текстом фрагментов? Будь строгим: «да» — только если вывод прямо следует из текста, без домыслов.
Ответ строго в JSON: {"ok": true, "refs": "номера пунктов, на которых держится вывод или которым он противоречит", "reason": "одно короткое предложение"}`;

/** Похоже на спор с прошлым ответом */
const DISPUTE = /^(но(?=[\s,.!?]|$)|а\s+(вот|ведь|как\s+же|разве)|нет[,.!\s]|ведь|однако|не\s+так|неправ|ты\s+(не\s+прав|ошиб))|не\s+(сказано|написано|указано)|нигде\s+не|ошибаешься|ошибся|неверно|неправильно|не\s+прав|не\s+соглас|где\s+(это\s+)?(написано|сказано)|с\s+чего\s+ты\s+взял|там\s+(же\s+)?(про|о|об|только)(?=\s|$)/i;
export const looksLikeDispute = (q: string) => DISPUTE.test(q.trim());

/** Номера статей и пунктов из текста игрока: «ст. 12.8 ч. 2», «статья 15», «п. 2.4» */
export function refsIn(text: string): { num: string; part?: string }[] {
  const out: { num: string; part?: string }[] = [];
  for (const m of text.matchAll(/(?<![а-яё])(?:ст(?:атья|атье|атьи|\.)?|пункт|п\.)\s*(\d+(?:\.\d+)*)(?:\s*,?\s*(?:ч(?:асть|асти|\.)?)\s*(\d+))?/gi)) out.push({ num: m[1]!, part: m[2] });
  for (const m of text.matchAll(/(?<![а-яё])(?:ч(?:асть|асти|\.)?)\s*(\d+)\s*(?:ст(?:атьи|\.)?)\s*(\d+(?:\.\d+)*)/gi)) out.push({ num: m[2]!, part: m[1] });
  return out;
}

export const SCOPES: Record<Section, { label: string; hint: string }> = {
  project: { label: 'Правила проекта', hint: 'Накажет ли администрация: JAIL, WARN, BAN' },
  laws: { label: 'Законы штата', hint: 'Что грозит в игре: статья, срок, штраф' },
};

class Assistant {
  status = $state<AiStatus | null>(null);
  turns = $state<Turn[]>([]);
  busy = $state(false);
  /** История вопросов — на этом компьютере, общая для окна программы и меню в игре */
  history = $state<HistItem[]>(readHistory());
  /** Спрашивать перед отправкой (чтобы случайный Enter не отправил вопрос) */
  confirmSend = $state(readFlag('nova.aiConfirm'));
  /** Открыта пошаговая настройка (разовая после обновления или по кнопке «Настроить») */
  setupOpen = $state(false);
  /** С какой нейросети начать настройку (выбрали в списке ту, для которой нет ключа) */
  setupService = $state<AiProvider | null>(null);
  private chunkOff: (() => void) | null = null;
  private listening = false;

  get ready() { return !!this.status?.hasKey; }

  async init() {
    if (!this.listening) {
      this.listening = true;
      window.addEventListener('storage', (e) => { if (e.key === HISTORY_KEY) this.history = readHistory(); });
    }
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

  setConfirm(v: boolean) { this.confirmSend = v; try { localStorage.setItem('nova.aiConfirm', v ? '1' : ''); } catch { /* без памяти */ } }

  // ── История ──
  private saveHistory(list: HistItem[]) {
    this.history = list;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* переполнено — живём без истории */ }
  }
  private remember(t: Turn) {
    if (t.fromHistory || t.error || (!t.a && !t.nick)) return;
    const used = new Set(pieces(t.a).flatMap((p) => (p.t === 'ref' && p.kind === 's' ? [p.n] : [])));
    this.saveHistory(pushHistory(this.history, {
      id: t.id, at: t.at ?? Date.now(), q: t.q, a: answerText(t.a), scope: t.scope ?? 'project',
      refs: t.sources.filter((s) => used.has(s.n)).map((s) => ({ n: s.n, node: s.entry.node.id })),
      ...(t.rating ? { rating: t.rating } : {}), ...(t.nick ? { nick: $state.snapshot(t.nick) } : {}),
    }));
  }
  /** Открыть вопрос из истории — без нейросети, со ссылками на пункты */
  restore(h: HistItem) {
    const sources = h.refs.flatMap((r) => { const entry = app.index.byId.get(r.node); return entry ? [{ n: r.n, entry }] : []; });
    this.turns = [{ id: h.id, q: h.q, a: h.a, sources, pending: false, scope: h.scope, at: h.at, rating: h.rating, nick: h.nick, fromHistory: true }];
  }
  forget(id: string) { this.saveHistory(this.history.filter((h) => h.id !== id)); }
  forgetAll() { this.saveHistory([]); }

  /** «Помог / Не помог»: запоминаем у вопроса и отправляем в статистику (без текста вопроса) */
  rate(t: Turn, v: Rating) {
    if (t.rating === v) return;
    t.rating = v;
    const h = this.history.find((x) => x.id === t.id);
    if (h) this.saveHistory(this.history.map((x) => (x.id === t.id ? { ...x, rating: v } : x)));
    track('ai_rating', { rating: v, scope: t.scope ?? 'project', provider: this.provider, kind: t.nick ? 'nick' : 'answer' });
  }

  /** Текст ответа для копирования: ссылки — номерами пунктов */
  copyText(t: Turn) {
    if (t.nick) {
      const n = t.nick;
      const verdict = n.verdict === 'ok' ? 'подходит' : n.verdict === 'bad' ? 'не подходит' : 'спорно';
      return [`Ник ${n.nick} — ${verdict} (п. 2.13 Общих правил).`, ...n.format.filter((f) => !f.ok).map((f) => `— ${f.label}: нет`), ...n.issues.map((i) => `— ${i}`)].join('\n');
    }
    return plainAnswer(t).replace(/\*\*/g, '');
  }

  /** Вопрос игрока (раздел — как выбран в меню слева: «Правила» или «Законы»). Возвращает ход разговора, когда ответ готов (для голосового вопроса) */
  ask(question: string, opts: { voice?: boolean } = {}): Promise<Turn | undefined> {
    const q = question.trim();
    if (!q || this.busy) return Promise.resolve(undefined);
    const nick = nickIn(q);
    const scope: Section = nick ? 'project' : app.hasLaws ? app.section : 'project';
    // Открытый из истории вопрос — начало нового разговора
    if (this.turns.some((x) => x.fromHistory)) this.turns = [];
    this.turns.push({ id: `${Date.now()}`, q, a: '', sources: [], pending: true, scope, at: Date.now(), ...(opts.voice ? { voice: true } : {}), ...(nick ? { nick: { nick, format: nickFormat(nick), verdict: null, issues: [] } } : {}) });
    const t = this.turns[this.turns.length - 1]!; // реактивная копия
    return (nick ? this.checkNick(t) : this.answer(t)).then(() => { this.remember(t); return t; });
  }

  /** Проверка ника по п. 2.13 ОП: формат — сразу, имя и фамилия — на forebears.io (так советует само правило), смысл — нейросеть */
  private async checkNick(t: Turn) {
    const n = t.nick!;
    this.busy = true;
    const rule = app.index.entries.find((e) => e.doc.scope === 'project' && e.node.number === '2.13' && /никнейм/i.test(e.node.text));
    if (rule) t.sources = [{ n: 1, entry: rule }];
    const [first = '', last = ''] = n.nick.split('_');
    try {
      const [a, b] = await Promise.all([
        backend.nameCount('forenames', first).catch(() => null),
        backend.nameCount('surnames', last).catch(() => null),
      ]);
      n.names = { first: a, last: b };
      const seen = (x: number | null, what: string, w: string) => x === null ? `${what} «${w}»: forebears.io не ответил` : x > 0 ? `${what} «${w}» есть в жизни — у ${people(x)} человек` : `${what} «${w}» не найдена на forebears.io`;
      const text = rule ? `${rule.node.text}\n${rule.node.annotations.map((x) => x.text).join('\n')}` : 'Никнейм в формате Имя_Фамилия.';
      const raw = await backend.aiComplete([
        { role: 'system', content: NICK },
        { role: 'user', content: `Правило:\n${text}\n\nПо базе имён forebears.io:\n${seen(a, 'Имя', first)}\n${seen(b, 'Фамилия', last)}\n\nНик: ${n.nick}` },
      ]);
      const j = JSON.parse(raw) as { verdict?: unknown; issues?: unknown };
      const formatOk = n.format.every((f) => f.ok);
      const verdict = j.verdict === 'bad' || j.verdict === 'doubt' ? j.verdict : 'ok';
      n.issues = Array.isArray(j.issues) ? j.issues.filter((x): x is string => typeof x === 'string').slice(0, 5) : [];
      n.verdict = !formatOk ? 'bad' : verdict;
      t.a = n.verdict === 'ok' ? `Ник ${n.nick} подходит по [S1].` : n.verdict === 'bad' ? `Ник ${n.nick} не подходит по [S1].` : `Ник ${n.nick} спорный — решает администрация по [S1].`;
      track('ai_nick', { provider: this.provider, verdict: n.verdict, first: a === null ? -1 : a > 0 ? 1 : 0, last: b === null ? -1 : b > 0 ? 1 : 0 });
    } catch (e) {
      // Нейросеть недоступна — показываем хотя бы формат и forebears
      n.verdict = n.format.every((f) => f.ok) ? 'doubt' : 'bad';
      t.error = String(e);
    } finally {
      t.pending = false;
      this.busy = false;
    }
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
        const plan = JSON.parse(raw) as { docs?: unknown; keywords?: unknown; dispute?: unknown };
        if (plan.dispute === true && before.length) t.debate = true;
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

      if (before.length && looksLikeDispute(q)) t.debate = true;
      const last = before.at(-1);

      // 2. Подбор пунктов только в выбранном разделе: по вопросу, словам-подсказкам и прошлому вопросу.
      //    В споре — ещё пункты, названные игроком, пункты прошлого ответа и их документы целиком.
      const entries = t.debate && last
        ? debateEntries(q, extra, last, inScope, boost)
        : rank(app.index, `${q} ${extra} ${prev}`, fast ? 10 : 14, inScope, boost);
      t.sources = entries.map((entry, n) => ({ n: n + 1, entry }));
      t.notes = learn.relevant(`${q} ${prev} ${extra}`, scope).map((note, n) => ({ n: n + 1, note }));

      // 3. Ответ: пункты + последние пару вопросов-ответов того же раздела
      const history: ChatMsg[] = before.slice(-2).flatMap((x) => [
        { role: 'user' as const, content: x.q },
        { role: 'assistant' as const, content: answerText(x.a).replace(/\s*[[(](?:[SN]\d+(?:\s*[,;]\s*)?)+[\])]/g, '') },
      ]);
      const parts = [
        ...(t.notes ?? []).map((s) => `[N${s.n}] Разъяснение команды NOVA HELPER\n${s.note.text}`),
        ...t.sources.map((s) => fragment(s, t.debate ? 450 : fast ? 420 : 550)),
      ];
      const context = parts.length ? parts.join('\n\n') : '(подходящих фрагментов не найдено)';
      const ask = t.debate
        ? `Фрагменты:\n\n${context}\n\nДовод игрока: ${q}\n\n(Разбери довод по фрагментам и не забудь служебную строку ИТОГ в конце.)`
        : `Фрагменты:\n\n${context}\n\nВопрос игрока: ${q}\n\n(Ответь коротко: 2–4 предложения.${t.voice ? VOICE_LINE : ''})`;
      await backend.aiChat(t.id, [
        { role: 'system', content: t.debate ? debateSystem(scope) : system(scope) },
        ...history,
        { role: 'user', content: ask },
      ]).then((r) => { if (!t.a) t.a = r.text; t.model = r.model; });
      t.time.total = sec();
      if (t.voice) {
        t.spoken = spokenIn(t.a);
        t.a = answerText(t.a);
      }
      if (t.debate) {
        t.verdict = parseVerdict(t.a) ?? undefined;
        t.a = answerText(t.a);
        if (t.verdict && last) void this.report(t, last, context);
      }
      track('ai_answer', { provider: this.provider, scope, model: t.model ?? '', first: t.time.first ?? t.time.total, total: t.time.total, sources: t.sources.length, debate: t.debate ? 1 : 0, agree: t.verdict ? (t.verdict.agree ? 1 : 0) : -1, notes: t.notes?.length ?? 0 });
    } catch (e) {
      t.error = String(e);
      track('ai_error', { provider: this.provider, scope, kind: errorKind(t.error) });
    } finally {
      t.pending = false;
      this.busy = false;
    }
  }

  /** Довод игрока → ещё одна проверка по тексту → на проверку команде (если приём включён) */
  private async report(t: Turn, last: Turn, context: string) {
    const v = t.verdict!;
    if (!learn.learning || !v.note) return;
    t.learnState = 'checking';
    let verdict = { ok: false, refs: v.refs, reason: 'Помощник не согласился с доводом' };
    if (v.agree) {
      try {
        const raw = await backend.aiComplete([
          { role: 'system', content: VERIFY },
          { role: 'user', content: `Фрагменты:\n\n${context}\n\nТолкование: ${v.note}` },
        ]);
        const j = JSON.parse(raw) as { ok?: unknown; refs?: unknown; reason?: unknown };
        verdict = { ok: j.ok === true, refs: typeof j.refs === 'string' ? j.refs : v.refs, reason: typeof j.reason === 'string' ? j.reason : '' };
      } catch { verdict = { ok: false, refs: v.refs, reason: 'Повторная проверка не удалась' }; }
    }
    t.learnState = await learn.submit({
      scope: t.scope!, q: last.q, before: plainAnswer(last), arg: t.q, answer: plainAnswer(t), verdict,
      note: { text: v.note, keywords: v.keywords }, app: app.version,
    });
    track('ai_dispute', { scope: t.scope!, agree: v.agree ? 1 : 0, confirmed: verdict.ok ? 1 : 0, sent: t.learnState });
  }
}

/** Для голосового вопроса: в конце ответа — короткий вариант, который прочитает голос */
const VOICE_LINE = ` Вопрос задан голосом в игре: в самом конце добавь отдельную строку «ГОЛОС: …» — то же самое для озвучки: одна-две короткие фразы, как живой человек сказал бы другу в голосовом чате. Простыми словами, без ссылок [S], номеров пунктов и канцелярита; наказание — по-человечески («могут посадить в джейл на час»); числа — словами.`;

/** Короткий вариант для озвучки из строки «ГОЛОС: …»; нет строки — пусто (тогда читаем сокращённый ответ) */
export function spokenIn(text: string): string {
  const m = /(?:^|\n)[ \t*_`]*ГОЛОС\s*:\s*([\s\S]+)$/.exec(text);
  if (!m) return '';
  return m[1]!.replace(/\*\*|__|`/g, '').replace(/\s*[[(](?:[SN]\d+(?:\s*[,;]\s*)?)+[\])]/g, '').replace(/\s+/g, ' ').trim().replace(/^[«"]|[»"]$/g, '');
}

/** Проверка ника: нейросеть оценивает только смысл, формат программа уже проверила */
const NICK = `Ты проверяешь игровой ник по правилу 2.13 Общих правил проекта NOVA RP (GTA 5). Текст правила будет ниже — опирайся только на него.
Формат (Имя_Фамилия, регистр) программа уже проверила — его не оценивай.
Оцени смысл по списку правила: пол персонажа не угадывай; родные и близкие; скрытый смысл и звучание, близкое к оскорблениям; известные личности;
роль игрока (Bandit, Medik, Inkassator); фашизм; религия, раса, нация; лекарства; мат; бессмысленные слова и клички, животные, персонажи,
овощи и фрукты, предметы, компании (Cheater, GodMode, Shrek, Pomidor, Divan).
Выдуманные имена и фамилии разрешены, как и фамилия по названию семьи, если вписываются в RolePlay.
Сведения forebears.io — подсказка: если имя или фамилия есть в жизни — это довод «за», но запрещённое правилом слово (например Bandit) всё равно нельзя.
Не придирайся: обычные имена и фамилии любых народов — «ok». Если не уверен — «doubt».
Ответь только JSON: {"verdict":"ok|bad|doubt","issues":["коротко по-русски, какой пункт правила нарушен"]}. Для «ok» issues пустой.`;

/** Подбор пунктов для спора: названные игроком → из прошлого ответа → поиск → документы целиком */
function debateEntries(q: string, extra: string, last: Turn, inScope: (d: RuleDocument) => boolean, boost: Set<string>): Entry[] {
  const BUDGET = 9000; // знаков: бесплатные лимиты Groq не любят длинные запросы
  const out: Entry[] = [];
  const seen = new Set<string>();
  let size = 0;
  const add = (e: Entry | undefined, force = false) => {
    if (!e || seen.has(e.node.id) || !inScope(e.doc)) return;
    const len = Math.min(e.node.text.length, 450) + 80;
    if (!force && size + len > BUDGET) return;
    seen.add(e.node.id); out.push(e); size += len;
  };
  const all = app.index.entries;
  // Пункты, которые назвал игрок
  for (const r of refsIn(q)) {
    for (const e of all) {
      if (!inScope(e.doc)) continue;
      const law = e.doc.scope === 'server';
      const hit = law
        ? (e.article === r.num && (!r.part || e.node.number === r.part)) || (!e.article && e.node.number === r.num && e.node.kind === 'article')
        : e.node.number === r.num;
      if (hit) add(e, true);
    }
  }
  // На что сослался прошлый ответ
  const used = new Set(pieces(last.a).flatMap((p) => (p.t === 'ref' && p.kind === 's' ? [p.n] : [])));
  for (const s of last.sources) if (used.has(s.n)) add(s.entry, true);
  // Поиск по доводу
  for (const e of rank(app.index, `${q} ${extra} ${last.q}`, 8, inScope, boost)) add(e);
  // Документы спорных пунктов — целиком, сколько влезет
  const docs = [...new Set(out.slice(0, 6).map((e) => e.doc.id))].slice(0, 2);
  for (const id of docs) for (const e of all) if (e.doc.id === id) add(e);
  return out;
}

/** Ответ для команды: без разметки, ссылки [S1] — номерами пунктов, [N1] — словом «разъяснение» */
export function plainAnswer(t: Turn) {
  return pieces(answerText(t.a)).map((p) => {
    if (p.t !== 'ref') return p.v;
    if (p.kind === 'n') return '(разъяснение)';
    const s = t.sources.find((x) => x.n === p.n);
    return s ? `(${sourceLabel(s).num})` : '';
  }).join('').replace(/ +([.,])/g, '$1');
}

/** Служебная строка «ИТОГ: {…}» в конце разбора */
export function parseVerdict(text: string): Verdict | null {
  const m = /ИТОГ\s*:?\s*(\{[\s\S]*\})/.exec(text);
  if (!m) return null;
  try {
    const j = JSON.parse(m[1]!) as Record<string, unknown>;
    return {
      agree: j.agree === true,
      refs: typeof j.refs === 'string' ? j.refs : '',
      note: typeof j.note === 'string' ? j.note.trim() : '',
      keywords: Array.isArray(j.keywords) ? j.keywords.filter((x): x is string => typeof x === 'string').slice(0, 10) : [],
    };
  } catch { return null; }
}

/** Текст ответа без служебной строки (пока ответ печатается — тоже) */
export function answerText(text: string) {
  const i = text.search(/\n?[ \t*_`]*(?:ИТОГ|ГОЛОС)\s*:/);
  return (i >= 0 ? text.slice(0, i) : text).trimEnd();
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

/** Ответ на кусочки: текст, **жирное** и ссылки [S3] / [S1, N2] / (S7) — нейросеть иногда ставит круглые скобки */
export type Piece = { t: 'text' | 'bold'; v: string } | { t: 'ref'; n: number; kind: 's' | 'n' };
export function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  const re = /\*\*(.+?)\*\*|\[\s*([SN]\d+(?:\s*[,;]\s*[SN]\d+)*)\s*\]|\(\s*([SN]\d+(?:\s*[,;]\s*[SN]\d+)*)\s*\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    if (m[1]) out.push({ t: 'bold', v: m[1] });
    else for (const r of (m[2] ?? m[3])!.split(/[,;]/)) {
      const x = r.trim();
      out.push({ t: 'ref', n: Number(x.slice(1)), kind: x[0] === 'N' ? 'n' : 's' });
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

function readHistory(): HistItem[] { try { return sanitizeHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')); } catch { return []; } }
function readFlag(key: string) { try { return localStorage.getItem(key) === '1'; } catch { return false; } }
