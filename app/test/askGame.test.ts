import { describe, expect, it } from 'vitest';
import { answerState } from '../src/lib/askGame';
import type { Turn } from '../src/lib/ai.svelte';

const entry = (num: string, title: string) => ({ doc: { id: 'd', title, scope: 'project' }, node: { number: num, text: '', punishments: [], annotations: [] }, path: [] });

describe('ответ для окна поверх игры', () => {
  it('жирное остаётся, ссылки [S#] уходят в плашки с номером пункта', () => {
    const t = { q: 'Это DM?', a: '**Не DM.** Прицеливание — весомая IC-причина [S1].', sources: [{ n: 1, entry: entry('4.1', 'Общие правила проекта') }] } as unknown as Turn;
    const s = answerState(t);
    expect(s.stage).toBe('answer');
    if (s.stage !== 'answer') return;
    expect(s.parts).toEqual([{ t: 'bold', v: 'Не DM.' }, { t: 'text', v: ' Прицеливание — весомая IC-причина.' }]);
    expect(s.refs).toEqual([{ num: '4.1', doc: 'Общие правила проекта' }]);
  });
  it('ошибка помощника — ошибкой', () => {
    const t = { q: 'Вопрос', a: '', sources: [], error: 'Нет связи' } as unknown as Turn;
    expect(answerState(t)).toEqual({ stage: 'error', error: 'Нет связи', q: 'Вопрос' });
  });
});

describe('сколько показывать ответ («Авто»)', () => {
  it('короткий — около 30 секунд, длинный — до 2 минут', async () => {
    const { autoSeconds } = await import('../src/lib/askTime');
    expect(autoSeconds(3, 5)).toBe(30);
    expect(autoSeconds(10, 10)).toBe(34);
    expect(autoSeconds(30, 10)).toBe(64);
    expect(autoSeconds(80, 20)).toBe(120);
  });
});

import { EXAM, examScore, staleRules } from '../src/lib/exam';
describe('экзамен помощника', () => {
  it('у каждого вопроса есть опора на текст правила', () => {
    for (const x of EXAM) expect(x.rule.length, x.id).toBeGreaterThan(0);
  });
  it('правило переписали — эталон устарел, в итог не входит', () => {
    const murder = EXAM.find((x) => x.id === 'law-murder')!;
    expect(staleRules(murder, () => ['Убийство — 1 год лишения свободы.'])).toEqual([]);
    expect(staleRules(murder, () => ['Убийство — 4 года лишения свободы.'])).toEqual(['6.2']);
    expect(staleRules(murder, () => [])).toEqual(['6.2']);
    const r = (match: 'yes' | 'no' | 'stale') => ({ id: '', answer: '', cited: [], citedOk: true, match, why: '' });
    expect(examScore([r('yes'), r('stale'), r('stale')])).toBe(100);
    expect(examScore([r('yes'), r('no')])).toBe(50);
  });
});
