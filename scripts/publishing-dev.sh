#!/usr/bin/env bash
# Local-only P6-D stack. Never invokes SSH or a production deployment script.
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
command -v git >/dev/null
command -v docker >/dev/null
docker compose version >/dev/null
[[ "$(docker context inspect --format '{{.Endpoints.docker.Host}}')" != ssh://* ]] || {
  echo 'Remote Docker contexts are forbidden for this local environment.' >&2
  exit 1
}
export V11_SOURCE_REVISION
V11_SOURCE_REVISION="$(git rev-parse HEAD)"
[[ "$V11_SOURCE_REVISION" =~ ^[0-9a-f]{40}$ ]]
compose=(docker compose -f compose.admin-publish.yaml)
if [[ "${V11_LOCAL_PUBLISH:-0}" == 1 ]]; then
  compose+=(--profile publisher)
fi
case "${1:-status}" in
  build)
    # A Git identity must describe the actual reviewed build inputs.
    inputs=(app shared server public backend admin nuxt.config.ts tsconfig.json package.json package-lock.json)
    git diff --quiet HEAD -- "${inputs[@]}" || {
      echo 'Commit reviewed application inputs before a release-identity build.' >&2
      exit 1
    }
    [[ -z "$(git ls-files --others --exclude-standard -- "${inputs[@]}")" ]] || {
      echo 'Untracked application inputs must be reviewed and committed first.' >&2
      exit 1
    }
    "${compose[@]}" config --quiet
    "${compose[@]}" build api worker gateway frontend
    ;;
  start|status|stop) ;;
  *) echo 'Usage: scripts/publishing-dev.sh build|start|status|stop' >&2; exit 2 ;;
esac
if [[ "${1:-status}" == build || "${1:-status}" == start ]]; then
  V11_SOURCE_REVISION="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' xiaowork-homepage-worker:p6d-dev)"
  [[ "$V11_SOURCE_REVISION" =~ ^[0-9a-f]{40}$ ]]
  export V11_BUILDER_ID
  V11_BUILDER_ID="$(docker image inspect --format '{{.Id}}' xiaowork-homepage-worker:p6d-dev)"
  [[ "$V11_BUILDER_ID" =~ ^sha256:[0-9a-f]{64}$ ]]
  "${compose[@]}" config --quiet
  "${compose[@]}" up -d --no-build --wait --wait-timeout 120
  echo 'Local admin: https://localhost:3445/admin/ (trust the dedicated local CA).'
  echo 'Initialize the test administrator with the documented interactive TTY command.'
elif [[ "${1:-status}" == stop ]]; then
  # Keep all SQLite, upload, release, session and TLS volumes.
  "${compose[@]}" down
else
  "${compose[@]}" ps -a
fi
