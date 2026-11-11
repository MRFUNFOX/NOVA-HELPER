/**
 * Связь интерфейса с программой (Rust). В браузере при разработке (`npm run dev`)
 * вместо программы работает заглушка с настоящей базой из dev/mock-db.json —
 * так интерфейс можно смотреть и проверять без сборки .exe.
 */
import type { RuleDocument } from '@shared/types';
import type { Changelog, Manifest } from '@shared/format';

export type HintMode = 'always' | 'timed' | 'off';

export interface Settings {
  hotkey: string;
  hint: HintMode;
  closeToTray: boolean;
  firstRunDone: boolean;
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
  finishFirstRun: () => invoke<void>('finish_first_run'),
  hide: () => invoke<void>('hide_main'),
  minimize: () => invoke<void>('minimize_main'),
  quit: () => invoke<void>('quit_app'),
  version: () => invoke<string>('app_version'),

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
  async openUrl(url: string) {
    if (!isTauri) { window.open(url, '_blank', 'noopener'); return; }
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  },
  async autostart(enable?: boolean): Promise<boolean> {
    if (!isTauri) return mockState.autostart = enable ?? mockState.autostart;
    const a = await import('@tauri-apps/plugin-autostart');
    if (enable === true) await a.enable();
    if (enable === false) await a.disable();
    return a.isEnabled();
  },
  async on(event: string, cb: (payload: unknown) => void): Promise<() => void> {
    if (!isTauri) return () => {};
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
const mockState = {
  settings: { hotkey: 'Alt+Q', hint: 'always', closeToTray: true, firstRunDone: false, window: null } as Settings,
  autostart: true,
  dbLoaded: false,
};

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
      return { ...mockState.settings };
    case 'save_settings':
      mockState.settings = { ...(args!.new as Settings), hotkey: mockState.settings.hotkey };
      return { ...mockState.settings };
    case 'set_hotkey':
      if (args!.hotkey === 'Alt+Tab') throw 'Сочетание «Alt+Tab» не подходит или уже занято другой программой. Выберите другое.';
      mockState.settings.hotkey = args!.hotkey as string;
      return { ...mockState.settings };
    case 'finish_first_run':
      mockState.settings.firstRunDone = true;
      return;
    case 'app_version':
      return '0.3.1';
    default:
      return;
  }
}
