// Какую версию программы предложить. Чистые функции — их проверяют тесты.
//  • Всем — «последний» выпуск GitHub (выпускает Claude по просьбе владельца).
//  • Команде (Dev/Admin) ещё и тестовые сборки (pre-release), которые игрокам не приходят.

export const APP_REPO = 'MRFUNFOX/NOVA-HELPER';

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

export type Source = 'latest' | 'test';
export interface Target { version: string; source: Source; mandatory: boolean }

/**
 * Выбрать, что предложить: самую новую версию из найденных, если она новее установленной.
 * При одинаковой версии обычный выпуск важнее тестового. Обязательность — из описания выпуска.
 */
export function pickTarget(
  current: string,
  latest: { version: string; notes?: string | null } | null,
  test: { version: string } | null,
): Target | null {
  const fresh: Target[] = [];
  if (latest && cmpVersion(latest.version, current) > 0) fresh.push({ version: latest.version, source: 'latest', mandatory: isMandatory(latest.notes) });
  if (test && cmpVersion(test.version, current) > 0) fresh.push({ version: test.version, source: 'test', mandatory: false });
  if (!fresh.length) return null;
  return fresh.reduce((a, b) => (cmpVersion(b.version, a.version) > 0 ? b : a));
}
