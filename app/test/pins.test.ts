import { describe, expect, it } from 'vitest';
import type { RuleDocument, RuleNode } from '@shared/types';
import { buildIndex } from '../src/lib/search';
import { pinFrom, pinnable, sameContent } from '../src/lib/pins';

const node = (o: Partial<RuleNode>): RuleNode => ({
  id: 'n', kind: 'point', number: '4.1', text: 'Запрещено DM.', children: [], punishments: [], annotations: [], amendments: [], images: [], ...o,
} as RuleNode);

const doc = (scope: 'project' | 'server', children: RuleNode[]): RuleDocument => ({ id: 'd1', title: 'Общие правила проекта', scope, children, looseAmendments: [] } as unknown as RuleDocument);

describe('закреплённые пункты', () => {
  it('собирает окно из пункта с подпунктами и наказанием', () => {
    const n = node({ id: 'p41', punishments: [{ raw: 'JAIL 120 мин' }] as RuleNode['punishments'], children: [node({ id: 'p411', number: '4.1.1', text: 'Исключение — самооборона.' })] });
    const idx = buildIndex([doc('project', [n])]);
    const p = pinFrom(idx.byId.get('p41')!, 'Общие правила');
    expect(p.key).toBe('d1#p41');
    expect(p.badge).toBe('4.1');
    expect(p.text).toBe('Запрещено DM.\n4.1.1 Исключение — самооборона.');
    expect(p.punish).toEqual(['JAIL 120 мин']);
  });
  it('часть статьи закона подписана «ст. N ч. M»', () => {
    const part = node({ id: 'c1', kind: 'part', number: '1', text: 'Убийство — 4 года.' });
    const art = node({ id: 'a62', kind: 'article', number: '6.2', text: 'Убийство', children: [part] });
    const idx = buildIndex([doc('server', [art])]);
    expect(pinFrom(idx.byId.get('c1')!, 'УК').badge).toBe('ст. 6.2 ч. 1');
  });
  it('разделы и главы целиком не закрепляются', () => {
    expect(pinnable(node({ kind: 'section', text: 'Раздел' }))).toBe(false);
    expect(pinnable(node({ kind: 'chapter', text: 'Глава' }))).toBe(false);
    expect(pinnable(node({ text: '  ' }))).toBe(false);
    expect(pinnable(node({}))).toBe(true);
  });
  it('раскладка не влияет на сравнение текста', () => {
    const a = { key: 'k', docId: 'd', nodeId: 'n', badge: '1', doc: 'D', law: false, text: 't', punish: [] };
    expect(sameContent(a, { ...a, x: 10, w: 400 })).toBe(true);
    expect(sameContent(a, { ...a, text: 't2' })).toBe(false);
  });
});
