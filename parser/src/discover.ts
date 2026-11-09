import type { Fetcher } from './fetcher.js';
import { pageUrl, parseNodeList, parseThreadList, slugify, type NodeLink, type ThreadListItem } from './forum.js';
import { norm } from './structure.js';
import type { DocMeta } from './document.js';
import type { ServerInfo } from './types.js';

export const CONFIG = {
  base: 'https://forum.nova-rp.com',
  /** Страница со списком серверов: блок категории 21 «Раздел игровых серверов» */
  serversPage: 'https://forum.nova-rp.com/categories/21/',
  serversScope: '.block--category21',
  serverTitle: /^сервер\s*\|\s*(.+)$/i,
  /** Путь внутри каждого сервера — сопоставляется по названию, а не по адресу */
  lawPath: ['Государственные организации', 'Правительство', 'Законодательная база'],
  rulesForum: 'https://forum.nova-rp.com/forums/893/',
  /** Подразделы, которые не являются действующими документами */
  skipForums: [/архив/i],
  maxListPages: 10,
};

export interface Discovery {
  servers: ServerInfo[];
  docs: (DocMeta & { listItem: ThreadListItem })[];
  warnings: string[];
  /** Номера служебных страниц, которые удалось получить (для отчёта) */
  pagesFetched: number;
}

/** Нестрогое сравнение названий: регистр, «ё», кавычки, лишние слова. */
export function titleMatches(actual: string, wanted: string): boolean {
  const a = norm(actual);
  const w = norm(wanted);
  return a === w || a.includes(w) || (w.includes(a) && a.length >= 5);
}

export async function discover(fetcher: Fetcher, log: (s: string) => void = () => {}): Promise<Discovery> {
  const out: Discovery = { servers: [], docs: [], warnings: [], pagesFetched: 0 };
  const get = async (url: string) => { out.pagesFetched++; return fetcher.get(url); };

  /** Все темы раздела со всех страниц */
  async function listThreads(forumUrl: string, firstHtml?: string): Promise<ThreadListItem[]> {
    const first = firstHtml ?? (await get(forumUrl));
    const { threads, lastPage } = parseThreadList(first);
    for (let p = 2; p <= Math.min(lastPage, CONFIG.maxListPages); p++) {
      threads.push(...parseThreadList(await get(pageUrl(forumUrl, p))).threads);
    }
    return threads;
  }

  // ── Правила проекта: сам раздел 893 и его подразделы ──
  log('Правила проекта…');
  const rulesHtml = await get(CONFIG.rulesForum);
  const addRules = (threads: ThreadListItem[], category: string) => {
    for (const t of threads) {
      out.docs.push({ scope: 'project', category, threadId: t.id, sourceUrl: t.url, listTitle: t.title, listItem: t });
    }
  };
  addRules(await listThreads(CONFIG.rulesForum, rulesHtml), 'Правила проекта');
  for (const sub of parseNodeList(rulesHtml)) {
    if (CONFIG.skipForums.some((re) => re.test(sub.title))) continue;
    const html = await get(sub.url);
    addRules(await listThreads(sub.url, html), sub.title);
  }

  // ── Серверы ──
  log('Серверы…');
  const serverNodes = parseNodeList(await get(CONFIG.serversPage), CONFIG.serversScope)
    .filter((n) => CONFIG.serverTitle.test(n.title));
  if (!serverNodes.length) out.warnings.push('Не найдено ни одного раздела «Сервер | …» — структура форума изменилась?');

  for (const node of serverNodes) {
    const name = CONFIG.serverTitle.exec(node.title)![1]!.trim();
    const server: ServerInfo = { id: slugify(name), name, forumUrl: node.url };
    out.servers.push(server);
    log(`  ${name}`);
    try {
      let current: NodeLink = node;
      let html = await get(node.url);
      for (const step of CONFIG.lawPath) {
        const next = parseNodeList(html).find((n) => titleMatches(n.title, step));
        if (!next) throw new Error(`в «${current.title}» нет подраздела «${step}»`);
        current = next;
        html = await get(next.url);
      }
      server.lawBaseUrl = current.url;
      const threads = await listThreads(current.url, html);
      for (const t of threads) {
        out.docs.push({
          scope: 'server', serverId: server.id, category: 'Законодательная база',
          threadId: t.id, sourceUrl: t.url, listTitle: t.title, listItem: t,
        });
      }
      log(`    законов: ${threads.length}`);
    } catch (e) {
      out.warnings.push(`Сервер ${name}: ${(e as Error).message}`);
    }
  }
  return out;
}
