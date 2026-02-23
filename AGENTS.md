# AGENTS.md

## Purpose
This document is the living handoff for engineers/agents working in this repository.
Update it whenever architecture, routes, data models, auth behavior, deployment, or developer commands change.

## Product Snapshot
Issue Prompt Tracker is a responsive web app + API for capturing project-specific issues/features with screenshots and converting them into AI-ready prompt bundles (`yaml + images`).

## Current Architecture
- Frontend: `apps/web` (React + Vite)
- Backend: `apps/api` (Fastify + Prisma)
- Shared package: `packages/shared` (prompt format/build helpers)
- Database: Postgres (Docker compose)
- Storage: filesystem uploads (configured via `UPLOAD_DIR`)

## Frontend Structure (Web)
- Auth screen: login/register
- Authenticated shell with routed pages:
  - `/issues`: issue/feature CRUD, image attachments, edit/delete
  - `/projects`: project CRUD + active project selection
  - `/categories`: global category CRUD
  - `/prompts`: filter items, copy prompt, download item/project prompt bundles
- Mobile-first navigation:
  - desktop sidebar nav
  - bottom tab nav on small screens
- PWA-enabled build (manifest + service worker via `vite-plugin-pwa`)
- Branding assets served from `apps/web/public/branding`

## Backend Auth + Access Control
- JWT auth endpoints:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `GET /api/auth/me`
- Roles:
  - `USER`: sees/manages own projects/items
  - `ADMIN`: sees/manages all projects/items
- Admin bootstrap on API startup using env:
  - `ADMIN_EMAIL`
  - `ADMIN_PASSWORD`
  - `ADMIN_NAME`
- JWT env:
  - `JWT_SECRET`
  - `JWT_EXPIRES_IN`

## Data Model Notes
- `User` model added with `role`
- `Project.ownerId` and `Item.ownerId` enforce per-user scope
- Existing records are backfilled to admin owner on startup if owner is null

## Dev Commands
- Install: `npm install`
- Setup dev environment: `npm run setup:dev`
- Start app: `npm run dev`
- Run tests: `npm run test`
- Build all: `npm run build`
- Stop local DB: `npm run stop:devdb`

## Local Environment Notes
- Local Postgres host port: `55432`
- `.env` must include auth vars + DB URL

## Update Policy (Important)
When making changes, append an entry to **Change Log** below with:
1. Date (YYYY-MM-DD)
2. What changed
3. Any migration or env var impact
4. Any manual verification steps performed

## Change Log
### 2026-02-23
- Implemented auth layer (JWT, register/login/me) and role-based access (`ADMIN`/`USER`).
- Added user ownership to projects/items and migration `20260223211000_add_auth`.
- Added admin bootstrap and legacy ownership backfill on API startup.
- Fixed frontend JSON parse failure by setting `Content-Type: application/json` only for JSON-body requests.
- Rebuilt frontend UX into responsive routed pages (`/projects`, `/categories`, `/issues`, `/prompts`) with dedicated CRUD experiences and mobile navigation.
- Added Vite dev proxy for `/api` and `/uploads` to API server.
- Updated local DB host mapping to port `55432` to avoid conflicts.
- Verification performed:
  - `npm run test`
  - `npm run build`
  - login/auth API smoke checks
- Normalized `docker-compose.yml` environment placeholders to sane defaults (`:-`) for smoother local/Coolify setup.
- Added Postgres variables to `.env.example` (`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST_PORT`).
- Expanded Coolify deployment docs in `README.md` with explicit Postgres + API env variable examples and required persistent volume mounts.
- Added baseline PWA support to web app (manifest, service worker registration, offline-ready shell).
- Generated and committed branded icon/image assets (`favicon`, apple icon, PWA icons, manifest screenshots).
- Added reusable asset generator script `npm run assets:generate -w apps/web`.
- Integrated brand mark logo into auth and app shell UI.
- Fixed Coolify web image build failure by changing `docker/Dockerfile.web` final stage copy to `COPY --from=0 ...` (stage-index copy) to avoid alias resolution issues after Coolify Dockerfile mutation for build secrets.
