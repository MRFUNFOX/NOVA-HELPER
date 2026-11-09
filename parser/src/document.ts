import { createHash } from 'node:crypto';
import { htmlToLines } from './text.js';
import { parseStructure } from './structure.js';
import { applyAmendments, type ApplyReport } from './amendments.js';
import type { Post, ThreadPage } from './forum.js';
import type { Amendment, RuleDocument, RuleNode, Scope } from './types.js';

export interface DocMeta {
  scope: Scope;
  serverId?: string;
  category: string;
  threadId: number;
  sourceUrl: string;
  /** Заголовок из списка тем — запасной, если на странице темы его нет */
  listTitle: string;
}

export interface BuildResult {
  doc: RuleDocument;
  amendments: ApplyReport;
  warnings: string[];
}

/** Собирает документ из всех страниц темы: основное сообщение + поправки администрации. */
export function buildDocument(pages: ThreadPage[], meta: DocMeta, now: Date): BuildResult {
  const warnings: string[] = [];
  const posts: Post[] = pages.flatMap((p) => p.posts);
  const main = posts[0];
  if (!main) throw new Error(`Тема ${meta.threadId}: нет сообщений`);
  const title = pages[0]?.title || meta.listTitle;
  const docId = meta.scope === 'project' ? `project/${meta.threadId}` : `server/${meta.serverId}/${meta.threadId}`;

  const children = parseStructure(htmlToLines(main.bodyHtml), { docId, title });

  // Поправки принимаем только от автора темы и администрации
  const extra = posts.slice(1).filter((p) => p.isStaff || p.author === main.author);
  const looseAmendments: Amendment[] = [];
  const amendments = applyAmendments(children, main, extra, now, looseAmendments);
  for (const n of amendments.unmerged) warnings.push(`${title}: п. ${n} — основной текст правили после поправки, но пункт остался в старой редакции`);
  for (const n of amendments.conflicts) warnings.push(`${title}: п. ${n} — текст не совпадает ни с одной редакцией из поправок`);

  const stats = { nodes: 0, punishments: 0, images: 0 };
  const dupNumbers = new Set<string>();
  const seen = new Set<string>();
  (function walk(ns: RuleNode[]) {
    for (const n of ns) {
      stats.nodes++;
      stats.punishments += n.punishments.length;
      stats.images += n.images.length;
      if (n.id.includes('~')) dupNumbers.add(n.number ?? n.id);
      seen.add(n.id);
      walk(n.children);
    }
  })(children);
  for (const d of dupNumbers) warnings.push(`${title}: номер ${d} встречается на форуме дважды`);

  const doc: RuleDocument = {
    id: docId,
    scope: meta.scope,
    serverId: meta.serverId,
    category: meta.category,
    title,
    threadId: meta.threadId,
    sourceUrl: meta.sourceUrl,
    publishedAt: main.postedAt,
    fetchedAt: now.toISOString(),
    locked: pages[0]?.locked ?? false,
    children,
    looseAmendments,
    stats,
    hash: '',
  };
  doc.hash = documentHash(doc);
  return { doc, amendments, warnings };
}

/** Хеш содержимого документа: не зависит от времени сбора. */
export function documentHash(doc: RuleDocument): string {
  const { fetchedAt: _f, hash: _h, ...content } = doc;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
