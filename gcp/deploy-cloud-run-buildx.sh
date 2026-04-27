#!/usr/bin/env bash
# Cloud Run deploy — Docker Buildx + digest-pinned
# =================================================================
# Principles enforced by this script:
#   1. Always pin by digest (@sha256:) — never deploy by :latest tag
#   2. --platform linux/amd64 on every build (Cloud Run is amd64;
#      Apple Silicon builds ARM by default)
#   3. Services deploy independently — a change scoped to one service
#      does not require rebuilding the other
#   4. Invocation-controlled — can be run manually or by CI automation
#
# Usage:
#   gcp/deploy-cloud-run-buildx.sh --service le          # just light-engine
#   gcp/deploy-cloud-run-buildx.sh --service central     # just greenreach-central
#   gcp/deploy-cloud-run-buildx.sh --service both        # both (default)
#   gcp/deploy-cloud-run-buildx.sh --service le --skip-build   # redeploy last pushed image
#   gcp/deploy-cloud-run-buildx.sh --service le --tag v2026-04-20  # custom tag
#
# Prerequisites (local or CI):
#   - Docker Desktop with buildx (`docker buildx version`)
#   - gcloud CLI authenticated (`gcloud auth login` or SA key via
#     GOOGLE_APPLICATION_CREDENTIALS), project set to $PROJECT_ID
#   - Artifact Registry repo `$REPO_NAME` exists in `$REGION`
#   - Docker configured for Artifact Registry auth:
#       gcloud auth configure-docker ${REGION}-docker.pkg.dev
# =================================================================

set -euo pipefail
# Propagate command-substitution failures so e.g. `$(flags_for_role ...)`
# aborts the script if the callee returns non-zero, rather than silently
# inserting an empty string and running `gcloud run deploy` without flags.
shopt -s inherit_errexit 2>/dev/null || true

# ----------------------------------------------------------------
# Configuration (override via env vars)
# ----------------------------------------------------------------
PROJECT_ID="${PROJECT_ID:-project-5d00790f-13a9-4637-a40}"
REGION="${REGION:-us-east1}"
REPO_NAME="${REPO_NAME:-greenreach}"
CENTRAL_SERVICE="${CENTRAL_SERVICE:-greenreach-central}"
LE_SERVICE="${LE_SERVICE:-light-engine}"
TAG="${TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}"

# Absolute paths to build contexts (avoids working-dir surprises)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LE_CONTEXT="${REPO_ROOT}"
CENTRAL_CONTEXT="${REPO_ROOT}/greenreach-central"

# ----------------------------------------------------------------
# Arg parsing
# ----------------------------------------------------------------
SERVICE="both"
SKIP_BUILD="false"
SKIP_DEPLOY="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service)      SERVICE="$2"; shift 2 ;;
    --tag)          TAG="$2"; shift 2 ;;
    --skip-build)   SKIP_BUILD="true"; shift ;;
    --skip-deploy)  SKIP_DEPLOY="true"; shift ;;
    -h|--help)      sed -n '2,25p' "$0"; exit 0 ;;
    *)              echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

case "$SERVICE" in
  le|central|both) ;;
  *) echo "Error: --service must be one of: le, central, both" >&2; exit 2 ;;
esac

# ----------------------------------------------------------------
# Preflight
# ----------------------------------------------------------------
command -v docker  >/dev/null || { echo "docker not found"; exit 1; }
command -v gcloud  >/dev/null || { echo "gcloud not found"; exit 1; }
docker buildx version >/dev/null 2>&1 || { echo "docker buildx not available"; exit 1; }

echo "=================================================="
echo "Cloud Run Deploy (buildx + digest-pinned)"
echo "  Project:   ${PROJECT_ID}"
echo "  Region:    ${REGION}"
echo "  Registry:  ${REGISTRY}"
echo "  Platform:  ${PLATFORM}"
echo "  Tag:       ${TAG}"
echo "  Service:   ${SERVICE}"
echo "  Skip build:  ${SKIP_BUILD}"
echo "  Skip deploy: ${SKIP_DEPLOY}"
echo "=================================================="

# ----------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------

# Build + push one image via buildx (amd64, absolute context).
# Args: <service-name> <context-dir>
build_and_push() {
  local svc="$1" ctx="$2"
  local image_ref="${REGISTRY}/${svc}:${TAG}"

  if [[ ! -d "$ctx" ]]; then
    echo "ERROR: [${svc}] build context does not exist: ${ctx}" >&2
    return 1
  fi

  echo ""
  echo ">>> [${svc}] buildx build --platform ${PLATFORM} --push"
  echo "    context: ${ctx}"
  echo "    image:   ${image_ref}"

  docker buildx build \
    --platform "${PLATFORM}" \
    --tag "${image_ref}" \
    --push \
    "${ctx}"

  echo ">>> [${svc}] build + push complete"
}

# Resolve the authoritative sha256 digest for <svc>:<TAG> from Artifact Registry.
# Prints the digest (with "sha256:" prefix) on stdout.
resolve_digest() {
  local svc="$1"
  local digest
  digest=$(gcloud artifacts docker images describe \
    "${REGISTRY}/${svc}:${TAG}" \
    --project="${PROJECT_ID}" \
    --format="value(image_summary.digest)" 2>/dev/null || true)

  if [[ -z "$digest" ]]; then
    echo "ERROR: could not resolve digest for ${REGISTRY}/${svc}:${TAG}" >&2
    echo "       Was the image pushed? Try: gcloud artifacts docker images list ${REGISTRY}/${svc}" >&2
    return 1
  fi
  echo "$digest"
}

# Deploy <svc> pinned to <digest>, using the flag-set for <role>
# (role is one of: le, central). Role decouples the flag-function
# lookup from the (overridable) service name.
deploy_by_digest() {
  local svc="$1" digest="$2" role="$3"
  local image_ref="${REGISTRY}/${svc}@${digest}"

  echo ""
  echo ">>> [${svc}] gcloud run deploy --image ${image_ref}"

  # Capture flags first so an unknown role aborts the script here (via
  # inherit_errexit) rather than silently running `gcloud run deploy`
  # with no per-role flags.
  local flags
  flags=$(flags_for_role "${role}" "${svc}")

  # shellcheck disable=SC2086
  gcloud run deploy "${svc}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --image="${image_ref}" \
    --update-traffic=LATEST=100 \
    ${flags}

  # URL lookup is best-effort; don't fail the whole deploy if it returns
  # nothing (e.g. status.url not yet populated, permission gap).
  local url=""
  url=$(gcloud run services describe "${svc}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format="value(status.url)" 2>/dev/null || true)
  echo ">>> [${svc}] deployed @ ${digest}"
  echo ">>> [${svc}] URL: ${url:-(unavailable)}"
}

# ----------------------------------------------------------------
# Per-role flags
# Keep these minimal and stable; full env/secret config lives in
# gcp/deploy-cloud-run.sh (the initial-setup script). These flags
# are what a redeploy-by-digest needs to preserve runtime shape.
# To edit env vars or secrets, use `gcloud run services update`
# directly, or rerun gcp/deploy-cloud-run.sh.
#
# Role (not service name) selects the flag-set so overriding
# LE_SERVICE/CENTRAL_SERVICE via env vars does not break dispatch.
# ----------------------------------------------------------------

flags_for_role() {
  local role="$1" svc="$2"
  case "$role" in
    le)
      cat <<EOF
--service-account=${svc}-sa@${PROJECT_ID}.iam.gserviceaccount.com
--port=8080
--cpu=1
--memory=1Gi
--min-instances=1
--max-instances=3
--timeout=300
--concurrency=50
--execution-environment=gen2
--allow-unauthenticated
EOF
      ;;
    central)
      cat <<EOF
--service-account=${svc}-sa@${PROJECT_ID}.iam.gserviceaccount.com
--port=8080
--cpu=1
--memory=512Mi
--min-instances=1
--max-instances=5
--timeout=300
--concurrency=80
--allow-unauthenticated
EOF
      ;;
    *)
      echo "ERROR: unknown role: ${role}" >&2
      return 1
      ;;
  esac
}

# ----------------------------------------------------------------
# Main
# ----------------------------------------------------------------

run_service() {
  local role="$1" svc="$2" ctx="$3"

  if [[ "$SKIP_BUILD" != "true" ]]; then
    build_and_push "$svc" "$ctx"
  else
    echo ">>> [${svc}] --skip-build set; reusing existing ${svc}:${TAG}"
  fi

  if [[ "$SKIP_DEPLOY" == "true" ]]; then
    echo ">>> [${svc}] --skip-deploy set; stopping after build/push"
    return
  fi

  local digest
  digest=$(resolve_digest "$svc")
  echo ">>> [${svc}] authoritative digest: ${digest}"

  deploy_by_digest "$svc" "$digest" "$role"
}

case "$SERVICE" in
  le)      run_service le      "$LE_SERVICE"      "$LE_CONTEXT" ;;
  central) run_service central "$CENTRAL_SERVICE" "$CENTRAL_CONTEXT" ;;
  both)
    run_service central "$CENTRAL_SERVICE" "$CENTRAL_CONTEXT"
    run_service le      "$LE_SERVICE"      "$LE_CONTEXT"
    ;;
esac

echo ""
echo "=================================================="
echo "Done."
echo "=================================================="
