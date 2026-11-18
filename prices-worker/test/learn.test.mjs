import assert from 'node:assert/strict';
import { handleLearn, sha256 } from '../src/learn.js';

// Поддельное хранилище KV
const kv = new Map();
let writes = 0;
const STATE = {
  get: async (k) => kv.get(k) ?? null,
  put: async (k, v) => { writes++; kv.set(k, v); },
  delete: async (k) => { kv.delete(k); },
  list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
};
const env = { STATE };
const DEV = 'NOVA-TEST-DEV0-CODE';
env.DEV_CODE_SHA256 = await sha256(DEV);

async function call(path, { method = 'GET', body, token, ip = '1.1.1.1' } = {}) {
  const headers = { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await handleLearn(new Request(`https://w.dev/learn/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, data: await r.json() };
}

// Чужой адрес не наш
assert.equal(await handleLearn(new Request('https://w.dev/status'), env), null);

// 1. Разъяснения для всех: сначала — встроенное про бронежилет
let r = await call('notes');
assert.equal(r.data.learning, true);
assert.equal(r.data.notes.length, 1);
assert.match(r.data.notes[0].text, /Бронежилет/);
assert.equal(r.data.notes[0].by, undefined); // кто принял — не для игроков

// 2. Без входа в панель нельзя
assert.equal((await call('queue')).status, 401);
assert.equal((await call('queue', { token: 'a'.repeat(64) })).status, 401);

// 3. Вход разработчика своим кодом (регистр и пробелы не важны)
r = await call('login', { method: 'POST', body: { code: '  ' + DEV.toLowerCase() + ' ', device: 'pc-1' } });
assert.equal(r.status, 200);
assert.equal(r.data.role, 'dev');
const devToken = r.data.token;
assert.match(devToken, /^[a-f0-9]{64}$/);
assert.ok(![...kv.values()].some((v) => v.includes(devToken)), 'токен не хранится в открытом виде');
assert.ok(![...kv.values()].some((v) => v.includes(DEV)), 'код не хранится в открытом виде');
r = await call('me', { token: devToken });
assert.equal(r.data.role, 'dev');

// 4. Dev создаёт админа — код показывается один раз
r = await call('team', { method: 'POST', token: devToken, body: { action: 'create', name: 'Помощница' } });
assert.equal(r.status, 200);
const adminCode = r.data.code;
const adminId = r.data.id;
assert.match(adminCode, /^NOVA-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
assert.equal((await call('team', { method: 'POST', token: devToken, body: { action: 'create', name: 'помощница' } })).status, 409);
r = await call('team', { token: devToken });
assert.equal(r.data.users.length, 2);
assert.ok(!JSON.stringify(r.data).includes('codeHash'));
// Второго Dev нет и быть не может: роль при создании всегда admin
assert.equal(r.data.users.filter((u) => u.role === 'dev').length, 1);
// Себя Dev не удалит и не заблокирует
assert.equal((await call('team', { method: 'POST', token: devToken, body: { action: 'delete', id: 'dev' } })).status, 403);

// 5. Админ входит; ему закрыты команда, журнал и выключатель
r = await call('login', { method: 'POST', body: { code: adminCode, device: 'pc-2' }, ip: '2.2.2.2' });
assert.equal(r.data.role, 'admin');
const adminToken = r.data.token;
assert.equal((await call('team', { token: adminToken })).status, 403);
assert.equal((await call('log', { token: adminToken })).status, 403);
assert.equal((await call('toggle', { method: 'POST', token: adminToken, body: { on: false } })).status, 403);
assert.equal((await call('queue', { token: adminToken })).status, 200);

// 6. Игрок присылает довод → админ принимает с правкой → его получают все
const arg = { scope: 'laws', q: 'Можно носить тайзер открыто?', before: 'Нет…', arg: 'Тайзер — спецсредство, ст. 15 про оружие', answer: 'Вы правы…',
  verdict: { ok: true, refs: 'ст. 4 ч. 1, ст. 11' }, note: { text: 'Тайзер — спецсредство, не оружие.', keywords: ['тайзер', 'шокер'] }, app: '0.7.1' };
assert.equal((await call('submit', { method: 'POST', body: arg, ip: '9.9.9.9' })).status, 200);
assert.equal((await call('submit', { method: 'POST', body: { q: 'пусто' }, ip: '9.9.9.9' })).status, 400);
r = await call('queue', { token: adminToken });
assert.equal(r.data.items.length, 1);
const qid = r.data.items[0].id;
r = await call('decide', { method: 'POST', token: adminToken, body: { id: qid, action: 'accept', text: 'Тайзер — спецсредство, а не оружие (ст. 4 ч. 1).' } });
assert.equal(r.status, 200);
assert.equal((await call('queue', { token: adminToken })).data.items.length, 0);
r = await call('notes');
assert.equal(r.data.notes.length, 2); // встроенное + новое
assert.equal(r.data.notes[1].text, 'Тайзер — спецсредство, а не оружие (ст. 4 ч. 1).');
assert.deepEqual(r.data.notes[1].keywords, ['тайзер', 'шокер']);
r = await call('notes/all', { token: adminToken });
assert.equal(r.data.notes[1].byName, 'Помощница');
// Правка и удаление
assert.equal((await call('note', { method: 'POST', token: adminToken, body: { id: r.data.notes[1].id, keywords: 'тайзер, электрошокер' } })).status, 200);
assert.deepEqual((await call('notes')).data.notes[1].keywords, ['тайзер', 'электрошокер']);

// 7. Выключатель: доводы не принимаются, разъяснения работают
assert.equal((await call('toggle', { method: 'POST', token: devToken, body: { on: false } })).data.learning, false);
assert.equal((await call('submit', { method: 'POST', body: arg, ip: '9.9.9.9' })).status, 403);
assert.equal((await call('notes')).data.learning, false);
assert.equal((await call('notes')).data.notes.length, 2);
await call('toggle', { method: 'POST', token: devToken, body: { on: true } });

// 8. Лимит доводов с одного адреса
for (let i = 1; i < 20; i++) await call('submit', { method: 'POST', body: arg, ip: '8.8.8.8' });
assert.equal((await call('submit', { method: 'POST', body: arg, ip: '8.8.8.8' })).status, 200); // 20-й
assert.equal((await call('submit', { method: 'POST', body: arg, ip: '8.8.8.8' })).status, 429); // 21-й

// 9. Подбор кода: после 5 неверных — компьютер закрыт, а сам админ с другого входит
for (let i = 0; i < 4; i++) {
  r = await call('login', { method: 'POST', body: { code: 'NOVA-AAAA-BBBB-CCC' + i }, ip: '6.6.6.6' });
  assert.equal(r.status, 401); assert.equal(r.data.left, 4 - i);
}
r = await call('login', { method: 'POST', body: { code: 'NOVA-AAAA-BBBB-CCCX' }, ip: '6.6.6.6' });
assert.equal(r.status, 429);
r = await call('login', { method: 'POST', body: { code: adminCode }, ip: '6.6.6.6' });
assert.equal(r.status, 429, 'даже верный код с закрытого компьютера не пускает');
r = await call('login', { method: 'POST', body: { code: adminCode, device: 'pc-2' }, ip: '2.2.2.2' });
assert.equal(r.status, 200, 'с другого компьютера админ входит');
const admin2 = r.data.token;
// Повторный вход с того же компьютера заменяет прошлый вход
assert.equal((await call('me', { token: adminToken })).status, 401);

// 10. Блокировка, новый код, завершение входов
r = await call('team', { token: devToken });
assert.equal(r.data.users.find((u) => u.id === adminId).sessions.length, 1);
await call('team', { method: 'POST', token: devToken, body: { action: 'block', id: adminId } });
assert.equal((await call('me', { token: admin2 })).status, 401);
assert.equal((await call('login', { method: 'POST', body: { code: adminCode }, ip: '3.3.3.3' })).status, 401);
await call('team', { method: 'POST', token: devToken, body: { action: 'unblock', id: adminId } });
r = await call('team', { method: 'POST', token: devToken, body: { action: 'newcode', id: adminId } });
const code2 = r.data.code;
assert.notEqual(code2, adminCode);
assert.equal((await call('login', { method: 'POST', body: { code: adminCode }, ip: '4.4.4.4' })).status, 401);
r = await call('login', { method: 'POST', body: { code: code2, device: 'pc-3' }, ip: '4.4.4.4' });
assert.equal(r.status, 200);
const admin3 = r.data.token;
await call('team', { method: 'POST', token: devToken, body: { action: 'end', id: adminId } });
assert.equal((await call('me', { token: admin3 })).status, 401);
// Выход
assert.equal((await call('logout', { method: 'POST', token: devToken })).status, 200);
assert.equal((await call('me', { token: devToken })).status, 401);

// 11. Журнал
r = await call('login', { method: 'POST', body: { code: DEV, device: 'pc-1' } });
const dev2 = r.data.token;
r = await call('log', { token: dev2 });
assert.ok(r.data.entries.length > 10);
assert.ok(r.data.stats.submits >= 21);
assert.equal(r.data.stats.accepted, 1);
assert.ok(r.data.stats.badToday >= 5);
assert.ok(r.data.entries.some((e) => e.text === 'Вход с нового компьютера' && e.who === 'Помощница'));
assert.ok(!JSON.stringify(r.data).match(/\d+\.\d+\.\d+\.\d+/), 'адресов в журнале нет');

console.log('обучение: ок, записей в KV:', writes);

// 12. Общий потолок за сутки: доводы и неверные коды не съедают лимит KV сборщика цен
{
  const day = JSON.parse(kv.get(`L:day:${new Date().toISOString().slice(0, 10)}`));
  day.sub = 100; day.bad = 50;
  kv.set(`L:day:${new Date().toISOString().slice(0, 10)}`, JSON.stringify(day));
  assert.equal((await call('submit', { method: 'POST', body: arg, ip: '5.5.5.5' })).status, 429);
  const before = writes;
  r = await call('login', { method: 'POST', body: { code: 'NOVA-ZZZZ-ZZZZ-ZZZZ' }, ip: '7.7.7.7' });
  assert.equal(r.status, 401);
  assert.equal(writes, before, 'после потолка неверные коды ничего не записывают');
  assert.equal((await call('login', { method: 'POST', body: { code: DEV, device: 'pc-1' }, ip: '7.7.7.7' })).status, 200, 'верный код работает');
  console.log('потолок: ок');
}
