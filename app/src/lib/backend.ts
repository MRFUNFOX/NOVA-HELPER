/**
 * Связь интерфейса с программой (Rust). В браузере при разработке (`npm run dev`)
 * вместо программы работает заглушка с настоящей базой из dev/mock-db.json —
 * так интерфейс можно смотреть и проверять без сборки .exe.
 */
import type { RuleDocument } from '@shared/types';
import type { Changelog, Manifest } from '@shared/format';
import type { Pin } from './pins';
import { APP_REPO, cmpVersion, pickTarget, updateUrl } from './update';

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
/** Подсказка в углу экрана: отступ от правого нижнего угла монитора (логические пиксели) */
export interface HintSpot { right: number; bottom: number }
export interface HintInfo extends HintSpot { show: boolean; moved: boolean; hotkey: string }
export interface PinsState { enabled: boolean; pins: Pin[]; editorKey: string; editor: boolean; editorVia?: 'hotkey' | 'button'; hint?: HintInfo | null }
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
  /** Редактор окон: подсказку в углу перетащили (null — вернуть на место) */
  hintMove: (pos: HintSpot | null) => invoke<void>('hint_move', { pos }),
  /** В игре ли игрок и не в полноэкранном ли режиме игра */
  gameState: () => invoke<{ inGame: boolean; fullscreen: boolean }>('game_state'),
  /** Меню поверх игры: раскладка (меню, окна, прозрачность) и «спрятать» */
  gameMenuLayout: () => invoke<unknown>('game_menu_layout'),
  gameMenuSave: (layout: unknown) => invoke<void>('game_menu_save', { layout }),
  gameMenuHide: () => invoke<void>('game_menu_hide'),
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
  /** level: 0 — служебный запрос; 1 — разбор ситуации (модель думает); 2 — проверка ответа сильной моделью */
  aiComplete: (messages: ChatMsg[], level = 0) => invoke<string>('ai_complete', { messages, level }),
  /** Сколько людей носят имя / фамилию по forebears.io (правило 2.13 ОП советует его). null — сайт не ответил */
  nameCount: (kind: 'forenames' | 'surnames', name: string) => invoke<number | null>('name_count', { kind, name }),
  // ── Вопрос голосом: распознавание речи на компьютере игрока ──
  voiceStatus: () => invoke<{ installed: boolean; outdated?: boolean; installing: boolean; sizeMb: number }>('voice_status'),
  voiceInstall: () => invoke<void>('voice_install'),
  voiceRemove: () => invoke<void>('voice_remove'),
  voiceStart: () => invoke<void>('voice_start'),
  voiceStop: () => invoke<void>('voice_stop'),
  voiceCancel: () => invoke<void>('voice_cancel'),
  /** deep — длинная ситуация или спор: нейросеть рассуждает глубже */
  aiChat: (id: string, deep: boolean, messages: ChatMsg[]) => invoke<{ text: string; model: string; reasoning?: string }>('ai_chat', { id, deep, messages }),

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

// ── Обновление самой программы ──
export interface AppUpdate {
  version: string;
  notes?: string;
  /** Обязательное: ставится само, без «Позже» */
  mandatory: boolean;
  /** Тестовая сборка — видит только команда */
  test: boolean;
  install: (onProgress: (p: number) => void) => Promise<void>;
}
export { isMandatory } from './update';

/** Для команды: новейшая тестовая сборка (pre-release) */
async function newestTest(): Promise<{ version: string } | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${APP_REPO}/releases?per_page=10`, { cache: 'no-store' });
    if (!r.ok) return null;
    const list = (await r.json()) as { tag_name: string; draft: boolean; prerelease: boolean }[];
    const v = list.filter((x) => !x.draft && x.prerelease && /^v?\d+\.\d+\.\d+$/.test(x.tag_name)).map((x) => x.tag_name.replace(/^v/, '')).sort(cmpVersion).pop();
    return v ? { version: v } : null;
  } catch { return null; }
}

/** Есть ли новая версия. Всем — последний выпуск; команде (staff) — ещё и тестовые сборки. */
export async function checkAppUpdate(staff = false): Promise<AppUpdate | null> {
  if (!isTauri) {
    // Для проверки вида в браузере: ?appupdate (или ?appupdate=test)
    const p = import.meta.env.DEV ? new URLSearchParams(location.search).get('appupdate') : null;
    if (p === null) return null;
    return { version: '0.7.15', notes: 'Технические работы: исправление ошибок.', mandatory: false, test: p === 'test', install: async () => {} };
  }
  const { check } = await import('@tauri-apps/plugin-updater');
  const [latest, test, current] = await Promise.all([
    check().catch(() => null),
    staff ? newestTest() : Promise.resolve(null),
    backend.version(),
  ]);
  const t = pickTarget(current, latest && { version: latest.version, notes: latest.body }, test);
  if (!t) return null;
  if (t.source === 'latest' && latest) {
    return {
      version: latest.version, notes: latest.body ?? undefined, mandatory: t.mandatory, test: false,
      async install(onProgress) {
        let total = 0;
        let got = 0;
        await latest.downloadAndInstall((e) => {
          if (e.event === 'Started') total = e.data.contentLength ?? 0;
          if (e.event === 'Progress') { got += e.data.chunkLength; if (total) onProgress(got / total); }
        });
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
      },
    };
  }
  // Тестовая — ставится со своего адреса
  const url = updateUrl(t.version);
  const found = await invoke<{ version: string; notes: string | null } | null>('update_check', { url });
  if (!found) return null;
  return {
    version: found.version, notes: found.notes ?? undefined, mandatory: t.mandatory, test: t.source === 'test',
    async install(onProgress) {
      const off = await backend.on('update-progress', (p) => onProgress(Number(p) || 0));
      try { await invoke('update_install', { url }); } finally { off(); }
    },
  };
}

// ── Заглушка для браузера ──
const mockListeners: Record<string, Set<(p: unknown) => void>> = {};
const mockEmit = (event: string, payload: unknown) => mockListeners[event]?.forEach((cb) => cb(payload));
const mockState = {
  voice: false,
  voiceTimer: 0 as ReturnType<typeof setTimeout> | 0,
  settings: { hotkey: 'Alt+Q', hint: 'always', closeToTray: true, firstRunDone: false, window: null } as Settings,
  autostart: true,
  dbLoaded: false,
  aiKey: '',
  aiGroq: '',
  aiZai: '',
  pins: [] as Pin[],
  editor: false,
  hint: null as HintSpot | null,
};

/** Пример закреплённых окон для тестовой страницы слоя (pins.html?sample) */
const SAMPLE_PINS: Pin[] = [
  { key: 'a#4.1', docId: 'a', nodeId: '4.1', badge: '4.1', doc: 'Общие правила проекта', law: false, text: 'Запрещено убийство игрока без весомой IC-причины (DeathMatch, DM).', punish: ['JAIL 120 мин'] },
  { key: 'b#2.7', docId: 'b', nodeId: '2.7', badge: '2.7', doc: 'Правила зелёных зон', law: false, text: 'В зелёной зоне запрещены любые нападения, ограбления и похищения.', punish: ['JAIL 60 мин'] },
  { key: 'c#6.2', docId: 'c', nodeId: '6.2', badge: 'ст. 6.2 ч. 1', doc: 'Уголовный кодекс', law: true, text: 'Умышленное причинение смерти другому человеку наказывается лишением свободы на срок 4 года.', punish: [], x: 1560, y: 330, bg: 30, font: 13, locked: true },
  // Окна скупщика: обычная цена, редкая, сработавшая цель, продукты
  ...([
    ['Бензин', [[91, 109, -34, 0, 0], [170, 204, 8, 1, 0], [170, 204, 11, 0, 0]], null, 420, 330],
    ['Солярка', [[96, 115, 47, 0, 0], [193, 231, 22, 0, 1], [79, 94, -24, 0, 0]], null, 420, 470],
    ['Лосось', [[3725, 4470, 80, 1, 0], [2123, 2547, -35, 0, 0], [3590, 4308, 116, 0, 0]], 4400, 680, 330],
  ] as const).map(([item, cells, goal, x, y]) => ({
    key: `buyer:${item}`, docId: '', nodeId: '', badge: item, doc: 'Скупщики', law: false, text: '', punish: [], kind: 'buyer' as const, x, y,
    buyer: { item, group: 'raw' as const, time: new Date(Date.now() - 23 * 60e3).toISOString().slice(0, 11) + '22:05:00+03:00', goal,
      cells: cells.map(([min, start, delta, best, rare], i) => ({ n: i + 1, start, min, delta, best: !!best, rare: !!rare, goal: goal !== null && start >= goal })) },
  })),
  { key: 'buyer:Тыква', docId: '', nodeId: '', badge: 'Тыква', doc: 'Скупщики', law: false, text: '', punish: [], kind: 'buyer', x: 680, y: 490,
    buyer: { item: 'Тыква', group: 'products', time: new Date().toISOString().slice(0, 11) + '22:05:00+03:00', goal: null, cells: [{ n: 0, start: 764, min: null, delta: 14, best: false, rare: false, goal: false }] } },
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
    // Голос в браузере: ?voice — модель уже скачана. Запись «слышит» заготовленную фразу
    case 'voice_status':
      return { installed: mockState.voice || params.has('voice'), outdated: !mockState.voice && params.has('voiceold'), installing: false, sizeMb: 164 };
    case 'voice_install': {
      const total = 164e6;
      for (let i = 1; i <= 6; i++) {
        await new Promise((r) => setTimeout(r, 400));
        mockEmit('voice-install', { stage: i < 6 ? 'asr' : 'unpack', done: Math.min(total, i * 27e6), total });
      }
      mockState.voice = true;
      mockEmit('voice-install', { stage: 'done', done: total, total });
      return;
    }
    case 'voice_remove':
      mockState.voice = false;
      return;
    case 'voice_start': {
      mockEmit('voice', { stage: 'listen' });
      let n = 0;
      const tick = () => {
        n++;
        mockEmit('voice-level', n < 30 ? 0.25 + 0.6 * Math.abs(Math.sin(n / 2)) : 0.02);
        if (n < 45) mockState.voiceTimer = setTimeout(tick, 60);
        else finish();
      };
      const finish = () => {
        mockEmit('voice', { stage: 'think' });
        mockState.voiceTimer = setTimeout(() => mockEmit('voice', { stage: 'heard', text: 'Меня убили и через 5 минут я вернулся на то же место это нарушение' }), 900);
      };
      (window as unknown as { __nhVoiceFinish: () => void }).__nhVoiceFinish = () => { clearTimeout(mockState.voiceTimer || undefined); finish(); };
      mockState.voiceTimer = setTimeout(tick, 60);
      return;
    }
    case 'voice_stop':
      (window as unknown as { __nhVoiceFinish?: () => void }).__nhVoiceFinish?.();
      return;
    case 'voice_cancel':
      clearTimeout(mockState.voiceTimer || undefined);
      mockEmit('voice', { stage: 'idle' });
      return;
    case 'name_count': {
      const n = String(args!.name).toLowerCase();
      const known: Record<string, number> = { vova: 98_000, ivan: 4_212_000, petrov: 584_743, bandit: 4_886, katya: 61_000, alex: 1_900_000, layrouse: 0 };
      return known[n] ?? 0;
    }
    case 'ai_complete': {
      const sys = String((args!.messages as ChatMsg[])[0]?.content ?? '');
      if (sys.includes('проверяешь игровой ник')) {
        const nick = String((args!.messages as ChatMsg[])[1]?.content ?? '').split('Ник: ')[1] ?? '';
        if (/bandit|medik|killer/i.test(nick)) return JSON.stringify({ verdict: 'bad', issues: ['Отражает роль игрока: «Bandit» — бандит'] });
        if (/papa|mama|pidr|xyi/i.test(nick)) return JSON.stringify({ verdict: 'bad', issues: ['Упоминание родных или скрытый оскорбительный смысл'] });
        if (/kaneki|nagibator/i.test(nick)) return JSON.stringify({ verdict: 'doubt', issues: ['Похоже на имя персонажа аниме — может считаться известной личностью'] });
        return JSON.stringify({ verdict: 'ok', issues: [] });
      }
      if (sys.includes('проверяешь толкование')) return JSON.stringify({ ok: true, refs: 'ст. 4 ч. 1, ст. 11, ст. 15 ч. 1', reason: 'Бронежилет отнесён к спецсредствам, ст. 15 говорит только об оружии.' });
      const user = String((args!.messages as ChatMsg[])[1]?.content ?? '');
      await new Promise((r) => setTimeout(r, 400));
      // Разбор ситуации
      if (sys.includes('Не отвечай на него — разбери')) {
        const q = user.split('Вопрос игрока: ').pop() ?? '';
        if (/госник|полиц|сотрудник/i.test(q)) return JSON.stringify({
          who: ['игрок — рассказчик', 'два сотрудника госструктуры — игроки', 'администратор — посадил сотрудников в деморган'],
          facts: ['сотрудники остановили игрока на центральной улице', 'выписывали штрафы без причины и намекали на деньги', 'игрок написал репорт', 'администратор посадил сотрудников в деморган'],
          ask: 'справедливо ли администратор наказал сотрудников',
          topics: [
            { check: 'можно ли сотруднику выписывать штрафы без причины', words: ['злоупотребление полномочиями', 'необоснованная выдача штрафов'] },
            { check: 'можно ли сотруднику брать взятку на центральной улице', words: ['взятки', 'общественных местах', 'центральных улицах'] },
            { check: 'за что администрация сажает сотрудников в деморган', words: ['JAIL', 'государственных структур'] },
          ],
          docs: ['D1'], dispute: false,
        });
        return JSON.stringify({ who: [], facts: [], ask: q.slice(0, 80), topics: [{ check: q.slice(0, 80), words: [] }], docs: [], dispute: false });
      }
      // Самопроверка ответа
      if (sys.includes('Помощник ответил игроку')) {
        if (/госник|деморган/i.test(user)) return JSON.stringify({ ok: false, problems: ['Ответ перепутал участников: в деморган посадили сотрудников, а не игрока'], answer: '**Да, наказание справедливое.** Сотрудники выписывали штрафы без причины — это злоупотребление полномочиями [S1], а намёки на деньги на центральной улице — запрещённая взятка в общественном месте [S2]. Госники — тоже игроки, поэтому за это их и наказала администрация: до **JAIL 180 минут** [S1].' });
        return JSON.stringify({ ok: true, problems: [], answer: '' });
      }
      // Оценка экзамена
      if (sys.includes('принимаешь экзамен')) {
        const r = [...user].reduce((n, c) => n + c.charCodeAt(0), 0) % 4;
        return JSON.stringify(r === 0 ? { match: 'no', why: 'Вердикт противоположный эталону: помощник назвал это DM, хотя пункт разрешает.' } : r === 1 ? { match: 'partly', why: 'Вердикт верный, но не названо наказание.' } : { match: 'yes', why: 'Вердикт и пункт совпадают с эталоном.' });
      }
      return JSON.stringify({ keywords: [] });
    }
    case 'ai_chat': {
      // Z.ai в жизни подолгу держит очередь — в тестовой версии изображаем ожидание
      if (!mockState.aiKey.startsWith('gsk_')) await new Promise((r) => setTimeout(r, 8000));
      // Ответ-образец по кусочкам, со ссылками на первые фрагменты
      const msgs = args!.messages as ChatMsg[];
      const user = String(msgs[msgs.length - 1]?.content ?? '');
      // Для проверок в браузере: что ушло нейросети
      (window as unknown as { __nhLastPrompt?: string; __nhLastSize?: number }).__nhLastPrompt = user;
      (window as unknown as { __nhLastSize?: number }).__nhLastSize = msgs.reduce((n, m) => n + m.content.length, 0);
      const num = (re: RegExp) => user.split('\n\n').find((b) => re.test(b))?.match(/^\[S(\d+)\]/)?.[1] ?? '1';
      const text = user.includes('Довод игрока')
        ? `**Вы правы.** Бронежилет — спецсредство, а не оружие [S${num(/спец средствам относятся/)}]. Правило о скрытом ношении говорит только об оружии [S${num(/скрытое ношение оружия/)}]. Для спецсредств запрещён только государственный образец [S${num(/государственного образца разрешены/)}]. Значит, гражданский бронежилет носить открыто можно, и ст. 12.8 ч. 2 здесь не применяется. Мой прошлый ответ был неверным.\nИТОГ: {"agree": true, "refs": "ст. 4 ч. 1, ст. 11, ст. 15 ч. 1", "note": "Бронежилет — спецсредство, а не оружие (ст. 4 ч. 1 закона об обороте оружия). Правило о скрытом ношении (ст. 15 ч. 1) касается только оружия; гражданский бронежилет носить открыто не запрещено, запрещён только государственный образец (ст. 11, ст. 12.8.1 УК).", "keywords": ["бронежилет", "бронник", "броня"]}`
        : user.includes('[N1]') && /бронежилет|бронник/i.test(user)
          ? `**Нет, не так.** Гражданский бронежилет носить открыто можно [N1]: это спецсредство, а не оружие [S${num(/спец средствам относятся/)}], а запрет есть только для государственного образца [S${num(/государственного образца разрешены/)}].`
          : /бронежилет|бронник/i.test(user)
            ? `**Нет**, с лицензией разрешено только скрытое ношение (S${num(/скрытое ношение оружия/)}). За нарушение — 4 года или штраф $10 000–30 000.`
            : /8\.3/.test(user)
              ? `Пункт 8.3 есть в двух документах. В **Общих правилах** он запрещает мешать работе администрации — например, лезть в разбирательство или флудить в репорт [S${num(/помеху работе администрации/)}]. В **Правилах криминальных организаций** — запрещает союзы с другими бандами ради покраски граффити [S${num(/покраски граффити/)}]. О каком из них речь?`
              : /До 35 слов/.test(user)
                ? '**Это DM.** «Косо посмотрел» — не весомая IC-причина для убийства [S1], администрация даст **JAIL до 120 минут**.'
                : 'Нет, это **DM** (убийство без причины) [S1]. Он выстрелил первым без RP-ситуации и без весомой причины, а то, что вы «косо посмотрели», причиной не считается. Администрация даст **JAIL до 120 минут** [S1].';
      // Модель сначала рассуждает (видно только команде), потом пишет ответ
      const reasoning = /8\.3/.test(user)
        ? 'Игрок спрашивает, что значит 8.3, без документа. Во фрагментах два пункта 8.3: в Общих правилах (помеха работе администрации) и в Правилах криминальных организаций (союзы для граффити). Из вопроса не понять, какой нужен — коротко объясню оба и спрошу.'
        : 'Ситуация: игрок А убил игрока Б. Был ли повод? Игрок пишет, что Б «косо посмотрел» — это не угроза жизни и не RP-ситуация. Пункт про DM [S1] требует весомую IC-причину; её нет. Исключений про самооборону здесь не видно. Вердикт: DM, нарушил тот, кто стрелял.';
      for (const part of reasoning.match(/.{1,16}/gs) ?? []) {
        mockEmit('ai-think', { id: args!.id, delta: part });
        await new Promise((r) => setTimeout(r, 25));
      }
      for (const part of text.match(/.{1,12}/gs) ?? []) {
        mockEmit('ai-chunk', { id: args!.id, delta: part });
        await new Promise((r) => setTimeout(r, 40));
      }
      return { text, model: 'openai/gpt-oss-120b', reasoning };
    }
    case 'pins_get': {
      if (params.has('sample') && !mockState.pins.length) mockState.pins = SAMPLE_PINS.map((p) => ({ ...p }));
      // ?calcpins — окна калькулятора первого профиля (для проверки слоя окон в браузере)
      if (params.has('calcpins') && !mockState.pins.some((p) => p.kind === 'calc')) {
        try {
          const prof = (JSON.parse(localStorage.getItem('nova.calc') ?? '[]') as { id: string }[])[0];
          if (prof) for (const type of ['sum', 'list', 'chart', 'cats'] as const) {
            const calc = { type, prof: prof.id, period: 'week' as const };
            mockState.pins.push({ key: `calc:${type}:${prof.id}:week`, docId: '', nodeId: '', badge: type, doc: 'Калькулятор', law: false, text: '', punish: [], kind: 'calc', calc, w: Number(params.get('calcw')) || undefined, font: Number(params.get('calcfont')) || undefined, bg: 100, x: 40, y: 40 + 175 * ['sum', 'list', 'chart', 'cats'].indexOf(type) });
          }
        } catch { /* нет данных */ }
      }
      if (params.has('editor')) mockState.editor = true;
      const enabled = !!mockState.settings.devMode || params.has('sample');
      return { enabled, pins: mockState.pins, editorKey: mockState.settings.editorHotkey ?? 'Alt+Shift+Z', editor: mockState.editor,
        hint: { show: true, right: mockState.hint?.right ?? 16, bottom: mockState.hint?.bottom ?? 56, moved: !!mockState.hint, hotkey: mockState.settings.hotkey } };
    }
    case 'hint_move': {
      mockState.hint = (args!.pos as HintSpot | null) ?? null;
      return;
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
    case 'game_menu_layout': { try { return JSON.parse(localStorage.getItem('mock.gamemenu') ?? 'null'); } catch { return null; } }
    case 'game_menu_save': { try { localStorage.setItem('mock.gamemenu', JSON.stringify(args?.layout)); } catch { /* браузер без хранилища */ } return; }
    case 'game_menu_hide': return;
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
