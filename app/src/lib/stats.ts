/**
 * Анонимная статистика для будущих улучшений. Отправляется, только если игрок разрешил.
 * Что уходит: название события и пара чисел или слов (см. вызовы track). Ники, ключи,
 * тексты вопросов помощнику и IP не отправляются.
 */
import { backend } from './backend';
import { app } from './state.svelte';

export function track(name: string, props?: Record<string, string | number>) {
  if (app.settings?.analytics !== true) return;
  backend.stat(name, props).catch(() => { /* статистика не важнее работы программы */ });
}

/** Ошибки программы: не больше 5 за запуск, чтобы не тратить лимит */
let errors = 0;
export function trackErrors() {
  const send = (msg: string) => {
    if (errors++ >= 5) return;
    track('app_error', { message: msg.slice(0, 200) });
  };
  window.addEventListener('error', (e) => send(String(e.message || e.error)));
  window.addEventListener('unhandledrejection', (e) => send(String(e.reason)));
}

/** Поиск, который ничего не нашёл — по одному разу на запрос за запуск */
const empty = new Set<string>();
export function trackEmptySearch(section: string, query: string) {
  const q = query.trim().toLowerCase().slice(0, 60);
  if (q.length < 2 || empty.has(q)) return;
  empty.add(q);
  track('search_empty', { section, query: q });
}

/** Причина ошибки помощника — коротким словом, без текста ошибки */
export function errorKind(e: string) {
  if (/лимит/i.test(e)) return 'limit';
  if (/стран|Forbidden|недоступен/i.test(e)) return 'country';
  if (/долго не отвечает/i.test(e)) return 'timeout';
  if (/интернет|связаться/i.test(e)) return 'network';
  if (/Ключ не подходит/i.test(e)) return 'bad_key';
  return 'other';
}
