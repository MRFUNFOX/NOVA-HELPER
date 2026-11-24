/**
 * ИИ-помощник: вопрос своими словами → подбор пунктов правил и законов → ответ нейросети (Groq или Z.ai)
 * со ссылками на эти пункты. Нейросеть видит только подобранные пункты и обязана на них
 * ссылаться, поэтому отвечает по нашим правилам, а не «из головы».
 */
import type { RuleDocument } from '@shared/types';
import { backend, type AiProvider, type AiStatus, type ChatMsg } from './backend';
import { app, sectionOf, shortTitle, type Section } from './state.svelte';
import { nodeBadge, rank, type Entry } from './search';
import { aboutGov, slang } from './slang';
import { errorKind, track } from './stats';
import { learn, type Note } from './learn.svelte';
import { WORLD, WORLD_SHORT } from './world';
import { EXAM, JUDGE, citesRef, type ExamItem, type ExamResult, type Match } from './exam';
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
  /** Как модель рассуждала перед ответом — видит только команда (Dev/Admin) */
  think?: string;
  /** Разбор ситуации перед поиском: участники, факты, что проверить */
  analysis?: Analysis;
  /** Что сейчас делает помощник: разбирает ситуацию, отвечает, проверяет ответ */
  stage?: 'plan' | 'answer' | 'check';
  /** Итог самопроверки: поправлен ли ответ и что было не так */
  checked?: { fixed: boolean; problems: string[] };
  /** Вопрос экзамена — не в истории и не в статистике */
  exam?: boolean;
  /** До какого момента ждём бесплатный лимит лучшей модели */
  waitUntil?: number;
}

/** Разбор ситуации: нейросеть сначала понимает, кто что сделал и что проверить, — и только потом ищем пункты */
export interface Analysis {
  who: string[];
  facts: string[];
  ask: string;
  topics: { check: string; words: string[] }[];
  docs: string[];
  dispute: boolean;
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

Ты не справочник, а опытный администратор: тебе дают ситуацию — ты в неё вдумываешься и выносишь решение.

${WORLD}

Как думать (про себя, до ответа):
1. Разбери ситуацию: кто что сделал и в каком порядке, кто начал, была ли RP-ситуация и весомая IC-причина, что было до и после.
   Держись фактов из рассказа: не приписывай участникам того, чего игрок не говорил. Перечитай, кого именно наказали и кто что сказал.
2. Найди во фрагментах пункты, которые к этому подходят. Прочитай их целиком: примечания, исключения, определения терминов.
3. Примерь каждый пункт к фактам по смыслу, а не по совпадению слов. Пункт про другое — отбрось.
   Сначала ищи пункт, который прямо называет поступок из рассказа (те же места и действия: крыша, зелёная зона, маска, ограбление). Правило общего документа раздела («Общие правила мероприятий», «Общие правила проекта») действует везде в этом разделе; правило конкретного мероприятия, события или войны за территории — только там. Если правило конкретного места противоречит общему — для этого места оно важнее.
4. Подумай, как это решил бы разумный администратор: что здесь здраво, а что — попытка обойти правило.
5. Не хватает важной детали — реши по самому вероятному варианту и скажи, от чего ещё зависит итог. Не уходи от ответа.
Перед фрагментами может быть «Разбор ситуации» — это черновик помощника. Сверь его с рассказом игрока: если разбор с рассказом расходится, верь рассказу.

Как отвечать:
- Игрок просто описал ситуацию без вопроса — пойми, что он хочет узнать (обычно: прав ли он, кто нарушил, за что наказали), и оцени поступки каждого участника.
- Первое предложение — вердикт. Вердикт выносишь всегда, даже если ситуация спорная: «Да, можно», «Нет, это нарушение», «Нарушил грабитель, а не охранник», «Скорее всего, нарушения нет».
  На вопросы «зачем», «почему», «как», «что такое», «что значит» — сразу суть, без «Да» и «Нет».
- Дальше 2–4 предложения — почему: какие факты решают, какой пункт и почему он здесь применим (или нет), какое наказание.
  Это твоя логика, а не пересказ пункта. Если итог зависит от детали — так и скажи: «если он первым достал оружие — тогда …».
- Простыми словами, как опытный игрок другу, не больше 110 слов.
- Термины поясняй в скобках: DM (убийство без причины), PG (действия, невозможные в реальной жизни).
- Без списков, нумерации, заголовков и таблиц. Самое главное выдели **жирным** — одно-два места.
- После утверждения ставь ссылку на фрагмент в квадратных скобках: [S2]. Только номера из списка фрагментов.
- Фрагменты [N1], [N2] — проверенные разъяснения команды программы: как правильно толковать пункты. Если разъяснение относится к вопросу, опирайся на него и ставь ссылку [N1].
- Не путай понятия: например, оружие и спецсредства (бронежилет, тайзер, дубинка, наручники) — разные вещи, правило для одного не переноси на другое.
- Сленг: «растулил», «завалил», «положил» = убил; «коп» = сотрудник полиции; «РП» = RolePlay.
- Читай пункт внимательно и не приписывай ему то, чего в нём нет. Если прямого пункта нет — ответь по близкому и скажи «скорее всего».
- Если во фрагментах ничего по теме — скажи «${nothing}» и что стоит уточнить. Ничего не выдумывай.`;
}

/** Первый шаг: нейросеть разбирает ситуацию — кто участники, какие факты, что проверить по правилам — и выбирает документы.
 *  Каждый вопрос к правилам потом ищем отдельно, поэтому в ответ попадают пункты обо всех частях ситуации. */
function analyzeSystem(scope: Section) {
  const docsHint = scope === 'laws'
    ? 'Обычно ответ в Уголовном, Административном или Дорожном кодексе; о полномочиях сотрудников — в законах о статусе их структур.'
    : 'О нарушениях (DM, NonRP, PG, MG, RK, оскорбления, ник, чат) — почти всегда «Общие правила проекта». Если в ситуации сотрудники госструктур (полиция, «госники», FIB, армия, EMS) — добавь «Общие правила государственных структур».';
  const words = scope === 'laws'
    ? 'как пишут в законах: убийство, похищение, взятка, задержание, превышение полномочий, штраф, лишение свободы, номера статей из вопроса'
    : 'как пишут в правилах: DeathMatch DM, NonRP, PowerGaming PG, MetaGaming MG, RevengeKill RK, NLR, DriveBy DB, ООС, IC, злоупотребление полномочиями, задержание, ограбление, похищение, зелёная зона, номера пунктов из вопроса';
  return `Ты — опытный администратор GTA 5 RP-проекта NOVA RP. Игрок задаёт вопрос или описывает ситуацию. Не отвечай на него — разбери, чтобы потом найти нужные пункты ${scope === 'laws' ? 'законов штата' : 'правил проекта'}.
${WORLD_SHORT}

Ответ строго в JSON:
{"who": ["участник — кто он и что сделал"], "facts": ["факт из рассказа"], "ask": "что игрок хочет узнать", "topics": [{"check": "что проверить по правилам", "words": ["слово"]}], "docs": ["D3"], "dispute": false}
- who: 0–5 участников, включая самого игрока. Роль каждого: игрок, сотрудник полиции или другой госструктуры, администратор. Госник и коп — игроки, а не администрация. Кто кого наказал — как в рассказе.
- facts: только то, что сказал игрок, по порядку. Ничего не додумывай.
- ask: одним предложением. Если вопроса нет, игрок обычно хочет узнать, прав ли он, кто нарушил и справедливо ли наказание.
- topics: 1–5 отдельных вопросов к правилам: каждый поступок каждого участника — свой вопрос («правомерно ли сотрудник выписал штраф без причины», «можно ли было стрелять в ответ»). words — 3–8 слов, ${words}.
- docs: 1–5 документов из списка, где скорее всего ответ. ${docsHint}
- dispute: true, только если игрок спорит с прошлым ответом о смысле правил («но ведь…», «там не сказано…», «ты не прав, это разрешено»). Жалоба на сам ответ («не уточнил», «подробнее», «должен был дать оба варианта», «не тот пункт») — false.`;
}

/** Разбор из ответа нейросети. Плохой JSON — null, лишнее отбрасываем */
export function parseAnalysis(raw: string): Analysis | null {
  let j: Record<string, unknown>;
  try {
    const a = raw.indexOf('{');
    const b = raw.lastIndexOf('}');
    j = JSON.parse(a >= 0 && b > a ? raw.slice(a, b + 1) : raw) as Record<string, unknown>;
  } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const strs = (v: unknown, n: number) => (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x).trim() : '')).filter(Boolean).slice(0, n);
  const topics: Analysis['topics'] = (Array.isArray(j.topics) ? j.topics : []).flatMap((x: unknown) => {
    if (typeof x === 'string') return x.trim() ? [{ check: x.trim(), words: [] }] : [];
    if (!x || typeof x !== 'object') return [];
    const o = x as Record<string, unknown>;
    const check = typeof o.check === 'string' ? o.check.trim() : '';
    const words = strs(o.words, 10);
    return check || words.length ? [{ check, words }] : [];
  }).slice(0, 6);
  // Старый формат шага: просто слова для поиска
  const kw = strs(j.keywords, 12);
  if (kw.length) topics.push({ check: '', words: kw });
  return { who: strs(j.who, 6), facts: strs(j.facts, 8), ask: typeof j.ask === 'string' ? j.ask.trim() : '', topics, docs: strs(j.docs, 6), dispute: j.dispute === true };
}

/** Разбор для ответа — черновиком, который нейросеть сверит с рассказом */
export function analysisText(a: Analysis) {
  const lines: string[] = [];
  if (a.who.length) lines.push(`Участники: ${a.who.join('; ')}`);
  if (a.facts.length) lines.push(`Факты: ${a.facts.join('; ')}`);
  if (a.ask) lines.push(`Игрок хочет узнать: ${a.ask}`);
  const checks = a.topics.map((x) => x.check).filter(Boolean);
  if (checks.length) lines.push(`Что проверить: ${checks.map((c, i) => `${i + 1}) ${c}`).join(' ')}`);
  return lines.length ? `Разбор ситуации (черновик — сверь с рассказом игрока, рассказ главнее):\n${lines.join('\n')}` : '';
}

/** Пункты из нескольких поисков в один список: обязательные — первыми, дальше по очереди из каждого поиска,
 *  пока не кончится место. Так каждая часть ситуации получает свои пункты, а длинный поиск не вытесняет короткий. */
export function mergeGroups<T>(forced: T[], groups: T[][], budget: number, max: number, size: (x: T) => number, key: (x: T) => string): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const x of forced) {
    if (seen.has(key(x))) continue;
    seen.add(key(x)); out.push(x); used += size(x);
  }
  const depth = Math.max(0, ...groups.map((g) => g.length));
  for (let d = 0; d < depth && out.length < max; d++) {
    for (const g of groups) {
      const x = g[d];
      if (x === undefined || seen.has(key(x)) || out.length >= max) continue;
      const n = size(x);
      if (used + n > budget) continue;
      seen.add(key(x)); out.push(x); used += n;
    }
  }
  return out;
}

/** Сколько знаков займёт пункт во фрагментах — чтобы запрос влез в бесплатный лимит */
function fragSize(e: Entry, max: number) {
  return 90 + Math.min(e.node.text.length, max)
    + e.node.punishments.reduce((n, p) => n + p.raw.length + 12, 0)
    + e.node.annotations.reduce((n, a) => n + Math.min(a.text.length, 300) + 14, 0);
}

/** Самопроверка ответа на сложную ситуацию: второй взгляд ищет грубые ошибки и, если нашёл, переписывает ответ */
const CHECK = `Ты — старший администратор GTA 5 RP-проекта NOVA RP. Помощник ответил игроку. Проверь ответ строго по рассказу игрока и фрагментам правил.
${WORLD}

Ищи только серьёзные ошибки:
- перепутаны участники или их роли (игрок, сотрудник госструктуры, администратор), кто кого наказал;
- ответ приписывает игроку или участникам то, чего в рассказе нет;
- пункт применён не по смыслу, или вывод противоречит тексту пункта, примечанию, исключению;
- законы штата вместо правил проекта или наоборот;
- нет вердикта или ответ уходит от вопроса;
- ссылка [S#] на фрагмент, где этого нет.
Стиль, длину и мелкие неточности не трогай. Ответ без серьёзных ошибок — ok: true.
Ответ строго в JSON: {"ok": true, "problems": ["коротко, что не так"], "answer": ""}
Если ok: false — в "answer" напиши исправленный ответ целиком по тем же правилам: первое предложение — вердикт, дальше 2–4 предложения логики, ссылки [S#] только на фрагменты из списка, без списков и заголовков, главное **жирным**, не больше 110 слов.`;

/** Итог самопроверки. Поправляем ответ, только если проверка нашла ошибку и дала новый текст */
export function parseCheck(raw: string): { fix: boolean; problems: string[]; answer: string } | null {
  try {
    const a = raw.indexOf('{');
    const j = JSON.parse(a >= 0 ? raw.slice(a, raw.lastIndexOf('}') + 1) : raw) as Record<string, unknown>;
    const problems = (Array.isArray(j.problems) ? j.problems : []).filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 5);
    const answer = typeof j.answer === 'string' ? j.answer.trim() : '';
    return { fix: j.ok === false && problems.length > 0 && answer.length >= 20, problems, answer };
  } catch { return null; }
}

/** Игрок спорит с прошлым ответом: честная проверка довода по тексту */
function debateSystem(scope: Section) {
  const where = scope === 'laws' ? 'законам штата' : 'правилам проекта NOVA RP';
  return `Ты — помощник программы NOVA HELPER для игроков GTA 5 RP-проекта NOVA RP (сервер Horizon). Отвечаешь по ${where}.
${WORLD_SHORT}
Игрок не согласен с твоим прошлым ответом и приводит довод. Проверь довод честно, только по тексту фрагментов:
1. Что именно запрещает или разрешает пункт, на который ссылаются. Если наказание — за «незаконное» действие, найди, какая норма делает его незаконным. Нет такой нормы — значит, действие не запрещено.
2. Есть ли во фрагментах пункт, который прямо делает это действие нарушением.
3. Не путаются ли понятия (например, оружие и спецсредство) и нет ли исключений.
Соглашайся только если довод подтверждается текстом. Уверенный тон игрока — не аргумент. Если довод неверен — назови пункт, который ему противоречит.
Если твой прошлый ответ был неверным — прямо скажи об этом.
Спор — только о смысле правил. Если игрок недоволен самим ответом (неполный, не уточнил, не тот документ) — согласись, дай полный ответ на его вопрос и в ИТОГ поставь "agree": false и пустой "note". Никогда не толкуй правила о том, как должен отвечать помощник.

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
  // Номер без слова «пункт»: «что значит 8.3», «2.13?» — только с точкой внутри, чтобы не цеплять «120 минут»
  for (const m of text.matchAll(/(?<![\d.])(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)(?![\d.]\d)/g)) {
    if (!out.some((r) => r.num === m[1])) out.push({ num: m[1]! });
  }
  return out;
}

/** Пункты с номерами, которые назвал игрок, — во всех документах раздела */
export function exactEntries(q: string, inScope: (d: RuleDocument) => boolean): Entry[] {
  const out: Entry[] = [];
  for (const r of refsIn(q)) {
    for (const e of app.index.entries) {
      if (!inScope(e.doc) || out.includes(e)) continue;
      const law = e.doc.scope === 'server';
      const hit = law
        ? (e.article === r.num && (!r.part || e.node.number === r.part)) || (!e.article && e.node.number === r.num && e.node.kind === 'article')
        : e.node.number === r.num;
      if (hit) out.push(e);
    }
  }
  return out;
}

/** Игрок недоволен самим ответом (не уточнил, мало, не те варианты), а не спорит о смысле правил */
const META = /(ты|помощник)\s+(же\s+)?(должен|долж[её]н|обязан|не\s+(дал|уточнил|спросил|объяснил|написал|ответил))|разв[её]рнут|подробн|полн(ый|ее|остью)\s+ответ|оба\s+вариант|все\s+вариант|не\s+уточнил|не\s+тот\s+(пункт|документ)|другой\s+(пункт|документ)/i;
export const looksLikeMeta = (q: string) => META.test(q.trim());

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
  private thinkOff: (() => void) | null = null;
  private waitOff: (() => void) | null = null;
  private listening = false;

  get ready() { return !!this.status?.hasKey; }

  async init() {
    if (!this.listening) {
      this.listening = true;
      window.addEventListener('storage', (e) => { if (e.key === HISTORY_KEY) this.history = readHistory(); });
    }
    try { this.status = await backend.aiStatus(); } catch { this.status = { hasKey: false, keyHint: '', model: null }; }
    this.thinkOff ??= await backend.on('ai-think', (p) => {
      const { id, delta } = p as { id: string; delta: string };
      const t = this.turns.find((x) => x.id === id);
      if (t) t.think = (t.think ?? '') + delta;
    });
    // Лимит лучшей модели освободится через несколько секунд — помощник ждёт, а не отвечает моделью слабее
    this.waitOff ??= await backend.on('ai-wait', (p) => {
      const { id, seconds } = p as { id: string; seconds: number };
      const t = this.turns.find((x) => x.id === id);
      if (t) t.waitUntil = seconds > 0 ? Date.now() + seconds * 1000 : undefined;
    });
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
    if (t.fromHistory || t.exam || t.error || (!t.a && !t.nick)) return;
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

  /** По чему отвечает помощник — свой переключатель в панели помощника, не зависит от меню слева (в игровом меню его не видно) */
  scope = $state<Section>(readScope());
  setScope(s: Section) {
    this.scope = s;
    try { localStorage.setItem(SCOPE_KEY, s); } catch { /* без памяти */ }
    track('ai_scope', { scope: s });
  }

  /** Вопрос игрока по выбранному в помощнике разделу. other — тот же вопрос по другому разделу («Ответить по законам») */
  ask(question: string, as?: Section): Promise<Turn | undefined> {
    const q = question.trim();
    if (!q || this.busy || this.exam.running) return Promise.resolve(undefined);
    if (as && as !== this.scope) this.setScope(as);
    const nick = nickIn(q);
    const scope: Section = nick ? 'project' : app.hasLaws ? this.scope : 'project';
    // Открытый из истории вопрос — начало нового разговора
    if (this.turns.some((x) => x.fromHistory)) this.turns = [];
    this.turns.push({ id: `${Date.now()}`, q, a: '', sources: [], pending: true, scope, at: Date.now(), ...(nick ? { nick: { nick, format: nickFormat(nick), verdict: null, issues: [] } } : {}) });
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
      // Прошлый вопрос того же раздела — для уточнений «а если…» (у вопроса экзамена прошлого нет)
      const before = i < 0 ? [] : this.turns.slice(0, i).filter((x) => x.scope === scope && x.a && !x.error);
      const last = before.at(-1);
      const prev = last?.q ?? '';
      const inScope = (d: RuleDocument) => sectionOf(d) === scope;

      const t0 = performance.now();
      const sec = () => Math.round((performance.now() - t0) / 100) / 10;
      t.time = { start: t0 };
      // Бесплатные модели Z.ai медленные и с коротким окном — им фрагменты покороче
      const fast = this.provider === 'zai';

      // 1. Разбор ситуации: кто участники, что произошло, что проверить по правилам, в каких документах искать
      t.stage = 'plan';
      const docs = app.db.docs.filter(inScope);
      const catalog = docs.map((d, n) => `D${n + 1} ${shortTitle(d.title)}`).join('\n');
      let extra = slang(`${q} ${prev}`);
      const boost = new Set<string>();
      let an: Analysis | null = null;
      try {
        const lastA = last ? cut(answerText(last.a).replace(/\s*[[(](?:[SN]\d+(?:\s*[,;]\s*)?)+[\])]/g, ''), 400) : '';
        const raw = await backend.aiComplete([
          { role: 'system', content: analyzeSystem(scope) },
          { role: 'user', content: `Документы (${SCOPES[scope].label.toLowerCase()}):\n${catalog}\n\n${prev ? `Прошлый вопрос игрока: ${prev}\nПрошлый ответ помощника: ${lastA}\n\n` : ''}Вопрос игрока: ${q}` },
        ], 1);
        an = parseAnalysis(raw);
      } catch { /* без разбора ищем по самому вопросу */ }
      if (an) {
        t.analysis = an;
        if (an.dispute && before.length) t.debate = true;
        extra += ' ' + an.topics.flatMap((x) => x.words).join(' ');
        for (const id of an.docs) {
          const d = docs[Number(id.replace(/\D/g, '')) - 1];
          if (d) boost.add(d.id);
        }
      }
      // Госники, полиция, армия… — их общие правила нужны всегда, даже если нейросеть их не выбрала
      if (aboutGov(`${q} ${prev}`)) for (const d of docs) if (/общие правила государственных структур/i.test(d.title)) boost.add(d.id);
      t.time.plan = sec();
      t.plan = { docs: [...boost].map((id) => shortTitle(app.doc(id)?.title ?? id)), keywords: extra.trim() };

      if (before.length && looksLikeDispute(q)) t.debate = true;
      // «Ты не уточнил», «дай подробнее» — не спор, а просьба ответить полнее на прошлый вопрос
      const meta = !!last && looksLikeMeta(q);
      if (meta) t.debate = false;
      const asked = meta && last ? last.q : q;

      // 2. Подбор пунктов только в выбранном разделе.
      //    Обычный вопрос: номера, названные игроком, → по очереди пункты к каждому вопросу разбора → поиск по всему вопросу.
      //    Спор: пункты, названные игроком, пункты прошлого ответа и их документы целиком.
      const max = fast ? 420 : 550;
      const exact = t.debate ? [] : exactEntries(asked, inScope);
      let entries: Entry[];
      if (t.debate && last) entries = debateEntries(q, extra, last, inScope, boost);
      else {
        const topics = (an?.topics ?? []).map((x) => rank(app.index, `${x.check} ${x.words.join(' ')} ${slang(x.check)}`, 6, inScope, boost));
        const whole = rank(app.index, `${asked} ${q} ${extra} ${prev}`, 14, inScope, boost);
        entries = mergeGroups(exact, [...topics, whole], fast ? 7000 : 8500, 18, (e) => fragSize(e, max), (e) => e.node.id);
      }
      const sameNum = new Set(exact.map((e) => e.doc.id)).size > 1 ? exact : [];
      t.sources = entries.map((entry, n) => ({ n: n + 1, entry }));
      const topicWords = (an?.topics ?? []).map((x) => x.check).join(' ');
      t.notes = learn.relevant(`${q} ${prev} ${extra} ${topicWords}`, scope).map((note, n) => ({ n: n + 1, note }));

      // 3. Ответ: разбор + пункты + последние пару вопросов-ответов того же раздела
      t.stage = 'answer';
      const history: ChatMsg[] = before.slice(-2).flatMap((x) => [
        { role: 'user' as const, content: x.q },
        { role: 'assistant' as const, content: answerText(x.a).replace(/\s*[[(](?:[SN]\d+(?:\s*[,;]\s*)?)+[\])]/g, '') },
      ]);
      const parts = [
        ...(t.notes ?? []).map((s) => `[N${s.n}] Разъяснение команды NOVA HELPER\n${s.note.text}`),
        ...t.sources.map((s) => fragment(s, t.debate ? 450 : max)),
      ];
      const context = parts.length ? parts.join('\n\n') : '(подходящих фрагментов не найдено)';
      const draft = an && !t.debate && !meta && !sameNum.length ? analysisText(an) : '';
      const ask = t.debate
        ? `Фрагменты:\n\n${context}\n\nДовод игрока: ${q}\n\n(Разбери довод по фрагментам и не забудь служебную строку ИТОГ в конце.)`
        : `${draft ? `${draft}\n\n` : ''}Фрагменты:\n\n${context}\n\n${meta ? `Прошлый вопрос игрока: ${asked}\nИгрок недоволен прошлым ответом: «${q}». Коротко признай это и ответь на прошлый вопрос полностью.` : `Вопрос игрока: ${q}`}\n\n(${sameNum.length ? `Номер ${refsIn(asked).map((r) => r.num).join(', ')} есть в нескольких документах: ${[...new Set(sameNum.map((e) => shortTitle(e.doc.title)))].join('; ')}. Если из вопроса не ясно, о каком документе речь, — коротко объясни каждый вариант (по одному предложению, назови документ) и спроси, какой имелся в виду. Не больше 5 предложений.` : 'Вдумайся в ситуацию, вынеси вердикт и объясни свою логику: 3–5 предложений.'})`;
      // Длинная ситуация, несколько вопросов в одном или спор — думать глубже; короткий вопрос — быстро
      const deep = !!t.debate || q.length > 140 || (an?.topics.filter((x) => x.check).length ?? 0) >= 3;
      await backend.aiChat(t.id, deep, [
        { role: 'system', content: t.debate ? debateSystem(scope) : system(scope) },
        ...history,
        { role: 'user', content: ask },
      ]).then((r) => { if (!t.a) t.a = r.text; if (!t.think && r.reasoning) t.think = r.reasoning; t.model = r.model; });
      t.time.total = sec();
      if (t.debate) {
        t.verdict = parseVerdict(t.a) ?? undefined;
        t.a = answerText(t.a);
        if (t.verdict && last && !t.exam) void this.report(t, last, context);
      } else if (deep && !meta && !sameNum.length) {
        // 4. Сложная ситуация — второй взгляд: нет ли грубой ошибки
        t.stage = 'check';
        await this.selfCheck(t, context);
        t.time.total = sec();
      }
      if (!t.exam) track('ai_answer', { provider: this.provider, scope, model: t.model ?? '', first: t.time.first ?? t.time.total, total: t.time.total, sources: t.sources.length, debate: t.debate ? 1 : 0, agree: t.verdict ? (t.verdict.agree ? 1 : 0) : -1, notes: t.notes?.length ?? 0, topics: an?.topics.length ?? -1, fixed: t.checked ? (t.checked.fixed ? 1 : 0) : -1 });
    } catch (e) {
      t.error = String(e);
      if (!t.exam) track('ai_error', { provider: this.provider, scope, kind: errorKind(t.error) });
    } finally {
      t.stage = undefined;
      t.waitUntil = undefined;
      t.pending = false;
      this.busy = false;
    }
  }

  /** Второй взгляд на ответ: сильная модель ищет грубые ошибки (перепутаны участники, пункт не о том, нет вердикта) и переписывает ответ */
  private async selfCheck(t: Turn, context: string) {
    try {
      const raw = await backend.aiComplete([
        { role: 'system', content: CHECK },
        { role: 'user', content: `Фрагменты:\n\n${context}\n\nРассказ и вопрос игрока: ${t.q}\n\nОтвет помощника:\n${answerText(t.a)}` },
      ], 2);
      const r = parseCheck(raw);
      if (!r) return;
      t.checked = { fixed: r.fix, problems: r.problems };
      if (r.fix) t.a = r.answer;
    } catch { /* проверка не удалась (лимит, сеть) — оставляем ответ как есть */ }
  }

  // ── Экзамен (только Dev): вопросы с известным правильным ответом ──
  exam = $state<ExamState>(readExam());
  private examStop = false;

  stopExam() { this.examStop = true; }

  async runExam(items: ExamItem[] = EXAM) {
    if (this.busy || this.exam.running) return;
    this.examStop = false;
    this.exam = { running: true, done: 0, total: items.length, at: Date.now(), results: [], provider: this.status?.provider ?? '' };
    for (const item of items) {
      if (this.examStop) break;
      this.exam.current = item.id;
      let r = await this.examOne(item);
      // Бесплатный лимит на минуту кончился — ждём и пробуем ещё раз
      if (r.match === 'error' && /лимит|подождите/i.test(r.why) && !this.examStop) {
        await sleep(60_000, () => this.examStop);
        if (!this.examStop) r = await this.examOne(item);
      }
      this.exam.results.push(r);
      this.exam.done++;
      saveExam(this.exam);
      // Пауза, чтобы не упереться в лимит токенов в минуту
      if (this.exam.done < items.length && !this.examStop) await sleep(this.provider === 'groq' ? 12_000 : 3_000, () => this.examStop);
    }
    this.exam.running = false;
    this.exam.current = undefined;
    saveExam(this.exam);
  }

  private async examOne(item: ExamItem): Promise<ExamResult> {
    const t: Turn = { id: `exam-${item.id}-${Date.now()}`, q: item.q, a: '', sources: [], pending: true, scope: item.scope, at: Date.now(), exam: true };
    await this.answer(t);
    const used = new Set(pieces(t.a).flatMap((p) => (p.t === 'ref' && p.kind === 's' ? [p.n] : [])));
    const cited = t.sources.filter((s) => used.has(s.n)).map((s) => `${sourceLabel(s).num} · ${sourceLabel(s).doc}`);
    const base = { id: item.id, answer: plainAnswer(t), cited, citedOk: citesRef(cited, item.refs), model: t.model, seconds: t.time?.total, fixed: t.checked?.fixed };
    if (t.error) return { ...base, match: 'error', why: t.error };
    try {
      const raw = await backend.aiComplete([
        { role: 'system', content: JUDGE },
        { role: 'user', content: `Вопрос игрока: ${item.q}\n\nЭталон: ${item.verdict}\nВажно упомянуть: ${item.points.join('; ')}\n\nОтвет помощника: ${base.answer}\nПомощник сослался на: ${cited.join('; ') || 'ни на что'}` },
      ], 1);
      const a = raw.indexOf('{');
      const j = JSON.parse(a >= 0 ? raw.slice(a, raw.lastIndexOf('}') + 1) : raw) as { match?: unknown; why?: unknown };
      const match: Match = j.match === 'yes' || j.match === 'partly' ? j.match : 'no';
      return { ...base, match, why: typeof j.why === 'string' ? j.why : '' };
    } catch (e) {
      return { ...base, match: 'error', why: `Оценка не удалась: ${String(e)}` };
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
  const BUDGET = 6500; // знаков: запрос со спором должен влезать в бесплатный лимит Groq (8 тыс. токенов в минуту)
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
  const i = text.search(/\n?[ \t*_`]*ИТОГ\s*:/);
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

export interface ExamState {
  running: boolean;
  done: number;
  total: number;
  at: number;
  results: ExamResult[];
  /** Какая нейросеть сдавала */
  provider: string;
  current?: string;
}
const EXAM_KEY = 'nova.examLast';
function readExam(): ExamState {
  try {
    const j = JSON.parse(localStorage.getItem(EXAM_KEY) ?? 'null') as ExamState | null;
    if (j && Array.isArray(j.results)) return { ...j, running: false, current: undefined };
  } catch { /* нет прошлого экзамена */ }
  return { running: false, done: 0, total: 0, at: 0, results: [], provider: '' };
}
function saveExam(x: ExamState) { try { localStorage.setItem(EXAM_KEY, JSON.stringify({ ...$state.snapshot(x), running: false })); } catch { /* без памяти */ } }
/** Пауза, которую можно прервать кнопкой «Остановить» */
async function sleep(ms: number, stop: () => boolean) {
  const end = Date.now() + ms;
  while (Date.now() < end && !stop()) await new Promise((r) => setTimeout(r, 500));
}

const SCOPE_KEY = 'nova.aiScope';
function readScope(): Section {
  try { return localStorage.getItem(SCOPE_KEY) === 'laws' ? 'laws' : 'project'; } catch { return 'project'; }
}

/** Похоже, вопрос про другой раздел: в «Правилах» спросили про УК и суд, в «Законах» — про DM и деморган.
 *  Тогда под ответом предлагаем ответить по другому разделу. «Штраф» и «задержание» есть и там и там — их не считаем. */
const LAWISH = /(^|[^а-яё])(ук|ак|дк|упк)([^а-яё]|$)|уголовн|административн\S* кодекс|дорожн\S* кодекс|кодекс|стать[яиеюй]|лишени\S* свобод|срок\S* (тюрьм|заключ)|([^а-яё]|^)суд(е|а|у|ом|ах|ов|ья|ьи|ье|ьёй|ей)?([^а-яё]|$)|адвокат|прокурор|лицензи|розыск|конституци/i;
const RULEISH = /(^|[^a-zа-яё])(dm|дм|nonrp|нонрп|pg|пг|mg|мг|rk|рк|nlr|db|дб|tk|ооc|оос|ooc|ic)([^a-zа-яё]|$)|деморган|jail|джейл|варн|warn|([^а-яё]|^)бан([^а-яё]|$)|([^а-яё]|^)(мут|мьют)([^а-яё]|$)|администрац|админ|репорт|никнейм|([^а-яё]|^)ник([^а-яё]|$)|зелён\S* зон|зелен\S* зон/i;
export function otherScope(q: string, scope: Section): Section | null {
  const law = LAWISH.test(q);
  const rule = RULEISH.test(q);
  if (scope === 'project' && law && !rule) return 'laws';
  if (scope === 'laws' && rule && !law) return 'project';
  return null;
}
