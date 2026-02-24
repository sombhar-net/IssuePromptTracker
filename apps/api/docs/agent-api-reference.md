# Agent API Reference (Markdown)

Base URL examples assume local dev:
- API: `http://localhost:4000`
- Agent auth header: `X-AAM-API-Key`

## Public Docs Endpoint
### `GET /api/agent/v1/docs.md`
Returns combined markdown docs for agent setup and API usage.

Example:
```bash
curl -sS http://localhost:4000/api/agent/v1/docs.md
```

## Agent Project Context
### `GET /api/agent/v1/project`
Returns current project metadata, categories, and prompt template metadata.

```bash
curl -sS \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  http://localhost:4000/api/agent/v1/project
```

## Agent Issue Listing
### `GET /api/agent/v1/issues`
Query params:
- `type`, `status`, `priority`, `categoryId`, `tag`, `search`
- `limit` (default 20, max 100)
- `cursor` (opaque)
- `includePrompts` (`true|false`, default `true`)
- `includeImagesInline` (`true|false`)

```bash
curl -sS \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  "http://localhost:4000/api/agent/v1/issues?status=open&limit=20"
```

`issues[*].prompt` is included by default. Set `includePrompts=false` for lighter payloads.
`status` can include `in_review` for agent submissions awaiting human approval.

## Agent Issue Detail
### `GET /api/agent/v1/issues/:id`
```bash
curl -sS \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  "http://localhost:4000/api/agent/v1/issues/<issueId>"
```

`issue.prompt` is included by default. Use `includePrompts=false` to suppress prompt data.

## Agent Work Context (Recommended pre-action gate)
### `GET /api/agent/v1/issues/:id/work-context`
Returns issue detail with prompt embedded plus a pre-action checklist to enforce prompt+image review before implementation/resolution.

```bash
curl -sS \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  "http://localhost:4000/api/agent/v1/issues/<issueId>/work-context"
```

## Agent Prompt for One Issue
### `GET /api/agent/v1/issues/:id/prompt`
```bash
curl -sS \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  http://localhost:4000/api/agent/v1/issues/<issueId>/prompt
```

## Agent Image Download
### `GET /api/agent/v1/issues/:issueId/images/:imageId`
```bash
curl -L \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  -o screenshot.png \
  http://localhost:4000/api/agent/v1/issues/<issueId>/images/<imageId>
```

## Agent Resolve Endpoint
### `POST /api/agent/v1/issues/:id/resolve`
Body:
- `chatSessionId`: non-empty string
- `resolutionNote`: non-empty implementation summary
- `codeChanges`: non-empty code-change summary
- `commandOutputs`: non-empty array of command/output records
- `testSummary` (optional): test and verification summary

```bash
curl -sS -X POST \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "chatSessionId":"chatcmpl_abc123",
    "resolutionNote":"Fixed null dereference in checkout submission flow.",
    "codeChanges":"Updated checkout validator and submit handler; added null guards.",
    "commandOutputs":[
      {"command":"npm run test -w apps/web","output":"Test Files 12 passed","exitCode":0},
      {"command":"npm run build -w apps/web","output":"Build success","exitCode":0}
    ],
    "testSummary":"Web tests and build both pass."
  }' \
  http://localhost:4000/api/agent/v1/issues/<issueId>/resolve
```

Behavior:
- Agent resolve now moves issues into `in_review` status (human approval required).
- Closed issues (`resolved`, `archived`) cannot be re-resolved by agent keys.

## Agent Activities Feed (Project)
### `GET /api/agent/v1/activities`
Query params:
- `limit` (default 50, max 200)
- `cursor` (opaque)
- `itemId` (optional issue filter)
- `type` (optional event type filter)
- `since` (ISO datetime for bootstrap)

```bash
curl -sS \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  "http://localhost:4000/api/agent/v1/activities?limit=50"
```

Response shape:
```json
{
  "projectId": "clx...",
  "activities": [
    {
      "id": "clx...",
      "itemId": "clx...",
      "type": "STATUS_CHANGE",
      "actorType": "AGENT",
      "message": "Status changed from open to in_review",
      "metadata": { "from": "open", "to": "in_review" },
      "createdAt": "2026-02-24T15:40:55.000Z",
      "actor": { "kind": "agent", "keyId": "clx...", "name": "codex-prod", "prefix": "a1b2c3d4" },
      "item": { "id": "clx...", "title": "Checkout crashes", "type": "issue", "projectId": "clx..." }
    }
  ],
  "page": {
    "limit": 50,
    "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTAyLTI0VDE1OjQwOjU1LjAwMFoiLCJpZCI6ImNseC4uLiJ9"
  }
}
```

## Agent Activities for One Issue
### `GET /api/agent/v1/issues/:id/activities`
Same pagination/filter semantics as activity feed (except no `since`).

```bash
curl -sS \
  -H "X-AAM-API-Key: $AAM_API_KEY" \
  "http://localhost:4000/api/agent/v1/issues/<issueId>/activities?limit=30"
```

## User Activities Endpoints (JWT)
- `GET /api/items/:id/activities`
- `GET /api/activities?projectId=<id>`
- `POST /api/items/:id/review` (`approve` -> `resolved`, `reject` -> `in_progress`, only when status is `in_review`)

These power the web timeline and can be used by trusted user-token automation.
