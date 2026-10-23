#!/usr/bin/env bash
# Jedno polecenie: wypchnij gałąź → PR → (Ty: Merge) → czekam na Vercel → projekt iOS → Xcode.
#   bash mobile/ship.sh
set -euo pipefail
cd "$(dirname "$0")/.."
BR=$(git branch --show-current)
say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
say "Wypycham $BR na GitHuba"
git push -u origin "$BR"
URL="https://github.com/adrianstrychar/veloiq/compare/main...$BR?expand=1"
say "Otwieram PR w przeglądarce – kliknij „Create pull request”, a gdy build Vercela będzie zielony – „Merge”."
open "$URL" || echo "$URL"
HEAD=$(git rev-parse HEAD)
say "Czekam na merge do main…"
until git fetch -q origin main && git merge-base --is-ancestor "$HEAD" origin/main; do sleep 20; done
say "Merge jest. Czekam, aż Vercel wdroży produkcję…"
until curl -fsS -o /dev/null "https://veloiq-three.vercel.app/voice/enzo/manifest.json"; do sleep 15; done
say "Produkcja gotowa. Buduję projekt iOS (głos Enzo, adres Vercela)…"
bash mobile/setup-ios.sh
open ios/App/App.xcodeproj
printf '\n\033[1;32m✓ Teraz w Xcode: Product → Clean Build Folder, potem ▶ Run (iPhone podłączony).\033[0m\n'
