# CLAUDE.md

Wytyczne dla asystentów AI (Claude Code) pracujących w tym repozytorium.

## Zasady raportowania

- **Nigdy nie raportuj wyników testów, których nie wykonałeś.** Jeśli środowisko nie
  pozwala na żywy test (brak API key, sesji, dostępu do DB) — powiedz to WPROST przed
  raportem i oznacz wyniki jako **"trace projektowy"**, nie jako wykonane testy.

- **Rozróżniaj zawsze dwa poziomy pewności** i nazywaj je w każdym raporcie z weryfikacji:
  - **"zweryfikowane żywym uruchomieniem"** — realny przebieg kodu (endpoint, skrypt, test).
  - **"zweryfikowane analizą kodu"** — wnioskowanie ze statycznej lektury/typów, bez uruchomienia.

- **Finalna bramka funkcjonalna dla zmian w czacie AI:** manualny test na **Vercel preview
  przez właściciela** przed merge.
