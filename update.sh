#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/deploy/common.sh"

if [[ $# -ne 1 ]]; then
  echo 'Usage: bash update.sh <new-release-tag> (prepare reviewed source first)' >&2
  exit 1
fi
export IMAGE_TAG="$1"
validate_tag "$IMAGE_TAG"
previous="$(read_current)"
if [[ -z "$previous" ]]; then
  echo 'No recorded deployment. Run bash deploy.sh <release-tag> first.' >&2
  exit 1
fi
if [[ "$previous" == "$IMAGE_TAG" ]]; then
  echo 'Choose a new immutable release tag for changed source.' >&2
  exit 1
fi
compose config --quiet
if docker image inspect "xiaowork-homepage:$IMAGE_TAG" >/dev/null 2>&1; then
  echo 'This image tag already exists. Choose a new tag or use rollback.sh.' >&2
  exit 1
fi

# A failed build never replaces the running container.
compose build --pull web
if compose up -d --no-build --wait --wait-timeout 90 web; then
  record_release "$previous"
  echo "Updated to $IMAGE_TAG. Previous image retained: $previous"
else
  echo "Update failed; restoring $previous." >&2
  export IMAGE_TAG="$previous"
  compose up -d --no-build --wait --wait-timeout 90 web || {
    echo 'Automatic recovery also failed. Inspect logs and use rollback.sh.' >&2
    exit 1
  }
  exit 1
fi
