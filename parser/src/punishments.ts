import type { Punishment, PunishmentKind } from './types.js';

/** Похоже ли на наказание — используется, чтобы отличить « | BAN …» от « | » в обычном тексте. */
export const PUNISH_RE =
  /(?<!\p{L})(ban|warn|jail|mute|rmute|kick|demorgan|бан|варн|мут|кик|чс)(?!\p{L})|блокир|деморган|изъяти|конфиск|обнулен|лишени\p{L}*\s+свобод|штраф|увольнен|выговор|предупрежден|ч[её]рн\p{L}*\s+спис|навсегда|перманент/iu;

const KIND_RULES: [PunishmentKind, RegExp][] = [
  ['blacklist', /(?<!\p{L})чс(?!\p{L})|ч[её]рн\p{L}*\s+спис/iu],
  ['ban', /(?<!\p{L})(ban|бан)(?!\p{L})|блокир/iu],
  ['warn', /(?<!\p{L})(warn|варн)/iu],
  ['jail', /(?<!\p{L})(jail|demorgan)(?!\p{L})|деморган/iu],
  ['mute', /(?<!\p{L})(r?mute|мут)/iu],
  ['kick', /(?<!\p{L})(kick|кик)/iu],
  ['confiscation', /изъяти|конфиск/i],
  ['reset', /обнулен/i],
  ['prison', /лишени\p{L}*\s+свобод/iu],
  ['fine', /штраф/i],
  ['dismissal', /увольнен/i],
  ['reprimand', /выговор|предупрежден/i],
];

export function classifyPunishment(raw: string): Punishment {
  const text = raw.replace(/^\s*наказани[ея]\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
  const kinds = KIND_RULES.filter(([, re]) => re.test(text)).map(([k]) => k);
  const permanentBan = /(ban|бан|блокир)[^.;]{0,40}(навсегда|перманент)|перманентн\p{L}*\s+блокир/iu.test(text);
  if (permanentBan) kinds.push('permaban');
  return {
    raw: text,
    kinds: kinds.length ? kinds : ['other'],
    severe: permanentBan || kinds.includes('blacklist'),
  };
}

/**
 * Делит строку пункта по « | »: первая часть — текст правила, остальные — наказания.
 * Части, не похожие на наказание, возвращаются в текст.
 */
export function splitPipePunishments(line: string): { text: string; punishments: Punishment[] } {
  if (!line.includes('|')) return { text: line, punishments: [] };
  const parts = line.split(/\s*\|\s*/);
  const textParts: string[] = [parts[0] ?? ''];
  const punishments: Punishment[] = [];
  for (const part of parts.slice(1)) {
    if (!part.trim()) continue;
    const prev = punishments[punishments.length - 1];
    // «BAN от 1 до 30 дней | Навсегда.» — это одна градация наказания, а не два
    if (prev && /^(навсегда|перманентно)(?!\p{L})/iu.test(part.trim())) {
      punishments[punishments.length - 1] = classifyPunishment(`${prev.raw} | ${part.trim()}`);
      continue;
    }
    if (PUNISH_RE.test(part)) punishments.push(classifyPunishment(part));
    else if (punishments.length === 0) textParts.push(part);
    else {
      // продолжение наказания без ключевых слов («каждому участнику сделки»)
      const last = punishments[punishments.length - 1]!;
      last.raw = `${last.raw} | ${part.trim()}`;
    }
  }
  return { text: textParts.join(' | ').trim(), punishments };
}
