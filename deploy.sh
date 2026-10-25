#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/deploy/common.sh"

export IMAGE_TAG="${1:-$(git -C "$ROOT" rev-parse --short=12 HEAD 2>/dev/null || printf 'p1-local')}"
validate_tag "$IMAGE_TAG"
previous="$(read_current)"
compose config --quiet

# Existing tags are immutable so a prior image remains available for rollback.
if docker image inspect "xiaowork-homepage:$IMAGE_TAG" >/dev/null 2>&1; then
  echo "Using existing image $IMAGE_TAG. Choose a new tag to build changed sources."
else
  compose build --pull web
fi

if compose up -d --no-build --wait --wait-timeout 90 web; then
  record_release "$previous"
  echo "XiaoWork $IMAGE_TAG is healthy."
else
  echo 'Deployment failed. Inspect docker compose logs; use bash rollback.sh <previous-tag> to recover.' >&2
  exit 1
fi
