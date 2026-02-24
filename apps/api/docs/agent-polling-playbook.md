# Polling Playbook for Agent Integrations

This API is designed to support reliable pull-based synchronization.

## Cursor Semantics
- Cursor is opaque and ordered by `(createdAt desc, id desc)`.
- Never parse cursor in client logic.
- Persist the `nextCursor` from the last fully processed page.

## Bootstrap Pattern
When onboarding a new consumer:
1. Call `/api/agent/v1/activities?since=<now-24h>&limit=50`.
2. Process pages until `nextCursor` is null.
3. Continue periodic polling using `cursor` only.

## Loop Skeleton
```text
cursor = loadCheckpoint()
loop every 30s:
  resp = GET /activities?cursor=cursor&limit=50
  for activity in resp.activities:
    handle(activity.idempotentKey = activity.id)
  cursor = resp.page.nextCursor ?? cursor
  saveCheckpoint(cursor)
```

## Idempotency and Ordering
- Use `activity.id` as immutable idempotency key.
- Consumers should ignore already-seen IDs.
- Do not assume strict timestamp uniqueness; rely on cursor progression.

## Recovery
- If the server returns `400 Invalid cursor`, restart from `since`.
- If network fails, retry with exponential backoff.
- If service downtime is prolonged, backfill with larger `since` window.

## Throughput Controls
- Default `limit` should be 50.
- Increase limit only for backfill/recovery runs.
- Keep steady-state polling lightweight to avoid unnecessary load.

## Suggested Routing in Agents
- `STATUS_CHANGE`: update task lifecycle.
- `RESOLUTION_NOTE`: capture final reasoning/notes.
- `REVIEW_SUBMITTED`: treat as handoff checkpoint (implementation details submitted for human approval).
- `REVIEW_APPROVED`: mark workflow complete.
- `REVIEW_REJECTED`: re-fetch work context and continue implementation.
- `ITEM_UPDATED`: call `GET /api/agent/v1/issues/:id/work-context`, then download all listed images before acting.
- `IMAGE_*`: refresh image manifests in your local cache.

## Operational Checklist
- Rotate API keys periodically.
- Revoke compromised keys immediately.
- Track last successful poll timestamp.
- Alert on prolonged no-data or repeated cursor reset events.
