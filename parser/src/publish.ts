import { createHash, createPrivateKey, sign } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_VERSION, type RuleDocument, type RuleNode, type ServerInfo } from './types.js';

/*
 * Формат публикации (папка out/, в CI — ветка data репозитория):
 *   manifest.json        — версия базы, список документов с sha256 (подписан: manifest.sig)
 *   docs/<id>.<hash>.json — документы; имя меняется вместе с содержимым → кэш не мешает
 *   changelog/<ver>.json — что изменилось в этой версии; changelog/index.json — последние версии
 *   status.json          — время последней проверки и предупреждения (меняется каждый прогон)
 */

export interface ManifestDoc {
  id: string;
  title: string;
  scope: RuleDocument['scope'];
  serverId?: string;
  category: string;
  sourceUrl: string;
  sha256: string;
  size: number;
  path: string;
  stats: RuleDocument['stats'];
  /** Документ не обновился в этом прогоне (сбой загрузки или блокировка валидатором) */
  stale?: boolean;
}

export interface Manifest {
  schema: number;
  dbVersion: string;
  generatedAt: string;
  minAppVersion: string;
  servers: ServerInfo[];
  documents: ManifestDoc[];
  changelog?: string;
}

export type ChangeKind = 'added' | 'removed' | 'modified';
export interface NodeChange {
  kind: ChangeKind;
  nodeId: string;
  number?: string;
  before?: string;
  after?: string;
}
export interface DocChange {
  docId: string;
  title: string;
  serverId?: string;
  kind: ChangeKind;
  nodes: NodeChange[];
}
export interface Changelog {
  dbVersion: string;
  previousVersion?: string;
  generatedAt: string;
  documents: DocChange[];
  servers: { added: string[]; archived: string[] };
}

export interface PublishInput {
  outDir: string;
  now: Date;
  servers: ServerInfo[];
  /** Свежесобранные документы */
  docs: RuleDocument[];
  /** ID документов, которые должны быть в базе, но в этом прогоне не загрузились */
  failedDocIds: string[];
  /** Сколько документов нашёл обход форума (для защиты от «обнуления») */
  discoveredCount: number;
  warnings: string[];
  minAppVersion?: string;
  signingKeyPem?: string;
  /**
   * Разрешить сильное уменьшение числа документов (только для ручного запуска, когда
   * уменьшение намеренное — например, перестали собирать какой-то раздел).
   */
  acceptShrink?: boolean;
}

export interface PublishResult {
  changed: boolean;
  aborted?: string;
  manifest: Manifest;
  changelog?: Changelog;
  warnings: string[];
}

const MISSING_RUNS_TO_ARCHIVE = 3;

function readJson<T>(path: string): T | undefined {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return undefined; }
}

const safeName = (id: string) => id.replace(/[^a-z0-9-]+/gi, '_');

function flatten(nodes: RuleNode[], out = new Map<string, RuleNode>()) {
  for (const n of nodes) { out.set(n.id, n); flatten(n.children, out); }
  return out;
}

export function plainNode(n: RuleNode): string {
  const parts = [n.number ? `${n.number} ${n.text}` : n.text];
  for (const p of n.punishments) parts.push(`Наказание: ${p.raw}`);
  for (const a of n.annotations) parts.push(a.text);
  return parts.join('\n');
}

export function diffDocuments(prev: RuleDocument | undefined, next: RuleDocument | undefined): DocChange | undefined {
  if (!prev && !next) return undefined;
  const base = (next ?? prev)!;
  if (!prev) return { docId: base.id, title: base.title, serverId: base.serverId, kind: 'added', nodes: [] };
  if (!next) return { docId: base.id, title: base.title, serverId: base.serverId, kind: 'removed', nodes: [] };
  if (prev.hash === next.hash) return undefined;
  const a = flatten(prev.children);
  const b = flatten(next.children);
  const nodes: NodeChange[] = [];
  for (const [id, n] of b) {
    const old = a.get(id);
    if (!old) nodes.push({ kind: 'added', nodeId: id, number: n.number, after: plainNode(n) });
    else if (old.hash !== n.hash) nodes.push({ kind: 'modified', nodeId: id, number: n.number, before: plainNode(old), after: plainNode(n) });
  }
  for (const [id, n] of a) if (!b.has(id)) nodes.push({ kind: 'removed', nodeId: id, number: n.number, before: plainNode(n) });
  return { docId: next.id, title: next.title, serverId: next.serverId, kind: 'modified', nodes };
}

/** Валидатор: свежий документ подозрительно «похудел» — вероятнее сбой разбора, чем реальная правка. */
export function suspiciousShrink(prev: RuleDocument | undefined, next: RuleDocument): string | undefined {
  if (next.stats.nodes === 0) return 'документ разобран пустым';
  if (!prev || prev.stats.nodes < 10) return undefined;
  if (next.stats.nodes < prev.stats.nodes * 0.5) return `пунктов стало ${next.stats.nodes} вместо ${prev.stats.nodes}`;
  if (prev.stats.punishments >= 10 && next.stats.punishments < prev.stats.punishments * 0.5) {
    return `наказаний стало ${next.stats.punishments} вместо ${prev.stats.punishments}`;
  }
  return undefined;
}

export function publish(input: PublishInput): PublishResult {
  const { outDir, now } = input;
  const warnings = [...input.warnings];
  mkdirSync(join(outDir, 'docs'), { recursive: true });
  mkdirSync(join(outDir, 'changelog'), { recursive: true });

  const prevManifest = readJson<Manifest>(join(outDir, 'manifest.json'));
  const prevDocs = new Map<string, { meta: ManifestDoc; doc?: RuleDocument }>();
  for (const m of prevManifest?.documents ?? []) {
    prevDocs.set(m.id, { meta: m, doc: readJson<RuleDocument>(join(outDir, m.path)) });
  }

  // Защита от обнуления базы: форум отдал заглушки или поменялась структура
  const prevCount = prevManifest?.documents.length ?? 0;
  if (prevCount >= 10 && input.discoveredCount < prevCount * 0.7 && !input.acceptShrink) {
    const aborted = `Обход форума нашёл ${input.discoveredCount} документов вместо ${prevCount} — публикация отменена`;
    return { changed: false, aborted, manifest: prevManifest!, warnings: [...warnings, aborted] };
  }

  // ── Серверы: пропавший сервер архивируется только после нескольких прогонов подряд ──
  const servers: ServerInfo[] = [];
  const addedServers: string[] = [];
  const archivedServers: string[] = [];
  const seenIds = new Set(input.servers.map((s) => s.id));
  for (const s of input.servers) {
    const prev = prevManifest?.servers.find((p) => p.id === s.id);
    if (!prev) addedServers.push(s.name);
    servers.push({ ...s, missingRuns: 0, archived: false });
  }
  for (const prev of prevManifest?.servers ?? []) {
    if (seenIds.has(prev.id)) continue;
    const missingRuns = (prev.missingRuns ?? 0) + 1;
    const archived = missingRuns >= MISSING_RUNS_TO_ARCHIVE;
    if (archived && !prev.archived) archivedServers.push(prev.name);
    if (!archived) warnings.push(`Сервер ${prev.name} не найден на форуме (${missingRuns}/${MISSING_RUNS_TO_ARCHIVE})`);
    servers.push({ ...prev, missingRuns, archived });
  }
  const archivedIds = new Set(servers.filter((s) => s.archived).map((s) => s.id));
  const keptMissingServerIds = new Set(servers.filter((s) => !seenIds.has(s.id) && !s.archived).map((s) => s.id));

  // ── Документы ──
  const finalDocs: ManifestDoc[] = [];
  const changes: DocChange[] = [];
  const freshIds = new Set(input.docs.map((d) => d.id));

  for (const doc of input.docs) {
    const prev = prevDocs.get(doc.id);
    const problem = suspiciousShrink(prev?.doc, doc);
    if (problem && prev) {
      warnings.push(`${doc.title}: ${problem} — оставлена прошлая версия`);
      finalDocs.push({ ...prev.meta, stale: true });
      continue;
    }
    if (problem) { warnings.push(`${doc.title}: ${problem} — не опубликован`); continue; }

    const json = JSON.stringify(doc);
    const sha = createHash('sha256').update(json).digest('hex');
    const path = `docs/${safeName(doc.id)}.${doc.hash.slice(0, 12)}.json`;
    if (!existsSync(join(outDir, path))) writeFileSync(join(outDir, path), json);
    finalDocs.push({
      id: doc.id, title: doc.title, scope: doc.scope, serverId: doc.serverId, category: doc.category,
      sourceUrl: doc.sourceUrl, sha256: sha, size: Buffer.byteLength(json), path, stats: doc.stats,
    });
    const change = diffDocuments(prev?.doc, doc);
    if (change) changes.push(change);
  }

  // Не загрузились в этом прогоне или сервер временно пропал → держим прошлую версию
  for (const [id, prev] of prevDocs) {
    if (freshIds.has(id)) continue;
    const serverId = prev.meta.serverId;
    const failed = input.failedDocIds.includes(id);
    const serverTemporarilyMissing = serverId !== undefined && keptMissingServerIds.has(serverId);
    if (failed || serverTemporarilyMissing) {
      finalDocs.push({ ...prev.meta, stale: true });
      if (failed) warnings.push(`${prev.meta.title}: не удалось загрузить — оставлена прошлая версия`);
      continue;
    }
    if (serverId && archivedIds.has(serverId)) continue; // сервер закрыт — документы уходят
    // Тема удалена с форума
    const change = diffDocuments(prev.doc, undefined);
    if (change) changes.push(change);
  }

  finalDocs.sort((a, b) => (a.scope + (a.serverId ?? '') + a.category + a.title).localeCompare(b.scope + (b.serverId ?? '') + b.category + b.title, 'ru'));

  const changed = !prevManifest
    || changes.length > 0
    || addedServers.length > 0
    || archivedServers.length > 0
    || JSON.stringify(prevManifest.documents.map((d) => d.path)) !== JSON.stringify(finalDocs.map((d) => d.path));

  const dbVersion = changed ? versionOf(now) : prevManifest!.dbVersion;
  const manifest: Manifest = {
    schema: SCHEMA_VERSION,
    dbVersion,
    generatedAt: changed ? now.toISOString() : prevManifest!.generatedAt,
    minAppVersion: input.minAppVersion ?? prevManifest?.minAppVersion ?? '0.1.0',
    servers,
    documents: finalDocs,
    changelog: prevManifest?.changelog,
  };

  let changelog: Changelog | undefined;
  if (changed) {
    changelog = {
      dbVersion,
      previousVersion: prevManifest?.dbVersion,
      generatedAt: now.toISOString(),
      documents: changes,
      servers: { added: addedServers, archived: archivedServers },
    };
    const clPath = `changelog/${dbVersion}.json`;
    writeFileSync(join(outDir, clPath), JSON.stringify(changelog));
    manifest.changelog = clPath;
    const index = readJson<{ versions: { dbVersion: string; path: string; generatedAt: string; summary: string }[] }>(join(outDir, 'changelog/index.json')) ?? { versions: [] };
    index.versions.unshift({ dbVersion, path: clPath, generatedAt: now.toISOString(), summary: summarize(changelog) });
    index.versions = index.versions.slice(0, 50);
    writeFileSync(join(outDir, 'changelog/index.json'), JSON.stringify(index, null, 1));
  }

  // Манифест пишем всегда (servers.missingRuns меняется), подпись — вместе с ним
  const manifestJson = JSON.stringify(manifest, null, 1);
  writeFileSync(join(outDir, 'manifest.json'), manifestJson);
  if (input.signingKeyPem) {
    const sig = sign(null, Buffer.from(manifestJson), createPrivateKey(input.signingKeyPem));
    writeFileSync(join(outDir, 'manifest.sig'), sig.toString('base64'));
  } else {
    warnings.push('Ключ подписи не задан (NOVA_SIGNING_KEY) — manifest.sig не создан');
  }
  writeFileSync(join(outDir, 'status.json'), JSON.stringify({ checkedAt: now.toISOString(), dbVersion, warnings }, null, 1));

  prune(outDir, manifest, prevManifest);
  return { changed, manifest, changelog, warnings };
}

/**
 * Удаляет файлы документов, на которые не ссылается ни текущий, ни прошлый манифест
 * (прошлый держим, чтобы клиент, начавший обновление минуту назад, не получил 404),
 * и журналы изменений старше последних 50 версий.
 */
function prune(outDir: string, manifest: Manifest, prev?: Manifest) {
  const keep = new Set([...manifest.documents, ...(prev?.documents ?? [])].map((d) => d.path));
  for (const f of readdirSync(join(outDir, 'docs'))) {
    if (!keep.has(`docs/${f}`)) rmSync(join(outDir, 'docs', f));
  }
  const index = readJson<{ versions: { path: string }[] }>(join(outDir, 'changelog/index.json'));
  if (index) {
    const keepCl = new Set(index.versions.map((v) => v.path));
    for (const f of readdirSync(join(outDir, 'changelog'))) {
      if (f !== 'index.json' && !keepCl.has(`changelog/${f}`)) rmSync(join(outDir, 'changelog', f));
    }
  }
}

function versionOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

export function summarize(cl: Changelog): string {
  const nodes = cl.documents.reduce((a, d) => a + d.nodes.length, 0);
  const parts: string[] = [];
  if (nodes) parts.push(`изменено пунктов: ${nodes}`);
  const added = cl.documents.filter((d) => d.kind === 'added').length;
  const removed = cl.documents.filter((d) => d.kind === 'removed').length;
  if (added) parts.push(`новых документов: ${added}`);
  if (removed) parts.push(`удалено документов: ${removed}`);
  if (cl.servers.added.length) parts.push(`новые серверы: ${cl.servers.added.join(', ')}`);
  if (cl.servers.archived.length) parts.push(`закрыты серверы: ${cl.servers.archived.join(', ')}`);
  return parts.join('; ') || 'обновление базы';
}
