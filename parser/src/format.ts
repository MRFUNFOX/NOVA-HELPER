/**
 * Формат опубликованной базы (manifest.json и changelog/*.json).
 * Общий для парсера и программы NOVA HELPER — без зависимостей от Node.
 */
import type { RuleDocument, ServerInfo } from './types.js';

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
  /** Версия парсера, собравшего базу (см. PARSER_VERSION) */
  parserVersion?: number;
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
