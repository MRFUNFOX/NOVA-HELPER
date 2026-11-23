import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildIndex, rank, type Entry } from '../src/lib/search';
import { analysisText, mergeGroups, parseAnalysis, parseCheck } from '../src/lib/ai.svelte';
import { EXAM, citesRef, examScore, type ExamResult } from '../src/lib/exam';
import { slang } from '../src/lib/slang';
import type { RuleDocument } from '@shared/types';

describe('разбор ситуации', () => {
  it('читает JSON даже с лишним текстом вокруг', () => {
    const a = parseAnalysis('Вот разбор:\n```json\n{"who":["игрок","два госника — игроки"],"facts":["выписали штраф"],"ask":"справедливо ли","topics":[{"check":"штраф без причины","words":["злоупотребление полномочиями"]},"взятка на улице"],"docs":["D2",5],"dispute":false}\n```');
    expect(a).not.toBeNull();
    expect(a!.who).toHaveLength(2);
    expect(a!.topics).toEqual([{ check: 'штраф без причины', words: ['злоупотребление полномочиями'] }, { check: 'взятка на улице', words: [] }]);
    expect(a!.docs).toEqual(['D2', '5']);
    expect(a!.dispute).toBe(false);
  });
  it('старый формат (слова для поиска) тоже понимает', () => {
    const a = parseAnalysis('{"docs":["D1"],"keywords":["DM","убийство"],"dispute":true}');
    expect(a!.topics).toEqual([{ check: '', words: ['DM', 'убийство'] }]);
    expect(a!.dispute).toBe(true);
  });
  it('мусор — null, а не падение', () => {
    expect(parseAnalysis('не знаю')).toBeNull();
    expect(parseAnalysis('{"topics": 5}')!.topics).toEqual([]);
  });
  it('черновик для ответа: только заполненное', () => {
    const t = analysisText({ who: ['игрок'], facts: [], ask: 'прав ли он', topics: [{ check: 'DM', words: [] }, { check: '', words: ['x'] }], docs: [], dispute: false });
    expect(t).toContain('Участники: игрок');
    expect(t).toContain('Что проверить: 1) DM');
    expect(t).not.toContain('Факты');
    expect(analysisText({ who: [], facts: [], ask: '', topics: [], docs: [], dispute: false })).toBe('');
  });
});

describe('пункты из нескольких поисков', () => {
  const size = () => 100;
  const key = (x: string) => x;
  it('обязательные первыми, дальше по очереди из каждого поиска, без повторов', () => {
    expect(mergeGroups(['n'], [['a1', 'a2', 'a3'], ['b1', 'a1', 'b2'], ['c1']], 10_000, 20, size, key))
      .toEqual(['n', 'a1', 'b1', 'c1', 'a2', 'a3', 'b2']);
  });
  it('не больше бюджета и не больше max', () => {
    expect(mergeGroups([], [['a1', 'a2'], ['b1', 'b2']], 300, 20, size, key)).toEqual(['a1', 'b1', 'a2']);
    expect(mergeGroups([], [['a1', 'a2'], ['b1', 'b2']], 10_000, 2, size, key)).toEqual(['a1', 'b1']);
  });
  it('длинный пункт, который не влез, не мешает короткому', () => {
    const sz = (x: string) => (x === 'big' ? 900 : 100);
    expect(mergeGroups([], [['big', 'a2'], ['b1']], 500, 20, sz, key)).toEqual(['b1', 'a2']);
  });
});

describe('самопроверка ответа', () => {
  it('поправляем только если нашла ошибку и дала новый текст', () => {
    expect(parseCheck('{"ok": true, "problems": [], "answer": ""}')!.fix).toBe(false);
    expect(parseCheck('{"ok": false, "problems": ["перепутал участников"], "answer": ""}')!.fix).toBe(false);
    expect(parseCheck('{"ok": false, "problems": [], "answer": "Новый ответ достаточно длинный"}')!.fix).toBe(false);
    const r = parseCheck('{"ok": false, "problems": ["перепутал участников"], "answer": "**Да, справедливо.** Сотрудники злоупотребили полномочиями [S1]."}')!;
    expect(r.fix).toBe(true);
    expect(r.problems).toEqual(['перепутал участников']);
    expect(parseCheck('ой')).toBeNull();
  });
});

describe('экзамен', () => {
  it('ссылка на нужный пункт: 4.1 — не 4.10 и не 14.1', () => {
    expect(citesRef(['4.1 · Общие правила проекта'], ['4.1'])).toBe(true);
    expect(citesRef(['4.10 · Общие правила проекта'], ['4.1'])).toBe(false);
    expect(citesRef(['14.1 · Общие правила проекта'], ['4.1'])).toBe(false);
    expect(citesRef(['ст. 6.2 ч. 1 · Уголовный Кодекс'], ['6.2'])).toBe(true);
    expect(citesRef(['ст. 6.2.1 ч. 1 · Уголовный Кодекс'], ['6.2'])).toBe(false);
    expect(citesRef([], ['6.2'])).toBe(false);
  });
  it('оценка: да — балл, частично — половина, ошибка — ноль', () => {
    const r = (match: ExamResult['match']): ExamResult => ({ id: match, answer: '', cited: [], citedOk: true, match, why: '' });
    expect(examScore([r('yes'), r('partly'), r('no'), r('error')])).toBe(38);
    expect(examScore([])).toBe(0);
  });
  it('вопросы уникальны и у каждого есть эталон и пункты', () => {
    expect(new Set(EXAM.map((x) => x.id)).size).toBe(EXAM.length);
    for (const x of EXAM) {
      expect(x.verdict.length).toBeGreaterThan(10);
      expect(x.refs.length).toBeGreaterThan(0);
      // Вопрос с ником через «_» ушёл бы в проверку ника, а не в обычный ответ
      expect(x.q).not.toMatch(/[A-Za-z]+_[A-Za-z]+/);
    }
  });

  const db = JSON.parse(readFileSync(new URL('../dev/mock-db.json', import.meta.url), 'utf8')) as { docs: RuleDocument[] };
  const index = buildIndex(db.docs);
  const inScope = (scope: 'project' | 'laws') => (d: RuleDocument) => (scope === 'laws') === (d.scope === 'server');
  const num = (e: Entry) => (e.article ?? e.node.number ?? '');

  it('пункты эталона есть в правилах нужного раздела', () => {
    for (const x of EXAM) {
      const found = x.refs.some((r) => index.entries.some((e) => inScope(x.scope)(e.doc) && num(e) === r));
      expect(found, `${x.id}: нет пункта ${x.refs.join('/')}`).toBe(true);
    }
  });

  it('даже без разбора нейросети поиск по вопросу находит нужный пункт для большинства вопросов', () => {
    const missed: string[] = [];
    for (const x of EXAM) {
      const got = rank(index, `${x.q} ${slang(x.q)}`, 18, inScope(x.scope));
      if (!got.some((e) => x.refs.includes(num(e)))) missed.push(x.id);
    }
    console.log('Без разбора не нашлось:', missed.join(', ') || 'всё нашлось');
    expect(missed.length).toBeLessThanOrEqual(Math.floor(EXAM.length / 3));
  });

  it('с разбором каждая часть ситуации получает свои пункты', () => {
    const pick = (scope: 'project' | 'laws', q: string, topics: { check: string; words: string[] }[]) => {
      const groups = topics.map((t) => rank(index, `${t.check} ${t.words.join(' ')} ${slang(t.check)}`, 6, inScope(scope)));
      const whole = rank(index, `${q} ${slang(q)}`, 14, inScope(scope));
      return mergeGroups([], [...groups, whole], 8500, 18, (e) => 90 + Math.min(e.node.text.length, 550), (e) => e.node.id);
    };
    const has = (es: Entry[], n: string, doc: RegExp) => es.some((e) => num(e) === n && doc.test(e.doc.title));
    const gov = pick('project', EXAM.find((x) => x.id === 'gov-story')!.q, [
      { check: 'можно ли сотруднику госструктуры выписывать штрафы без причины', words: ['злоупотребление полномочиями', 'необоснованная выдача штрафов'] },
      { check: 'можно ли сотруднику брать взятку на центральной улице', words: ['взятки', 'общественных местах', 'центральных улицах'] },
    ]);
    expect(has(gov, '5.1', /государственных структур/)).toBe(true);
    expect(has(gov, '5.9', /государственных структур/)).toBe(true);
    const ems = pick('project', 'Можно ограбить медика EMS, пока он на работе?', [
      { check: 'можно ли грабить сотрудника EMS в рабочее время', words: ['грабить', 'EMS', 'рабочее время'] },
    ]);
    expect(has(ems, '5.3', /Общие правила проекта/)).toBe(true);
    const bribe = pick('laws', 'Что будет моему персонажу, если он даст взятку полицейскому?', [
      { check: 'дача взятки должностному лицу', words: ['дача взятки', 'должностному лицу'] },
    ]);
    expect(bribe.some((e) => num(e) === '15.5' || /дача взятки/i.test(e.node.text))).toBe(true);
  });
});
