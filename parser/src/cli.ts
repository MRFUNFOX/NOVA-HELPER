import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BrowserFetcher, ChainFetcher, FirecrawlFetcher, type Fetcher } from './fetcher.js';
import { CONFIG, discover } from './discover.js';
import { pageUrl, parseThreadPage, type ThreadPage } from './forum.js';
import { buildDocument, type DocMeta } from './document.js';
import { publish, summarize } from './publish.js';
import type { RuleDocument } from './types.js';

const log = (s: string) => console.log(s);

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

/** Ограничение параллельных запросов: форум и Firecrawl не любят залпы */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]!); }
  }));
  return out;
}

async function fetchThread(fetcher: Fetcher, url: string): Promise<ThreadPage[]> {
  const first = parseThreadPage(await fetcher.get(url));
  const pages = [first];
  for (let p = 2; p <= Math.min(first.lastPage, 20); p++) pages.push(parseThreadPage(await fetcher.get(pageUrl(url, p))));
  return pages;
}

async function scrape() {
  const key = process.env.FIRECRAWL_API_KEY;
  // --via browser | firecrawl | auto (по умолчанию: браузер, при неудаче Firecrawl)
  const via = arg('via', 'auto')!;
  const outDir = resolve(arg('out', 'out')!);
  const now = new Date();
  const browser = via === 'firecrawl' ? undefined : new BrowserFetcher({ log });
  const firecrawl = via === 'browser' || !key ? undefined : new FirecrawlFetcher(key, { log });
  if (!browser && !firecrawl) throw new Error('Нужна переменная окружения FIRECRAWL_API_KEY для --via firecrawl');
  const fetcher = new ChainFetcher(browser, firecrawl, log);
  try {
    await scrapeWith(fetcher, outDir, now, firecrawl);
  } finally {
    await browser?.close();
  }
}

async function scrapeWith(fetcher: Fetcher, outDir: string, now: Date, firecrawl?: FirecrawlFetcher) {

  log('▶ Обход форума');
  const plan = await discover(fetcher, log);
  log(`  документов найдено: ${plan.docs.length}, серверов: ${plan.servers.length}`);

  log('▶ Загрузка и разбор тем');
  const docs: RuleDocument[] = [];
  const failed: string[] = [];
  const warnings = [...plan.warnings];
  await mapLimit(plan.docs, 2, async (meta) => {
    const id = meta.scope === 'project' ? `project/${meta.threadId}` : `server/${meta.serverId}/${meta.threadId}`;
    try {
      const pages = await fetchThread(fetcher, meta.sourceUrl);
      const res = buildDocument(pages, meta as DocMeta, now);
      docs.push(res.doc);
      warnings.push(...res.warnings);
      log(`  ✓ ${res.doc.title} — пунктов ${res.doc.stats.nodes}, наказаний ${res.doc.stats.punishments}`);
    } catch (e) {
      failed.push(id);
      log(`  ✗ ${meta.listTitle}: ${(e as Error).message}`);
    }
  });

  log('▶ Публикация');
  const result = publish({
    outDir, now, servers: plan.servers, docs, failedDocIds: failed,
    discoveredCount: plan.docs.length, warnings,
    signingKeyPem: process.env.NOVA_SIGNING_KEY,
    acceptShrink: process.argv.includes('--accept-shrink'),
    lawsDisabled: !CONFIG.collectLaws,
  });
  report(result, firecrawl?.credits);
  if (result.aborted) process.exitCode = 2;
}

function report(result: ReturnType<typeof publish>, credits?: number) {
  log(result.changed ? `  новая версия базы: ${result.manifest.dbVersion}` : `  изменений нет, версия ${result.manifest.dbVersion}`);
  if (result.changelog) log(`  ${summarize(result.changelog)}`);
  if (credits !== undefined) log(`  потрачено кредитов Firecrawl: ${credits}`);
  if (result.warnings.length) {
    log(`\n⚠ Предупреждения (${result.warnings.length}):`);
    for (const w of result.warnings) log(`  - ${w}`);
  }
  // Для GitHub Actions: итог в summary и флаг для шага уведомления
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [`### База ${result.manifest.dbVersion}`, result.changelog ? summarize(result.changelog) : 'Изменений нет', '', ...result.warnings.map((w) => `- ⚠ ${w}`)];
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n', { flag: 'a' });
  }
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `changed=${result.changed}\nwarnings=${result.warnings.length}\n`, { flag: 'a' });
  }
}

/** Сборка базы из сохранённых образцов — проверка без сети и без кредитов. */
function offline() {
  const fx = (f: string) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8');
  const outDir = resolve(arg('out', 'out-offline')!);
  const now = new Date(arg('now', new Date().toISOString())!);
  const rules = parseThreadPage(fx('raw_thread_406242.html'));
  const ukBody = fx('horizon_uk_411152.html').split('<div class="bbWrapper">')[1]!;
  const uk: ThreadPage = {
    title: 'Уголовный Кодекс Штата San-Andreas', locked: true, lastPage: 1,
    posts: [{ id: '0', url: '', author: 'Jonny Makalister', isStaff: true, bodyHtml: `<div class="bbWrapper">${ukBody}` }],
  };
  const warnings: string[] = [];
  const docs = [
    buildDocument([rules], { scope: 'project', category: 'Общие правила', threadId: 406242, sourceUrl: 'https://forum.nova-rp.com/threads/406242/', listTitle: 'Общие правила проекта' }, now),
    buildDocument([uk], { scope: 'server', serverId: 'horizon', category: 'Законодательная база', threadId: 411152, sourceUrl: 'https://forum.nova-rp.com/threads/411152/', listTitle: 'Уголовный кодекс' }, now),
  ];
  for (const d of docs) {
    warnings.push(...d.warnings);
    log(`  ${d.doc.title}: пунктов ${d.doc.stats.nodes}, наказаний ${d.doc.stats.punishments}; поправки: ${JSON.stringify(d.amendments)}`);
  }
  const result = publish({
    outDir, now,
    servers: [{ id: 'horizon', name: 'Horizon', forumUrl: 'https://forum.nova-rp.com/forums/1456/', lawBaseUrl: 'https://forum.nova-rp.com/forums/1478/' }],
    docs: docs.map((d) => d.doc), failedDocIds: [], discoveredCount: docs.length, warnings,
    signingKeyPem: process.env.NOVA_SIGNING_KEY,
  });
  report(result);
}

/** Пара ключей Ed25519: приватный — в секреты GitHub, публичный — в программу. */
function keygen() {
  const dir = resolve(arg('out', 'keys')!);
  mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(join(dir, 'nova-signing.key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(join(dir, 'nova-signing.pub.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  log(`Ключи записаны в ${dir}. Приватный ключ (nova-signing.key.pem) — только в секрет NOVA_SIGNING_KEY, в репозиторий не класть.`);
}

const cmd = process.argv[2];
const run = { scrape, offline: async () => offline(), keygen: async () => keygen() }[cmd ?? ''];
if (!run) {
  console.error('Команды: scrape --out <папка> | offline --out <папка> | keygen --out <папка>');
  process.exit(1);
}
run().catch((e) => { console.error(e); process.exit(1); });
