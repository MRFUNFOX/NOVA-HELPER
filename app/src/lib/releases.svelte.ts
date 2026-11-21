// Выпуски программы для команды (Dev и Admin): какая версия открыта игрокам, какая ждёт проверки,
// кнопка «Опубликовать для всех». Без своего сервера — только GitHub:
//  • сборки лежат в Releases репозитория NOVA-HELPER (тестовые — с пометкой pre-release, игрокам не приходят);
//  • какая версия открыта игрокам — файл channel.json в маленьком репозитории nova-release;
//  • менять этот файл может только тот, у кого есть «ключ публикации» (токен GitHub только на nova-release).
//    Ключ хранится на компьютере команды, в программе у игроков его нет.
import { APP_REPO, CHANNEL_REPO, cmpVersion, isMandatory } from './update';

export { APP_REPO, CHANNEL_REPO, cmpVersion };
const CHANNEL_PATH = 'channel.json';
const KEY_STORE = 'nh-release-key';

export interface Build {
  version: string;
  /** Когда собрана */
  at: string;
  /** «Что нового» — первый абзац описания выпуска */
  notes: string;
  /** Тестовая (pre-release): игрокам приходит только после публикации */
  test: boolean;
  mandatory: boolean;
}
export interface Published { version: string; at: string; by: string; mandatory: boolean }
export interface Channel { public: Published | null; history: Published[] }

/** Первый абзац описания выпуска без служебных строк */
export function whatsNew(body: string): string {
  return body.replace(/\[обязательное\]/gi, '').trim().split(/\n\s*\n/)[0]?.replace(/^Скачайте[\s\S]*/, '').trim() ?? '';
}

/** Какая версия сейчас у игроков: опубликованная кнопкой или последняя обычная (не тестовая) — что новее */
export function liveVersion(builds: Build[], ch: Channel | null): string {
  const full = builds.filter((b) => !b.test).map((b) => b.version);
  const all = [...full, ...(ch?.public ? [ch.public.version] : [])];
  return all.sort(cmpVersion).pop() ?? '';
}

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

class Releases {
  builds = $state<Build[] | null>(null);
  channel = $state<Channel | null>(null);
  error = $state('');
  key = $state(readKey());
  private sha = '';

  get live() { return this.builds ? liveVersion(this.builds, this.channel) : ''; }
  /** Новейшая сборка, которой ещё нет у игроков */
  get pending(): Build | undefined {
    const live = this.live;
    return (this.builds ?? []).filter((b) => cmpVersion(b.version, live) > 0).sort((a, b) => cmpVersion(a.version, b.version)).pop();
  }

  async load() {
    this.error = '';
    try {
      const [rels, ch] = await Promise.all([
        fetch(`https://api.github.com/repos/${APP_REPO}/releases?per_page=20`, { cache: 'no-store' }),
        fetch(`https://api.github.com/repos/${CHANNEL_REPO}/contents/${CHANNEL_PATH}`, { cache: 'no-store' }),
      ]);
      if (!rels.ok) throw new Error(rels.status === 403 ? 'GitHub временно ограничил запросы — попробуйте через минуту.' : `GitHub ответил ${rels.status}.`);
      const list = (await rels.json()) as { tag_name: string; draft: boolean; prerelease: boolean; body: string | null; published_at: string | null; created_at: string }[];
      this.builds = list.filter((r) => !r.draft).map((r) => ({
        version: r.tag_name.replace(/^v/, ''), at: r.published_at ?? r.created_at, notes: whatsNew(r.body ?? ''), test: r.prerelease, mandatory: isMandatory(r.body ?? ''),
      }));
      if (ch.ok) {
        const j = (await ch.json()) as { content: string; sha: string };
        this.sha = j.sha;
        const c = JSON.parse(unb64(j.content)) as Partial<Channel>;
        this.channel = { public: c.public ?? null, history: Array.isArray(c.history) ? c.history : [] };
      } else {
        this.sha = '';
        this.channel = { public: null, history: [] };
      }
    } catch (e) {
      this.error = e instanceof TypeError ? 'Нет связи с GitHub. Проверьте интернет.' : String((e as Error).message ?? e);
    }
  }

  setKey(k: string) {
    this.key = k.trim();
    try { if (this.key) localStorage.setItem(KEY_STORE, this.key); else localStorage.removeItem(KEY_STORE); } catch { /* без памяти */ }
  }

  /** Открыть версию игрокам: записать её в channel.json (нужен ключ публикации) */
  async publish(version: string, mandatory: boolean, by: string) {
    if (!this.key) throw new Error('nokey');
    await this.load();
    const entry: Published = { version, at: new Date().toISOString(), by, mandatory };
    const next: Channel = { public: entry, history: [entry, ...(this.channel?.history ?? [])].slice(0, 30) };
    const r = await fetch(`https://api.github.com/repos/${CHANNEL_REPO}/contents/${CHANNEL_PATH}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${this.key}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Игрокам — ${version}${mandatory ? ' (обязательное)' : ''} · ${by}`, content: b64(JSON.stringify(next, null, 2) + '\n'), ...(this.sha ? { sha: this.sha } : {}) }),
    });
    if (r.status === 401 || r.status === 403) throw new Error('badkey');
    if (r.status === 409) throw new Error('conflict');
    if (!r.ok) throw new Error(`GitHub ответил ${r.status}`);
    this.channel = next;
    this.sha = ((await r.json()) as { content: { sha: string } }).content.sha;
  }
}

function readKey() { try { return localStorage.getItem(KEY_STORE) ?? ''; } catch { return ''; } }

export const releases = new Releases();
