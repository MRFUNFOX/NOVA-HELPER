/**
 * Вопрос помощнику голосом прямо в игре (дизайн утверждён 25.11.2026).
 * Клавишу и микрофон ведёт программа (ask.rs, voice.rs), распознанный вопрос приходит сюда — в главное окно,
 * где загружены правила и помощник. Отсюда ход ответа и сам ответ уходят в маленькое окно поверх игры.
 * Вопрос попадает и в историю помощника — его можно открыть потом в программе.
 */
import { backend, type AskState } from './backend';
import { ai, answerText, pieces, sourceLabel, type Turn } from './ai.svelte';
import { app } from './state.svelte';
import { track } from './stats';
export { autoSeconds } from './askTime';

/** Что показать в окне по готовому ответу: текст с **жирным** и номера пунктов отдельными плашками */
export function answerState(t: Turn): AskState {
  if (t.error) return { stage: 'error', error: t.error, q: t.q };
  const parts: { t: 'text' | 'bold'; v: string }[] = [];
  const refs: { num: string; doc: string }[] = [];
  for (const p of pieces(answerText(t.a))) {
    if (p.t === 'ref') {
      if (p.kind !== 's') continue;
      const s = t.sources.find((x) => x.n === p.n);
      if (!s) continue;
      const l = sourceLabel(s);
      if (!refs.some((r) => r.num === l.num && r.doc === l.doc)) refs.push(l);
      continue;
    }
    const last = parts.at(-1);
    if (last && last.t === p.t) last.v += p.v;
    else parts.push({ t: p.t, v: p.v });
  }
  // Пробелы, оставшиеся от убранных ссылок: «убийства [S1].» → «убийства.»
  for (const p of parts) p.v = p.v.replace(/ +([.,;:!?])/g, '$1').replace(/ {2,}/g, ' ');
  if (parts.length) parts[parts.length - 1]!.v = parts[parts.length - 1]!.v.trimEnd();
  if (t.nick) {
    const n = t.nick;
    const head = n.verdict === 'ok' ? 'Ник подходит.' : n.verdict === 'bad' ? 'Ник не подходит.' : 'Ник спорный.';
    const why = [...n.format.filter((f) => !f.ok).map((f) => f.label), ...n.issues].slice(0, 3).join('; ');
    parts.splice(0, parts.length, { t: 'bold', v: head }, ...(why ? [{ t: 'text' as const, v: ` ${why}` }] : []));
  }
  return { stage: 'answer', q: t.q, parts, refs: refs.slice(0, 3) };
}

async function run(q: string) {
  const say = (s: AskState) => void backend.askShow(s).catch(() => {});
  if (!app.aiEnabled || !ai.ready) {
    say({ stage: 'error', q, error: 'Помощник не подключён — подключи его в программе' });
    return;
  }
  if (ai.busy) {
    say({ stage: 'error', q, error: 'Помощник ещё отвечает на прошлый вопрос — спроси чуть позже' });
    return;
  }
  say({ stage: 'think', q, step: 'plan' });
  track('ask_game', {});
  const job = ai.ask(q);
  // Ход ответа: разбирает ситуацию → отвечает → перепроверяет
  let step = 'plan';
  const watch = setInterval(() => {
    const t = ai.turns.at(-1);
    if (t?.pending && t.stage && t.stage !== step) {
      step = t.stage;
      say({ stage: 'think', q, step: t.stage });
    }
  }, 400);
  try {
    const t = await job;
    if (!t) { say({ stage: 'error', q, error: 'Не получилось задать вопрос — попробуй ещё раз' }); return; }
    say(answerState(t));
  } catch (e) {
    say({ stage: 'error', q, error: String(e) });
  } finally {
    clearInterval(watch);
  }
}

let started = false;
/** Один раз в главном окне: слушать вопросы, заданные голосом в игре */
export function initAskGame() {
  if (started) return;
  started = true;
  void backend.on('voice', (p) => {
    const v = p as { stage: string; origin?: string; text?: string };
    if (v.origin === 'game' && v.stage === 'heard' && v.text) void run(v.text);
  });
}
