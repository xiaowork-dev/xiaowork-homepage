#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${XIAOWORK_ENV_FILE:-$ROOT/.env}"
STATE_DIR="$ROOT/.deploy"
recorded_compose="$(cat "$STATE_DIR/compose-file" 2>/dev/null || true)"
COMPOSE_FILE="${XIAOWORK_COMPOSE_FILE:-${recorded_compose:-compose.yaml}}"
case "$COMPOSE_FILE" in
  compose.yaml|compose.proxy.yaml) ;;
  *) echo 'XIAOWORK_COMPOSE_FILE must be compose.yaml or compose.proxy.yaml.' >&2; exit 1 ;;
esac
if [[ -n "$recorded_compose" && "$recorded_compose" != "$COMPOSE_FILE" ]]; then
  echo 'Deployment network mode differs from the recorded mode. Plan an explicit migration first.' >&2
  exit 1
fi

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
  docker compose --project-directory "$ROOT" --env-file "$ENV_FILE" -f "$ROOT/$COMPOSE_FILE" "$@"
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
  printf '%s\n' "$COMPOSE_FILE" > "$STATE_DIR/compose-file"
}
