# Issue Prompt Tracker

A mobile-friendly and web-ready app to capture issues/features with screenshots, then convert them into AI-ready prompts.

## What it does
- Tracks multiple projects
- Uses global editable categories (issue/feature/other)
- Includes authentication with roles (`USER`, `ADMIN`)
- Works as an installable PWA (desktop/mobile home screen)
- Provides dedicated responsive pages:
  - `Projects`: list page + separate create/update pages
  - `Categories`: list page + separate create/update pages
  - `Issues`: list page + separate create/update pages with multi-screenshot attachments
  - `Prompts`: filter, copy prompt, and download YAML + images bundles
  - `Prompt Templates`: edit project prompt templates for `issue` / `feature` / `other`
- Exports prompt bundles as zip files:
  - Single item: `prompt.yaml` + `images/*`
  - Whole project: `prompts.yaml` + `images/*`

## Stack
- Frontend: React + Vite (responsive for mobile web + desktop)
- PWA: `vite-plugin-pwa` (manifest + service worker)
- Backend: Fastify + Prisma
- Database: PostgreSQL
- File storage: local persistent volume for screenshots
- Deployment: Docker Compose (Coolify-ready)

## Branding assets
- Generated files live in `apps/web/public/branding`.
- Regenerate icon/logo/screenshot assets:
```bash
npm run assets:generate -w apps/web
```

## Local setup
If Docker daemon access is blocked for your user, run:
```bash
sudo usermod -aG docker "$USER" && newgrp docker
```

Then use the one-command setup:
```bash
npm run setup:dev
```

Default admin credentials (from `.env` / `.env.example`):
- Email: `admin@example.com`
- Password: `Admin123!`

Or run manual setup:

1. Install dependencies:
```bash
npm install
```

2. Copy environment file:
```bash
cp .env.example .env
```
Local uploads should use `UPLOAD_DIR=./uploads` (stored under `apps/api/uploads`).

3. Start Postgres (Docker) and run migrations:
```bash
docker compose up -d postgres
npm run prisma:generate
npm run prisma:migrate:deploy
```
Default local DB host port is `55432` to avoid conflicts with existing local Postgres.

4. Start API + web:
```bash
npm run dev
```

5. Open app:
- Web: `http://localhost:5173`
- API health: `http://localhost:4000/healthz`

To stop local Postgres container:
```bash
npm run stop:devdb
```

## Docker Compose run
```bash
docker compose up --build
```
Then open `http://localhost:3000`.

## Coolify auto-deploy (git push -> deploy)
1. Push this repo to GitHub/GitLab.
2. In Coolify, create a new **Docker Compose** application from this repo.
3. Set branch (for example `main`) and enable auto-deploy on push.
4. In Coolify app settings, open **Environment Variables** and set:
- Postgres service vars:
  - `POSTGRES_DB=aamtracker`
  - `POSTGRES_USER=app`
  - `POSTGRES_PASSWORD=<strong-password>`
- API vars:
  - `DATABASE_URL=postgresql://app:<strong-password>@postgres:5432/aamtracker?schema=public`
  - `UPLOAD_DIR=/data/uploads` (must stay absolute for persistent volume mounts)
  - `MAX_UPLOAD_MB=8`
  - `AGENT_INLINE_IMAGE_MAX_BYTES=262144`
  - `CORS_ORIGIN=*` (or your domain)
  - `JWT_SECRET=<long-random-secret>`
  - `JWT_EXPIRES_IN=7d`
  - `ADMIN_EMAIL=admin@example.com`
  - `ADMIN_PASSWORD=<strong-admin-password>`
  - `ADMIN_NAME=Admin`
5. Attach persistent volumes:
- `postgres` service -> `/var/lib/postgresql/data`
- `api` service -> `/data/uploads`
6. Deploy once manually; next pushes auto-deploy.

Important:
- Inside Coolify/docker network, DB host must be `postgres` (the compose service name), not `localhost`.
- If you change `POSTGRES_DB`, `POSTGRES_USER`, or `POSTGRES_PASSWORD`, update `DATABASE_URL` to match exactly.

## API endpoints (high-level)
- `/api/auth/register`
- `/api/auth/login`
- `/api/auth/me`
- `/api/projects` CRUD
- `/api/categories` CRUD
- `/api/items` CRUD + filters
- `/api/items/:id/images` upload/delete/reorder
- `/api/prompts/item/:id`
- `/api/prompts/project/:projectId`
- `/api/prompt-templates/:projectId` (GET/PUT)
- `/api/projects/:projectId/agent-keys` (POST/GET)
- `/api/projects/:projectId/agent-keys/:keyId` (DELETE revoke)
- `/api/agent/v1/project`
- `/api/agent/v1/issues`
- `/api/agent/v1/issues/:id`
- `/api/agent/v1/issues/:id/prompt`
- `/api/agent/v1/issues/:id/resolve`
- `/api/agent/v1/issues/:issueId/images/:imageId`
- `/api/exports/item/:id.zip`
- `/api/exports/project/:projectId.zip`
- `/uploads/*` static screenshots

## Notes
- Non-admin users only see their own projects/items
- Admin users can see and manage all projects/items across users
- Prompt templates are editable per project for `issue` / `feature` / `other` with default fallback
- Agent API keys are project-scoped machine credentials for `/api/agent/v1` and use header `X-AAM-API-Key`.
