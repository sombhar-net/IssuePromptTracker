# Agentic Coding Guide for Issue Prompt Tracker

This guide is for building coding agents or automation workflows that consume the Issue Prompt Tracker APIs.

## What This API Is Good At
- Tracking issues/features with status, priority, tags, and screenshots.
- Returning AI-ready prompt text and YAML records.
- Recording user/agent activity for auditability.
- Supporting polling-based integrations through cursor pagination.

## Authentication Models
There are two auth models.

## 1) User JWT (human app auth)
Use these for browser-backed workflows and user-owned operations.
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

Send bearer token:
```http
Authorization: Bearer <jwt>
```

## 2) Agent API key (machine auth)
Use these for automations and external agents.

Agent keys are project-scoped and created by a user:
- `POST /api/projects/:projectId/agent-keys`
- `GET /api/projects/:projectId/agent-keys`
- `DELETE /api/projects/:projectId/agent-keys/:keyId`

Use the returned token as:
```http
X-AAM-API-Key: aam_pk_<keyId>_<secret>
```

## Typical Agent Flow
1. Human creates a project-specific agent key.
2. Agent reads `GET /api/agent/v1/project` to load categories and templates.
3. Agent polls `GET /api/agent/v1/activities` for incremental changes.
4. Agent loads pre-action context with `GET /api/agent/v1/issues/:id/work-context`.
5. Agent downloads and reviews all listed images via `GET /api/agent/v1/issues/:issueId/images/:imageId`.
6. Agent submits implementation details with `POST /api/agent/v1/issues/:id/resolve`, which moves status to `in_review`.
7. Human reviewer approves/rejects with `POST /api/items/:id/review` (or equivalent web UI action).
8. Human audits timeline in the web app or via activities endpoints.

## Polling Strategy (Recommended)
Use cursor-based polling instead of repeatedly fetching full issue lists.

- Poll interval: every 15s to 60s (default recommendation: 30s).
- Persist `nextCursor` after successful page processing.
- Deduplicate by immutable activity `id`.
- If cursor is lost, bootstrap with `since=<ISO timestamp>`.

## Activity Types
Current activity event types:
- `ITEM_CREATED`
- `ITEM_UPDATED`
- `IMAGE_UPLOADED`
- `IMAGE_DELETED`
- `IMAGES_REORDERED`
- `STATUS_CHANGE`
- `RESOLUTION_NOTE`
- `REVIEW_SUBMITTED`
- `REVIEW_APPROVED`
- `REVIEW_REJECTED`

## Error Handling Rules
- `401`: auth missing/invalid.
- `404`: resource not found or out of scope.
- `400`: invalid query/body or malformed cursor.
- `409`: conflict (for example deleting project with linked items).

Retry guidance:
- Retry 5xx with exponential backoff and jitter.
- Do not blindly retry 4xx.
- For cursor errors (`400 Invalid cursor`), reset with `since`.

## Safe Agent Behaviors
- Treat prompt text (`issue.prompt.text`) as source-of-truth task framing for "fix this/that" requests.
- Do not implement or resolve until prompt and all issue images are loaded/reviewed.
- Always include `chatSessionId`, `resolutionNote`, `codeChanges`, and command-output evidence when submitting for review.
- Do not attempt to finalize issues as `resolved`/`archived` via agent keys; human reviewers own final closure.
- Treat `archived` as terminal unless a human explicitly reopens.
- Avoid status thrash; only write status on real transitions.
- Use issue/image URLs from API responses instead of constructing paths manually.
