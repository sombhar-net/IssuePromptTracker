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
- `AAM_INSECURE_TLS`: set to `1` only in local/dev environments with self-signed certs

Header contract for authenticated calls:

```http
X-AAM-API-Key: <AAM_API_KEY>
```

Use these helper functions in shell examples to keep API keys out process arguments:

```bash
base_url="${AAM_API_BASE_URL%/}"

aam_get() {
  local url="$1"
  curl -sS --fail --config - <<EOF
url = "${url}"
header = "X-AAM-API-Key: ${AAM_API_KEY}"
header = "Accept: application/json"
EOF
}

aam_post_json() {
  local url="$1"
  local payload="$2"
  curl -sS --fail --config - --data "${payload}" <<EOF
url = "${url}"
request = "POST"
header = "X-AAM-API-Key: ${AAM_API_KEY}"
header = "Content-Type: application/json"
header = "Accept: application/json"
EOF
}
```

## 2. Bootstrap and Scope Validation

Always call project context first:

```bash
aam_get "${base_url}/agent/v1/project"
```

Use this response to:

- validate project scope (`project.id`)
- cache category metadata
- cache prompt template placeholders/defaults

If `AAM_PROJECT_ID` is set, compare it with `project.id` and stop on mismatch.

## 3. Polling the Activity Feed

Primary feed:

```bash
aam_get "${base_url}/agent/v1/activities?limit=50"
```

Recommended polling rules:

- page with `cursor` until `page.nextCursor` is null
- process activities newest-to-oldest as delivered
- treat activity `id` as idempotency key
- persist `nextCursor` only after successful page processing
- when falling back to `since`, expect replay at boundary timestamps and dedupe by `id`

Recovery fallback for cursor corruption:

```bash
aam_get "${base_url}/agent/v1/activities?limit=50&since=2026-02-24T00:00:00.000Z"
```

## 4. Loading Issue Details and Prompt Context

Fetch only for activities you need to act on:

```bash
aam_get "${base_url}/agent/v1/issues/${ISSUE_ID}?includePrompts=true"
```

Prompt-only fetch:

```bash
aam_get "${base_url}/agent/v1/issues/${ISSUE_ID}/prompt"
```

Image fetch:

```bash
curl -sS -L --fail --config - \
  -o "issue-$ISSUE_ID-image.png" \
  <<EOF
url = "${base_url}/agent/v1/issues/${ISSUE_ID}/images/${IMAGE_ID}"
header = "X-AAM-API-Key: ${AAM_API_KEY}"
EOF
```

## 5. Resolving Work

Resolution contract:

- endpoint: `POST /agent/v1/issues/:id/resolve`
- body:
  - `status`: `resolved` or `archived`
  - `resolutionNote`: non-empty technical summary

Example:

```bash
aam_post_json \
  "${base_url}/agent/v1/issues/${ISSUE_ID}/resolve" \
  '{"status":"resolved","resolutionNote":"Updated validation flow, added test coverage, and verified build/test pass."}'
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
aam_get "${base_url}/agent/v1/project"

# 2) poll one page
aam_get "${base_url}/agent/v1/activities?limit=50"

# 3) inspect issue
aam_get "${base_url}/agent/v1/issues/${ISSUE_ID}?includePrompts=true"

# 4) mark complete
aam_post_json \
  "${base_url}/agent/v1/issues/${ISSUE_ID}/resolve" \
  '{"status":"resolved","resolutionNote":"Implemented fix and validated behavior."}'
```
