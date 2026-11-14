/**
 * Связь интерфейса с программой (Rust). В браузере при разработке (`npm run dev`)
 * вместо программы работает заглушка с настоящей базой из dev/mock-db.json —
 * так интерфейс можно смотреть и проверять без сборки .exe.
 */
import type { RuleDocument } from '@shared/types';
import type { Changelog, Manifest } from '@shared/format';
import type { Pin } from './pins';

export type HintMode = 'always' | 'timed' | 'off';

export interface Settings {
  hotkey: string;
  hint: HintMode;
  closeToTray: boolean;
  firstRunDone: boolean;
  /** Игрок уже видел настройку ИИ-помощника (настроил или пропустил) */
  aiSetupDone?: boolean;
  /** Режим разработчика: видны функции, которые игрокам ещё не показываем */
  devMode?: boolean;
  /** Анонимная статистика: null — ещё не спрашивали */
  analytics?: boolean | null;
  /** Клавиша редактора закреплённых окон */
  editorHotkey?: string;
  /** Сервер, с которым игрок играет (на будущее — законы серверов) */
  window?: { x: number; y: number; width: number; height: number } | null;
}

export interface Db {
  manifest: Manifest | null;
  docs: RuleDocument[];
  changelogs: Changelog[];
  corrupted?: boolean;
}

export interface CheckResult {
  status: 'upToDate' | 'available' | 'firstInstall' | 'appTooOld';
  localVersion?: string | null;
  remoteVersion: string;
  generatedAt: string;
  changedDocs: number;
  addedDocs: number;
  removedDocs: number;
  summary: string[];
}

export interface AiStatus { hasKey: boolean; keyHint: string; model: string | null; provider?: string | null; hasGroq?: boolean; hasZai?: boolean }
export type AiProvider = 'groq' | 'zai';
export interface PinsState { enabled: boolean; pins: Pin[]; editorKey: string; editor: boolean; editorVia?: 'hotkey' | 'button' }
export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
  }
  return mock(cmd, args) as Promise<T>;
}

export const backend = {
  isTauri,
  async loadDb(): Promise<Db> {
    return JSON.parse(await invoke<string>('db_load')) as Db;
  },
  checkDb: () => invoke<CheckResult>('db_check'),
  async updateDb(): Promise<Db> {
    return JSON.parse(await invoke<string>('db_update')) as Db;
  },
  getSettings: () => invoke<Settings>('get_settings'),
  saveSettings: (s: Settings) => invoke<Settings>('save_settings', { new: s }),
  setHotkey: (hotkey: string) => invoke<Settings>('set_hotkey', { hotkey }),
  suspendHotkey: (suspended: boolean) => invoke<void>('suspend_hotkey', { suspended }),
  setEditorHotkey: (hotkey: string) => invoke<Settings>('set_editor_hotkey', { hotkey }),
  suspendEditorHotkey: (suspended: boolean) => invoke<void>('suspend_editor_hotkey', { suspended }),

  // ── Закреплённые пункты поверх игры ──
  pinsGet: () => invoke<PinsState>('pins_get'),
  pinsSet: (pins: Pin[]) => invoke<void>('pins_set', { pins }),
  pinsLayout: (layout: Partial<Pin>[]) => invoke<void>('pins_layout', { layout }),
  pinsRemove: (key: string) => invoke<void>('pins_remove', { key }),
  pinsEditor: (open: boolean) => invoke<void>('pins_editor', { open }),
  pinsSync: () => invoke<void>('pins_sync'),
  /** В игре ли игрок и не в полноэкранном ли режиме игра */
  gameState: () => invoke<{ inGame: boolean; fullscreen: boolean }>('game_state'),
  finishFirstRun: () => invoke<void>('finish_first_run'),
  hide: () => invoke<void>('hide_main'),
  minimize: () => invoke<void>('minimize_main'),
  quit: () => invoke<void>('quit_app'),
  version: () => invoke<string>('app_version'),
  /** Окно умеет быть прозрачным (создано так при запуске в режиме разработчика) */
  windowGlass: () => invoke<boolean>('window_glass'),

  // ── ИИ-помощник (ключ Groq или Z.ai хранится в программе, сюда не передаётся) ──
  aiStatus: () => invoke<AiStatus>('ai_status'),
  aiSetKey: (key: string) => invoke<AiStatus>('ai_set_key', { key }),
  aiClearKey: () => invoke<AiStatus>('ai_clear_key'),
  aiUse: (provider: AiProvider) => invoke<AiStatus>('ai_use', { provider }),
  stat: (name: string, props: Record<string, string | number> | undefined) => invoke<void>('stat', {
    name, props, locale: navigator.language || '',
    osVersion: /Windows NT ([\d.]+)/.exec(navigator.userAgent)?.[1] ?? '',
  }),
  aiComplete: (messages: ChatMsg[]) => invoke<string>('ai_complete', { messages }),
  aiChat: (id: string, messages: ChatMsg[]) => invoke<{ text: string; model: string }>('ai_chat', { id, messages }),

  async toggleMaximize() {
    if (!isTauri) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().toggleMaximize();
  },
  async startDrag() {
    if (!isTauri) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
  },
  /** Открыть ссылку в браузере. Не вышло — копируем её, чтобы игрок вставил сам. Возвращает, открылась ли. */
  async openUrl(url: string): Promise<boolean> {
    if (!isTauri) { window.open(url, '_blank', 'noopener'); return true; }
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return true;
    } catch {
      try { await navigator.clipboard.writeText(url); } catch { /* буфер недоступен */ }
      return false;
    }
  },
  async autostart(enable?: boolean): Promise<boolean> {
    if (!isTauri) return mockState.autostart = enable ?? mockState.autostart;
    const a = await import('@tauri-apps/plugin-autostart');
    if (enable === true) await a.enable();
    if (enable === false) await a.disable();
    return a.isEnabled();
  },
  async on(event: string, cb: (payload: unknown) => void): Promise<() => void> {
    if (!isTauri) {
      (mockListeners[event] ??= new Set()).add(cb);
      return () => mockListeners[event]?.delete(cb);
    }
    const { listen } = await import('@tauri-apps/api/event');
    return listen(event, (e) => cb(e.payload));
  },
};

// ── Обновление самой программы (плагин updater) ──
export interface AppUpdate { version: string; notes?: string; install: (onProgress: (p: number) => void) => Promise<void> }

export async function checkAppUpdate(): Promise<AppUpdate | null> {
  if (!isTauri) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const u = await check();
  if (!u) return null;
  return {
    version: u.version,
    notes: u.body ?? undefined,
    async install(onProgress) {
      let total = 0;
      let got = 0;
      await u.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0;
        if (e.event === 'Progress') { got += e.data.chunkLength; if (total) onProgress(got / total); }
      });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}

// ── Заглушка для браузера ──
const mockListeners: Record<string, Set<(p: unknown) => void>> = {};
const mockEmit = (event: string, payload: unknown) => mockListeners[event]?.forEach((cb) => cb(payload));
const mockState = {
  settings: { hotkey: 'Alt+Q', hint: 'always', closeToTray: true, firstRunDone: false, window: null } as Settings,
  autostart: true,
  dbLoaded: false,
  aiKey: '',
  aiGroq: '',
  aiZai: '',
  pins: [] as Pin[],
  editor: false,
};

/** Пример закреплённых окон для тестовой страницы слоя (pins.html?sample) */
const SAMPLE_PINS: Pin[] = [
  { key: 'a#4.1', docId: 'a', nodeId: '4.1', badge: '4.1', doc: 'Общие правила проекта', law: false, text: 'Запрещено убийство игрока без весомой IC-причины (DeathMatch, DM).', punish: ['JAIL 120 мин'] },
  { key: 'b#2.7', docId: 'b', nodeId: '2.7', badge: '2.7', doc: 'Правила зелёных зон', law: false, text: 'В зелёной зоне запрещены любые нападения, ограбления и похищения.', punish: ['JAIL 60 мин'] },
  { key: 'c#6.2', docId: 'c', nodeId: '6.2', badge: 'ст. 6.2 ч. 1', doc: 'Уголовный кодекс', law: true, text: 'Умышленное причинение смерти другому человеку наказывается лишением свободы на срок 4 года.', punish: [], x: 1560, y: 330, bg: 30, font: 13, locked: true },
];

async function mock(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const params = new URLSearchParams(location.search);
  await new Promise((r) => setTimeout(r, 120));
  switch (cmd) {
    case 'db_load': {
      // ?slow — медленный диск/первый запуск: посмотреть скелетную загрузку
      if (params.has('slow')) await new Promise((r) => setTimeout(r, Number(params.get('slow')) || 4000));
      if (params.has('empty') && !mockState.dbLoaded) return JSON.stringify({ manifest: null, docs: [], changelogs: [] });
      const r = await fetch('/dev/mock-db.json');
      return r.text();
    }
    case 'db_check':
      if (params.has('offline')) throw 'Не удалось связаться с сервером базы правил (нет сети). Проверьте интернет.';
      return {
        status: params.has('empty') && !mockState.dbLoaded ? 'firstInstall' : params.has('update') ? 'available' : 'upToDate',
        localVersion: '2026.11.09-1943', remoteVersion: '2026.11.10-0617', generatedAt: '2026-11-10T06:17:00Z',
        changedDocs: 2, addedDocs: 0, removedDocs: 0, summary: ['изменено пунктов: 3'],
      } satisfies CheckResult;
    case 'db_update': {
      await new Promise((r) => setTimeout(r, params.has('slowupdate') ? 6000 : 900));
      mockState.dbLoaded = true;
      return (await fetch('/dev/mock-db.json')).text();
    }
    case 'get_settings':
      if (params.has('ready')) mockState.settings.firstRunDone = true;
      // ?ready&aisetup — программа стояла до появления помощника: покажется разовая настройка
      if (params.has('ready') && !params.has('aisetup') && mockState.settings.aiSetupDone === undefined) mockState.settings.aiSetupDone = true;
      // ?dev — режим разработчика уже включён
      if (params.has('dev') && mockState.settings.devMode === undefined) mockState.settings.devMode = true;
      // ?ready без ?consent — статистику уже спрашивали (отказ), чтобы окно не мешало тестам
      if (params.has('ready') && !params.has('consent') && mockState.settings.analytics === undefined) mockState.settings.analytics = false;
      return { ...mockState.settings };
    case 'save_settings':
      mockState.settings = { ...(args!.new as Settings), hotkey: mockState.settings.hotkey, editorHotkey: mockState.settings.editorHotkey };
      return { ...mockState.settings };
    case 'set_hotkey':
      if (args!.hotkey === 'Alt+Tab') throw 'Сочетание «Alt+Tab» не подходит или уже занято другой программой. Выберите другое.';
      mockState.settings.hotkey = args!.hotkey as string;
      return { ...mockState.settings };
    case 'finish_first_run':
      mockState.settings.firstRunDone = true;
      return;
    case 'ai_status': {
      // ?aikey — помощник уже настроен (Groq), ?aizai — есть ещё и ключ Z.ai
      if (params.has('aikey') && !mockState.aiKey) mockState.aiKey = mockState.aiGroq = 'gsk_mockmockmock1234';
      if (params.has('aizai') && !mockState.aiZai) mockState.aiZai = 'a1b2c3d4e5f6a7b8c9d0e1f2.Zai9';
      return mockStatus();
    }
    case 'ai_set_key': {
      await new Promise((r) => setTimeout(r, 700));
      const key = String(args!.key).trim();
      if (!key) throw 'Вставьте ключ в поле — сочетание Ctrl+V.';
      if (/error|Forbidden|\{/.test(key)) throw 'Это не ключ, а сообщение сайта об ошибке. «Forbidden» значит, что сайт недоступен из вашей страны: Groq не работает в России и СНГ — для них есть Z.ai.';
      const groq = key.startsWith('gsk_');
      if (!groq && key.length < 20) throw 'Это не похоже на ключ. У Groq он начинается с «gsk_», у Z.ai — длинный набор букв и цифр. Скопируйте ключ ещё раз.';
      if (key.includes('bad')) throw 'Ключ не подходит. Скопируйте его ещё раз целиком.';
      if (groq) mockState.aiGroq = key; else mockState.aiZai = key;
      mockState.aiKey = key;
      return mockStatus();
    }
    case 'ai_use': {
      const k = args!.provider === 'zai' ? mockState.aiZai : mockState.aiGroq;
      if (!k) throw 'Для этой нейросети ещё нет ключа';
      mockState.aiKey = k;
      return mockStatus();
    }
    case 'ai_clear_key':
      if (mockState.aiKey.startsWith('gsk_')) mockState.aiGroq = ''; else mockState.aiZai = '';
      mockState.aiKey = mockState.aiGroq || mockState.aiZai;
      return mockStatus();
    case 'ai_complete':
      return JSON.stringify({ keywords: [] });
    case 'ai_chat': {
      // Z.ai в жизни подолгу держит очередь — в тестовой версии изображаем ожидание
      if (!mockState.aiKey.startsWith('gsk_')) await new Promise((r) => setTimeout(r, 8000));
      // Ответ-образец по кусочкам, со ссылками на первые фрагменты
      const text = 'Нет, это **DM** (убийство без причины) [S1]. Администрация даст **JAIL до 120 минут** [S1].';
      for (const part of text.match(/.{1,12}/gs) ?? []) {
        mockEmit('ai-chunk', { id: args!.id, delta: part });
        await new Promise((r) => setTimeout(r, 40));
      }
      return { text, model: 'openai/gpt-oss-120b' };
    }
    case 'pins_get': {
      if (params.has('sample') && !mockState.pins.length) mockState.pins = SAMPLE_PINS.map((p) => ({ ...p }));
      if (params.has('editor')) mockState.editor = true;
      const enabled = !!mockState.settings.devMode || params.has('sample');
      return { enabled, pins: mockState.pins, editorKey: mockState.settings.editorHotkey ?? 'Alt+Shift+Z', editor: mockState.editor };
    }
    case 'pins_set': {
      const old = mockState.pins;
      mockState.pins = (args!.pins as Pin[]).map((p) => {
        const o = old.find((x) => x.key === p.key);
        return o ? { ...p, x: o.x, y: o.y, w: o.w, bg: o.bg, font: o.font, locked: o.locked } : p;
      });
      mockEmit('pins-changed', mockState.pins);
      return;
    }
    case 'pins_layout':
      for (const l of args!.layout as Partial<Pin>[]) {
        const p = mockState.pins.find((x) => x.key === l.key);
        if (p) Object.assign(p, { x: l.x, y: l.y, w: l.w, bg: l.bg, font: l.font, locked: l.locked });
      }
      return;
    case 'pins_remove':
      mockState.pins = mockState.pins.filter((p) => p.key !== args!.key);
      mockEmit('pins-changed', mockState.pins);
      return;
    case 'pins_editor':
      mockState.editor = !!args!.open;
      mockEmit('pins-editor', mockState.editor);
      return;
    case 'pins_sync':
      return;
    case 'set_editor_hotkey':
      if (args!.hotkey === mockState.settings.hotkey) throw 'Это сочетание уже открывает саму программу. Выберите другое.';
      mockState.settings = { ...mockState.settings, editorHotkey: String(args!.hotkey) };
      return { ...mockState.settings };
    case 'suspend_editor_hotkey':
      return;
    case 'game_state':
      return { inGame: params.has('ingame'), fullscreen: params.has('fullscreen') };
    case 'window_glass':
      return !!mockState.settings.devMode;
    case 'stat':
      console.debug('[статистика]', args!.name, args!.props ?? '');
      return;
    case 'app_version':
      return '0.6.1';
    default:
      return;
  }
}

function mockStatus(): AiStatus {
  const k = mockState.aiKey;
  const groq = k.startsWith('gsk_');
  return {
    hasKey: !!k, keyHint: k ? `…${k.slice(-4)}` : '', model: k ? (groq ? 'openai/gpt-oss-120b' : 'glm-4.7-flash') : null,
    provider: k ? (groq ? 'Groq' : 'Z.ai') : null, hasGroq: !!mockState.aiGroq, hasZai: !!mockState.aiZai,
  };
}
