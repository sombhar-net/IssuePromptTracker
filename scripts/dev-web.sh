#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_PORT="${PORT:-4000}"
MAX_WAIT_SECONDS="${DEV_API_WAIT_SECONDS:-30}"

echo "Waiting for API at 127.0.0.1:${API_PORT}..."
for ((i=1; i<=MAX_WAIT_SECONDS; i++)); do
  if (echo >"/dev/tcp/127.0.0.1/${API_PORT}") >/dev/null 2>&1; then
    exec npm run dev -w apps/web
  fi
  sleep 1
done

echo "API did not become ready at 127.0.0.1:${API_PORT} within ${MAX_WAIT_SECONDS}s." >&2
echo "Check API logs and Postgres, then retry \`npm run dev\`." >&2
exit 1
