import { createHash } from 'node:crypto';
import { htmlToLines } from './text.js';
import { nodeHash, parseStructure } from './structure.js';
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

  // Картинка, повторённая в документе 3+ раз (например, полоска-разделитель с imgur без размеров) — оформление
  const imageCount = new Map<string, number>();
  (function count(ns: RuleNode[]) {
    for (const n of ns) { for (const i of n.images) imageCount.set(i.src, (imageCount.get(i.src) ?? 0) + 1); count(n.children); }
  })(children);
  (function strip(ns: RuleNode[]) {
    for (const n of ns) {
      const before = n.images.length;
      n.images = n.images.filter((i) => (imageCount.get(i.src) ?? 0) < 3);
      if (n.images.length !== before) n.hash = nodeHash(n);
      strip(n.children);
    }
  })(children);

  const stats = { nodes: 0, punishments: 0, images: 0 };
  const dupNumbers = new Set<string>();
  (function walk(ns: RuleNode[]) {
    for (const n of ns) {
      stats.nodes++;
      stats.punishments += n.punishments.length;
      stats.images += n.images.length;
      // Повтор подзаголовков — норма; предупреждаем только о повторе номеров статей и пунктов
      if (n.id.includes('~') && n.number && (n.kind === 'article' || n.kind === 'point')) dupNumbers.add(n.number);
      walk(n.children);
    }
  })(children);
  if (dupNumbers.size) {
    const list = [...dupNumbers];
    const shown = list.slice(0, 8).join(', ') + (list.length > 8 ? ` и ещё ${list.length - 8}` : '');
    warnings.push(`${title}: номера встречаются на форуме дважды — ${shown}`);
  }

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
    draft: /для\s+ознакомлени|законопроект|проект\s+(закона|кодекса)/i.test(title) || undefined,
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
