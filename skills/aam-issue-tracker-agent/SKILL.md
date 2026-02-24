---
name: aam-issue-tracker-agent
description: Use Issue Prompt Tracker agent APIs to build or operate coding automations with API-key auth, including project bootstrap, activity polling, issue detail fetches, prompt generation, image retrieval, and resolution updates. Trigger this skill when tasks involve /api/agent/v1 endpoints, X-AAM-API-Key usage, cursor-based polling, or creating/updating an agent skill integration for this tracker.
---

# AAM Issue Tracker Agent

## Quick Start

1. Export required environment variables:
   - `AAM_API_BASE_URL` (example: `https://tracker.example.com/api`)
   - `AAM_API_KEY` (format: `aam_pk_<keyId>_<secret>`)
2. Optionally export:
   - `AAM_PROJECT_ID` (expected project guardrail)
   - `AAM_POLL_SECONDS` (default suggestion: `30`)
   - `AAM_TIMEOUT_MS` (default suggestion: `15000`)
3. Run bootstrap script to validate auth and project scope:
   - `scripts/bootstrap.sh`

## Core Workflow

1. Bootstrap context
   - Call `GET /agent/v1/project` first.
   - Verify `project.id` matches `AAM_PROJECT_ID` when set.
2. Poll changes
   - Call `GET /agent/v1/activities?limit=50&cursor=<cursor>`.
   - Persist `nextCursor` after successful page processing.
3. Fetch issue details only when needed
   - Use `GET /agent/v1/issues/:id` and `GET /agent/v1/issues/:id/activities`.
   - Fetch images via `GET /agent/v1/issues/:issueId/images/:imageId`.
4. Generate prompt context when required
   - Use `GET /agent/v1/issues/:id/prompt`.
5. Complete work and update tracker
   - Use `POST /agent/v1/issues/:id/resolve` with `status` (`resolved` or `archived`) and a non-empty `resolutionNote`.

## Reliability Rules

- Treat activity `id` as idempotency key.
- Retry only transient failures (`5xx`, network timeouts) with exponential backoff.
- Do not retry validation/auth failures (`4xx`) blindly.
- Reset polling with `since=<ISO timestamp>` if server returns `Invalid cursor`.
- Never log full API keys.

## Command Patterns

Use these minimal request patterns:

```bash
curl -sS -H "X-AAM-API-Key: $AAM_API_KEY" "$AAM_API_BASE_URL/agent/v1/project"
curl -sS -H "X-AAM-API-Key: $AAM_API_KEY" "$AAM_API_BASE_URL/agent/v1/activities?limit=50"
curl -sS -H "X-AAM-API-Key: $AAM_API_KEY" "$AAM_API_BASE_URL/agent/v1/issues/$ISSUE_ID"
curl -sS -X POST \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"resolved","resolutionNote":"Implemented fix and validated behavior."}' \
  "$AAM_API_BASE_URL/agent/v1/issues/$ISSUE_ID/resolve"
```

## References

- Read `references/api-usage.md` for endpoint-level details and response expectations.
- Use `scripts/bootstrap.sh` for environment and connectivity checks before running automation loops.
