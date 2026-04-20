# Secret Rotation Runbook

## Overview

All secrets used by GreenReach services should be rotated on a regular schedule.
This document defines the rotation cadence, procedure, and verification steps.

## Secret Inventory

| Secret | Service | Storage | Rotation Cadence |
|--------|---------|---------|-----------------|
| `SQUARE_ACCESS_TOKEN` | Central | Secret Manager | 6 months |
| `SQUARE_APPLICATION_ID` | Central | Secret Manager | On compromise only |
| `SWITCHBOT_TOKEN` | LE | Secret Manager | 12 months |
| `SWITCHBOT_SECRET` | LE | Secret Manager | 12 months |
| `JWT_SECRET` | Both | Secret Manager | 6 months |
| `TOKEN_ENCRYPTION_KEY` | LE | Secret Manager | 6 months |
| `OPENAI_API_KEY` | Central | Secret Manager | 6 months |
| `GOOGLE_SMTP_PASSWORD` | Central | Secret Manager | 12 months |

## Rotation Procedure

### 1. Generate New Secret

For JWT/encryption keys:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

For API keys: Generate in the respective service dashboard (Square, SwitchBot, OpenAI).

### 2. Update Secret Manager

```bash
echo -n "NEW_VALUE" | gcloud secrets versions add SECRET_NAME --data-file=-
```

### 3. Deploy Updated Services

```bash
# LE service
gcloud run services update light-engine --region=us-east1 --update-secrets=...

# Central service
gcloud run services update greenreach-central --region=us-east1 --update-secrets=...
```

### 4. Verify

- Check Cloud Run logs for startup errors
- Hit health endpoint: `curl https://SERVICE_URL/health`
- For JWT: verify existing sessions still work (grace period)
- For SwitchBot: verify sensor data updates within 5 minutes
- For Square: verify payment processing with test transaction

### 5. Disable Old Version

```bash
gcloud secrets versions disable SECRET_NAME --version=PREVIOUS_VERSION
```

Wait 24 hours before destroying old version (rollback window).

## JWT Rotation Notes

JWT_SECRET rotation invalidates all existing tokens. Mitigation:
- Accept both old and new secret for 24 hours (dual-validation)
- Or: schedule rotation during low-traffic window
- Active sessions re-authenticate on next API call

## Emergency Rotation

If a secret is compromised:
1. Generate and deploy new secret immediately
2. Disable compromised version in Secret Manager
3. Check Cloud Run audit logs for unauthorized access
4. Review application logs for anomalous activity
5. Document incident in `docs/incidents/`

## Schedule

| Month | Secrets Due |
|-------|-------------|
| January | JWT_SECRET, TOKEN_ENCRYPTION_KEY |
| April | SQUARE_ACCESS_TOKEN, OPENAI_API_KEY |
| July | JWT_SECRET, TOKEN_ENCRYPTION_KEY |
| October | SQUARE_ACCESS_TOKEN, OPENAI_API_KEY, SWITCHBOT_TOKEN, SWITCHBOT_SECRET, GOOGLE_SMTP_PASSWORD |
