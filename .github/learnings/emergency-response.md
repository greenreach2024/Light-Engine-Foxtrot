# Emergency Response

> How to handle production issues correctly on GreenReach Central (Elastic Beanstalk).  
> Updated: 2026-02-11

---

## Quick Reference

| Situation | Action | Time to Fix |
|-----------|--------|-------------|
| Health Yellow (transient) | Wait 5 min, check `/health` | 5 min |
| Health Red (crash loop) | Check logs → rollback or env var disable | 10 min |
| Bad deploy broke something | `eb deploy --version <last-good>` | 5 min |
| New feature broke something | Set `ENABLE_<FEATURE>=false` in EB env | 2 min |
| Database migration failed | Fix SQL, re-run (IF NOT EXISTS is safe) | 10 min |
| API key leaked | Revoke in provider dashboard, rotate in EB | 5 min |

---

## 1. Check Before Panicking

```bash
# Environment health
aws elasticbeanstalk describe-environments \
  --environment-name greenreach-central-prod-v4 \
  --region us-east-1 \
  --query 'Environments[0].{Health:Health,Status:Status}' \
  --output table

# Recent events (last 10)
aws elasticbeanstalk describe-events \
  --environment-name greenreach-central-prod-v4 \
  --region us-east-1 \
  --max-items 10 \
  --output table

# Application logs
eb logs --region us-east-1
```

---

## 2. Feature Isolation via Environment Variables

Every major feature is behind an env-var gate:

| Feature | Env Var | Default | Disable Command |
|---------|---------|---------|-----------------|
| Grant Wizard | `ENABLE_GRANT_WIZARD` | enabled (`!== 'false'`) | Set to `false` |
| AI Pusher | `OPENAI_API_KEY` | conditional | Remove key |
| Grant AI Draft | `GRANT_OPENAI_API_KEY` | conditional | Remove key |

```bash
# Disable grant wizard without redeploying
aws elasticbeanstalk update-environment \
  --environment-name greenreach-central-prod-v4 \
  --option-settings "Namespace=aws:elasticbeanstalk:application:environment,OptionName=ENABLE_GRANT_WIZARD,Value=false" \
  --region us-east-1
```

---

## 3. Rollback to Previous Version

```bash
# List recent application versions
aws elasticbeanstalk describe-application-versions \
  --application-name greenreach-central \
  --region us-east-1 \
  --max-items 5 \
  --query 'ApplicationVersions[].{Label:VersionLabel,Date:DateCreated}' \
  --output table

# Deploy a known-good version
aws elasticbeanstalk update-environment \
  --environment-name greenreach-central-prod-v4 \
  --version-label "app-YYMMDD_HHMMSSXXXXXX" \
  --region us-east-1
```

---

## 4. Database Issues

**Safe pattern:** All migrations use `IF NOT EXISTS`. Re-running is safe.

```bash
# Connect to RDS (credentials in EB env vars)
psql -h $RDS_HOSTNAME -U $RDS_USERNAME -d $RDS_DB_NAME

# Check table exists
\dt grant_*

# Re-run migration if needed (idempotent)
\i migrations/011_grant_wizard.sql
```

**Never do in production:**
- `DROP TABLE` without explicit user approval
- `ALTER TABLE ... DROP COLUMN` without migration plan
- Direct data edits without `BEGIN; ... COMMIT;` transaction

---

## 5. The "Health Yellow" Incident (2026-02-11)

**What happened:** After deploying grant wizard, health went Yellow due to a transient SQL error in `ai-recommendations-pusher.js` referencing `farms.size_sqft` (which had been renamed to `farms.farm_size`).  
**Resolution:** Self-resolved — the pusher caught the error internally and continued. Health returned to Green within minutes.  
**Lesson:** Not every Yellow requires action. Check whether the error is in the new code or pre-existing. The AI pusher error was pre-existing and non-critical.

---

## 6. Deployment Approval Gate

**MANDATORY per `.github/copilot-instructions.md`:**

1. Propose changes with specific file/line edits
2. Get review validation
3. **STOP** — wait for user "APPROVED FOR DEPLOYMENT"
4. Only then execute deploy commands

**Never:**
- Deploy iteratively ("let me try one more fix")
- Assume proposal approval = deployment approval
- Make production changes while debugging
