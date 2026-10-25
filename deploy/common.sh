#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${XIAOWORK_ENV_FILE:-$ROOT/.env}"
STATE_DIR="$ROOT/.deploy"

command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 1; }
docker compose version >/dev/null
docker info >/dev/null

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ "$ENV_FILE" != "$ROOT/.env" ]]; then
    echo "Environment file not found: $ENV_FILE" >&2
    exit 1
  fi
  cp "$ROOT/.env.example" "$ENV_FILE"
  echo 'Created .env with loopback-only defaults; edit it for your environment.'
fi

compose() {
  docker compose --project-directory "$ROOT" --env-file "$ENV_FILE" -f "$ROOT/compose.yaml" "$@"
}

validate_tag() {
  [[ "$1" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] || {
    echo 'Invalid image tag.' >&2
    exit 1
  }
}

read_current() {
  if [[ -f "$STATE_DIR/current" ]]; then cat "$STATE_DIR/current"; fi
}

record_release() {
  local previous="$1"
  mkdir -p "$STATE_DIR"
  if [[ -n "$previous" && "$previous" != "$IMAGE_TAG" ]]; then
    printf '%s\n' "$previous" > "$STATE_DIR/previous"
  fi
  printf '%s\n' "$IMAGE_TAG" > "$STATE_DIR/current"
}
