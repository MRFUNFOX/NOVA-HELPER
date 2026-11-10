import { describe, expect, it } from 'vitest';
import { variants } from '../src/lib/punish';

const v = (raw: string) => variants({ raw, kinds: [], severe: false } as never).map((x) => `${x.level}:${x.text}`);

describe('наказания', () => {
  it('«Устный/Письменный выговор» — одно наказание', () => {
    expect(v('Устный/Письменный выговор')).toEqual(['other:Устный/Письменный выговор']);
  });
  it('градация через « / » и «|» делится на плашки', () => {
    expect(v('JAIL от 60 до 100 минут / WARN / BАN от 3-х до 30-ти дней')).toEqual(['other:JAIL от 60 до 100 минут', 'other:WARN', 'ban:BАN от 3-х до 30-ти дней']);
    expect(v('BAN от 1 до 30 дней | Навсегда')).toEqual(['ban:BAN от 1 до 30 дней', 'severe:Навсегда']);
    expect(v('Блокировка от 15 дней/Перманентная блокировка/Черный список')).toEqual(['ban:Блокировка от 15 дней', 'severe:Перманентная блокировка', 'severe:Черный список']);
  });
  it('«и/или» не делится', () => {
    expect(v('JAIL и/или WARN')).toEqual(['other:JAIL и/или WARN']);
  });
  it('запятая перед JAIL/WARN/BAN делит градацию', () => {
    expect(v('JAIL 180 минут с изъятием, WARN с изъятием, BAN до 3 дней.')).toEqual(['other:JAIL 180 минут с изъятием', 'other:WARN с изъятием', 'ban:BAN до 3 дней']);
    expect(v('JAIL до 180 минут, если игрок не состоит')).toEqual(['other:JAIL до 180 минут, если игрок не состоит']);
  });
  it('DEMORGAN/WARN — две плашки', () => {
    expect(v('DEMORGAN/WARN')).toEqual(['other:DEMORGAN', 'other:WARN']);
  });
});
