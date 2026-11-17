import assert from 'node:assert/strict';
import { parsePrices, messageText } from '../src/parse.js';
import { run, watch } from '../src/worker.js';

const N = ['Медь','Изумруд','Рубин','Алмаз','Бензин','Солярка','Керосин','Фальшивые деньги','Окунь','Карп','Форель','Лосось','Жемчуг','Шкура','Идеальное мясо','Хорошее мясо'];
const H22 = [[[35,42],[131,157],[616,739],[3602,4322],[130,156],[96,115],[124,148],[5876,7051],[45,54],[364,436],[452,542],[3725,4470],[1341,1609],[789,946],[728,873],[355,426]],
             [[23,27],[176,211],[638,765],[2989,3586],[170,204],[180,216],[158,189],[9387,11264],[43,51],[194,232],[438,525],[2123,2547],[1353,1623],[1024,1228],[855,1026],[521,625]],
             [[50,60],[334,400],[673,807],[3005,3606],[170,204],[79,94],[163,195],[6074,7288],[21,25],[207,248],[288,345],[3590,4308],[1294,1552],[836,1003],[866,1039],[442,530]]];
const H21 = [[[31,37],[299,358],[672,806],[3816,4579],[67,80],[65,78],[166,199],[5514,6616],[42,50],[307,368],[440,528],[2070,2484],[616,739],[938,1125],[731,877],[407,488]],
             [[47,56],[236,283],[434,520],[3993,4791],[158,189],[144,172],[52,62],[9191,11029],[19,22],[346,415],[395,474],[3243,3891],[1411,1693],[955,1146],[738,885],[376,451]],
             [[27,32],[172,206],[647,776],[3469,4162],[153,183],[103,123],[121,145],[7201,8641],[18,21],[309,370],[553,663],[1664,1996],[638,765],[1009,1210],[720,864],[547,656]]];
const msg = (when, data, prod, style = 'md') => {
  const head = style === 'md' ? `🔔 **Изменение цен у скупщиков** (${when} МСК)` : `Изменение цен у скупщиков (${when} МСК)`;
  let s = head + '\n\n';
  data.forEach((b, i) => {
    s += `${i % 2 ? '🔶' : '🔷'} ***Скупщик сырья ${style === 'md' ? '№' : 'No'}${i + 1}***\n\`\`\`\n`;
    b.forEach(([a, c], j) => (s += `- ${N[j]}: $${a} ($${c})\n`));
    s += '```\n';
  });
  if (prod) { s += '🔶 ***Скупщик продуктов***\n```\n'; for (const [k, v] of Object.entries(prod)) s += `- ${k}: $${v}\n`; s += '```\n'; }
  s += '**Цены актуальны на момент публикации. В течение часа они меняются в зависимости от спроса.**';
  return s;
};

// 1. Разбор
const p = parsePrices(msg('16.11.2026 22:05', H22, { 'Капуста': 644, 'Тыква': 764, 'Мандарины': 790, 'Ананасы': 1110 }));
assert.equal(p.time, '2026-11-16T22:05:00+03:00');
assert.deepEqual(p.raw[0]['Лосось'], [3725, 4470]);
assert.deepEqual(p.raw[1]['Фальшивые деньги'], [9387, 11264]);
assert.deepEqual(p.raw[2]['Хорошее мясо'], [442, 530]);
assert.equal(Object.keys(p.raw[0]).length, 16);
assert.equal(p.products['Ананасы'], 1110);
const p2 = parsePrices(msg('16.11.2026 21:05', H21, null, 'plain'));
assert.equal(p2.time, '2026-11-16T21:05:00+03:00');
assert.deepEqual(p2.raw[1]['Медь'], [47, 56]);
assert.equal(parsePrices('привет'), null);
assert.equal(parsePrices(messageText({ content: '', embeds: [{ description: msg('16.11.2026 22:05', H22) }] })).raw[2]['Алмаз'][1], 3606);
console.log('разбор: ок');

// 2. Полный прогон сборщика с поддельными Discord / GitHub / KV
const files = {};
const kv = new Map();
let msgs = [
  { id: '100', timestamp: new Date(Date.now() - 2 * 36e5).toISOString(), content: 'обычное сообщение' },
  { id: '101', timestamp: new Date(Date.now() - 36e5).toISOString(), content: msg('16.11.2026 21:05', H21, { 'Капуста': 600 }) },
];
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  if (url.startsWith('https://discord.com')) {
    const u = new URL(url); const after = u.searchParams.get('after');
    const list = after ? msgs.filter((m) => BigInt(m.id) > BigInt(after)) : [...msgs].reverse();
    return new Response(JSON.stringify(list), { status: 200 });
  }
  const path = url.split('/contents/')[1];
  if ((opt.method || 'GET') === 'GET') {
    if (!files[path]) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ sha: 'sha-' + path, content: Buffer.from(files[path]).toString('base64') }));
  }
  const body = JSON.parse(opt.body);
  files[path] = Buffer.from(body.content, 'base64').toString('utf8');
  return new Response('{}', { status: 201 });
};
const env = { CHANNEL_ID: '1', GITHUB_REPO: 'x/y', DISCORD_TOKEN: 't', GITHUB_TOKEN: 'g', STATE: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) } };

let r = await run(env);
assert.equal(r.changed, true); assert.equal(kv.get('lastId'), '101');
let prices = JSON.parse(files['prices.json']);
assert.equal(prices.time, '2026-11-16T21:05:00+03:00'); assert.equal(prices.prev, null);
r = await run(env); assert.equal(r.changed, false);              // новых нет
msgs.push({ id: '102', timestamp: new Date().toISOString(), content: msg('16.11.2026 22:05', H22, { 'Капуста': 644 }) });
r = await run(env); assert.equal(r.changed, true);
prices = JSON.parse(files['prices.json']);
assert.equal(prices.time, '2026-11-16T22:05:00+03:00');
assert.equal(prices.prev.raw[0]['Лосось'], 2484);                 // для стрелки
assert.equal(prices.raw[0]['Лосось'][1], 4470);
assert.equal(prices.history, undefined);                          // история — отдельным файлом
assert.equal(JSON.parse(files['history.json']).history.length, 2);
assert.deepEqual(prices.rareFrom, {});                            // мало истории — редкие не считаем
console.log('сборщик: ок', 'prices.json =', files['prices.json'].length, 'байт');

// 3. Дежурство: цены появляются на 3-й проверке — сборщик ловит их, не дожидаясь следующей минуты
let calls = 0;
const fakeSleep = async () => {
  calls++;
  if (calls === 2) msgs.push({ id: '103', timestamp: new Date().toISOString(), content: msg('16.11.2026 23:05', H21, { 'Капуста': 700 }) });
};
r = await watch(env, Date.now(), fakeSleep);
assert.equal(r.changed, true); assert.equal(r.polls, 3); assert.ok(r.lag >= 0);
assert.equal(JSON.parse(files['prices.json']).time, '2026-11-16T23:05:00+03:00');
// Цен нет — дежурство само заканчивается до конца минуты
const t0 = Date.now() - 42_000;
r = await watch(env, t0, fakeSleep);
assert.equal(r.changed, false); assert.ok(r.polls <= 2);
console.log('дежурство: ок');
