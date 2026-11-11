import type { RuleNode } from '@shared/types';

/** Лежит ли узел `id` внутри `n` (или это он сам) */
export function contains(n: RuleNode, id?: string): boolean {
  return !!id && (n.id === id || n.children.some((c) => contains(c, id)));
}

/** Примерная высота блока до отрисовки: ~60 px на пункт */
export function estimate(nodes: RuleNode[], collapsed = false): number {
  if (collapsed) return 70;
  let count = 0;
  const walk = (ns: RuleNode[]) => ns.forEach((n) => { count++; walk(n.children); });
  walk(nodes);
  return Math.min(80 + count * 60, 20000);
}
