// Меню поверх игры: раскладка (где меню, где и какого размера окна, прозрачность) и открытые окна.
// Утверждённый дизайн — claude/game-menu-spec.md в проекте, образец — прототип в Claude Design.
import { backend } from './backend';

export type WinId = 'rules' | 'laws' | 'buyers' | 'ai' | 'pins' | 'settings' | 'admin';
export type Dock = 'bottom' | 'free' | 'left' | 'right';

/** Обычный размер окна и меньше чего оно не сжимается (подобрано по содержимому). h = 0 — высота по содержимому. */
export const WIN: Record<WinId, { w: number; h: number; minW: number; minH: number }> = {
  rules: { w: 820, h: 680, minW: 640, minH: 420 },
  laws: { w: 820, h: 680, minW: 660, minH: 420 },
  buyers: { w: 840, h: 680, minW: 800, minH: 440 },
  ai: { w: 440, h: 640, minW: 400, minH: 420 },
  pins: { w: 440, h: 0, minW: 420, minH: 0 },
  settings: { w: 820, h: 680, minW: 700, minH: 420 },
  admin: { w: 480, h: 660, minW: 420, minH: 420 },
};

export interface WinGeo { x?: number; y?: number; w?: number; h?: number; glass?: number }
export interface Layout {
  bar: { dock: Dock; cx: number; cy: number };
  /** Общая прозрачность, 0–80 % */
  glass: number;
  wins: Partial<Record<WinId, WinGeo>>;
  /** Закреплено (булавка): клавиша, Esc и клик в пустое место не прячут меню, а отпускают мышь в игру */
  pinned?: boolean;
}

const GAP = 16;
/** Ширина вертикального меню вместе с отступом — окна открываются правее/левее */
export const RAIL = 94;

/** Цвета подложек при прозрачности t %: прозрачнее только фон, текст и кнопки как были */
export function glassVars(t: number): string {
  const a = 1 - t / 100;
  const f = (x: number) => Math.min(1, x).toFixed(2);
  return `--bg: rgba(26, 27, 30, ${f(a)}); --surface: rgba(33, 34, 38, ${f(a + 0.08)}); --surface-2: rgba(39, 40, 45, ${f(a + 0.14)}); --surface-3: rgba(49, 50, 56, ${f(a + 0.2)});`;
}

class GameMenu {
  layout = $state<Layout>({ bar: { dock: 'bottom', cx: 0, cy: 0 }, glass: 15, wins: {} });
  /** Открытые окна, от самого давнего к последнему */
  open = $state<WinId[]>([]);
  /** Окно поверх остальных — которое трогали последним */
  top = $state<WinId | ''>('');
  vw = $state(typeof window === 'undefined' ? 1920 : window.innerWidth);
  vh = $state(typeof window === 'undefined' ? 1080 : window.innerHeight);
  private timer: ReturnType<typeof setTimeout> | undefined;

  async load() {
    try {
      const l = (await backend.gameMenuLayout()) as Partial<Layout> | null;
      if (l && typeof l === 'object') {
        this.layout = {
          bar: { dock: 'bottom', cx: 0, cy: 0, ...(l.bar ?? {}) },
          glass: typeof l.glass === 'number' ? Math.max(0, Math.min(80, l.glass)) : 15,
          wins: l.wins ?? {},
          pinned: !!l.pinned,
        };
      }
    } catch { /* первая раскладка — по умолчанию */ }
  }

  /** Сохранить раскладку (после перетаскивания, ползунка) — не чаще раза в полсекунды */
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void backend.gameMenuSave($state.snapshot(this.layout)).catch(() => {}); }, 500);
  }

  /** Закреплённое меню сейчас «отпущено»: видно, но мышь и клавиатура — у игры */
  passive = $state(false);

  /** Булавка: сохраняем сразу — по ней решает программа, прятать ли меню */
  setPinned(on: boolean) {
    this.layout.pinned = on;
    clearTimeout(this.timer);
    void backend.gameMenuSave($state.snapshot(this.layout)).catch(() => {});
  }

  geo(id: WinId): WinGeo {
    return this.layout.wins[id] ?? {};
  }

  setGeo(id: WinId, patch: WinGeo | null, persist = true) {
    const cur = { ...this.geo(id), ...(patch ?? {}) };
    for (const k of Object.keys(cur) as (keyof WinGeo)[]) if (cur[k] === undefined) delete cur[k];
    this.layout.wins = { ...this.layout.wins, [id]: cur };
    if (persist) this.save();
  }

  get vertical() { return this.layout.bar.dock === 'left' || this.layout.bar.dock === 'right'; }

  /** Открыть или закрыть окно. Не влезают по ширине — закрывается самое давнее (кроме передвинутых вручную). */
  toggle(id: WinId) {
    if (this.open.includes(id)) { this.close(id); return; }
    let next = [...this.open, id];
    const width = (ids: WinId[]) => ids.filter((x) => this.geo(x).x === undefined)
      .reduce((s, x) => s + (this.geo(x).w ?? WIN[x].w), 0) + GAP * (ids.length - 1);
    const limit = this.vw - (this.vertical ? RAIL + GAP : GAP * 2);
    while (next.length > 1 && width(next) > limit) next = next.slice(1);
    this.open = next;
    this.top = id;
  }

  close(id: WinId) {
    this.open = this.open.filter((x) => x !== id);
  }
}

export const gm = new GameMenu();
