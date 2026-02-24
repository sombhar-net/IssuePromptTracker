#!/usr/bin/env bash
set -euo pipefail

required_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env var: ${name}" >&2
    exit 1
  fi
}

required_command() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "Missing required command: ${name}" >&2
    exit 1
  fi
}

required_command "curl"
required_command "python3"

required_env "AAM_API_BASE_URL"
required_env "AAM_API_KEY"

if [[ "${AAM_API_KEY}" != aam_pk_* ]]; then
  echo "AAM_API_KEY does not look like an agent key (expected aam_pk_<keyId>_<secret>)." >&2
fi

base_url="${AAM_API_BASE_URL%/}"
timeout_ms="${AAM_TIMEOUT_MS:-15000}"
timeout_seconds=$(( (timeout_ms + 999) / 1000 ))

if (( timeout_seconds < 1 )); then
  timeout_seconds=1
fi

curl_args=(
  --silent
  --show-error
  --fail
  --max-time "${timeout_seconds}"
)

if [[ "${AAM_INSECURE_TLS:-0}" == "1" ]]; then
  echo "Warning: AAM_INSECURE_TLS=1 disables TLS certificate verification." >&2
  curl_args+=(-k)
fi

api_get() {
  local url="$1"

  curl "${curl_args[@]}" --config - <<EOF
url = "${url}"
header = "X-AAM-API-Key: ${AAM_API_KEY}"
header = "Accept: application/json"
EOF
}

json_field() {
  local input="$1"
  local expr="$2"
  printf "%s" "${input}" | python3 -c '
import json
import sys

payload = json.load(sys.stdin)
expr = sys.argv[1]

current = payload
for part in expr.split("."):
    if part == "":
        continue
    if isinstance(current, dict):
        current = current.get(part)
    else:
        current = None
    if current is None:
        break

if current is None:
    print("")
elif isinstance(current, (dict, list)):
    print(json.dumps(current))
else:
    print(str(current))
' "${expr}"
}

echo "Checking agent project context..."
project_json="$(api_get "${base_url}/agent/v1/project")"
project_id="$(json_field "${project_json}" "project.id")"
project_name="$(json_field "${project_json}" "project.name")"

if [[ -z "${project_id}" ]]; then
  echo "Unable to read project.id from /agent/v1/project response." >&2
  exit 1
fi

if [[ -n "${AAM_PROJECT_ID:-}" && "${AAM_PROJECT_ID}" != "${project_id}" ]]; then
  echo "Project guardrail failed. Expected ${AAM_PROJECT_ID} but key is scoped to ${project_id}." >&2
  exit 1
fi

echo "Project: ${project_name} (${project_id})"

echo "Checking activity feed connectivity..."
activities_json="$(api_get "${base_url}/agent/v1/activities?limit=1")"
activity_count="$(json_field "${activities_json}" "activities")"
next_cursor="$(json_field "${activities_json}" "page.nextCursor")"

if [[ "${activity_count}" == "" ]]; then
  echo "Unable to read activity payload from /agent/v1/activities response." >&2
  exit 1
fi

if [[ "${next_cursor}" == "" || "${next_cursor}" == "null" ]]; then
  echo "Activity feed reachable. nextCursor: none"
else
  echo "Activity feed reachable. nextCursor: present"
fi

if [[ -n "${AAM_POLL_SECONDS:-}" ]]; then
  echo "Configured poll interval: ${AAM_POLL_SECONDS}s"
fi

echo "Bootstrap checks passed."
