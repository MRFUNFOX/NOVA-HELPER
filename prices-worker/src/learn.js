/**
 * Обучение ИИ-помощника: доводы игроков, разъяснения, команда и журнал.
 *
 * Всё хранится в том же KV, что и сборщик цен, под ключами «L:…»:
 *   L:cfg            { learning }                — принимать ли доводы игроков
 *   L:users          { [id]: аккаунт }           — Dev и админы (код хранится только отпечатком SHA-256)
 *   L:sess:<hash>    { uid, created, seen, … }   — вход на компьютере (сам токен не хранится)
 *   L:notes          [разъяснение]               — принятые разъяснения, их получают все игроки
 *   L:q:<id>         довод на проверке
 *   L:log:<день>     [запись журнала]            — 90 дней
 *   L:rl:<ip>        неверные коды с одного адреса (адрес — только отпечатком, живёт сутки)
 *   L:sub:<ip>:<день> сколько доводов прислали с адреса за день
 *   L:day:<день>     { sub, bad }                — сколько доводов и неверных кодов за сутки (общий потолок)
 *
 * Роли: dev — один, входит своим кодом разработчика (отпечаток в DEV_CODE_SHA256);
 * admin — создаёт только dev. Второго dev создать нельзя.
 */

const DEV_HASH = 'df5c7595ca604a1dd828d8b19ce2b0328c9152b13d5799386ef999b1ac58880a';
const DAY = 864e5;
const SESSION_TTL = 180 * 86400; // вход живёт полгода без открытия программы
const LOG_TTL = 90 * 86400;
const QUEUE_TTL = 60 * 86400;
const SUBMIT_PER_DAY = 20;
/** Общий потолок в сутки: бесплатный лимит KV — 1000 записей на весь аккаунт, и его же тратит сборщик цен.
 *  Даже если кто-то нарочно засыпает сервер доводами или неверными кодами, на цены останется запас. */
const DAY_SUBMITS = 100;
const DAY_BAD_LOGINS = 50;
const FAILS_BEFORE_LOCK = 5;
const MAX_NOTES = 500;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra } });
const fail = (status, error, more = {}) => json({ error, ...more }, status);

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const codeHash = (code) => sha256(String(code || '').trim().toUpperCase());

/** Случайный код NOVA-XXXX-XXXX-XXXX: 12 знаков из 32 (без похожих 0/O, 1/I/L) ≈ 60 бит */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  const s = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
  return `NOVA-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const newId = () => Date.now().toString(36) + randomHex(3);
const today = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const words = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
  .map((x) => str(String(x), 40).toLowerCase()).filter(Boolean).slice(0, 12);
const scopeOf = (v) => (v === 'project' ? 'project' : 'laws');

// ── хранилище ──
const getJson = async (env, key, fallback) => {
  const v = await env.STATE.get(key);
  if (!v) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
};
const putJson = (env, key, value, ttl) =>
  env.STATE.put(key, JSON.stringify(value), ttl ? { expirationTtl: ttl } : undefined);

const getCfg = (env) => getJson(env, 'L:cfg', { learning: true });
const getUsers = (env) => getJson(env, 'L:users', {});
/** Первое разъяснение — из спора про бронежилет 18.11.2026. Пока список пуст в KV, игроки получают его. */
const SEED_NOTES = [{
  id: 'seed-armor', scope: 'laws',
  text: 'Бронежилет — спецсредство, а не оружие (ст. 4 ч. 1 закона «О регулировании оборота оружия, боеприпасов и спецсредств»). Правило о скрытом ношении (ст. 15 ч. 1) касается только оружия. Гражданский бронежилет носить открыто не запрещено, поэтому ст. 12.8 ч. 2 УК за это не применяется. Запрещены только спецсредства государственного образца для гражданских (ст. 11 закона, ст. 12.8.1 УК).',
  keywords: ['бронежилет', 'бронник', 'броня', 'бронь', 'спецсредство', 'спецсредства'],
  by: 'dev', byName: 'Разработчик', at: '2026-11-18T19:00:00.000Z',
}];
const getNotes = (env) => getJson(env, 'L:notes', SEED_NOTES);

/** Запись в журнал. Ошибка записи не ломает само действие. */
async function log(env, entry) {
  try {
    const key = `L:log:${today()}`;
    const list = await getJson(env, key, []);
    list.push({ at: new Date().toISOString(), ...entry });
    await putJson(env, key, list.slice(-400), LOG_TTL);
  } catch (e) { console.error('learn log:', e.message); }
}

const getDay = (env, t) => getJson(env, `L:day:${today(t)}`, { sub: 0, bad: 0 });
const putDay = (env, day) => putJson(env, `L:day:${today()}`, day, 10 * 86400);

const ipKey = async (req) => (await sha256('ip:' + (req.headers.get('CF-Connecting-IP') || 'local'))).slice(0, 24);

// ── вход ──
async function auth(req, env) {
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(req.headers.get('Authorization') || '');
  if (!m) return null;
  const h = await sha256(m[1]);
  const sess = await getJson(env, `L:sess:${h}`, null);
  if (!sess) return null;
  const users = await getUsers(env);
  const user = users[sess.uid];
  if (!user || user.blocked) return null;
  // «Был в сети» обновляем не чаще раза в сутки — бережём лимит записей KV
  if (Date.now() - Date.parse(sess.seen) > DAY) {
    sess.seen = new Date().toISOString();
    await putJson(env, `L:sess:${h}`, sess, SESSION_TTL);
    const s = user.sessions?.find((x) => x.h === h);
    if (s) { s.seen = sess.seen; await putJson(env, 'L:users', users); }
  }
  return { user, users, h };
}

async function login(req, env) {
  const body = await req.json().catch(() => ({}));
  const ip = await ipKey(req);
  const rl = await getJson(env, `L:rl:${ip}`, { n: 0, level: 0, until: 0 });
  if (rl.until > Date.now()) return fail(429, 'locked', { until: new Date(rl.until).toISOString() });

  const hash = await codeHash(body.code);
  const users = await getUsers(env);
  let user = Object.values(users).find((u) => u.codeHash === hash && !u.deleted);
  if (!user && hash === (env.DEV_CODE_SHA256 || DEV_HASH)) {
    // Первый вход разработчика: заводим аккаунт Dev (он может быть только один)
    user = Object.values(users).find((u) => u.role === 'dev');
    if (!user) {
      user = { id: 'dev', role: 'dev', name: 'Разработчик', created: new Date().toISOString(), sessions: [], devices: [] };
      users.dev = user;
    }
    user.codeHash = hash;
  }
  if (!user || user.blocked) {
    // Потолок за сутки исчерпан — отказываем, ничего не записывая (коды длинные, перебор всё равно бесполезен)
    const day = await getDay(env);
    if (day.bad >= DAY_BAD_LOGINS) return fail(401, 'bad', { left: 0 });
    day.bad += 1;
    await putDay(env, day);
    rl.n += 1;
    let left = FAILS_BEFORE_LOCK - rl.n;
    if (rl.n >= FAILS_BEFORE_LOCK) {
      // 15 минут, потом каждый раз вдвое дольше — до суток
      rl.until = Date.now() + Math.min(15 * 60e3 * 2 ** rl.level, DAY);
      rl.level += 1; rl.n = 0; left = 0;
      await log(env, { kind: 'locked', who: '—', text: `${FAILS_BEFORE_LOCK} неверных кодов подряд, вход с этого компьютера закрыт до ${new Date(rl.until).toISOString()}` });
    } else if (user?.blocked) {
      await log(env, { kind: 'bad', uid: user.id, who: user.name, text: 'Попытка входа в заблокированный аккаунт' });
    } else {
      await log(env, { kind: 'bad', who: '—', text: 'Вход с неверным кодом' });
    }
    await putJson(env, `L:rl:${ip}`, rl, 86400);
    if (rl.until > Date.now()) return fail(429, 'locked', { until: new Date(rl.until).toISOString() });
    return fail(401, 'bad', { left });
  }
  if (rl.n || rl.level) await env.STATE.delete(`L:rl:${ip}`);

  const token = randomHex(32);
  const h = await sha256(token);
  const now = new Date().toISOString();
  const device = str(body.device, 64) || 'unknown';
  const deviceHash = (await sha256('dev:' + device)).slice(0, 16);
  user.devices ||= [];
  // «Новый компьютер» — только если человек уже входил с другого (самый первый вход не помечаем)
  const isNew = user.devices.length > 0 && !user.devices.includes(deviceHash);
  if (!user.devices.includes(deviceHash)) user.devices = [...user.devices, deviceHash].slice(-20);
  // Один вход на компьютер: прошлый вход с него закрываем
  for (const s of user.sessions || []) if (s.device === deviceHash) await env.STATE.delete(`L:sess:${s.h}`);
  user.sessions = (user.sessions || []).filter((s) => s.device !== deviceHash);
  const label = `Компьютер ${user.devices.indexOf(deviceHash) + 1}`;
  user.sessions.push({ h, device: deviceHash, label, created: now, seen: now, isNew });
  user.lastLogin = now;
  users[user.id] = user;
  await putJson(env, `L:sess:${h}`, { uid: user.id, created: now, seen: now }, SESSION_TTL);
  await putJson(env, 'L:users', users);
  await log(env, { kind: 'login', uid: user.id, who: user.name, text: isNew ? 'Вход с нового компьютера' : 'Вход' });
  const cfg = await getCfg(env);
  return json({ token, id: user.id, role: user.role, name: user.name, learning: cfg.learning });
}

async function endSessions(env, user, onlyHash) {
  const keep = [];
  for (const s of user.sessions || []) {
    if (!onlyHash || s.h === onlyHash) await env.STATE.delete(`L:sess:${s.h}`);
    else keep.push(s);
  }
  user.sessions = keep;
}

// ── доводы игроков ──
async function submit(req, env) {
  const cfg = await getCfg(env);
  if (!cfg.learning) return fail(403, 'off');
  const b = await req.json().catch(() => null);
  if (!b) return fail(400, 'bad');
  const item = {
    id: newId(),
    at: new Date().toISOString(),
    scope: scopeOf(b.scope),
    q: str(b.q, 500),
    before: str(b.before, 2500),
    arg: str(b.arg, 1500),
    answer: str(b.answer, 2500),
    verdict: { ok: !!b.verdict?.ok, refs: str(b.verdict?.refs, 200), reason: str(b.verdict?.reason, 400) },
    note: { text: str(b.note?.text, 800), keywords: words(b.note?.keywords) },
    app: str(b.app, 20),
  };
  if (!item.arg || !item.note.text) return fail(400, 'bad');
  const ip = await ipKey(req);
  const key = `L:sub:${ip}:${today()}`;
  const n = Number(await env.STATE.get(key)) || 0;
  if (n >= SUBMIT_PER_DAY) return fail(429, 'limit');
  const day = await getDay(env);
  if (day.sub >= DAY_SUBMITS) return fail(429, 'limit');
  day.sub += 1;
  await env.STATE.put(key, String(n + 1), { expirationTtl: 2 * 86400 });
  await putDay(env, day);
  await putJson(env, `L:q:${item.id}`, item, QUEUE_TTL);
  return json({ ok: true });
}

async function queue(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.STATE.list({ prefix: 'L:q:', cursor, limit: 100 });
    for (const k of page.keys) {
      const v = await getJson(env, k.name, null);
      if (v) out.push(v);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < 200);
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

async function decide(env, me, b) {
  const item = await getJson(env, `L:q:${str(b.id, 40)}`, null);
  if (!item) return fail(404, 'gone');
  const users = me.users;
  const stats = (users[me.user.id].stats ||= { accepted: 0, rejected: 0 });
  if (b.action === 'accept') {
    const text = str(b.text, 800) || item.note.text;
    const notes = await getNotes(env);
    if (notes.length >= MAX_NOTES) return fail(409, 'full');
    notes.push({
      id: newId(), scope: scopeOf(b.scope || item.scope), text,
      keywords: b.keywords ? words(b.keywords) : item.note.keywords,
      by: me.user.id, byName: me.user.name, at: new Date().toISOString(),
      from: { q: item.q, arg: item.arg, before: item.before, answer: item.answer, at: item.at },
    });
    await putJson(env, 'L:notes', notes);
    stats.accepted += 1;
    await log(env, { kind: 'note', uid: me.user.id, who: me.user.name, text: `Принял(а) разъяснение «${text.slice(0, 70)}…»${text !== item.note.text ? ', текст изменён' : ''}` });
  } else {
    stats.rejected += 1;
    await log(env, { kind: 'note', uid: me.user.id, who: me.user.name, text: `Отклонил(а) довод «${item.q.slice(0, 70)}»` });
  }
  await env.STATE.delete(`L:q:${item.id}`);
  await putJson(env, 'L:users', users);
  return json({ ok: true });
}

async function editNote(env, me, b) {
  const notes = await getNotes(env);
  const i = notes.findIndex((n) => n.id === b.id);
  if (i < 0) return fail(404, 'gone');
  const n = notes[i];
  if (b.delete) {
    notes.splice(i, 1);
    await log(env, { kind: 'note', uid: me.user.id, who: me.user.name, text: `Удалил(а) разъяснение «${n.text.slice(0, 70)}…»` });
  } else {
    if (b.text !== undefined) n.text = str(b.text, 800) || n.text;
    if (b.keywords !== undefined) n.keywords = words(b.keywords);
    if (b.scope) n.scope = scopeOf(b.scope);
    n.edited = new Date().toISOString();
    await log(env, { kind: 'note', uid: me.user.id, who: me.user.name, text: `Изменил(а) разъяснение «${n.text.slice(0, 70)}…»` });
  }
  await putJson(env, 'L:notes', notes);
  return json({ ok: true });
}

// ── команда (только dev) ──
const publicUser = (u) => ({
  id: u.id, role: u.role, name: u.name, created: u.created, lastLogin: u.lastLogin || null,
  blocked: !!u.blocked, blockedAt: u.blockedAt || null, stats: u.stats || { accepted: 0, rejected: 0 },
  sessions: (u.sessions || []).map(({ h, label, created, seen, isNew }) => ({ id: h.slice(0, 12), label, created, seen, isNew })),
});

async function team(env, me, b) {
  const users = me.users;
  const who = { uid: me.user.id, who: me.user.name, kind: 'team' };
  if (b.action === 'create') {
    const name = str(b.name, 40);
    if (!name) return fail(400, 'name');
    if (Object.values(users).some((u) => u.name.toLowerCase() === name.toLowerCase())) return fail(409, 'exists');
    const code = newCode();
    const id = newId();
    users[id] = { id, role: 'admin', name, codeHash: await codeHash(code), created: new Date().toISOString(), createdBy: me.user.id, sessions: [], devices: [] };
    await putJson(env, 'L:users', users);
    await log(env, { ...who, text: `Создал админа «${name}»` });
    return json({ ok: true, id, code });
  }
  const u = users[str(b.id, 40)];
  if (!u) return fail(404, 'gone');
  if (u.role === 'dev' && b.action !== 'end') return fail(403, 'dev'); // себя не заблокировать и не удалить
  if (b.action === 'newcode') {
    const code = newCode();
    u.codeHash = await codeHash(code);
    await endSessions(env, u);
    await putJson(env, 'L:users', users);
    await log(env, { ...who, text: `Выдал новый код «${u.name}», старый перестал работать` });
    return json({ ok: true, code });
  }
  if (b.action === 'block' || b.action === 'unblock') {
    u.blocked = b.action === 'block';
    u.blockedAt = u.blocked ? new Date().toISOString() : null;
    if (u.blocked) await endSessions(env, u);
    await putJson(env, 'L:users', users);
    await log(env, { ...who, text: `${u.blocked ? 'Заблокировал' : 'Разблокировал'} «${u.name}»` });
    return json({ ok: true });
  }
  if (b.action === 'delete') {
    await endSessions(env, u);
    delete users[u.id];
    await putJson(env, 'L:users', users);
    await log(env, { ...who, text: `Удалил админа «${u.name}»` });
    return json({ ok: true });
  }
  if (b.action === 'end') {
    const target = b.session ? (u.sessions || []).find((s) => s.h.startsWith(str(b.session, 12)))?.h : undefined;
    if (b.session && !target) return fail(404, 'gone');
    await endSessions(env, u, target);
    await putJson(env, 'L:users', users);
    await log(env, { ...who, text: target ? `Завершил вход «${u.name}» на одном компьютере` : `Завершил все входы «${u.name}»` });
    return json({ ok: true });
  }
  return fail(400, 'action');
}

async function journal(env, days = 7) {
  const entries = [];
  for (let i = 0; i < days; i++) {
    const list = await getJson(env, `L:log:${today(Date.now() - i * DAY)}`, []);
    entries.push(...list);
  }
  entries.sort((a, b) => (a.at < b.at ? 1 : -1));
  const t = today();
  let submits = 0;
  for (let i = 0; i < 7; i++) submits += (await getDay(env, Date.now() - i * DAY)).sub;
  const stats = {
    submits,
    accepted: entries.filter((e) => e.kind === 'note' && e.text.startsWith('Принял')).length,
    badToday: entries.filter((e) => (e.kind === 'bad' || e.kind === 'locked') && e.at.startsWith(t)).length,
  };
  return { entries: entries.slice(0, 300), stats };
}

/** Обработчик всех адресов /learn/… Возвращает null, если адрес не наш. */
export async function handleLearn(req, env) {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/learn/')) return null;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const path = url.pathname.slice('/learn/'.length);
  try {
    // Для всех: принятые разъяснения и включено ли обучение
    if (path === 'notes' && req.method === 'GET') {
      const [cfg, notes] = await Promise.all([getCfg(env), getNotes(env)]);
      return json({ learning: cfg.learning, notes: notes.map(({ id, scope, text, keywords }) => ({ id, scope, text, keywords })) },
        200, { 'Cache-Control': 'public, max-age=300' });
    }
    if (path === 'submit' && req.method === 'POST') return await submit(req, env);
    if (path === 'login' && req.method === 'POST') return await login(req, env);

    const me = await auth(req, env);
    if (!me) return fail(401, 'auth');
    const b = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const isDev = me.user.role === 'dev';

    if (path === 'me') {
      const cfg = await getCfg(env);
      return json({ id: me.user.id, role: me.user.role, name: me.user.name, learning: cfg.learning });
    }
    if (path === 'logout' && req.method === 'POST') {
      const users = me.users;
      await endSessions(env, users[me.user.id], me.h);
      await putJson(env, 'L:users', users);
      return json({ ok: true });
    }
    if (path === 'queue') return json({ items: await queue(env) });
    if (path === 'decide' && req.method === 'POST') return await decide(env, me, b);
    if (path === 'notes/all') return json({ notes: await getNotes(env) });
    if (path === 'note' && req.method === 'POST') return await editNote(env, me, b);

    if (!isDev) return fail(403, 'role');
    if (path === 'toggle' && req.method === 'POST') {
      const cfg = { learning: !!b.on };
      await putJson(env, 'L:cfg', cfg);
      await log(env, { kind: 'team', uid: me.user.id, who: me.user.name, text: cfg.learning ? 'Включил приём доводов' : 'Выключил приём доводов' });
      return json({ ok: true, learning: cfg.learning });
    }
    if (path === 'team' && req.method === 'GET') return json({ users: Object.values(me.users).map(publicUser), me: me.user.id });
    if (path === 'team' && req.method === 'POST') return await team(env, me, b);
    if (path === 'log') return json(await journal(env, Math.min(Number(url.searchParams.get('days')) || 7, 30)));
    return fail(404, 'path');
  } catch (e) {
    console.error('learn:', e.message);
    return fail(500, 'server');
  }
}
