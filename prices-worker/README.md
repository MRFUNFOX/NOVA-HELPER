# Сборщик цен скупщиков (Cloudflare Worker)

Раз в минуту проверяет Discord-канал с ценами скупщиков NOVA RP и, когда приходит новое сообщение,
записывает в репозиторий [MRFUNFOX/nova-prices](https://github.com/MRFUNFOX/nova-prices):

- `prices.json` — текущие цены, прошлый час (для стрелок), пороги «редкой» цены. Его читает программа.
- `history.json` — история начальных цен за 30 дней (только для сборщика).

Первый запуск сам загружает историю канала.

## Где что

- `src/parse.js` — разбор сообщения «Изменение цен у скупщиков».
- `src/history.js` — история и порог «редкой» цены (верхние 10% начальных цен за 7 дней).
- `src/worker.js` — сам воркер: Discord → GitHub, состояние в KV.
- `test/run.test.mjs` — проверка на настоящих ценах: `npm test`.
- `node bundle.mjs` → `dist/nova-prices-worker.js` — один файл для вставки в редактор Cloudflare.

## Настройки воркера в Cloudflare

| Что | Значение |
|---|---|
| Cron | каждую минуту |
| KV binding `STATE` | пространство `nova-prices-state` |
| `CHANNEL_ID` | ID канала Discord с ценами |
| `GITHUB_REPO` | `MRFUNFOX/nova-prices` |
| секрет `DISCORD_TOKEN` | токен бота (права в канале: просмотр и чтение истории, Message Content Intent) |
| секрет `GITHUB_TOKEN` | fine-grained токен: Contents — Read and write, только `nova-prices` |

Проверка: `https://<воркер>.workers.dev/status` — последний запуск и последняя ошибка (без секретов).
