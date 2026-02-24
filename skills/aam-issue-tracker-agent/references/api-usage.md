# AAM Issue Tracker Agent API Usage

## Table of Contents
1. Environment Contract
2. Bootstrap and Scope Validation
3. Polling the Activity Feed
4. Loading Issue Details and Prompt Context
5. Resolving Work
6. Failure Handling
7. Minimal End-to-End Example

## 1. Environment Contract

Set these environment variables before running an automation loop:

- `AAM_API_BASE_URL`: API base path, including `/api` (example: `https://tracker.example.com/api`)
- `AAM_API_KEY`: project-scoped agent key (`aam_pk_<keyId>_<secret>`)

Optional controls:

- `AAM_PROJECT_ID`: expected project id; fail fast if API key belongs to a different project
- `AAM_POLL_SECONDS`: poll interval in seconds (example: `30`)
- `AAM_TIMEOUT_MS`: request timeout in milliseconds (example: `15000`)

Header contract for authenticated calls:

```http
X-AAM-API-Key: <AAM_API_KEY>
```

## 2. Bootstrap and Scope Validation

Always call project context first:

```bash
curl -sS \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  "$AAM_API_BASE_URL/agent/v1/project"
```

Use this response to:

- validate project scope (`project.id`)
- cache category metadata
- cache prompt template placeholders/defaults

If `AAM_PROJECT_ID` is set, compare it with `project.id` and stop on mismatch.

## 3. Polling the Activity Feed

Primary feed:

```bash
curl -sS \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  "$AAM_API_BASE_URL/agent/v1/activities?limit=50"
```

Recommended polling rules:

- page with `cursor` until `page.nextCursor` is null
- process activities newest-to-oldest as delivered
- treat activity `id` as idempotency key
- persist `nextCursor` only after successful page processing

Recovery fallback for cursor corruption:

```bash
curl -sS \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  "$AAM_API_BASE_URL/agent/v1/activities?limit=50&since=2026-02-24T00:00:00.000Z"
```

## 4. Loading Issue Details and Prompt Context

Fetch only for activities you need to act on:

```bash
curl -sS \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  "$AAM_API_BASE_URL/agent/v1/issues/$ISSUE_ID?includePrompts=true"
```

Prompt-only fetch:

```bash
curl -sS \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  "$AAM_API_BASE_URL/agent/v1/issues/$ISSUE_ID/prompt"
```

Image fetch:

```bash
curl -sS -L \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  -o "issue-$ISSUE_ID-image.png" \
  "$AAM_API_BASE_URL/agent/v1/issues/$ISSUE_ID/images/$IMAGE_ID"
```

## 5. Resolving Work

Resolution contract:

- endpoint: `POST /agent/v1/issues/:id/resolve`
- body:
  - `status`: `resolved` or `archived`
  - `resolutionNote`: non-empty technical summary

Example:

```bash
curl -sS -X POST \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"resolved","resolutionNote":"Updated validation flow, added test coverage, and verified build/test pass."}' \
  "$AAM_API_BASE_URL/agent/v1/issues/$ISSUE_ID/resolve"
```

## 6. Failure Handling

Retry policy:

- retry: `5xx`, connection errors, timeouts
- do not blind-retry: `400`, `401`, `403`, `404`
- use exponential backoff with jitter

Operational safety:

- never log full API keys
- log `project.id`, `issue.id`, and `activity.id` for traceability
- keep `resolutionNote` concise and implementation-specific

## 7. Minimal End-to-End Example

```bash
# 1) verify scope
curl -sS -H "X-AAM-API-Key: $AAM_API_KEY" "$AAM_API_BASE_URL/agent/v1/project"

# 2) poll one page
curl -sS -H "X-AAM-API-Key: $AAM_API_KEY" "$AAM_API_BASE_URL/agent/v1/activities?limit=50"

# 3) inspect issue
curl -sS -H "X-AAM-API-Key: $AAM_API_KEY" "$AAM_API_BASE_URL/agent/v1/issues/$ISSUE_ID?includePrompts=true"

# 4) mark complete
curl -sS -X POST \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"resolved","resolutionNote":"Implemented fix and validated behavior."}' \
  "$AAM_API_BASE_URL/agent/v1/issues/$ISSUE_ID/resolve"
```
