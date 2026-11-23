#!/usr/bin/env bash
# Дообучение голоса Piper на записях из студии NOVA HELPER.
#   train.sh <папка с metadata.csv и wavs/> <куда класть результат> <эпох> [gpu|cpu] [чекпоинт для продолжения]
# Основа — открытая модель «Денис» (CC0) из rhasspy/piper-checkpoints.
set -euo pipefail
DATA=$1; OUT=$2; EPOCHS=$3; ACC=${4:-gpu}; RESUME=${5:-}
WORK=${WORK:-$HOME/piper-work}
mkdir -p "$WORK" "$OUT"
cd "$WORK"

if [ ! -d piper1-gpl ]; then
  git clone -q https://github.com/OHF-Voice/piper1-gpl.git
fi
cd piper1-gpl
if [ ! -f .installed ]; then
  python3 -m pip install -q scikit-build cmake ninja
  python3 -m pip install -q -e '.[train]'
  # Расширение выравнивания (cython) — как в инструкции Piper
  if [ -x ./build_monotonic_align.sh ]; then ./build_monotonic_align.sh; fi
  python3 setup.py build_ext --inplace
  touch .installed
fi

BASE="$WORK/denis.ckpt"
if [ ! -f "$BASE" ]; then
  curl -fsSL -o "$BASE" "https://huggingface.co/datasets/rhasspy/piper-checkpoints/resolve/main/ru/ru_RU/denis/medium/epoch%3D1999-step%3D92000.ckpt"
fi

START=(--model.warmstart_ckpt "$BASE")
if [ -n "$RESUME" ]; then START=(--ckpt_path "$RESUME"); fi

python3 -m piper.train fit \
  --data.voice_name "nova" \
  --data.csv_path "$DATA/metadata.csv" \
  --data.audio_dir "$DATA/wavs" \
  --model.sample_rate 22050 \
  --data.espeak_voice "ru" \
  --data.cache_dir "$WORK/cache" \
  --data.config_path "$OUT/model.onnx.json" \
  --data.batch_size "${BATCH:-16}" \
  --data.num_test_examples 4 \
  --model.mos_metric none \
  --trainer.accelerator "$ACC" \
  --trainer.devices 1 \
  --trainer.max_epochs "$EPOCHS" \
  --trainer.default_root_dir "$OUT/train" \
  "${START[@]}"

CKPT=$(ls -t "$OUT"/train/lightning_logs/version_*/checkpoints/last.ckpt 2>/dev/null | head -1 || true)
[ -z "$CKPT" ] && CKPT=$(ls -t "$OUT"/train/lightning_logs/version_*/checkpoints/*.ckpt | head -1)
echo "Экспорт из $CKPT"
python3 -m piper.train.export_onnx --checkpoint "$CKPT" --output-file "$OUT/model.onnx"
ls -la "$OUT"
