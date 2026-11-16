/**
 * Сборщик цен скупщиков NOVA RP (Cloudflare Worker).
 *
 * Каждую минуту: спрашивает у Discord, есть ли в канале сообщение новее последнего обработанного.
 * Есть — разбирает цены и записывает в репозиторий GitHub два файла:
 *   prices.json  — маленький, его скачивает программа (текущие цены, прошлый час, пороги «редкой» цены);
 *   history.json — история начальных цен за 30 дней, нужна только сборщику.
 * Первый запуск сам загружает историю канала (до 30 дней назад).
 *
 * Настройки (wrangler.toml / панель Cloudflare):
 *   CHANNEL_ID     — ID канала Discord с ценами
 *   GITHUB_REPO    — «владелец/репозиторий», куда писать файлы
 *   DISCORD_TOKEN  — токен бота (секрет)
 *   GITHUB_TOKEN   — токен GitHub с правом записи только в этот репозиторий (секрет)
 *   STATE          — хранилище KV: id последнего обработанного сообщения
 */
import { messageText, parsePrices } from './parse.js';
import { addToHistory, buildFile, HISTORY_DAYS } from './history.js';

const DISCORD = 'https://discord.com/api/v10';
const GITHUB = 'https://api.github.com';
const UA = 'NOVA-HELPER-prices (https://github.com/MRFUNFOX/NOVA-HELPER, 1.0)';

async function discord(env, path) {
  const r = await fetch(DISCORD + path, { headers: { Authorization: `Bot ${env.DISCORD_TOKEN}`, 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Discord ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const ghHeaders = (env) => ({
  Authorization: `Bearer ${env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': UA,
  'X-GitHub-Api-Version': '2022-11-28',
});

/** Прочитать JSON-файл из репозитория → { data, sha } (data = null, если файла нет) */
async function ghRead(env, path) {
  const r = await fetch(`${GITHUB}/repos/${env.GITHUB_REPO}/contents/${path}`, { headers: ghHeaders(env) });
  if (r.status === 404) return { data: null, sha: undefined };
  if (!r.ok) throw new Error(`GitHub read ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  let text;
  if (j.content) {
    const bin = atob(j.content.replace(/\n/g, ''));
    text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } else {
    // Файл больше 1 МБ — забираем как есть
    const raw = await fetch(`${GITHUB}/repos/${env.GITHUB_REPO}/contents/${path}`, { headers: { ...ghHeaders(env), Accept: 'application/vnd.github.raw' } });
    text = await raw.text();
  }
  return { data: JSON.parse(text), sha: j.sha };
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function ghWrite(env, path, data, sha, message) {
  const body = { message, content: toBase64(JSON.stringify(data)), ...(sha ? { sha } : {}) };
  const r = await fetch(`${GITHUB}/repos/${env.GITHUB_REPO}/contents/${path}`, {
    method: 'PUT', headers: { ...ghHeaders(env), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`GitHub write ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

/** Сообщения канала новее `after` (по возрастанию) */
async function newMessages(env, after) {
  const list = await discord(env, `/channels/${env.CHANNEL_ID}/messages?after=${after}&limit=50`);
  return list.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

/** Вся история канала до 30 дней назад (по возрастанию) */
async function allMessages(env) {
  const out = [];
  const edge = Date.now() - HISTORY_DAYS * 864e5;
  let before = '';
  for (let page = 0; page < 20; page++) {
    const list = await discord(env, `/channels/${env.CHANNEL_ID}/messages?limit=100${before ? `&before=${before}` : ''}`);
    if (!list.length) break;
    out.push(...list);
    before = list[list.length - 1].id;
    if (Date.parse(list[list.length - 1].timestamp) < edge) break;
  }
  return out.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

export async function run(env) {
  const lastId = await env.STATE.get('lastId');
  const messages = lastId ? await newMessages(env, lastId) : await allMessages(env);
  if (!messages.length) return { changed: false };

  const snaps = messages.map((m) => parsePrices(messageText(m))).filter(Boolean);
  const newest = messages[messages.length - 1].id;
  if (!snaps.length) {
    await env.STATE.put('lastId', newest);
    return { changed: false, skipped: messages.length };
  }

  const hist = await ghRead(env, 'history.json');
  let history = hist.data?.history || [];
  for (const s of snaps) history = addToHistory(history, s);
  const latest = snaps.reduce((a, b) => (Date.parse(a.time) >= Date.parse(b.time) ? a : b));
  const file = buildFile(history, latest);

  await ghWrite(env, 'history.json', { v: 1, history }, hist.sha, `История цен: ${latest.time}`);
  const cur = await ghRead(env, 'prices.json');
  const { history: _omit, ...small } = file;
  await ghWrite(env, 'prices.json', small, cur.sha, `Цены скупщиков: ${latest.time}`);
  await env.STATE.put('lastId', newest);
  return { changed: true, time: latest.time, added: snaps.length };
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      run(env)
        .then((r) => env.STATE.put('lastRun', JSON.stringify({ at: new Date().toISOString(), ...r })))
        .catch(async (e) => {
          console.error('prices:', e.message);
          await env.STATE.put('lastError', JSON.stringify({ at: new Date().toISOString(), error: String(e.message).slice(0, 400) }));
        }),
    );
  },
  // Проверка в браузере: адрес воркера/status — когда цены обработаны последний раз (без секретов)
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/status') {
      const j = async (k) => { const v = await env.STATE.get(k); return v ? JSON.parse(v) : null; };
      return Response.json({
        lastId: await env.STATE.get('lastId'), lastRun: await j('lastRun'), lastError: await j('lastError'),
        channel: env.CHANNEL_ID, repo: env.GITHUB_REPO,
        secrets: { discord: !!env.DISCORD_TOKEN, github: !!env.GITHUB_TOKEN },
      });
    }
    return new Response('NOVA HELPER prices worker', { status: 200 });
  },
};
