#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ $# -ne 2 || ! "$1" =~ ^(deploy|update)$ || ! "$2" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Usage: bash release.sh <deploy|update> <reviewed-full-commit-sha>' >&2
  exit 1
fi
action="$1"
revision="$2"
command -v git >/dev/null || { echo 'Git is required.' >&2; exit 1; }
[[ -e "$ROOT/.git" && -z "$(git -C "$ROOT" rev-parse --show-prefix)" ]] || {
  echo 'Run from a dedicated repository checkout.' >&2; exit 1;
}
[[ "$(git -C "$ROOT" branch --show-current)" == main ]] || {
  echo 'Release checkout must be on main.' >&2; exit 1;
}
[[ -z "$(git -C "$ROOT" status --porcelain)" ]] || {
  echo 'Release checkout has uncommitted files. Preserve them before releasing.' >&2; exit 1;
}
case "$(git -C "$ROOT" config --get remote.origin.url)" in
  https://github.com/xiaowork-dev/xiaowork-homepage|https://github.com/xiaowork-dev/xiaowork-homepage.git|git@github.com:xiaowork-dev/xiaowork-homepage.git) ;;
  *) echo 'origin does not match the confirmed XiaoWork repository.' >&2; exit 1 ;;
esac

# The SHA is a human-reviewed release input, not an assertion that any main commit is tested.
git -C "$ROOT" fetch --no-tags origin main
git -C "$ROOT" cat-file -e "$revision^{commit}"
git -C "$ROOT" merge-base --is-ancestor "$revision" refs/remotes/origin/main || {
  echo 'Requested commit is not on fetched origin/main.' >&2; exit 1;
}
git -C "$ROOT" merge-base --is-ancestor HEAD "$revision" || {
  echo 'Requested commit is older or divergent; use rollback.sh for retained images.' >&2; exit 1;
}
git -C "$ROOT" merge --ff-only "$revision"
[[ "$(git -C "$ROOT" rev-parse HEAD)" == "$revision" ]] || exit 1
echo "Releasing reviewed source $revision via $action.sh."
export XIAOWORK_SOURCE_REVISION="$revision"
exec bash "$ROOT/$action.sh" "git-${revision:0:12}"
