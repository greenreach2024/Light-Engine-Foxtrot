#!/usr/bin/env bash
set -euo pipefail

CANONICAL_ROOT="/Volumes/CodeVault/Projects/Light-Engine-Foxtrot"
TOOL_VERSION="phase-a-v1"
SHA=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sha)
      SHA="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      exit 2
      ;;
  esac
done

if [[ -z "$SHA" ]]; then
  echo "Usage: $0 --sha <commit-sha>"
  exit 2
fi

cd "$CANONICAL_ROOT"

bash scripts/release/preflight-clean-tree.sh --require-sha --sha "$SHA"

if ! git cat-file -e "${SHA}^{commit}" 2>/dev/null; then
  echo "Release candidate failed: invalid commit SHA: $SHA"
  exit 1
fi

TIMESTAMP_UTC="$(date -u +%Y%m%d_%H%M%SZ)"
SHORT_SHA="$(git rev-parse --short "$SHA")"
BRANCH="$(git branch --show-current || true)"
[[ -z "$BRANCH" ]] && BRANCH="detached"

WORKDIR="tmp/release-candidate-${TIMESTAMP_UTC}-${SHORT_SHA}"
SRC_DIR="$WORKDIR/source"
ARTIFACT="$WORKDIR/foxtrot-release-${TIMESTAMP_UTC}-${SHORT_SHA}.zip"
MANIFEST="$WORKDIR/MANIFEST.txt"

mkdir -p "$SRC_DIR"

git archive --format=tar "$SHA" | tar -xf - -C "$SRC_DIR"

cat > "$MANIFEST" <<EOF
tool_version=$TOOL_VERSION
timestamp_utc=$TIMESTAMP_UTC
release_sha=$SHA
release_short_sha=$SHORT_SHA
branch=$BRANCH
workspace_root=$CANONICAL_ROOT
EOF

cp "$MANIFEST" "$SRC_DIR/MANIFEST.txt"

(cd "$SRC_DIR" && zip -qr "../$(basename "$ARTIFACT")" .)

CHECKSUM="$(shasum -a 256 "$ARTIFACT" | awk '{print $1}')"

echo "Release candidate created"
echo "artifact=$ARTIFACT"
echo "manifest=$MANIFEST"
echo "sha256=$CHECKSUM"
