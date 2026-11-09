import { describe, expect, it } from 'vitest';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publish, type Changelog, type Manifest } from '../src/publish.js';
import { nodeHash } from '../src/structure.js';
import { documentHash } from '../src/document.js';
import type { RuleDocument, RuleNode, ServerInfo } from '../src/types.js';

function node(id: string, number: string, text: string): RuleNode {
  const n: RuleNode = { id, kind: 'point', number, text, punishments: [], annotations: [], images: [], amendments: [], children: [], hash: '' };
  n.hash = nodeHash(n);
  return n;
}

function doc(id: string, points: [string, string][], serverId?: string): RuleDocument {
  const children = points.map(([num, text]) => node(`${id}#p${num}`, num, text));
  const d: RuleDocument = {
    id, scope: serverId ? 'server' : 'project', serverId, category: 'Тест', title: `Документ ${id}`,
    threadId: 1, sourceUrl: '', fetchedAt: '', locked: true, children, looseAmendments: [],
    stats: { nodes: children.length, punishments: 0, images: 0 }, hash: '',
  };
  d.hash = documentHash(d);
  return d;
}

const many = (n: number, prefix = 'Текст'): [string, string][] => Array.from({ length: n }, (_, i) => [`1.${i + 1}`, `${prefix} ${i + 1}`]);
const S = (id: string): ServerInfo => ({ id, name: id, forumUrl: '' });
const read = <T>(dir: string, p: string) => JSON.parse(readFileSync(join(dir, p), 'utf8')) as T;

function run(dir: string, docs: RuleDocument[], servers: ServerInfo[], extra: Partial<Parameters<typeof publish>[0]> = {}, at = '2026-11-09T12:00:00Z') {
  return publish({ outDir: dir, now: new Date(at), servers, docs, failedDocIds: [], discoveredCount: docs.length, warnings: [], ...extra });
}

describe('публикация базы', () => {
  it('без изменений версия не меняется, при правке пункта — новая версия и «было/стало»', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nova-'));
    const first = run(dir, [doc('a', many(12))], [S('mirage')]);
    expect(first.changed).toBe(true);

    const same = run(dir, [doc('a', many(12))], [S('mirage')], {}, '2026-11-09T18:00:00Z');
    expect(same.changed).toBe(false);
    expect(same.manifest.dbVersion).toBe(first.manifest.dbVersion);

    const edited = many(12); edited[2] = ['1.3', 'Новая редакция пункта'];
    const next = run(dir, [doc('a', edited)], [S('mirage')], {}, '2026-11-10T06:00:00Z');
    expect(next.changed).toBe(true);
    expect(next.manifest.dbVersion).toBe('2026.11.10-0600');
    const cl = read<Changelog>(dir, next.manifest.changelog!);
    expect(cl.documents[0]!.nodes).toEqual([
      expect.objectContaining({ kind: 'modified', number: '1.3', before: '1.3 Текст 3', after: '1.3 Новая редакция пункта' }),
    ]);
  });

  it('подозрительно «похудевший» документ не публикуется — остаётся прошлая версия', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nova-'));
    run(dir, [doc('a', many(40))], []);
    const res = run(dir, [doc('a', many(3))], [], {}, '2026-11-10T00:00:00Z');
    expect(res.changed).toBe(false);
    expect(res.manifest.documents[0]).toMatchObject({ stale: true, stats: { nodes: 40 } });
    expect(res.warnings.join()).toContain('пунктов стало 3 вместо 40');
  });

  it('если обход нашёл намного меньше документов (заглушка, сбой) — публикация отменяется', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nova-'));
    const docs = Array.from({ length: 12 }, (_, i) => doc(`d${i}`, many(5)));
    run(dir, docs, []);
    const res = run(dir, docs.slice(0, 2), [], { discoveredCount: 2 }, '2026-11-10T00:00:00Z');
    expect(res.aborted).toContain('публикация отменена');
    expect(read<Manifest>(dir, 'manifest.json').documents).toHaveLength(12);
    // Намеренное уменьшение проходит только с явным флагом
    const forced = run(dir, docs.slice(0, 2), [], { discoveredCount: 2, acceptShrink: true }, '2026-11-10T01:00:00Z');
    expect(forced.aborted).toBeUndefined();
    expect(forced.manifest.documents).toHaveLength(2);
  });

  it('тема не загрузилась — в базе остаётся прошлая версия, а не «документ удалён»', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nova-'));
    run(dir, [doc('a', many(5)), doc('b', many(5))], []);
    const res = run(dir, [doc('a', many(5))], [], { failedDocIds: ['b'], discoveredCount: 2 }, '2026-11-10T00:00:00Z');
    expect(res.changed).toBe(false);
    expect(res.manifest.documents.find((d) => d.id === 'b')).toMatchObject({ stale: true });
  });

  it('пропавший сервер уходит в архив только после трёх прогонов подряд', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nova-'));
    run(dir, [doc('m', many(5), 'mirage'), doc('h', many(5), 'horizon')], [S('mirage'), S('horizon')]);
    for (let i = 1; i <= 2; i++) {
      const r = run(dir, [doc('m', many(5), 'mirage')], [S('mirage')], { discoveredCount: 2 }, `2026-11-1${i}T00:00:00Z`);
      expect(r.manifest.servers.find((s) => s.id === 'horizon')).toMatchObject({ missingRuns: i, archived: false });
      expect(r.manifest.documents.some((d) => d.id === 'h')).toBe(true);
    }
    const r3 = run(dir, [doc('m', many(5), 'mirage')], [S('mirage')], { discoveredCount: 2 }, '2026-11-13T00:00:00Z');
    expect(r3.manifest.servers.find((s) => s.id === 'horizon')).toMatchObject({ archived: true });
    expect(r3.manifest.documents.some((d) => d.id === 'h')).toBe(false);
    expect(read<Changelog>(dir, r3.manifest.changelog!).servers.archived).toEqual(['horizon']);
  });

  it('новый сервер попадает в базу и в перечень изменений', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nova-'));
    run(dir, [doc('m', many(5), 'mirage')], [S('mirage')]);
    const r = run(dir, [doc('m', many(5), 'mirage'), doc('n', many(5), 'nova')], [S('mirage'), S('nova')], {}, '2026-11-10T00:00:00Z');
    expect(read<Changelog>(dir, r.manifest.changelog!).servers.added).toEqual(['nova']);
  });

  it('старые версии документов удаляются, но прошлая версия остаётся для клиентов в процессе обновления', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nova-'));
    const v = (t: string) => { const p = many(5); p[0] = ['1.1', t]; return [doc('a', p)]; };
    const r1 = run(dir, v('v1'), [], {}, '2026-11-09T00:00:00Z');
    const r2 = run(dir, v('v2'), [], {}, '2026-11-10T00:00:00Z');
    const r3 = run(dir, v('v3'), [], {}, '2026-11-11T00:00:00Z');
    const files = readdirSync(join(dir, 'docs')).map((f) => `docs/${f}`).sort();
    expect(files).toEqual([r2.manifest.documents[0]!.path, r3.manifest.documents[0]!.path].sort());
    expect(files).not.toContain(r1.manifest.documents[0]!.path);
  });

  it('манифест подписан Ed25519 и проверяется публичным ключом', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nova-'));
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    run(dir, [doc('a', many(5))], [], { signingKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
    const manifest = readFileSync(join(dir, 'manifest.json'));
    const sig = Buffer.from(readFileSync(join(dir, 'manifest.sig'), 'utf8'), 'base64');
    const pub = createPublicKey(publicKey.export({ type: 'spki', format: 'pem' }));
    expect(verify(null, manifest, pub, sig)).toBe(true);
    expect(verify(null, Buffer.from(manifest.toString().replace('"a"', '"b"')), pub, sig)).toBe(false);
  });
});
