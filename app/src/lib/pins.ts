/**
 * Закреплённые пункты поверх игры: что храним о каждом окне и как собираем его из пункта правил.
 * Текст пункта собирает главное окно, раскладку (место, ширину, фон, шрифт, замок) — слой окон.
 */
import type { RuleNode } from '@shared/types';
import type { Entry } from './search';
import { nodeBadge } from './search';

export interface Pin {
  /** Уникальный ключ окна: документ + пункт */
  key: string;
  docId: string;
  nodeId: string;
  /** «4.1» или «ст. 6.2 ч. 1» */
  badge: string;
  /** Короткое название документа */
  doc: string;
  law: boolean;
  /** Текст пункта; подпункты — отдельными строками */
  text: string;
  punish: string[];
  // ── раскладка ──
  x?: number;
  y?: number;
  /** Ширина, пиксели */
  w?: number;
  /** Непрозрачность фона, 0–100 */
  bg?: number;
  /** Размер шрифта, пиксели */
  font?: number;
  locked?: boolean;
}

export const PIN_LIMIT = 8;
export const PIN_W = { min: 220, max: 640, default: 330 };
export const PIN_FONT = { min: 11, max: 20, default: 14 };
export const PIN_BG_DEFAULT = 55;

function badgeOf(e: Entry): string {
  const law = e.doc.scope === 'server';
  return e.article ? `ст. ${e.article} ч. ${e.node.number}` : nodeBadge(e.node, law) || '§';
}

/** Подпункты одной строкой каждый: «а) …», «4.1.1 …» */
function childLines(n: RuleNode, law: boolean): string[] {
  return n.children
    .filter((c) => c.text.trim())
    .map((c) => {
      const b = nodeBadge(c, law);
      return b ? `${b} ${c.text.trim()}` : c.text.trim();
    });
}

/** Пункты, которые можно закрепить: с текстом, не целые разделы и главы */
export function pinnable(n: RuleNode): boolean {
  return !!n.text.trim() && n.kind !== 'section' && n.kind !== 'chapter' && !(n.kind === 'heading' && n.children.length > 0);
}

/** `doc` — короткое название документа (shortTitle из state) */
export function pinFrom(e: Entry, doc: string): Pin {
  const law = e.doc.scope === 'server';
  const text = [e.node.text.trim(), ...childLines(e.node, law)].filter(Boolean).join('\n');
  return {
    key: `${e.doc.id}#${e.node.id}`,
    docId: e.doc.id,
    nodeId: e.node.id,
    badge: badgeOf(e),
    doc,
    law,
    text,
    punish: e.node.punishments.map((p) => p.raw),
  };
}

/** Тексты закреплённых пунктов поменялись? (раскладку не сравниваем) */
export function sameContent(a: Pin, b: Pin) {
  return a.badge === b.badge && a.doc === b.doc && a.text === b.text && a.punish.join('|') === b.punish.join('|');
}
