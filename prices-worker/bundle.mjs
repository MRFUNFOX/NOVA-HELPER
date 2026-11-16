// Собирает один файл для вставки в редактор Cloudflare: parse.js + history.js + worker.js без import
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const strip = (s) => s.replace(/^import .*$/gm, '').replace(/^export (?!default)/gm, '');
const parts = ['parse.js', 'history.js', 'worker.js'].map((f) => `// ---- ${f} ----\n` + strip(readFileSync(`src/${f}`, 'utf8')));
mkdirSync('dist', { recursive: true });
writeFileSync('dist/nova-prices-worker.js', '// NOVA HELPER — сборщик цен скупщиков. Один файл для Cloudflare Worker.\n' + parts.join('\n'));
