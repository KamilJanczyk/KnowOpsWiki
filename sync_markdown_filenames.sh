#!/usr/bin/env bash
set -e

# KnowOps Wiki - Automatyczny starter synchronizacji nazw Markdown z H1
# Wykrywa czy Node.js jest dostepny lokalnie, czy zadanie nalezy wykonac wewnatrz kontenera knowops-api.

if command -v node >/dev/null 2>&1; then
  node scripts/sync_markdown_filenames.mjs "$@"
elif command -v docker >/dev/null 2>&1; then
  docker compose exec -T api node scripts/sync_markdown_filenames.mjs "$@"
else
  echo "Blad: W srodowisku nie odnaleziono ani polecenia 'node', ani 'docker'." >&2
  echo "Zainstaluj Node.js lokalnie (sudo apt install nodejs) lub uruchom srodowisko Docker (docker compose up -d)." >&2
  exit 1
fi
