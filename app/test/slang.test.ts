import { describe, expect, it } from 'vitest';
import { slang } from '../src/lib/slang';

describe('разговорные слова → термины правил', () => {
  it('переводит сленг', () => {
    expect(slang('я растулил копа')).toContain('убийство');
    expect(slang('я растулил копа')).toContain('сотрудник полиции');
    expect(slang('ограбили дальнобойщика')).toContain('ограбление');
    expect(slang('угнал тачку')).toContain('транспорт');
  });
  it('не цепляется к обычным словам', () => {
    expect(slang('считается ли это нарушением')).toBe('');
    expect(slang('скопировать текст в положение')).toBe('');
    expect(slang('материк и автор')).toBe('');
  });
});
