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
  - `/prompt-templates`: per-project template editor for `issue` / `feature` / `other` prompt variants
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
- `PromptTemplate` stores per-project template text keyed by `CategoryKind` (`issue` / `feature` / `other`)
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
- Fixed issue form UX regression on `/issues/:itemId/edit`:
  - existing saved screenshots are now displayed in the Details tab (not only newly queued files)
  - added preview/remove actions for saved screenshots directly from the edit/manage form
- Migration/env impact: none.
- Verification performed:
  - `npm run build -w apps/web`
  - `npm run test`
- Updated `/prompts` copy behavior to match issue prompt tab:
  - `Copy Prompt` now attempts rich clipboard copy with prompt text + saved images
  - falls back to prompt text copy/manual fallback when image clipboard is unsupported or blocked
- Migration/env impact: none.
- Verification performed:
  - `npm run build -w apps/web`
- Refined prompt copy fallback notices on issue prompt tab and `/prompts` page:
  - plural `images` message is now shown only when the item has multiple images
  - singular `image` message is shown for one-image fallback failures
- Migration/env impact: none.
- Verification performed:
  - `npm run build -w apps/web`
- Added issue management prompt tab on `/issues/:itemId/edit`:
  - tab switch inside item form (`Details` / `Prompt`)
  - prompt tab supports copy prompt text and download item prompt bundle
  - prompt tab supports copy prompt + saved images to clipboard for direct paste into AI input fields (browser support dependent)
- Migration/env impact: none.
- Verification performed:
  - `npm run build -w apps/web`
- Updated issue prompt tab copy behavior:
  - primary `Copy Prompt` action now attempts to copy prompt text + saved images in one click
  - added fallback to copy prompt text only when browser/app clipboard does not support image writes
  - secondary action now explicitly copies prompt text only
- Migration/env impact: none.
- Verification performed:
  - `npm run build -w apps/web`
- Added project-scoped prompt template editor and API support:
  - new route `/prompt-templates` in web shell
  - API endpoints `GET/PUT /api/prompt-templates/:projectId`
  - prompt generation/export now resolve template kind from item category (`issue` / `feature` / `other`) and render placeholders
- Added Prisma migration `20260223235000_add_prompt_templates` with `PromptTemplate` table (`projectId + kind` unique).
- Migration/env impact:
  - DB migration required: `20260223235000_add_prompt_templates`
  - no new environment variables
- Verification performed:
  - `npm run test`
  - `npm run build`
  - `set -a; source .env; set +a; npm run prisma:migrate:deploy`
  - login/auth API smoke checks
- Normalized `docker-compose.yml` environment placeholders to sane defaults (`:-`) for smoother local/Coolify setup.
- Added Postgres variables to `.env.example` (`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST_PORT`).
- Expanded Coolify deployment docs in `README.md` with explicit Postgres + API env variable examples and required persistent volume mounts.
- Added baseline PWA support to web app (manifest, service worker registration, offline-ready shell).
- Generated and committed branded icon/image assets (`favicon`, apple icon, PWA icons, manifest screenshots).
- Added reusable asset generator script `npm run assets:generate -w apps/web`.
- Integrated brand mark logo into auth and app shell UI.
- Fixed Coolify web image build failure by changing `docker/Dockerfile.web` final stage copy to `COPY --from=0 ...` (stage-index copy) to avoid alias resolution issues after Coolify Dockerfile mutation for build secrets.
- Upgraded issue screenshot uploader UX to advanced queue flow:
  - drag-and-drop zone
  - clipboard image paste support on web (`Ctrl/Cmd+V` on focused dropzone)
  - pending image previews with per-image remove/clear queue
  - full-screen image preview modal for both queued and saved images
- Split CRUD UX into dedicated list/form routes:
  - Projects: `/projects`, `/projects/new`, `/projects/:projectId/edit`
  - Categories: `/categories`, `/categories/new`, `/categories/:categoryId/edit`
  - Issues: `/issues`, `/issues/new`, `/issues/:itemId/edit`
- Mobile shell UX updates:
  - removed topbar `Manage Projects` button (project selection handled by dropdown)
  - removed redundant topbar `Current: <project>` pill (active project shown only via selector)
  - replaced bottom mobile nav with burger-triggered sidebar drawer
  - reduced mobile dead space by removing bottom-nav route host spacing
- Action controls now use iconography:
  - icon-only quick actions for preview/remove/edit/delete
  - icon-leading labels for primary/secondary action buttons across pages
- Updated item validation rules:
  - `title` and `description` are now optional on create/update (empty values allowed)
  - `type`, `category`, `status`, and `priority` are enforced as required in the web form
- Improved validation UX on `/issues`:
  - invalid required fields are highlighted with inline red error messages
  - API validation errors are mapped into the global status alert with clearer messages
- Hardened API category validation for item create/update to return field-level validation issues when category IDs are invalid.
- Migration/env impact: none.
- Verification performed:
  - `npm run test`
  - `npm run build`
- Hardened Docker build reliability for Coolify by updating `docker/Dockerfile.api` and `docker/Dockerfile.web`:
  - include `package-lock.json` in the dependency layer
  - force devDependency install during image build with `npm install --include=dev` so workspace build tools are available even when Coolify injects build-time env/ARG values
- Migration/env impact: none.
- Verification performed:
  - `DOCKER_BUILDKIT=1 docker build --no-cache -f docker/Dockerfile.web -t aam-web-test:fix .`
  - `DOCKER_BUILDKIT=1 docker build --no-cache -f docker/Dockerfile.api -t aam-api-test:fix .`
- Fixed local upload path resolution to be stable regardless of process CWD:
  - API now resolves relative `UPLOAD_DIR` from `apps/api` root, not `process.cwd()`
  - backward compatibility added for legacy `UPLOAD_DIR=./apps/api/uploads` values
- Production safety default added in API env handling:
  - if `NODE_ENV=production` and `UPLOAD_DIR` is not set, API now defaults to `/data/uploads`
- Updated local env defaults:
  - `.env.example` now uses `UPLOAD_DIR=./uploads` (maps to `apps/api/uploads`)
  - README clarifies local upload path and keeps production/Coolify requirement as `UPLOAD_DIR=/data/uploads`
- Manual local data fix performed:
  - copied existing files from legacy `apps/api/apps/api/uploads` into `apps/api/uploads`
  - removed legacy nested directory after copy
- Migration/env impact:
  - no DB migration
  - recommended env value is `UPLOAD_DIR=./uploads` for local development
- Verification performed:
  - `npm run test`
  - `npm run build`
- Added a dedicated public landing experience before authentication:
  - new hero section with branded visuals, animated screenshot mockups, and feature chips
  - action-focused CTA buttons for `Sign In` and `Create Account` that jump users to the auth form
- Removed admin-credential hint text from login/register UI.
- Improved unauthenticated page responsiveness:
  - two-column desktop hero + auth card layout
  - stacked mobile layout with tighter spacing and touch-friendly CTA sizing
- Migration/env impact: none.
- Verification performed:
  - `npm run build -w apps/web`
