import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buyerPin, expectedTime, minutesLeft, nextCheckIn, rowsOf, timeLabel, type PricesFile } from '../src/lib/prices';

// Настоящий файл от сборщика (17.11.2026 00:05 МСК)
const file = JSON.parse(readFileSync(new URL('./fixtures/prices.json', import.meta.url), 'utf8')) as PricesFile;

describe('цены скупщиков', () => {
  it('строки: 16 товаров сырья и 4 продукта, в порядке как в Discord', () => {
    const rows = rowsOf(file, {});
    const raw = rows.filter((r) => r.group === 'raw');
    expect(raw.length).toBe(16);
    expect(raw[0]!.item).toBe('Медь');
    expect(raw[15]!.item).toBe('Хорошее мясо');
    expect(rows.filter((r) => r.group === 'products').map((r) => r.item)).toEqual(['Капуста', 'Тыква', 'Мандарины', 'Ананасы']);
  });

  it('крупно — начальная цена, мелко — минимальная; стрелка к прошлому часу', () => {
    const benz = rowsOf(file, {}).find((r) => r.item === 'Бензин')!;
    expect(benz.cells[0]).toMatchObject({ n: 1, start: 109, min: 91 });
    // Прошлый час у №1 — 166 → (109 − 166) / 166 = −34%
    expect(benz.cells[0]!.delta).toBe(-34);
  });

  it('лучшая цена — одна, у самого щедрого скупщика', () => {
    for (const r of rowsOf(file, {}).filter((x) => x.group === 'raw')) {
      const best = r.cells.filter((c) => c.best);
      expect(best.length).toBe(1);
      expect(best[0]!.start).toBe(Math.max(...r.cells.map((c) => c.start)));
    }
  });

  it('редкая цена — от порога недели', () => {
    const f: PricesFile = { ...file, rareFrom: { ...file.rareFrom, Бензин: 200 } };
    const benz = rowsOf(f, {}).find((r) => r.item === 'Бензин')!;
    expect(benz.cells.map((c) => c.rare)).toEqual(benz.cells.map((c) => c.start >= 200));
    // Без истории порогов нет — и редких нет
    expect(rowsOf({ ...file, rareFrom: {} }, {}).some((r) => r.cells.some((c) => c.rare))).toBe(false);
  });

  it('цель: зелёная ячейка, где цена дошла', () => {
    const benz0 = rowsOf(file, {}).find((r) => r.item === 'Бензин')!;
    const top = Math.max(...benz0.cells.map((c) => c.start));
    const benz = rowsOf(file, { Бензин: top }).find((r) => r.item === 'Бензин')!;
    expect(benz.reached).toBe(true);
    expect(benz.cells.filter((c) => c.goal).every((c) => c.start >= top)).toBe(true);
    expect(rowsOf(file, { Бензин: top + 1 }).find((r) => r.item === 'Бензин')!.reached).toBe(false);
  });

  it('продукты — одна цена, без «мин» и без «лучшей»', () => {
    const c = rowsOf(file, {}).find((r) => r.item === 'Капуста')!.cells;
    expect(c.length).toBe(1);
    expect(c[0]).toMatchObject({ n: 0, min: null, best: false });
  });

  it('окно скупщика для слоя поверх игры', () => {
    const row = rowsOf(file, { Лосось: 1000 }).find((r) => r.item === 'Лосось')!;
    const p = buyerPin(row, file.time);
    expect(p.key).toBe('buyer:Лосось');
    expect(p.kind).toBe('buyer');
    expect(p.buyer!.goal).toBe(1000);
    expect(p.buyer!.cells.length).toBe(3);
  });

  it('время и расписание проверок', () => {
    expect(timeLabel('2026-11-17T00:05:00+03:00')).toBe('00:05');
    const t = Date.parse('2026-11-17T00:05:00+03:00');
    expect(minutesLeft('2026-11-17T00:05:00+03:00', t + 37 * 60e3)).toBe(23);
    // 00:07 МСК — последние цены должны быть за 00:05
    expect(expectedTime(t + 2 * 60e3)).toBe(t);
    // 01:03 МСК — ещё ждём 01:05, последние положенные — 00:05
    expect(expectedTime(t + 58 * 60e3)).toBe(t);
    // Свежий файл — следующая проверка в 01:05:15, раньше цен не бывает
    expect(nextCheckIn(file, t + 10 * 60e3)).toBe(50 * 60e3 + 15e3);
    // В 01:05:05 цен ещё не может быть — ждём до 01:05:15, а не дёргаем GitHub
    expect(nextCheckIn(file, t + 60 * 60e3 + 5e3)).toBe(10e3);
    // Цены 01:05 ещё не пришли: до 01:07 — каждые 5 с, потом реже, через полчаса — редко
    expect(nextCheckIn(file, t + 61 * 60e3)).toBe(5e3);
    expect(nextCheckIn(file, t + 66 * 60e3)).toBe(30e3);
    expect(nextCheckIn(file, t + 75 * 60e3)).toBe(2 * 60e3);
    expect(nextCheckIn(file, t + 95 * 60e3)).toBe(5 * 60e3);
  });
});
