---
name: aam-issue-tracker-agent
description: Use Issue Prompt Tracker agent APIs to build or operate prompt-first coding automations with API-key auth, including project bootstrap, activity polling, issue detail fetches with default embedded prompts, image retrieval, and human-review submission updates. Trigger this skill when tasks involve /api/agent/v1 endpoints, X-AAM-API-Key usage, cursor-based polling, or creating/updating an agent skill integration for this tracker.
---

# AAM Issue Tracker Agent

## Quick Start

1. Prerequisites:
   - `bash`, `curl`, and `python3`
2. Export required environment variables:
   - `AAM_API_BASE_URL` (example: `https://tracker.example.com/api`)
   - `AAM_API_KEY` (format: `aam_pk_<keyId>_<secret>`)
3. Optionally export:
   - `AAM_PROJECT_ID` (expected project guardrail)
   - `AAM_POLL_SECONDS` (default suggestion: `30`)
   - `AAM_TIMEOUT_MS` (default suggestion: `15000`)
   - `AAM_INSECURE_TLS=1` (dev-only; disables TLS verification)
4. Run bootstrap script to validate auth and project scope:
   - from this skill directory: `./scripts/bootstrap.sh`
   - from repository root: `skills/aam-issue-tracker-agent/scripts/bootstrap.sh`

## Core Workflow

1. Bootstrap context
   - Call `GET /agent/v1/project` first.
   - Verify `project.id` matches `AAM_PROJECT_ID` when set.
2. Poll changes
   - Call `GET /agent/v1/activities?limit=50&cursor=<cursor>`.
   - Persist `nextCursor` after successful page processing.
3. Load mandatory pre-action context for "fix this/that issue"
   - Call `GET /agent/v1/issues/:id/work-context` first.
   - Treat `issue.prompt.text` as primary implementation context.
   - Treat `issue.prompt.yaml` as structured source-of-truth input.
4. Download and review all attachments before coding
   - For every image in `issue.images`, call `GET /agent/v1/issues/:issueId/images/:imageId`.
   - If image fetch fails, stop and report instead of proceeding with partial context.
5. Fetch supporting context only when needed
   - Use `GET /agent/v1/issues/:id/activities` for timeline/audit context.
   - Use `GET /agent/v1/issues/:id/prompt` only as fallback when pre-action context endpoint is unavailable.
6. Complete work and submit for human review
   - Use `POST /agent/v1/issues/:id/resolve` to move status to `in_review`.
   - Include `chatSessionId`, `resolutionNote`, `codeChanges`, and `commandOutputs`.
   - Humans finalize via review approval/rejection.

## Reliability Rules

- Treat activity `id` as idempotency key.
- Retry only transient failures (`5xx`, network timeouts) with exponential backoff.
- Do not retry validation/auth failures (`4xx`) blindly.
- Reset polling with `since=<ISO timestamp>` if server returns `Invalid cursor`.
- When using `since`, expect replay at the boundary and dedupe with activity `id`.
- Never edit code or post `/resolve` until prompt and all images are loaded.
- Never log full API keys.

## Command Patterns

Use these minimal request patterns:

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

aam_get "${base_url}/agent/v1/project"
aam_get "${base_url}/agent/v1/activities?limit=50"
aam_get "${base_url}/agent/v1/issues/${ISSUE_ID}/work-context"
for image_id in $(aam_get "${base_url}/agent/v1/issues/${ISSUE_ID}/work-context" | python3 -c 'import json,sys; payload=json.load(sys.stdin); print("\\n".join(img["id"] for img in payload.get("issue",{}).get("images",[])))'); do
  curl -sS --fail --config - -o "issue-${ISSUE_ID}-${image_id}.bin" <<EOF
url = "${base_url}/agent/v1/issues/${ISSUE_ID}/images/${image_id}"
header = "X-AAM-API-Key: ${AAM_API_KEY}"
EOF
done
curl -sS --fail --config - --data '{"chatSessionId":"chatcmpl_abc123","resolutionNote":"Implemented fix and validated behavior.","codeChanges":"Updated handler and tests.","commandOutputs":[{"command":"npm run test -w apps/web","output":"all tests passed","exitCode":0}]}' <<EOF
url = "${base_url}/agent/v1/issues/${ISSUE_ID}/resolve"
request = "POST"
header = "X-AAM-API-Key: ${AAM_API_KEY}"
header = "Content-Type: application/json"
header = "Accept: application/json"
EOF
```

## References

- Read `references/api-usage.md` for endpoint-level details and response expectations.
- Use `scripts/bootstrap.sh` for environment and connectivity checks before running automation loops.
