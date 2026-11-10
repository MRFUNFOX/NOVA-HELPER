/**
 * Длительности анимаций. Если в Windows включено «Показывать анимацию в Windows: выкл»
 * (prefers-reduced-motion), все переходы мгновенные.
 */
import { cubicOut } from 'svelte/easing';

const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const ms = (n: number) => (reduced ? 0 : n);
export const ease = cubicOut;

/** Появление экрана: короткий подъём на 8px */
export const enter = { y: 8, duration: ms(220), easing: cubicOut };
/** Раскрытие/сворачивание блоков */
export const fold = { duration: ms(220), easing: cubicOut };
