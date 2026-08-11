#!/usr/bin/env bash
# Restart the built app on :3000, reliably.
#
# Three audit runs in one session were wasted on a STALE `next start` still
# holding the port: the new one dies with EADDRINUSE, the old one keeps serving
# the PREVIOUS build, and the audits then measure code that is not on disk any
# more. It reads as "the fix did not work" and it is not true.
#
# `pkill -f next-server` does not solve it — the pattern matches the shell
# running pkill, so it kills its own caller (exit 144) and leaves the server up.
# Kill by whoever holds the PORT; that is the thing that actually conflicts.
set -euo pipefail
PORT="${PORT:-3000}"

pids=$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u || true)
[ -z "$pids" ] && pids=$(fuser -n tcp "$PORT" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true)
if [ -n "$pids" ]; then
  echo "→ killing $(echo "$pids" | tr '\n' ' ')on :$PORT"
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
  sleep 2
fi

npm run start > /tmp/snm-app.log 2>&1 &
for i in $(seq 1 90); do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/login"; then echo "→ app up after ${i}s"; exit 0; fi
  sleep 1
done
echo "app did not start within 90s"; tail -20 /tmp/snm-app.log; exit 1
