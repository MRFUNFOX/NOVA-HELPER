// Какую версию программы предложить. Чистые функции — их проверяют тесты.
//  • «Последний» выпуск GitHub — как раньше (так выпускает Claude).
//  • channel.json в репозитории nova-release — версия, которую команда открыла кнопкой «Опубликовать для всех».
//  • Команде (Dev/Admin) ещё и тестовые сборки (pre-release), которые игрокам пока не пришли.

export const APP_REPO = 'MRFUNFOX/NOVA-HELPER';
export const CHANNEL_REPO = 'MRFUNFOX/nova-release';

/** Обязательное обновление: в описании выпуска отдельной строкой «[обязательное]» (игроки её не видят — окно показывает первый абзац) */
export const isMandatory = (notes?: string | null) => /\[обязательное\]/i.test(notes ?? '');

/** Сравнение версий: 0.7.13 > 0.7.9 */
export function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Адрес обновления конкретной версии */
export const updateUrl = (v: string) => `https://github.com/${APP_REPO}/releases/download/v${v.replace(/^v/, '')}/latest.json`;

export type Source = 'latest' | 'channel' | 'test';
export interface Target { version: string; source: Source; mandatory: boolean }

/**
 * Выбрать, что предложить: самую новую версию из найденных, если она новее установленной.
 * При одинаковой версии открытая игрокам важнее тестовой. Обязательность — из описания выпуска
 * или из отметки «обязательное» при публикации кнопкой.
 */
export function pickTarget(
  current: string,
  latest: { version: string; notes?: string | null } | null,
  channel: { version: string; mandatory: boolean } | null,
  test: { version: string } | null,
): Target | null {
  const c: Target[] = [];
  if (latest) c.push({ version: latest.version, source: 'latest', mandatory: isMandatory(latest.notes) });
  if (channel) c.push({ version: channel.version, source: 'channel', mandatory: !!channel.mandatory });
  if (test) c.push({ version: test.version, source: 'test', mandatory: false });
  const fresh = c.filter((t) => cmpVersion(t.version, current) > 0);
  if (!fresh.length) return null;
  const top = fresh.reduce((a, b) => (cmpVersion(b.version, a.version) > 0 ? b : a));
  const same = fresh.filter((t) => cmpVersion(t.version, top.version) === 0);
  const open = same.filter((t) => t.source !== 'test');
  if (!open.length) return top;
  return { version: top.version, source: open.some((t) => t.source === 'latest') ? 'latest' : 'channel', mandatory: open.some((t) => t.mandatory) };
}
