import { describe, expect, it } from 'vitest';
import { inlinePunishment } from '../src/punishments.js';

describe('наказание после тире (УК Horizon с 23.11.2026)', () => {
  it('«— до 7 месяцев лишения свободы»', () => {
    const p = inlinePunishment('(ВОЕННЫЙ) Нарушение правил вождения боевой машины, повлекшее по неосторожности причинение тяжкого вреда здоровью человека — до 7 месяцев лишения свободы.');
    expect(p?.kinds).toEqual(['prison']);
    expect(p?.raw).toBe('До 7 месяцев лишения свободы');
  });
  it('«— 1 год лишения свободы» и штраф', () => {
    expect(inlinePunishment('Воспрепятствование избирательным правам — 1 год лишения свободы.')?.kinds).toContain('prison');
    expect(inlinePunishment('Мелкое хулиганство — штраф в размере 5.000$.')?.kinds).toContain('fine');
  });
  it('тире в определениях не путает', () => {
    expect(inlinePunishment('Объект преступления – общественные отношения, охраняемые уголовным законом.')).toBeUndefined();
    expect(inlinePunishment('Субъект преступления – физическое лицо, которое совершило деяние.')).toBeUndefined();
    expect(inlinePunishment('Полёт на вертолёте над городом - запрещён.')).toBeUndefined();
  });
});
