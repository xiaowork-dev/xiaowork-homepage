#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/deploy/common.sh"

export IMAGE_TAG="${1:-$(git -C "$ROOT" rev-parse --short=12 HEAD 2>/dev/null || printf 'p1-local')}"
validate_tag "$IMAGE_TAG"
previous="$(read_current)"
compose config --quiet

# Existing tags are immutable so a prior image remains available for rollback.
if docker image inspect "xiaowork-homepage:$IMAGE_TAG" >/dev/null 2>&1; then
  expected_origin=""
  while IFS='=' read -r key value; do
    if [[ "$key" == NUXT_PUBLIC_SITE_URL ]]; then expected_origin="$value"; fi
  done < <(compose config --environment)
  image_origin="$(docker image inspect --format '{{index .Config.Labels "io.xiaowork.site-url"}}' "xiaowork-homepage:$IMAGE_TAG")"
  if [[ "$image_origin" != "$expected_origin" ]]; then
    echo 'Existing image has a different or unverified build-time origin. Choose a new release tag.' >&2
    exit 1
  fi
  if [[ -n "${XIAOWORK_SOURCE_REVISION:-}" ]]; then
    image_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "xiaowork-homepage:$IMAGE_TAG")"
    if [[ "$image_revision" != "$XIAOWORK_SOURCE_REVISION" ]]; then
      echo 'Existing image source revision does not match the reviewed commit.' >&2
      exit 1
    fi
  fi
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
