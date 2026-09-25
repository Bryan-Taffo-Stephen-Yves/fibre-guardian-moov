#!/bin/sh
# Fibre Guardian : lance l'application (Mac : double-clic sur lancer.command ; Linux : ./lancer.sh).
cd "$(dirname "$0")" || exit 1
PORT=8000
URL="http://localhost:$PORT"
echo "Fibre Guardian démarre sur $URL. Ctrl+C pour arrêter."
( sleep 1; if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi ) >/dev/null 2>&1 &
if command -v node >/dev/null 2>&1; then PORT=$PORT exec node server/server.mjs
elif command -v python3 >/dev/null 2>&1; then exec python3 -m http.server "$PORT"
else echo "Installez Node.js (https://nodejs.org) ou Python, puis relancez."; exit 1
fi
