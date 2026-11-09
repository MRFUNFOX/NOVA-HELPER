/**
 * Стеммер Портера (Snowball) для русского языка: «оскорбил», «оскорбление», «оскорблять» → «оскорбл».
 * Без него поиск находит только точное совпадение формы слова, а игрок пишет как придётся.
 */

const VOWELS = 'аеиоуыэюя';

const PERFECTIVE_GERUND_1 = ['вшись', 'вши', 'в']; // после а/я
const PERFECTIVE_GERUND_2 = ['ывшись', 'ившись', 'ывши', 'ивши', 'ив', 'ыв'];
const ADJECTIVE = [
  'ими', 'ыми', 'его', 'ого', 'ему', 'ому', 'ее', 'ие', 'ые', 'ое', 'ей', 'ий', 'ый', 'ой', 'ем', 'им', 'ым', 'ом',
  'их', 'ых', 'ую', 'юю', 'ая', 'яя', 'ою', 'ею',
];
const PARTICIPLE_1 = ['ем', 'нн', 'вш', 'ющ', 'щ']; // после а/я
const PARTICIPLE_2 = ['ивш', 'ывш', 'ующ'];
const REFLEXIVE = ['ся', 'сь'];
const VERB_1 = ['ла', 'на', 'ете', 'йте', 'ли', 'й', 'л', 'ем', 'н', 'ло', 'но', 'ет', 'ют', 'ны', 'ть', 'ешь', 'нно']; // после а/я
const VERB_2 = [
  'ила', 'ыла', 'ена', 'ейте', 'уйте', 'ите', 'или', 'ыли', 'ей', 'уй', 'ил', 'ыл', 'им', 'ым', 'ен', 'ило', 'ыло',
  'ено', 'ят', 'ует', 'уют', 'ит', 'ыт', 'ены', 'ить', 'ыть', 'ишь', 'ую', 'ю',
];
const NOUN = [
  'а', 'ев', 'ов', 'ие', 'ье', 'е', 'иями', 'ями', 'ами', 'еи', 'ии', 'и', 'ией', 'ей', 'ой', 'ий', 'й', 'иям', 'ям',
  'ием', 'ем', 'ам', 'ом', 'о', 'у', 'ах', 'иях', 'ях', 'ы', 'ь', 'ию', 'ью', 'ю', 'ия', 'ья', 'я',
];
const SUPERLATIVE = ['ейше', 'ейш'];
const DERIVATIONAL = ['ость', 'ост'];

const byLength = (a: string[]) => [...a].sort((x, y) => y.length - x.length);
const PG1 = byLength(PERFECTIVE_GERUND_1);
const PG2 = byLength(PERFECTIVE_GERUND_2);
const ADJ = byLength(ADJECTIVE);
const PART1 = byLength(PARTICIPLE_1);
const PART2 = byLength(PARTICIPLE_2);
const VB1 = byLength(VERB_1);
const VB2 = byLength(VERB_2);
const NN = byLength(NOUN);

/** Убрать окончание из списка; group1 — окончания, которым должна предшествовать «а» или «я». */
function strip(word: string, rvStart: number, group1: string[], group2: string[] = []): string | null {
  for (const end of group2) {
    if (word.endsWith(end) && word.length - end.length >= rvStart) return word.slice(0, -end.length);
  }
  for (const end of group1) {
    if (word.endsWith(end) && word.length - end.length - 1 >= rvStart) {
      const prev = word[word.length - end.length - 1];
      if (prev === 'а' || prev === 'я') return word.slice(0, -end.length);
    }
  }
  return null;
}

export function stem(input: string): string {
  let word = input.toLowerCase().replace(/ё/g, 'е');
  if (word.length < 3 || !/^[а-я]+$/.test(word)) return word;

  // RV — часть слова после первой гласной; R2 — для производных окончаний
  let rv = -1;
  for (let i = 0; i < word.length; i++) {
    if (VOWELS.includes(word[i]!)) { rv = i + 1; break; }
  }
  if (rv < 0) return word;
  const r1 = regionAfter(word, 0);
  const r2 = regionAfter(word, r1);

  // Шаг 1
  const gerund = strip(word, rv, PG1, PG2);
  if (gerund !== null) {
    word = gerund;
  } else {
    word = strip(word, rv, [], REFLEXIVE) ?? word;
    const adj = strip(word, rv, [], ADJ);
    if (adj !== null) {
      word = strip(adj, rv, PART1, PART2) ?? adj;
    } else {
      const verb = strip(word, rv, VB1, VB2);
      if (verb !== null) word = verb;
      else word = strip(word, rv, [], NN) ?? word;
    }
  }
  // Шаг 2
  if (word.endsWith('и') && word.length - 1 >= rv) word = word.slice(0, -1);
  // Шаг 3
  for (const end of DERIVATIONAL) {
    if (word.endsWith(end) && word.length - end.length >= r2) { word = word.slice(0, -end.length); break; }
  }
  // Шаг 4
  if (word.endsWith('нн') && word.length - 1 >= rv) word = word.slice(0, -1);
  else {
    const sup = strip(word, rv, [], SUPERLATIVE);
    if (sup !== null) { word = sup; if (word.endsWith('нн')) word = word.slice(0, -1); }
    else if (word.endsWith('ь') && word.length - 1 >= rv) word = word.slice(0, -1);
  }
  return word;
}

/** Начало региона: позиция после первой не-гласной, которая идёт после гласной. */
function regionAfter(word: string, from: number): number {
  for (let i = from + 1; i < word.length; i++) {
    if (!VOWELS.includes(word[i]!) && VOWELS.includes(word[i - 1]!)) return i + 1;
  }
  return word.length;
}
