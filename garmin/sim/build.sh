#!/bin/bash
# Symulator w przeglądarce: ekran Edge 1030 napędzany silnikiem referencyjnym (lib/ride/flex-engine.ts).
#   garmin/sim/build.sh [plik-wyjściowy]     (domyślnie garmin/sim/dist/veloiq-edge-sim.html)
set -eu
cd "$(dirname "$0")/../.."
OUT="${1:-garmin/sim/dist/veloiq-edge-sim.html}"
mkdir -p "$(dirname "$OUT")"
npx -y esbuild garmin/sim/engine-entry.ts --bundle --format=iife --global-name=VQ --target=es2019 --minify-whitespace --minify-syntax --outfile=/tmp/vq-engine.js --log-level=warning
python3 - "$OUT" <<'PY'
import sys
tpl = open('garmin/sim/sim.template.html', encoding='utf-8').read()
eng = open('/tmp/vq-engine.js', encoding='utf-8').read()
assert '/*ENGINE*/' in tpl and '</script>' not in eng
open(sys.argv[1], 'w', encoding='utf-8').write(tpl.replace('/*ENGINE*/', eng))
print('zapisano', sys.argv[1], len(tpl) + len(eng), 'B')
PY
