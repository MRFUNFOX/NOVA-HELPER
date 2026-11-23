// Голосовой вопрос к ИИ: клавишу ловит программа (Rust), запись и распознавание — тоже там.
//  • Главное окно получает распознанную фразу, задаёт вопрос ИИ и рассылает ответ всем окнам.
//  • Слой окон поверх игры показывает плашку «Слушаю / Думаю» и карточку ответа (дизайн утверждён 23.11.2026).
import { backend } from './backend';
import { ai, answerText, pieces, sourceLabel, type Turn } from './ai.svelte';
import { app } from './state.svelte';
import { track } from './stats';

export type Stage = 'idle' | 'listen' | 'think' | 'answer' | 'missing' | 'error';

/** Ответ для карточки поверх игры */
export interface VoiceAnswer {
  q: string;
  /** Короткий вывод — первая фраза ответа */
  verdict: string;
  /** Объяснение — остальное (без ссылок) */
  rest: string;
  refs: { num: string; doc: string }[];
  pun?: string;
  scope: 'project' | 'laws';
  /** Ответ будет озвучен */
  speak: boolean;
  error?: string;
}

/** Ответ без ссылок [S1] и разметки, разбитый на вывод и объяснение */
export function splitAnswer(t: Turn): { verdict: string; rest: string } {
  const text = pieces(answerText(t.a)).map((p) => (p.t === 'ref' ? '' : p.v)).join('').replace(/\s+([.,;:!?])/g, '$1').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
  const m = /^(.+?[.!?])(\s+|$)/s.exec(text);
  if (!m) return { verdict: text, rest: '' };
  return { verdict: m[1]!.trim(), rest: text.slice(m[0].length).trim() };
}

function payload(t: Turn, speak: boolean): VoiceAnswer {
  if (t.nick) {
    const n = t.nick;
    return {
      q: t.q, scope: 'project', speak, refs: [{ num: '2.13', doc: 'Общие правила' }],
      verdict: n.verdict === 'ok' ? `Ник ${n.nick} подходит.` : n.verdict === 'bad' ? `Ник ${n.nick} не подходит.` : `Ник ${n.nick} спорный — решает администрация.`,
      rest: [...n.format.filter((f) => !f.ok).map((f) => f.label), ...n.issues].join('. '),
    };
  }
  const { verdict, rest } = splitAnswer(t);
  const used = new Set(pieces(t.a).flatMap((p) => (p.t === 'ref' && p.kind === 's' ? [p.n] : [])));
  const cited = t.sources.filter((s) => used.has(s.n));
  const pun = cited.flatMap((s) => s.entry.node.punishments).map((p) => p.raw.split('|')[0]!.trim()).find(Boolean);
  return {
    q: t.q, verdict, rest, scope: t.scope ?? 'project', speak, ...(pun ? { pun } : {}),
    refs: cited.slice(0, 2).map((s) => ({ num: sourceLabel(s).num, doc: sourceLabel(s).doc })),
  };
}

class Voice {
  stage = $state<Stage>('idle');
  level = $state(0);
  heard = $state('');
  answer = $state<VoiceAnswer | null>(null);
  /** Сколько ответа прочитано: 0…1 */
  said = $state(0);
  error = $state('');
  /** Скачивание моделей */
  install = $state<{ stage: string; done: number; total: number } | null>(null);
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private started = false;

  /** Слой поверх игры: показываем, что происходит */
  async startOverlay() {
    if (this.started) return;
    this.started = true;
    await backend.on('voice', (p) => {
      const v = p as { stage: Stage | 'heard'; text?: string; error?: string };
      clearTimeout(this.hideTimer);
      if (v.stage === 'heard') { this.heard = v.text ?? ''; this.stage = 'think'; return; }
      if (v.stage === 'listen') { this.heard = ''; this.answer = null; this.said = 0; this.error = ''; }
      this.stage = v.stage;
      if (v.stage === 'error' || v.stage === 'missing') {
        this.error = v.error ?? '';
        this.hideTimer = setTimeout(() => (this.stage = 'idle'), 4000);
      }
    });
    await backend.on('voice-level', (p) => (this.level = Number(p) || 0));
    await backend.on('voice-answer', (p) => {
      const a = p as VoiceAnswer;
      clearTimeout(this.hideTimer);
      this.answer = a;
      this.said = 0;
      this.stage = 'answer';
      // Без озвучки — держим столько, чтобы спокойно прочитать: ~2,5 слова в секунду, не меньше 10 с
      if (!a.speak || a.error) {
        const words = `${a.verdict} ${a.rest}`.split(/\s+/).length;
        this.hideTimer = setTimeout(() => (this.stage = 'idle'), Math.max(10_000, (words / 2.5) * 1000));
      }
    });
    await backend.on('voice-say', (p) => {
      const s = p as { p: number; done: boolean };
      if (this.stage !== 'answer') return;
      this.said = s.p;
      if (s.done) {
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => (this.stage = 'idle'), 2500);
      }
    });
  }

  /** Ход скачивания моделей — для настроек (в любом окне) */
  private watching = false;
  async watchInstall() {
    if (this.watching) return;
    this.watching = true;
    await backend.on('voice-install', (p) => {
      const v = p as { stage: string; done: number; total: number };
      this.install = v.stage === 'done' || v.stage === 'error' ? null : v;
    });
  }

  /**
   * Голос ставится сам: один раз тихо скачивается в фоне — у тех, у кого включён ИИ (без ИИ голос не нужен).
   * Дальше обновления программы его не трогают; если мы заменим модели — докачается только изменённое.
   * Удалил сам (voiceDeclined) — больше не качаем, остаётся кнопка в настройках.
   */
  private autoTimer: ReturnType<typeof setTimeout> | undefined;
  private autoInstall(delay = 45_000) {
    clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(async () => {
      // ИИ ещё не настроен — заглянем позже
      if (!ai.ready || !app.settings) return this.autoInstall(5 * 60_000);
      if (app.settings.voiceDeclined) return;
      const st = await backend.voiceStatus().catch(() => null);
      if (!st || st.installing) return;
      try {
        await backend.voiceInstall();
        if (!st.installed) track('voice_auto_install', {});
      } catch {
        // Нет интернета и т. п. — попробуем через полчаса (и при следующем запуске)
        this.autoInstall(30 * 60_000);
      }
    }, delay);
  }

  /** Главное окно: распознанная фраза → вопрос ИИ → ответ всем окнам и голосом */
  async startMain() {
    void this.watchInstall();
    this.autoInstall();
    await backend.on('voice', async (p) => {
      const v = p as { stage: string; text?: string };
      if (v.stage !== 'heard' || !v.text) return;
      const speak = app.settings?.voiceSpeak !== false;
      if (!ai.ready) {
        await backend.emit('voice-answer', { q: v.text, verdict: 'ИИ-помощник не настроен.', rest: 'Откройте программу и подключите бесплатный ключ — это займёт пару минут.', refs: [], scope: 'project', speak: false, error: 'setup' } satisfies VoiceAnswer);
        return;
      }
      // Пока помощник отвечает на прошлый вопрос — ждём
      for (let i = 0; ai.busy && i < 100; i++) await new Promise((r) => setTimeout(r, 200));
      const t = await ai.ask(v.text);
      if (!t) return;
      if (t.error) {
        await backend.emit('voice-answer', { q: t.q, verdict: 'Не получилось ответить.', rest: t.error, refs: [], scope: t.scope ?? 'project', speak: false, error: 'ai' } satisfies VoiceAnswer);
        return;
      }
      const a = payload(t, speak);
      await backend.emit('voice-answer', a);
      track('voice_ask', { scope: a.scope, speak: speak ? 1 : 0, nick: t.nick ? 1 : 0 });
      if (speak) backend.voiceSay(`${a.verdict} ${a.rest}`).catch(() => {});
    });
  }
}

export const voice = new Voice();
