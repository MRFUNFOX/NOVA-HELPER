import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildIndex, rank } from '../src/lib/search';

const db = JSON.parse(readFileSync(new URL('../dev/mock-db.json', import.meta.url), 'utf8'));
const index = buildIndex(db.docs);
const top = (q: string, k = 5) => rank(index, q, k).map((e) => `${e.node.number} ${e.doc.title.slice(0, 25)} | ${e.node.text.slice(0, 60).replace(/\n/g, ' ')}`);

describe('подбор пунктов для ИИ', () => {
  it('вопрос своими словами про убийство без причины находит DeathMatch', () => {
    // Ключевые слова, которые добавляет к вопросу нейросеть
    const r = top('можно ли убить человека просто так без причины? убийство DM без причины', 12);
    console.log(r.join('\n'));
    expect(r.some((x) => /DeathMatch|DM/.test(x))).toBe(true);
  });
  it('вопрос про оскорбление родственников', () => {
    const r = top('что будет если оскорбить родителей другого игрока', 8);
    console.log(r.join('\n'));
    expect(r.some((x) => /родн|родител/i.test(x))).toBe(true);
  });
  it('вопрос по законам: кража', () => {
    const r = top('какое наказание за кражу машины', 8);
    console.log(r.join('\n'));
    expect(r.some((x) => /краж|хищен|угон/i.test(x))).toBe(true);
  });
  it('номер пункта в вопросе — пункт обязательно в выборке', () => {
    expect(rank(index, 'что значит пункт 2.7.2?', 12).some((e) => e.node.number === '2.7.2')).toBe(true);
  });
});
