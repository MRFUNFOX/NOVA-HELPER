import { describe, expect, it } from 'vitest';
import { discover } from '../src/discover.js';
import { FixtureFetcher } from '../src/fetcher.js';

const B = 'https://forum.nova-rp.com';

/** Мини-страницы в разметке XenForo: подразделы (.node-title) и темы (.structItem--thread). */
function page(nodes: [string, string][], threads: [number, string][] = [], scope = '') {
  const n = nodes.map(([t, u]) => `<h3 class="node-title"><a href="${u}">${t}</a></h3>`).join('');
  const th = threads.map(([id, t]) => `<div class="structItem structItem--thread js-threadListItem-${id}" data-author="A">
    <div class="structItem-title"><a href="${B}/threads/${id}/" data-tp-primary="on">${t}</a></div></div>`).join('');
  const body = scope ? `<div class="block ${scope}">${n}</div>` : n;
  return `<html><body><div class="p-body"><div class="p-body-pageContent">${body}${th}</div></div></body></html>`;
}

const pages = new Map<string, string>([
  [`${B}/forums/893/`, page([['Общие правила', `${B}/forums/1242/`]], [[403002, 'Правила форума']])],
  [`${B}/forums/1242/`, page([], [[406242, 'Общие правила проекта']])],
  [`${B}/categories/21/`, page([['Сервер | Mirage', `${B}/gta5/`], ['Сервер | Horizon', `${B}/forums/1456/`]], [], 'block--category21')],
  // Mirage: «Законодательство» → подразделы, архив пропускается
  [`${B}/gta5/`, page([['Жалобы', `${B}/forums/897/`], ['Государственные организации', `${B}/forums/901/`]])],
  [`${B}/forums/901/`, page([['Правительство', `${B}/forums/905/`]])],
  [`${B}/forums/905/`, page([['Суд', `${B}/forums/1115/`], ['Законодательство', `${B}/forums/929/`]])],
  [`${B}/forums/929/`, page([
    ['Архив документации', `${B}/forums/1093/`],
    ['Нормативно-правовые акты', `${B}/forums/960/`],
    ['Указы Губернатора', `${B}/forums/961/`],
  ])],
  [`${B}/forums/960/`, page([], [[500001, 'Уголовный кодекс'], [500002, 'Административный кодекс']])],
  [`${B}/forums/961/`, page([], [[500003, 'Указ №1']])],
  // Horizon: «Законодательная база» с темами напрямую
  [`${B}/forums/1456/`, page([['Государственные организации', `${B}/forums/1476/`]])],
  [`${B}/forums/1476/`, page([['Правительство', `${B}/forums/1477/`]])],
  [`${B}/forums/1477/`, page([['Законодательная база', `${B}/forums/1478/`]])],
  [`${B}/forums/1478/`, page([['Архив документации', `${B}/forums/1479/`]], [[411152, 'Уголовный Кодекс']])],
]);

describe('автопоиск серверов и законов', () => {
  it('находит законы на серверах с разными названиями разделов и пропускает архив', async () => {
    const d = await discover(new FixtureFetcher(pages));
    expect(d.warnings).toEqual([]);
    expect(d.servers.map((s) => [s.id, s.lawBaseUrl])).toEqual([
      ['mirage', `${B}/forums/929/`],
      ['horizon', `${B}/forums/1478/`],
    ]);
    const mirage = d.docs.filter((x) => x.serverId === 'mirage').map((x) => [x.threadId, x.category]);
    expect(mirage).toEqual([
      [500001, 'Нормативно-правовые акты'],
      [500002, 'Нормативно-правовые акты'],
      [500003, 'Указы Губернатора'],
    ]);
    expect(d.docs.filter((x) => x.serverId === 'horizon').map((x) => x.threadId)).toEqual([411152]);
    expect(d.docs.filter((x) => x.scope === 'project').map((x) => x.threadId)).toEqual([403002, 406242]);
  });

  it('если у сервера нет пути до законов — предупреждение, а не падение всего сбора', async () => {
    const broken = new Map(pages);
    broken.set(`${B}/forums/905/`, page([['Суд', `${B}/forums/1115/`]]));
    const d = await discover(new FixtureFetcher(broken));
    expect(d.warnings).toEqual(['Сервер Mirage: в «Правительство» нет подраздела «Законодательная база» или «Законодательство»']);
    expect(d.docs.some((x) => x.serverId === 'horizon')).toBe(true);
  });
});
