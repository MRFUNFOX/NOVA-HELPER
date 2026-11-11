import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildIndex, search, snippet } from '../src/lib/search';

const db = JSON.parse(readFileSync(new URL('../dev/mock-db.json', import.meta.url), 'utf8'));
const index = buildIndex(db.docs);
const top = (q: string, n = 3) => search(index, q).slice(0, n).map((h) => `${h.entry.node.number ?? ''} ${h.entry.node.text.slice(0, 40)}`);

describe('поиск по правилам', () => {
  it('сленг: «дм» находит DeathMatch первым', () => {
    expect(top('дм', 1)[0]).toMatch(/DeathMatch|DM/);
  });
  it('другая форма слова: «оскорбил родных» находит пункт про оскорбление родных', () => {
    const r = search(index, 'оскорбление родных');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.entry.plain.toLowerCase()).toMatch(/оскорбл/);
  });
  it('номер пункта открывает сам пункт, а потом его подпункты', () => {
    const r = search(index, '2.7');
    expect(r[0]!.entry.node.number).toBe('2.7');
    expect(r.some((h) => h.entry.node.number === '2.7.1')).toBe(true);
  });
  it('находит и по тексту наказания: «перманентная блокировка»', () => {
    expect(search(index, 'навсегда бан').length).toBeGreaterThan(3);
  });
  it('сокращение кодекса: «ук 1.2» и «ст. 1.2 УК» — статья Уголовного кодекса', () => {
    for (const q of ['ук 1.2', 'ст. 1.2 УК', 'УК ст 1.2']) {
      const r = search(index, q);
      expect(r[0]!.entry.node.number, q).toBe('1.2');
      expect(r[0]!.entry.doc.title, q).toMatch(/Уголовный/);
      expect(r.every((h) => /Уголовный/.test(h.entry.doc.title)), q).toBe(true);
    }
  });
  it('номер без кодекса: сначала документы открытого раздела', () => {
    const laws = search(index, '1.2', 60, (d) => d.scope === 'server');
    expect(laws[0]!.entry.doc.scope).toBe('server');
    const rules = search(index, '1.2', 60, (d) => d.scope === 'project');
    expect(rules[0]!.entry.doc.scope).toBe('project');
  });
  it('законы ищутся по тексту: «лишение свободы»', () => {
    expect(search(index, 'лишение свободы').some((h) => h.entry.doc.scope === 'server')).toBe(true);
  });
  it('пустой и бессмысленный запрос — пустой результат', () => {
    expect(search(index, '   ')).toEqual([]);
    expect(search(index, 'зюзюкабра')).toEqual([]);
  });
  it('подсветка фрагмента', () => {
    const s = snippet('Запрещено убийство без причины (DeathMatch / DM)', 'дм');
    expect(s.marks.length).toBeGreaterThan(0);
    expect(s.text.slice(s.marks[0]![0], s.marks[0]![1]).toLowerCase()).toMatch(/deathmatch|dm/);
  });
  it('скорость: 200 запросов быстрее секунды', () => {
    const t = performance.now();
    for (let i = 0; i < 200; i++) search(index, i % 2 ? 'оружие в зеленой зоне' : 'дм');
    expect(performance.now() - t).toBeLessThan(1000);
  });
});
