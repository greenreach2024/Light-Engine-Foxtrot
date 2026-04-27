# Cloud Run Deploy — buildx + digest-pinned

Operational procedure for deploying `light-engine` and `greenreach-central`
to Google Cloud Run. Matches the workflow described in the top-level README
and codified in `gcp/deploy-cloud-run-buildx.sh`.

## Principles

1. **Always pin by digest (`@sha256:`).** Deploying by `:latest` can silently
   serve a cached old image. Cloud Run resolves tags at deploy time; once
   resolved, the revision is immutable, but redeploys of `:latest` can
   surprise you.
2. **`--platform linux/amd64` on every build.** Cloud Run runs amd64.
   On Apple Silicon, `docker build` defaults to arm64 and the resulting
   image will not run on Cloud Run.
3. **Services deploy independently.** A change scoped to `greenreach-central/`
   only requires rebuilding `greenreach-central`. A change scoped to root
   (LE) only requires rebuilding `light-engine`. Shared UI files that live
   in both `public/` folders require both.
4. **`main` push auto-deploy + manual override.** Pushes to `main` now trigger
   the deploy workflow automatically for both services. Manual dispatch remains
   available for one-off deploys (`le|central|both`) and incident handling.

## Prerequisites

- Docker Desktop with buildx: `docker buildx version`
- `gcloud` CLI authenticated: `gcloud auth login` or a service-account key via
  `GOOGLE_APPLICATION_CREDENTIALS`
- Artifact Registry repo `greenreach` exists in region `us-east1`
- Docker auth configured for Artifact Registry:

  ```bash
  gcloud auth configure-docker us-east1-docker.pkg.dev
  ```

## Deploy — one command

Build both services (amd64), push to Artifact Registry, resolve digests, and
deploy both Cloud Run services pinned by digest:

```bash
./gcp/deploy-cloud-run-buildx.sh --service both
```

Deploy just one service:

```bash
./gcp/deploy-cloud-run-buildx.sh --service le
./gcp/deploy-cloud-run-buildx.sh --service central
```

Redeploy the existing image without rebuilding (e.g., to roll forward after
a env-var change):

```bash
./gcp/deploy-cloud-run-buildx.sh --service le --skip-build
```

Build + push only, no deploy (useful to stage an image for later promotion):

```bash
./gcp/deploy-cloud-run-buildx.sh --service le --skip-deploy
```

## Deploy — manual steps

If you want to run the three steps yourself (e.g., during an incident):

### 1. Build & push

```bash
# Central
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:latest \
  --push /absolute/path/to/Light-Engine-Foxtrot/greenreach-central/

# Light Engine
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest \
  --push /absolute/path/to/Light-Engine-Foxtrot/
```

Use **absolute paths** for the build context. Relative paths can pick up a
different tree if your shell is in an unexpected working directory.

### 2. Retrieve the authoritative digest

```bash
gcloud artifacts docker images describe \
  us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest \
  --format="value(image_summary.digest)"
```

Output: `sha256:abc123...` — copy the whole string.

### 3. Deploy pinned by digest

```bash
gcloud run services update light-engine \
  --region=us-east1 \
  --image=us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine@sha256:abc123...
```

## Rollback

Cloud Run keeps every deployed revision. To roll back:

```bash
# List recent revisions for a service
gcloud run revisions list --service=light-engine --region=us-east1 --limit=10

# Route 100% traffic to a previous revision
gcloud run services update-traffic light-engine \
  --region=us-east1 \
  --to-revisions=<previous-revision-name>=100
```

Because every deploy was pinned by digest, the previous revision still
references the exact image bytes it was serving — no chance of a cached
`:latest` surprise.

## Deploy from GitHub Actions (WIF — no keys)

Production deploys run through the `Deploy Cloud Run`
GitHub Actions workflow (`.github/workflows/deploy-cloud-run.yml`):
- automatically on pushes to `main` (for deploy-relevant paths), and
- manually via `workflow_dispatch` when targeted deployment control is needed.

The workflow authenticates to GCP via **Workload Identity Federation** —
no long-lived service-account keys are ever created.

### One-time WIF setup (Cloud Shell)

```bash
PROJECT=project-5d00790f-13a9-4637-a40
PROJECT_NUMBER=1029387937866
POOL_ID=github
PROVIDER_ID=greenreach2024
REPO=greenreach2024/Light-Engine-Foxtrot
SA=devin-deployer@$PROJECT.iam.gserviceaccount.com

gcloud iam workload-identity-pools create $POOL_ID \
  --project=$PROJECT --location=global \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc $PROVIDER_ID \
  --project=$PROJECT --location=global --workload-identity-pool=$POOL_ID \
  --display-name="GitHub Actions OIDC" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner=='greenreach2024'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

gcloud iam service-accounts add-iam-policy-binding $SA \
  --project=$PROJECT \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.repository/$REPO"
```

The `devin-deployer` service account must also hold these project roles:
`roles/run.admin`, `roles/artifactregistry.writer`,
`roles/iam.serviceAccountUser`, `roles/storage.admin`.

### Trigger a deploy

From the GitHub UI:
Actions → **Deploy Cloud Run (buildx + digest-pinned)** → Run workflow →
pick `service: both | le | central` → Run.

From the CLI (or from Devin):

```bash
gh workflow run deploy-cloud-run.yml -f service=both
# or
gh workflow run deploy-cloud-run.yml -f service=le -f skip_build=false
```

The workflow runs the same `gcp/deploy-cloud-run-buildx.sh` script, so
the principles above (digest pinning, `linux/amd64`, per-service control)
apply identically.

## Relationship to `gcp/deploy-cloud-run.sh`

`gcp/deploy-cloud-run.sh` is the **initial infrastructure bring-up** script
— it uses Cloud Build and sets all the env vars, secret bindings, VPC
connector, Cloud SQL / AlloyDB wiring, and cross-service URLs from scratch.
Run it once when standing up the project or after large config changes.

`gcp/deploy-cloud-run-buildx.sh` is the **day-to-day deploy** script —
it rebuilds + pushes images with buildx and redeploys by digest, preserving
existing env vars and secret bindings. Use it for normal code-change
deploys.
