import { describe, expect, it } from 'vitest';
import { byCat, byDay, daysAgo, digits, inPeriod, MAX_PROFILES, money, perDay, recWord, sanitize, short, signed, totals, type Entry } from '../src/lib/calc';

const now = new Date(2026, 10, 21, 1, 30).getTime();
const at = (ago: number, h = 20) => { const d = new Date(2026, 10, 21 - ago, h, 0); return d.getTime(); };
const E = (ago: number, k: 'inc' | 'exp', cat: string, sum: number, h = 20): Entry => ({ id: `${ago}${k}${cat}${sum}`, at: at(ago, h), k, cat, sum });

describe('калькулятор прибыли', () => {
  const list = [E(0, 'inc', 'Скупщик', 186000, 0), E(0, 'exp', 'Бензин', 4200, 0), E(1, 'inc', 'Работа', 71000), E(6, 'exp', 'Тюнинг', 140000), E(7, 'inc', 'Кейсы', 35000), E(29, 'inc', 'Бизнес', 210000), E(40, 'exp', 'Аренда', 50000)];

  it('дни считаются по календарю, а не по 24 часам', () => {
    expect(daysAgo(at(0, 0), now)).toBe(0);
    expect(daysAgo(new Date(2026, 10, 20, 23, 59).getTime(), now)).toBe(1);
  });
  it('периоды: сегодня, неделя (7 дней), месяц (30 дней), всё время', () => {
    expect(inPeriod(list, 'day', now)).toHaveLength(2);
    expect(inPeriod(list, 'week', now)).toHaveLength(4);
    expect(inPeriod(list, 'month', now)).toHaveLength(6);
    expect(inPeriod(list, 'all', now)).toHaveLength(7);
  });
  it('итоги: заработал, потратил, прибыль', () => {
    expect(totals(inPeriod(list, 'day', now))).toEqual({ inc: 186000, exp: 4200, net: 181800 });
  });
  it('записи по дням — свежие дни первыми', () => {
    const d = byDay(list, now);
    expect(d.map((x) => x.ago)).toEqual([0, 1, 6, 7, 29, 40]);
    expect(d[0].net).toBe(181800);
  });
  it('категории — от большей суммы', () => {
    expect(byCat(list, 'inc').map((c) => c.cat)).toEqual(['Бизнес', 'Скупщик', 'Работа', 'Кейсы']);
  });
  it('график: n дней, последний — сегодня', () => {
    const p = perDay(list, 7, now);
    expect(p).toHaveLength(7);
    expect(p[6].net).toBe(181800);
    expect(p[0].net).toBe(-140000);
  });
  it('деньги и подписи', () => {
    expect(money(1250000)).toBe('$1 250 000');
    expect(signed(-4200)).toBe('−$4 200');
    expect(short(186000)).toBe('186к');
    expect(short(1200000)).toBe('1,2М');
    expect(digits('1 250 000')).toBe(1250000);
    expect(recWord(1)).toBe('1 запись');
    expect(recWord(3)).toBe('3 записи');
    expect(recWord(17)).toBe('17 записей');
    expect(recWord(21)).toBe('21 запись');
  });
  it('битые данные отбрасываются, профилей не больше 10', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, name: `П${i}`, start: 1, created: 0, entries: [{ id: 'x', at: 1, k: 'inc', cat: 'Работа', sum: 5 }, { id: 'bad', at: 1, k: 'oops', cat: 'Работа', sum: 5 }] }));
    const s = sanitize([null, { id: 1 }, ...many]);
    expect(s).toHaveLength(MAX_PROFILES);
    expect(s[0].entries).toHaveLength(1);
    expect(sanitize('мусор')).toEqual([]);
  });
});

import { goalOf } from '../src/lib/calc';
describe('цель профиля', () => {
  const base = { id: 'p', name: 'П', start: 1_000_000, created: 0, entries: [{ id: 'a', at: 1, k: 'inc' as const, cat: 'Работа', sum: 3_000_000 }] };
  it('«хочу, чтобы было» — считает баланс', () => {
    expect(goalOf({ ...base, goal: { kind: 'bal', sum: 5_000_000 } })).toMatchObject({ cur: 4_000_000, pct: 80, done: false, left: 1_000_000 });
  });
  it('«хочу заработать ещё» — считает только заработанное', () => {
    expect(goalOf({ ...base, goal: { kind: 'earn', sum: 3_000_000 } })).toMatchObject({ cur: 3_000_000, pct: 100, done: true, left: 0 });
  });
  it('без цели — null; битая цель отбрасывается', () => {
    expect(goalOf(base)).toBeNull();
    expect(sanitize([{ ...base, goal: { kind: 'x', sum: 5 } }])[0]!.goal).toBeNull();
    expect(sanitize([{ ...base, goal: { kind: 'earn', sum: 5 } }])[0]!.goal).toEqual({ kind: 'earn', sum: 5 });
  });
});

import { isMandatory } from '../src/lib/backend';
describe('обязательное обновление', () => {
  it('метка «[обязательное]» в описании выпуска', () => {
    expect(isMandatory('Исправлены цены скупщиков.\n\n[обязательное]\n\nСкачайте файл…')).toBe(true);
    expect(isMandatory('Исправлены цены скупщиков.')).toBe(false);
    expect(isMandatory(undefined)).toBe(false);
  });
});

import { cmpVersion, pickTarget, updateUrl } from '../src/lib/update';
describe('какую версию предложить', () => {
  it('версии сравниваются числами', () => {
    expect(cmpVersion('0.7.13', '0.7.9')).toBeGreaterThan(0);
    expect(cmpVersion('v0.8.0', '0.7.99')).toBeGreaterThan(0);
    expect(cmpVersion('0.7.14', '0.7.14')).toBe(0);
  });
  it('всем — последний выпуск; обязательный — по метке', () => {
    expect(pickTarget('0.7.14', { version: '0.7.15', notes: 'a\n\n[обязательное]' }, null)).toEqual({ version: '0.7.15', source: 'latest', mandatory: true });
    expect(pickTarget('0.7.15', { version: '0.7.15' }, null)).toBeNull();
  });
  it('тестовую видит только команда и только если она новее', () => {
    expect(pickTarget('0.7.15', { version: '0.7.15' }, { version: '0.7.16' })).toEqual({ version: '0.7.16', source: 'test', mandatory: false });
    expect(pickTarget('0.7.16', { version: '0.7.15' }, { version: '0.7.16' })).toBeNull();
  });
  it('вышла обычная версия новее тестовой — ставится обычная', () => {
    expect(pickTarget('0.7.16', { version: '0.7.17' }, { version: '0.7.16' })).toEqual({ version: '0.7.17', source: 'latest', mandatory: false });
  });
  it('адрес обновления версии', () => {
    expect(updateUrl('0.7.15')).toBe('https://github.com/MRFUNFOX/NOVA-HELPER/releases/download/v0.7.15/latest.json');
  });
});
