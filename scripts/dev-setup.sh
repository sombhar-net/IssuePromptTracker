#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

# Load root environment values (DATABASE_URL, etc.) for Prisma commands.
set -a
# shellcheck disable=SC1091
source .env
set +a

if ! docker info >/dev/null 2>&1; then
  cat <<'MSG'
Docker daemon is not reachable from this shell.

Run one of these and try again:
1) sudo usermod -aG docker "$USER" && newgrp docker
2) or run this script with elevated access in your own shell.
MSG
  exit 1
fi

echo "Installing npm dependencies..."
npm install

echo "Starting Postgres container..."
docker compose up -d postgres

echo "Generating Prisma client..."
npm run prisma:generate

echo "Applying migrations..."
npm run prisma:migrate:deploy

echo "Development environment is ready."
echo "Run: npm run dev"
