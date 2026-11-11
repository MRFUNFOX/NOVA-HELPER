import type { Punishment, RuleNode } from '@shared/types';

/**
 * Строгость наказания — для цвета:
 *  severe — перманентная блокировка, ЧС проекта, пожизненное лишение свободы (красный);
 *  ban    — временная блокировка, лишение свободы, арест (оранжевый);
 *  other  — JAIL, WARN, MUTE, штраф и прочее (жёлтый).
 */
export type Level = 'severe' | 'ban' | 'other';

const SEVERE = /навсегда|перманент|пожизненн|(?<!\p{L})чс(?!\p{L})|ч[её]рн\p{L}*\s+спис/iu;
const BAN = /(?<!\p{L})(b[aа]n|бан)(?!\p{L})|блокир|лишени\p{L}*\s+свобод|(?<!\p{L})арест/iu;
/** Реальный срок по законам штата — для фильтра «Лишение свободы» */
const PRISON = /лишени\p{L}*\s+свобод|пожизненн/iu; // «BАN» с русской «А» тоже встречается

export function levelOf(text: string): Level {
  if (SEVERE.test(text)) return 'severe';
  if (BAN.test(text)) return 'ban';
  return 'other';
}

export interface Variant { text: string; level: Level }

/**
 * Варианты одного наказания: «Блокировка от 15 дней/Перманентная блокировка/Черный список»
 * и «BAN от 1 до 30 дней | Навсегда» — это градация, показываем её отдельными плашками.
 * Делим по «|», по «/» перед заглавной буквой («и/или» не трогаем), по запятой перед JAIL/WARN/BAN
 * и по « или » («3 года лишения свободы или штраф…» — два варианта наказания).
 */
export function variants(p: Punishment): Variant[] {
  const raw = p.raw.split(/\s*\|\s*|\s+\/\s+|\/(?=[A-ZА-ЯЁ])|,\s*(?=(?:JAIL|WARN|B[AА]N|MUTE|KICK|DEMORGAN)(?!\p{L}))|\s+или\s+(?=\p{L}{3})/u).map((s) => s.trim().replace(/[.;,]$/, '')).filter(Boolean);
  // «Устный/Письменный выговор» — это одно наказание: одиночное русское слово склеиваем со следующим
  const parts: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let t = raw[i]!;
    while (i + 1 < raw.length && /^[А-ЯЁ]?[а-яё]+$/u.test(t.split('/').pop()!) && !/\s/.test(t)) t = `${t}/${raw[++i]}`;
    parts.push(t);
  }
  if (parts.length < 2) return [{ text: p.raw.trim().replace(/[.;]$/, ''), level: p.severe ? 'severe' : levelOf(p.raw) }];
  return parts.map((t) => ({ text: t.charAt(0).toUpperCase() + t.slice(1), level: levelOf(t) }));
}

/** Что показывать в документе: все пункты, только с наказанием или только самые строгие */
export type Filter = 'all' | 'punished' | 'severe';

const STRUCTURAL = new Set(['heading', 'section', 'chapter']);
export const isStructural = (n: RuleNode) => STRUCTURAL.has(n.kind);

/** `law` — документ из законов сервера: там «строгий» фильтр означает лишение свободы */
export function matches(n: RuleNode, f: Filter, law = false): boolean {
  if (f === 'all') return true;
  const self = f === 'severe' ? (law ? isPrison(n) : isSevere(n)) : n.punishments.length > 0;
  return self || n.children.some((c) => matches(c, f, law));
}

/**
 * Счётчики для карточек над документом. В законах считаем статьи (части статей — не отдельные
 * пункты), в правилах — пункты и подпункты.
 */
export function stats(nodes: RuleNode[], law = false) {
  const s = { points: 0, punished: 0, severe: 0 };
  const walk = (ns: RuleNode[]) => ns.forEach((n) => {
    if (!isStructural(n)) {
      const counted = !law || n.kind === 'article' || n.kind === 'point';
      if (counted) s.points++;
      // Статья закона «с наказанием», если наказание есть у неё или у её частей
      if (counted && (law ? matches(n, 'punished') : n.punishments.length > 0)) s.punished++;
      if (counted && (law ? matches(n, 'severe', true) : isSevere(n))) s.severe++;
      if (counted && law) return; // части статьи уже учтены в статье
    }
    walk(n.children);
  });
  walk(nodes);
  return s;
}

export function isSevere(n: RuleNode): boolean {
  return n.punishments.some((p) => p.severe || SEVERE.test(p.raw));
}

/** Для законов «строгое» — это реальный срок */
export function isPrison(n: RuleNode): boolean {
  return n.punishments.some((p) => PRISON.test(p.raw));
}

/** Самое строгое наказание пункта — для подписи в результатах поиска */
export function strongest(n: RuleNode): Level | null {
  if (!n.punishments.length) return null;
  if (isSevere(n)) return 'severe';
  return n.punishments.some((p) => BAN.test(p.raw)) ? 'ban' : 'other';
}
