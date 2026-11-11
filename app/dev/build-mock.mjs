// Собирает dev/mock-db.json для разработки в браузере из выгрузки ветки data (или data-preview):
//   git archive origin/data | tar -x -C /tmp/data && node dev/build-mock.mjs /tmp/data
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('Укажите папку с выгрузкой ветки data');
const read = (p) => JSON.parse(readFileSync(join(dir, p), 'utf8'));
const manifest = read('manifest.json');
const docs = manifest.documents.map((d) => read(d.path));
const index = read('changelog/index.json');
const changelogs = (index.versions ?? index).slice(0, 5).map((v) => read(`changelog/${v.dbVersion ?? v}.json`));
writeFileSync(new URL('./mock-db.json', import.meta.url), JSON.stringify({ manifest, docs, changelogs }));
console.log(`документов: ${docs.length}, журналов изменений: ${changelogs.length}`);
