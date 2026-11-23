# Собирает студию записи в один файл: подставляет список фраз в шаблон.
import json, pathlib
here = pathlib.Path(__file__).parent
phrases = json.loads((here / 'phrases.json').read_text())
data = json.dumps([[p['id'], p['show'], p['say']] for p in phrases], ensure_ascii=False).replace('<', '\\u003c')
html = (here / 'studio.template.html').read_text().replace('/*PHRASES*/[]', data)
out = here / 'NOVA-HELPER-studio.html'
out.write_text(html)
print(out, len(html) // 1024, 'КБ,', len(phrases), 'фраз')
