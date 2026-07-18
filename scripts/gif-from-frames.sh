#!/usr/bin/env bash
# ================================================================
# Validação visual em MOVIMENTO (gap 17): monta GIF a partir dos
# frames PNG que os scripts de captura já produzem (capture-city,
# capture-skeletons, etc.). Palette em 2 passos = GIF nítido e leve.
#
# Uso: scripts/gif-from-frames.sh <dir-com-PNGs> <padrao> <saida.gif> [fps]
# Ex.:  scripts/gif-from-frames.sh /tmp/skel-shots-final 'attack-%02d.png' attack.gif 8
# ================================================================
set -euo pipefail
DIR="${1:?dir com PNGs}"; PAT="${2:?padrao ex attack-%02d.png}"; OUT="${3:?saida.gif}"; FPS="${4:-8}"
PALETTE="$(mktemp --suffix=.png)"
trap 'rm -f "$PALETTE"' EXIT
ffmpeg -y -loglevel error -framerate "$FPS" -i "$DIR/$PAT" \
  -vf "scale=640:-1:flags=lanczos,palettegen" "$PALETTE"
ffmpeg -y -loglevel error -framerate "$FPS" -i "$DIR/$PAT" -i "$PALETTE" \
  -lavfi "scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse" "$OUT"
echo "OK: $OUT ($(du -h "$OUT" | cut -f1))"
