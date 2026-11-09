/**
 * Запись сочетания клавиш в формате плагина global-shortcut («Alt+Q», «Ctrl+Shift+F», «F8»).
 * Возвращает либо сочетание, либо понятную причину, почему оно не подходит.
 */
export type Recorded = { ok: true; hotkey: string } | { ok: false; reason: string } | { ok: null };

const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight']);
const NAMED: Record<string, string> = {
  Space: 'Space', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Delete: 'Delete',
  Backquote: 'Backquote', Minus: 'Minus', Equal: 'Equal', BracketLeft: 'BracketLeft', BracketRight: 'BracketRight',
  Semicolon: 'Semicolon', Quote: 'Quote', Comma: 'Comma', Period: 'Period', Slash: 'Slash', Backslash: 'Backslash',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Pause: 'Pause', ScrollLock: 'ScrollLock',
};
const BLOCKED = new Set(['Alt+Tab', 'Alt+F4', 'Ctrl+Alt+Delete', 'Alt+Space', 'Ctrl+Shift+Escape', 'Alt+Escape', 'Ctrl+Escape']);

function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  if (/^Numpad\d$/.test(code)) return code;
  return NAMED[code] ?? null;
}

export function recordHotkey(e: KeyboardEvent): Recorded {
  if (MODIFIER_CODES.has(e.code)) return { ok: null }; // ждём основную клавишу
  if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) return { ok: false, reason: 'Запись отменена.' };
  const key = keyName(e.code);
  if (!key) return { ok: false, reason: 'Эту клавишу нельзя назначить. Выберите букву, цифру или F1–F12.' };
  if (e.metaKey) return { ok: false, reason: 'Сочетания с клавишей Windows заняты системой.' };
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean) as string[];
  const isFn = /^F\d+$/.test(key) || key === 'Pause' || key === 'ScrollLock' || key === 'Insert';
  if (!mods.length && !isFn) {
    return { ok: false, reason: 'Одна буква или цифра сработает и в игре. Добавьте Alt, Ctrl или Shift — или выберите клавишу F1–F12.' };
  }
  if (mods.length === 1 && mods[0] === 'Shift' && !isFn) {
    return { ok: false, reason: 'Shift + буква — это просто заглавная буква в чате игры. Используйте Alt или Ctrl.' };
  }
  const hotkey = [...mods, key].join('+');
  if (BLOCKED.has(hotkey)) return { ok: false, reason: `«${pretty(hotkey)}» занято Windows. Выберите другое сочетание.` };
  return { ok: true, hotkey };
}

/** «Ctrl+Shift+Q» → ["Ctrl", "Shift", "Q"] для отрисовки клавиш */
export function keys(hotkey: string): string[] {
  return hotkey.split('+').map((k) => (k === 'Space' ? 'Пробел' : k === 'Backquote' ? 'Ё' : k.replace(/^Numpad/, 'Num ')));
}

export function pretty(hotkey: string): string {
  return keys(hotkey).join(' + ');
}
