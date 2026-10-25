#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/deploy/common.sh"

export IMAGE_TAG="${1:-$(cat "$STATE_DIR/previous" 2>/dev/null || true)}"
if [[ -z "$IMAGE_TAG" ]]; then
  echo 'Usage: bash rollback.sh <retained-image-tag>' >&2
  exit 1
fi
validate_tag "$IMAGE_TAG"
previous="$(read_current)"
compose config --quiet
docker image inspect "xiaowork-homepage:$IMAGE_TAG" >/dev/null
compose up -d --no-build --wait --wait-timeout 90 web
record_release "$previous"
echo "Rolled back to $IMAGE_TAG."
