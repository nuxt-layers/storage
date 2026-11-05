#!/usr/bin/env bash
# Runs every check CI runs, on your own machine: install, type check, unit
# tests, and integration tests against a throwaway SeaweedFS S3 server whose
# credentials are made for this run only. Needs Node.js, Docker and openssl.
#
#   scripts/local-check.sh                    check the branch
#   scripts/local-check.sh --commit-lockfile  also commit and push a changed lockfile
#
# Checks the branch you are on, or BRANCH if set. On Windows, run it from Git
# Bash (bash scripts/local-check.sh) with Docker Desktop running.
set -euo pipefail

# Git Bash rewrites arguments that look like paths (such as /data) into Windows
# paths. That must be off for Docker's container paths, but on for everything
# else: Node.js and pnpm's shims need their paths rewritten to run at all.
docker_() { MSYS_NO_PATHCONV=1 docker "$@"; }

image="chrislusf/seaweedfs:4.52"
container="storage-check-s3"
port=8333

cd "$(git rev-parse --show-toplevel)"
branch="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"

echo "==> Updating $branch"
git fetch origin "$branch"
git checkout "$branch"
git pull --ff-only origin "$branch"

echo "==> Enabling pnpm through Corepack"
command -v corepack >/dev/null 2>&1 || npm install --global corepack@latest
corepack enable pnpm

echo "==> Installing"
pnpm install
if grep -q minimumReleaseAgeExclude pnpm-workspace.yaml; then
  echo "!! pnpm added minimumReleaseAgeExclude to pnpm-workspace.yaml: a dependency is too new." >&2
  echo "!! Not committing; report this so the version range can be fixed." >&2
  exit 1
fi

echo "==> Type check and unit tests"
pnpm typecheck
pnpm test

echo "==> Starting a throwaway S3 server"
key="local$(openssl rand -hex 8)"
secret="$(openssl rand -hex 24)"
mkdir -p .local-check
config=".local-check/s3.json"
cleanup() {
  docker_ rm -f "$container" >/dev/null 2>&1 || true
  rm -rf .local-check
}
trap cleanup EXIT
printf '{"identities":[{"name":"local","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin","Read","Write","List","Tagging"]}]}' \
  "$key" "$secret" > "$config"
docker_ rm -f "$container" >/dev/null 2>&1 || true
# Copied in rather than mounted, so the same commands work on Linux, macOS and Windows.
docker_ create --name "$container" -p "$port:8333" \
  "$image" server -dir=/data -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json >/dev/null
docker_ cp "$config" "$container:/etc/seaweedfs/s3.json"
docker_ start "$container" >/dev/null
for _ in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/")" != "000" ] && break
  sleep 1
done

echo "==> Integration tests"
S3_TEST_ENDPOINT="http://127.0.0.1:$port" S3_TEST_ACCESS_KEY="$key" S3_TEST_SECRET_KEY="$secret" pnpm test:integration

if [ "${1:-}" = "--commit-lockfile" ] && [ -n "$(git status --porcelain -- pnpm-lock.yaml pnpm-workspace.yaml)" ]; then
  if [ "$branch" = "master" ]; then
    echo "!! master is protected: commit the lockfile on a branch and open a pull request." >&2
    exit 1
  fi
  echo "==> Committing the lockfile"
  git add pnpm-lock.yaml pnpm-workspace.yaml
  git commit -m "chore: update pnpm lockfile"
  git push origin "$branch"
fi

echo "==> All checks passed"
