#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="${ROOT_DIR}/skills"
OUT_DIR="${ROOT_DIR}/apps/web/public/skills"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/package-skill.sh <skill-name>
  ./scripts/package-skill.sh --all

Examples:
  ./scripts/package-skill.sh aam-issue-tracker-agent
  ./scripts/package-skill.sh --all
EOF
}

if [[ ! -d "${SKILLS_DIR}" ]]; then
  echo "Skills directory not found: ${SKILLS_DIR}" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

package_one() {
  local skill_name="$1"
  local skill_path="${SKILLS_DIR}/${skill_name}"
  local output_zip="${OUT_DIR}/${skill_name}.zip"

  if [[ ! -f "${skill_path}/SKILL.md" ]]; then
    echo "Skipping ${skill_name}: SKILL.md not found." >&2
    return
  fi

  rm -f "${output_zip}"
  (
    cd "${SKILLS_DIR}"
    zip -rq "${output_zip}" "${skill_name}"
  )
  echo "Packaged ${skill_name} -> ${output_zip}"
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" == "--all" ]]; then
  while IFS= read -r skill_dir; do
    package_one "${skill_dir}"
  done < <(find "${SKILLS_DIR}" -mindepth 1 -maxdepth 1 -type d -printf "%f\n" | sort)
  exit 0
fi

skill_name="${1:-aam-issue-tracker-agent}"
if [[ ! -d "${SKILLS_DIR}/${skill_name}" ]]; then
  echo "Skill not found: ${SKILLS_DIR}/${skill_name}" >&2
  usage >&2
  exit 1
fi

package_one "${skill_name}"
