#!/usr/bin/env bash
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
command -v node >/dev/null
command -v docker >/dev/null
exec node scripts/v11-release.mjs update "$@"
