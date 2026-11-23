#!/bin/bash
# Zrzuty ekranu aplikacji z symulatora Connect IQ: build demonstracyjny (monkey.demo.jungle) odtwarza
# scenariusz jazdy i wypisuje "SHOT <nazwa>" – wtedy robimy zrzut okna symulatora.
#   DEVICE=edge1030 ci/screens.sh       → bin/shots/<urządzenie>-<nazwa>.png
set -u
cd "$(dirname "$0")/.."
DEVICE="${DEVICE:-edge1030}"
mkdir -p bin/shots
if ! command -v import > /dev/null; then
  apt-get update -qq > /dev/null 2>&1 && apt-get install -y -qq imagemagick > /dev/null 2>&1
fi
KEY="${DEVELOPER_KEY:-/tmp/veloiq_key.der}"
if [ ! -f "$KEY" ]; then
  openssl genrsa -out /tmp/veloiq_key.pem 4096 2>/dev/null
  openssl pkcs8 -topk8 -inform PEM -outform DER -in /tmp/veloiq_key.pem -out "$KEY" -nocrypt
fi
if ! monkeyc -f monkey.demo.jungle -d "$DEVICE" -o bin/demo.prg -y "$KEY" -w -l 1 > bin/demo-build.log 2>&1; then
  grep -E "^ERROR" bin/demo-build.log | head -20
  echo "DEMO BUILD FAIL"; exit 1
fi
export DISPLAY=:2
Xvfb "$DISPLAY" -screen 0 1100x900x24 > /dev/null 2>&1 &
xvfb_pid=$!
sleep 1
simulator > /dev/null 2>&1 &
sim_pid=$!
sleep 6
monkeydo bin/demo.prg "$DEVICE" > bin/demo-run.log 2>&1 &
run_pid=$!
seen=0
for i in $(seq 1 440); do
  sleep 0.5
  n=$(grep -c "^SHOT " bin/demo-run.log 2>/dev/null)
  n=${n:-0}
  if [ "$n" -gt "$seen" ]; then
    name=$(grep "^SHOT " bin/demo-run.log | sed -n "$((seen + 1))p" | cut -d' ' -f2)
    seen=$((seen + 1))
    [ "$name" = "END" ] && break
    sleep 1.3    # ekran odświeża się raz na sekundę
    import -window root "bin/shots/$DEVICE-$name.png" 2>/dev/null
    echo "shot $name"
  fi
  if grep -qE "^(Error|Unhandled|Watchdog)" bin/demo-run.log; then break; fi
done
kill $run_pid $sim_pid $xvfb_pid 2>/dev/null
grep -vE "^SHOT " bin/demo-run.log | head -40
rm -f bin/demo.prg
# podgląd w logu (mały JPEG w base64) – do zdalnej weryfikacji bez pobierania artefaktów
if [ "${SHOT_LOG:-1}" = "1" ]; then
  for f in bin/shots/$DEVICE-*.png; do
    [ -f "$f" ] || continue
    if [ -n "${SHOT_LOG_FILTER:-}" ] && ! echo "$f" | grep -qE "$SHOT_LOG_FILTER"; then continue; fi
    convert "$f" -trim +repage ${SHOT_CROP:+-crop $SHOT_CROP +repage} -quality "${SHOT_Q:-55}" /tmp/shot.jpg 2>/dev/null
    echo "SHOTB64 $(basename "$f" .png) $(base64 -w0 /tmp/shot.jpg)"
  done
fi
exit 0
