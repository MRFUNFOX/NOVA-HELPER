import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildIndex, rank } from '../src/lib/search';

const db = JSON.parse(readFileSync(new URL('../dev/mock-db.json', import.meta.url), 'utf8'));
const index = buildIndex(db.docs);

it('ситуация с ограблением дальнобойщика: с выбранными документами находятся правила ограблений', () => {
  const boost = new Set<string>(db.docs.filter((d: { title: string }) => /похищений и ограблений|общие правила проекта/i.test(d.title)).map((d: { id: string }) => d.id));
  const q = 'Человек работал дальнобойщиком, но в 2 часа ночи его остановила машина, в которой был всего один человек. Остановка была с целью ограбления дальнобойщика, а дальнобойщик вышел из машины и растулил грабителя.';
  const r = rank(index, `${q} ограбление убийство DM самооборона IC причина`, 16, undefined, boost);
  for (const e of r) console.log(`${e.node.number} ${e.doc.title.slice(0, 30)} | ${e.node.text.slice(0, 70).replace(/\n/g, ' ')}`);
  expect(r.some((e) => /ограблени/i.test(e.doc.title))).toBe(true);
  expect(r.some((e) => /DeathMatch/.test(e.node.text))).toBe(true);
});
