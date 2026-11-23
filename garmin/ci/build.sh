#!/bin/bash
# Budowanie i test aplikacji VeloIQ Edge. Uruchamiane w kontenerze z Connect IQ SDK (patrz
# .github/workflows/garmin.yml) albo lokalnie: SDK w PATH (monkeyc, monkeydo, simulator).
#
#   ci/build.sh            – wszystkie urządzenia + testy
#   DEVICES="edge1030" ci/build.sh
#   SKIP_TESTS=1 ci/build.sh
set -u
cd "$(dirname "$0")/.."

DEVICES="${DEVICES:-edge1030 edge1030plus edge1030bontrager edge830 edge530 edge1040 edge840 edge540 edge1050}"
TEST_DEVICE="${TEST_DEVICE:-edge1030}"
TYPECHECK="${TYPECHECK:-1}"
mkdir -p bin
rm -f bin/*.prg bin/*.log bin/report.md bin/annotations.txt

KEY="${DEVELOPER_KEY:-}"
if [ -z "$KEY" ]; then
  openssl genrsa -out /tmp/veloiq_key.pem 4096 2>/dev/null
  openssl pkcs8 -topk8 -inform PEM -outform DER -in /tmp/veloiq_key.pem -out /tmp/veloiq_key.der -nocrypt
  KEY=/tmp/veloiq_key.der
fi

fail=0
{
  echo "## VeloIQ Edge – build"
  echo
  echo "| Urządzenie | Wynik | Rozmiar .prg |"
  echo "|---|---|---|"
} > bin/report.md

# GitHub: błędy kompilatora jako adnotacje (czytelne przez API check-runs)
annotate() { # $1 = log, $2 = device
  grep -E "^(ERROR|WARNING)" "$1" | head -40 | while IFS= read -r line; do
    lvl=warning; case "$line" in ERROR*) lvl=error;; esac
    file=$(echo "$line" | sed -nE 's/^[A-Z]+: [^:]+: ([^:]+):([0-9]+)(,[0-9]+)?: .*/\1/p')
    ln=$(echo "$line" | sed -nE 's/^[A-Z]+: [^:]+: ([^:]+):([0-9]+)(,[0-9]+)?: .*/\2/p')
    msg=$(echo "$line" | cut -c1-900)
    if [ -n "$file" ] && [ -n "$ln" ]; then
      echo "::$lvl file=garmin/${file#/app/},line=$ln,title=$2::$msg"
    else
      echo "::$lvl title=$2::$msg"
    fi
  done >> bin/annotations.txt
}

first=1
for d in $DEVICES; do
  log="bin/build-$d.log"
  if monkeyc -f monkey.jungle -d "$d" -o "bin/veloiq-$d.prg" -y "$KEY" -w -l "$TYPECHECK" > "$log" 2>&1 && [ -f "bin/veloiq-$d.prg" ]; then
    size=$(stat -c %s "bin/veloiq-$d.prg")
    echo "| $d | ✅ | $size B |" >> bin/report.md
    echo "BUILD OK   $d ($size B)"
  else
    echo "| $d | ❌ | – |" >> bin/report.md
    echo "BUILD FAIL $d"
    fail=1
  fi
  # pełny log tylko dla pierwszego urządzenia (pozostałe mają te same ostrzeżenia) albo przy błędzie
  if [ $first = 1 ] || ! [ -f "bin/veloiq-$d.prg" ]; then
    echo "----- $log"; cat "$log"; annotate "$log" "$d"
  fi
  first=0
done

if [ "${SKIP_TESTS:-0}" != "1" ]; then
  echo
  echo "== Testy jednostkowe ($TEST_DEVICE, symulator) =="
  tlog=bin/test-build.log
  if monkeyc -f monkey.jungle -d "$TEST_DEVICE" -o bin/veloiq-test.prg -y "$KEY" -t -w -l "$TYPECHECK" > "$tlog" 2>&1 && [ -f bin/veloiq-test.prg ]; then
    export DISPLAY=:1
    Xvfb "$DISPLAY" -screen 0 1280x1024x24 > /dev/null 2>&1 &
    xvfb_pid=$!
    simulator > /dev/null 2>&1 &
    sim_pid=$!
    sleep 6
    timeout "${TEST_TIMEOUT:-900}" monkeydo bin/veloiq-test.prg "$TEST_DEVICE" -t > bin/test-result.log 2>&1
    cat bin/test-result.log
    kill $sim_pid $xvfb_pid 2>/dev/null
    last=$(grep -E "^(PASSED|FAILED)" bin/test-result.log | tail -1)
    {
      echo
      echo "### Testy ($TEST_DEVICE)"
      echo
      echo '```'
      grep -E "^(PASS|FAIL|ERROR|PASSED|FAILED|Ran|Executing|DEBUG)" bin/test-result.log | tail -80
      echo '```'
    } >> bin/report.md
    case "$last" in
      PASSED*) echo "TESTS OK";;
      *) echo "TESTS FAIL"; fail=1
         grep -E "^(FAIL|ERROR)" bin/test-result.log | head -30 | while IFS= read -r l; do echo "::error title=test::$(echo "$l" | cut -c1-900)"; done >> bin/annotations.txt
         # szczegóły nieudanych asercji (linie DEBUG tuż przed FAIL)
         grep -E "^DEBUG" bin/test-result.log | tail -15 | while IFS= read -r l; do echo "::notice title=test-debug::$(echo "$l" | cut -c1-900)"; done >> bin/annotations.txt;;
    esac
  else
    cat "$tlog"; annotate "$tlog" "test"
    echo "TEST BUILD FAIL"; fail=1
    echo "### Testy: kompilacja nieudana" >> bin/report.md
  fi
  rm -f bin/veloiq-test.prg
fi

exit $fail
