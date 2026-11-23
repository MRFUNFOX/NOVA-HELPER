"""Готовит обученный голос для NOVA HELPER (движок sherpa-onnx):
метаданные в model.onnx и tokens.txt из таблицы звуков Piper. Потом — архив tts-<имя>.zip.
    python3 pack.py <папка с model.onnx и model.onnx.json> <имя голоса>
"""
import json, sys, zipfile, pathlib
import onnx

out = pathlib.Path(sys.argv[1]); name = sys.argv[2]
cfg = json.loads((out / 'model.onnx.json').read_text())
m = onnx.load(str(out / 'model.onnx'))
meta = {'model_type': 'vits', 'comment': 'piper', 'language': 'Russian', 'voice': 'ru', 'has_espeak': '1',
        'n_speakers': str(cfg.get('num_speakers', 1)), 'sample_rate': str(cfg['audio']['sample_rate'])}
del m.metadata_props[:]
for k, v in meta.items():
    p = m.metadata_props.add(); p.key = k; p.value = v
onnx.save(m, str(out / 'model.onnx'))
with open(out / 'tokens.txt', 'w', encoding='utf-8') as f:
    for sym, ids in cfg['phoneme_id_map'].items():
        f.write(f'{sym} {ids[0]}\n')
print('inputs', [i.name for i in m.graph.input], 'meta', meta)
print('inference', cfg.get('inference'))
(out / 'MODEL_CARD.txt').write_text(
    f'Голос «{name}» для NOVA HELPER. Дообучен на записях владельца NOVA HELPER (с его согласия)\n'
    'от открытой модели Piper ru_RU denis medium (CC0, rhasspy/piper-checkpoints).\n')
z = out / f'tts-{name}.zip'
with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
    for f in ['model.onnx', 'model.onnx.json', 'tokens.txt', 'MODEL_CARD.txt']:
        zf.write(out / f, f)
print(z, z.stat().st_size // 1024 // 1024, 'МБ')
