/**
 * Цены скупщиков в программе: скачивание раз в час, цели игрока, звук, окна поверх игры.
 *
 * Окна скупщика — это такие же закреплённые окна, как пункты правил (тот же слой и редактор),
 * только с данными `buyer`. Главное окно пересчитывает их при каждом новом часе или смене цели
 * и отдаёт программе весь список закрепок.
 */
import { app } from './state.svelte';
import { backend } from './backend';
import { BUYER_LIMIT, type Pin } from './pins';
import { buyerKey, buyerPin, nextCheckIn, PRICES_URL, rowsOf, type PricesFile, type Row } from './prices';

const read = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* не страшно */ } };

const CACHE = 'nova.prices';
const GOALS = 'nova.buyerGoals';
const SOUND = 'nova.buyerSound';
const GUIDE = 'nova.buyerGuide';

export interface GuideState { hidden: boolean; editor: boolean }

class Prices {
  file = $state.raw<PricesFile | null>(read<PricesFile | null>(CACHE, null));
  error = $state('');
  loading = $state(false);
  goals = $state<Record<string, number>>(read(GOALS, {}));
  sound = $state<boolean>(read(SOUND, true));
  guide = $state<GuideState>(read(GUIDE, { hidden: false, editor: false }));
  /** Тикает раз в 30 секунд — для «следующие через N мин» */
  now = $state(Date.now());

  rows = $derived<Row[]>(this.file ? rowsOf(this.file, this.goals) : []);
  pinned = $derived(new Set(app.pins.filter((p) => p.kind === 'buyer').map((p) => p.buyer?.item ?? p.badge)));

  private running = false;
  /** Метка версии файла от GitHub: повторный запрос без изменений не тратит лимит */
  private etag = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ticker: ReturnType<typeof setInterval> | undefined;
  /** «товар@время», для которых цель уже сработала — звук только на новые */
  private reached = new Set<string>();
  private seeded = false;
  private audio: AudioContext | null = null;
  /** Меню поверх игры — второе окно программы: звук цели играет только основное окно */
  quiet = false;

  /** Включить (раздел открыт для игрока): скачать цены и проверять каждый час */
  start() {
    if (this.running) return;
    this.running = true;
    this.unlockAudioOnGesture();
    this.ticker = setInterval(() => (this.now = Date.now()), 30e3);
    // Гайд: третий шаг — игрок открыл редактор окон
    void backend.on('pins-editor', (open) => { if (open && this.running && !this.guide.editor) this.setGuide({ editor: true }); });
    void this.tick();
  }

  /** Выключить (режим разработчика выключен): убрать окна скупщика с экрана */
  async stop() {
    this.running = false;
    clearTimeout(this.timer);
    clearInterval(this.ticker);
    if (app.pins.some((p) => p.kind === 'buyer')) {
      const next = app.pins.filter((p) => p.kind !== 'buyer');
      await backend.pinsSet(next).catch(() => {});
      app.pins = next;
    }
  }

  /** Нужно ли сейчас вообще ходить за ценами: есть окна на экране или открыт раздел */
  private get wanted() {
    return this.pinned.size > 0 || app.view.kind === 'buyers' || !this.file;
  }

  private async tick() {
    if (!this.running) return;
    if (this.wanted) await this.fetchNow();
    this.timer = setTimeout(() => void this.tick(), nextCheckIn(this.file));
  }

  async fetchNow() {
    if (this.loading) return;
    this.loading = true;
    try {
      const headers: Record<string, string> = { Accept: 'application/vnd.github.raw+json' };
      if (this.etag && this.file) headers['If-None-Match'] = this.etag;
      const r = await fetch(PRICES_URL, { headers, cache: 'no-store' });
      if (r.status === 304) { this.error = ''; return; }
      if (!r.ok) throw new Error(r.status === 403 ? 'GitHub временно ограничил запросы — попробую позже' : `Ошибка ${r.status}`);
      const f = (await r.json()) as PricesFile;
      if (!f?.time || !Array.isArray(f.raw)) throw new Error('Файл цен повреждён');
      this.error = '';
      this.etag = r.headers.get('ETag') ?? '';
      if (!this.file || this.file.time !== f.time || this.file.updatedAt !== f.updatedAt) {
        this.file = f;
        write(CACHE, f);
        await this.refresh();
      }
    } catch (e) {
      this.error = e instanceof TypeError ? 'Нет связи с сервером цен' : String((e as Error).message ?? e);
    } finally {
      this.loading = false;
    }
  }

  /** Раздел открыли — подтянуть цены, если устарели */
  opened() {
    if (!this.running) return;
    clearTimeout(this.timer);
    void this.tick();
  }

  // ── Окна поверх игры ──

  async togglePin(item: string) {
    const was = app.pins.find((p) => p.kind === 'buyer' && p.key === buyerKey(item));
    if (was) {
      await backend.pinsRemove(was.key).catch(() => {});
      app.pins = app.pins.filter((p) => p !== was);
      return;
    }
    if (this.pinned.size >= BUYER_LIMIT) {
      app.notify(`Можно вывести не больше ${BUYER_LIMIT} товаров — уберите какой-нибудь`, 'error');
      return;
    }
    const row = this.rows.find((r) => r.item === item);
    if (!row || !this.file) return;
    const next = [...app.pins, buyerPin(row, this.file.time)];
    try {
      await backend.pinsSet(next);
      app.pins = next;
      if (this.pinned.size === 1) app.notify(`Окно с ценами — поверх игры. Двигать окна — ${app.editorKey.replaceAll('+', ' + ')}`);
    } catch (e) { app.notify(String(e), 'error'); }
  }

  /** Новые цены или цели — обновить окна на экране и проверить цели */
  private async refresh() {
    this.checkGoals();
    if (!this.file) return;
    const time = this.file.time;
    let changed = false;
    const next: Pin[] = app.pins.map((p) => {
      if (p.kind !== 'buyer') return p;
      const row = this.rows.find((r) => r.item === (p.buyer?.item ?? p.badge));
      if (!row) return p;
      const fresh = buyerPin(row, time);
      if (JSON.stringify(fresh.buyer) === JSON.stringify(p.buyer)) return p;
      changed = true;
      return { ...p, ...fresh };
    });
    if (!changed) return;
    await backend.pinsSet(next).catch(() => {});
    app.pins = next;
  }

  // ── Цели ──

  setGoal(item: string, value: number | null) {
    const g = { ...this.goals };
    if (value && value > 0) g[item] = Math.round(value); else delete g[item];
    this.goals = g;
    write(GOALS, g);
    void this.refresh();
  }

  setSound(on: boolean) {
    this.sound = on;
    write(SOUND, on);
    if (on) this.chime();
  }

  private checkGoals() {
    if (!this.file) return;
    const now = new Set(this.rows.filter((r) => r.reached).map((r) => `${r.item}@${this.file!.time}@${r.goal}`));
    const fresh = [...now].filter((k) => !this.reached.has(k));
    this.reached = now;
    // Первый подсчёт после запуска — без звука: цели могли сработать, пока программа была закрыта
    if (!this.seeded) { this.seeded = true; return; }
    if (fresh.length && this.sound && !this.quiet) this.chime();
  }

  /** Короткий сигнал из двух нот. Без файлов — звук рисуется прямо в программе. */
  chime() {
    try {
      this.audio ??= new AudioContext();
      const ctx = this.audio;
      void ctx.resume();
      const t = ctx.currentTime + 0.02;
      for (const [f, d] of [[880, 0], [1318.5, 0.16]] as const) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.3, t + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.6);
        o.connect(g).connect(ctx.destination);
        o.start(t + d);
        o.stop(t + d + 0.65);
      }
    } catch { /* звук не поддерживается — молча */ }
  }

  /** Браузерный движок разрешает звук после первого клика по программе — заранее «будим» его */
  private unlockAudioOnGesture() {
    const unlock = () => {
      try { this.audio ??= new AudioContext(); void this.audio.resume(); } catch { /* нет звука */ }
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  // ── Гайд «Начни за 3 шага» ──

  get steps() {
    return [this.pinned.size > 0, Object.keys(this.goals).length > 0, this.guide.editor] as const;
  }

  setGuide(patch: Partial<GuideState>) {
    this.guide = { ...this.guide, ...patch };
    write(GUIDE, this.guide);
  }
}

export const prices = new Prices();
