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
