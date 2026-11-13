/**
 * Функции, которые ещё не показываем игрокам. Пока флаг `false`, функция видна только
 * в режиме разработчика (Настройки → 7 раз нажать на версию программы → ввести код).
 * Чтобы открыть функцию всем — поставить `true` и выпустить обновление.
 */
export const PUBLIC = {
  /** ИИ-помощник (Groq или Z.ai) с личным ключом игрока */
  ai: true,
  /** Закрепление пунктов поверх игры, редактор окон и прозрачный фон программы */
  pins: true,
};

/** SHA-256 кода разработчика. Сам код в программе не хранится. */
export const DEV_CODE_SHA256 = 'df5c7595ca604a1dd828d8b19ce2b0328c9152b13d5799386ef999b1ac58880a';

export async function checkDevCode(code: string): Promise<boolean> {
  const data = new TextEncoder().encode(code.trim().toUpperCase());
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === DEV_CODE_SHA256;
}
