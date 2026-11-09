import * as cheerio from 'cheerio';
import { cleanText } from './text.js';

/** Разбор страниц XenForo 2 форума forum.nova-rp.com. Только чтение HTML, без сети. */

export interface NodeLink { title: string; url: string }

export interface ThreadListItem {
  id: number;
  title: string;
  url: string;
  locked: boolean;
  sticky: boolean;
  author?: string;
}

export interface Post {
  id: string;
  url: string;
  author: string;
  isStaff: boolean;
  /** ISO дата публикации */
  postedAt?: string;
  /** ISO дата последнего редактирования */
  editedAt?: string;
  bodyHtml: string;
}

export interface ThreadPage {
  title: string;
  locked: boolean;
  posts: Post[];
  lastPage: number;
}

const BASE = 'https://forum.nova-rp.com';
const abs = (u: string) => new URL(u, BASE).href;

/** Проверка: вместо форума пришла заглушка антибот-защиты (она отдаётся с кодом 200!). */
export function isChallengePage(html: string): boolean {
  const head = html.slice(0, 6000);
  return /Checking your browser|Automated protection|React Labs\s*<\/?\w*>?\s*Security/i.test(head) && !/class="p-body/.test(html);
}

/** Подразделы на странице раздела/категории. `scope` — CSS-селектор блока (например `.block--category21`). */
export function parseNodeList(html: string, scope?: string): NodeLink[] {
  const $ = cheerio.load(html);
  const root = scope ? $(scope) : $('.p-body-pageContent');
  return root.find('.node-title a').map((_, a) => ({
    title: cleanText($(a).text()),
    url: abs($(a).attr('href') ?? ''),
  })).get().filter((n) => n.url && !/\/link-forums\//.test(n.url));
}

export function parseThreadList(html: string): { threads: ThreadListItem[]; lastPage: number } {
  const $ = cheerio.load(html);
  const threads: ThreadListItem[] = [];
  $('.structItem--thread').each((_, el) => {
    const item = $(el);
    const cls = item.attr('class') ?? '';
    const id = Number(/js-threadListItem-(\d+)/.exec(cls)?.[1]);
    const link = item.find('.structItem-title a[data-tp-primary]').first().length
      ? item.find('.structItem-title a[data-tp-primary]').first()
      : item.find('.structItem-title a').last();
    if (!id || !link.length) return;
    threads.push({
      id,
      title: cleanText(link.text()),
      url: abs(link.attr('href') ?? `/threads/${id}/`),
      locked: item.find('.structItem-status--locked').length > 0,
      sticky: item.find('.structItem-status--sticky').length > 0,
      author: item.attr('data-author'),
    });
  });
  return { threads, lastPage: lastPageOf($) };
}

export function parseThreadPage(html: string): ThreadPage {
  const $ = cheerio.load(html);
  const titleEl = $('h1.p-title-value').clone();
  titleEl.find('.label, .label-append').remove();
  const posts: Post[] = [];
  $('article.message--post').each((_, el) => {
    const art = $(el);
    const id = (art.attr('data-content') ?? '').replace(/^post-/, '');
    const body = art.find('.message-body .bbWrapper').first();
    if (!id || !body.length) return;
    posts.push({
      id,
      url: `${BASE}/posts/${id}/`,
      author: art.attr('data-author') ?? '',
      isStaff: art.find('.message-userDetails .username--staff').length > 0,
      postedAt: isoOf(art.find('.message-attribution-main time').first().attr('datetime')),
      editedAt: isoOf(art.find('.message-lastEdit time').first().attr('datetime')),
      bodyHtml: $.html(body),
    });
  });
  return {
    title: cleanText(titleEl.text()),
    locked: $('.blockStatus-message--locked').length > 0,
    posts,
    lastPage: lastPageOf($),
  };
}

function lastPageOf($: cheerio.CheerioAPI): number {
  let last = 1;
  $('.pageNav-main a, .pageNav-page a').each((_, a) => {
    const n = Number(cleanText($(a).text()));
    if (n > last) last = n;
  });
  return last;
}

/** «2026-11-08T14:25:39+0300» → ISO с двоеточием в смещении */
function isoOf(s?: string): string | undefined {
  if (!s) return undefined;
  const fixed = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(fixed);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** URL n-й страницы списка/темы XenForo: …/forums/1478/page-2 */
export function pageUrl(url: string, page: number): string {
  const clean = url.replace(/\/page-\d+\/?$/, '/').replace(/\/?$/, '/');
  return page <= 1 ? clean : `${clean}page-${page}`;
}

/** «Сервер | New Era» → «new-era» */
export function slugify(name: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
    н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  return name.toLowerCase().split('').map((c) => map[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
