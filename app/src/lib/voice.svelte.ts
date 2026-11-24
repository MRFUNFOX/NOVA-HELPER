// Вопрос голосом в помощнике (дизайн утверждён 24.11.2026): кнопка микрофона в поле ввода →
// игрок говорит → замолчал, и запись останавливается сама (это решает программа на Rust) → текст в поле, игрок правит и отправляет.
// Озвучки ответов нет. Модель распознавания (~156 МБ) скачивается один раз, по согласию игрока.
import { backend } from './backend';
import { track } from './stats';

export type MicStage = 'idle' | 'offer' | 'install' | 'listen' | 'think' | 'error';

class Mic {
  stage = $state<MicStage>('idle');
  /** Громкость с микрофона 0…1 — для полосок */
  level = $state(0);
  /** Последние значения громкости — «волна» на плашке записи */
  wave = $state<number[]>(Array(10).fill(0));
  installed = $state(false);
  sizeMb = $state(156);
  progress = $state({ done: 0, total: 0 });
  error = $state('');
  /** Запись начата в этом окне: события летят во все окна программы, отвечает только то, где нажали */
  private mine = false;
  private ready: Promise<void> | null = null;
  private onText: ((text: string) => void) | null = null;

  /** Подписки на события программы — один раз на окно */
  init(onText: (text: string) => void) {
    this.onText = onText;
    this.ready ??= (async () => {
      try {
        const s = await backend.voiceStatus();
        this.installed = s.installed;
        this.sizeMb = s.sizeMb;
        if (s.installing) this.stage = 'install';
      } catch { /* старый бэкенд — просто без голоса */ }
      await backend.on('voice-level', (p) => {
        if (!this.mine) return;
        this.level = Number(p) || 0;
        this.wave = [...this.wave.slice(1), this.level];
      });
      await backend.on('voice-install', (p) => {
        const v = p as { stage: string; done: number; total: number };
        if (v.stage === 'done') { this.installed = true; this.stage = 'idle'; track('voice_installed', {}); return; }
        if (v.stage === 'error') { if (this.stage === 'install') this.stage = 'offer'; return; }
        this.stage = 'install';
        this.progress = { done: v.done, total: v.total };
      });
      await backend.on('voice', (p) => {
        if (!this.mine) return;
        const v = p as { stage: string; text?: string; error?: string };
        if (v.stage === 'listen') this.stage = 'listen';
        else if (v.stage === 'think') this.stage = 'think';
        else if (v.stage === 'heard') { this.mine = false; this.stage = 'idle'; if (v.text) this.onText?.(v.text); }
        else if (v.stage === 'idle') { this.mine = false; this.stage = 'idle'; }
        else if (v.stage === 'error') { this.mine = false; this.fail(v.error ?? 'Не получилось распознать'); }
      });
    })();
    return this.ready;
  }

  /** Нажали микрофон */
  async press() {
    if (this.stage === 'listen') { await backend.voiceStop().catch(() => {}); return; }
    if (this.stage === 'think' || this.stage === 'install') return;
    if (!this.installed) { this.stage = this.stage === 'offer' ? 'idle' : 'offer'; return; }
    this.error = '';
    this.wave = Array(10).fill(0);
    this.mine = true;
    this.stage = 'listen';
    try {
      await backend.voiceStart();
      track('voice_ask', {});
    } catch (e) {
      this.mine = false;
      const msg = String(e);
      if (msg.includes('missing')) { this.installed = false; this.stage = 'offer'; return; }
      this.fail(msg);
    }
  }

  async install() {
    this.stage = 'install';
    this.progress = { done: 0, total: this.sizeMb * 1e6 };
    try {
      await backend.voiceInstall();
      this.installed = true;
      this.stage = 'idle';
    } catch (e) {
      this.stage = 'offer';
      this.error = String(e);
    }
  }

  /** Закрыли помощник посреди записи — запись выбрасываем */
  cancel() {
    if (this.stage === 'listen' && this.mine) void backend.voiceCancel().catch(() => {});
    if (this.stage === 'offer' || this.stage === 'error') this.stage = 'idle';
  }

  dismiss() { this.stage = 'idle'; this.error = ''; }

  private fail(msg: string) {
    this.error = msg;
    this.stage = 'error';
  }
}

export const mic = new Mic();
