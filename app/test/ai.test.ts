import { describe, expect, it } from 'vitest';
import { answerText, looksLikeDispute, parseVerdict, pieces, refsIn } from '../src/lib/ai.svelte';
import { learn } from '../src/lib/learn.svelte';

describe('ссылки в ответе', () => {
  it('квадратные и круглые скобки, статьи и разъяснения', () => {
    const p = pieces('Можно [S1, N2]. По ст. 15 ч. 1 (S7) — **нельзя**.');
    expect(p.filter((x) => x.t === 'ref')).toEqual([
      { t: 'ref', n: 1, kind: 's' }, { t: 'ref', n: 2, kind: 'n' }, { t: 'ref', n: 7, kind: 's' },
    ]);
    expect(p.some((x) => x.t === 'bold' && x.v === 'нельзя')).toBe(true);
    expect(pieces('(см. приложение)').every((x) => x.t === 'text')).toBe(true);
  });
});

describe('разбор довода', () => {
  const answer = 'Вы правы. Бронежилет — спецсредство [S1].\nИТОГ: {"agree": true, "refs": "ст. 4 ч. 1", "note": "Бронежилет — спецсредство.", "keywords": ["бронежилет", "бронник"]}';
  it('служебная строка не видна игроку', () => {
    expect(answerText(answer)).toBe('Вы правы. Бронежилет — спецсредство [S1].');
    expect(answerText('Вы правы.\n**ИТОГ:** {"agr')).toBe('Вы правы.');
    expect(answerText('Обычный ответ')).toBe('Обычный ответ');
  });
  it('итог читается', () => {
    expect(parseVerdict(answer)).toEqual({ agree: true, refs: 'ст. 4 ч. 1', note: 'Бронежилет — спецсредство.', keywords: ['бронежилет', 'бронник'] });
    expect(parseVerdict('без итога')).toBeNull();
    expect(parseVerdict('ИТОГ: {сломано')).toBeNull();
  });
  it('спор узнаётся', () => {
    for (const q of [
      'Но ст. 12.8 ч. 2 наказывает только за незаконное ношение',
      'Нигде не сказано, что нельзя носить бронник',
      'Ты не прав, там про оружие',
      'А где это написано?',
      'Нет, это неправильно',
      'там только про оружие',
    ]) expect(looksLikeDispute(q), q).toBe(true);
    for (const q of ['А зачем тогда эта лицензия нужна?', 'Сколько дают за угон?', 'Можно носить бронежилет?', 'Нормально']) expect(looksLikeDispute(q), q).toBe(false);
  });
  it('номера статей из довода', () => {
    expect(refsIn('Но ст. 12.8 ч. 2 и статья 15, а ещё п. 2.4')).toEqual([{ num: '12.8', part: '2' }, { num: '15', part: undefined }, { num: '2.4', part: undefined }]);
    expect(refsIn('ч. 1 ст. 15')).toContainEqual({ num: '15', part: '1' });
    expect(refsIn('текст 5 раз')).toEqual([]);
  });
});

describe('разъяснения к вопросу', () => {
  it('находятся по словам, разделы не смешиваются', () => {
    learn.notes = [
      { id: 'a', scope: 'laws', text: 'Бронежилет — спецсредство', keywords: ['бронежилет', 'бронник'] },
      { id: 'b', scope: 'project', text: 'Ответный огонь — не DM', keywords: ['ответный огонь', 'дм'] },
    ];
    expect(learn.relevant('Госник говорит, что бронник надо прятать', 'laws').map((n) => n.id)).toEqual(['a']);
    expect(learn.relevant('Можно носить бронежилеты открыто?', 'laws').map((n) => n.id)).toEqual(['a']);
    expect(learn.relevant('Можно носить бронежилет?', 'project')).toEqual([]);
    expect(learn.relevant('Это был ответный огонь', 'project').map((n) => n.id)).toEqual(['b']);
    expect(learn.relevant('Сколько дают за угон?', 'laws')).toEqual([]);
  });
});
