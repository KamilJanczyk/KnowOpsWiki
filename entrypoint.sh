#!/bin/sh
set -e

# Automatyczna korekta uprawnień katalogów roboczych i wolumenów (Docker/Linux)
mkdir -p /app/backups /app/docs /app/data /app/public/images
chown -R node:node /app/backups /app/data /app/public/images 2>/dev/null || true
chmod 775 /app/backups 2>/dev/null || true

# Bezpieczne uruchomienie procesu aplikacji jako nieuprzywilejowany użytkownik node
exec su-exec node "$@"
