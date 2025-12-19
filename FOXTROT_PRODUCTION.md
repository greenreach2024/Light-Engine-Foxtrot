# Light Engine Foxtrot - Production Environment

## Repository Structure

**Foxtrot** = Clean production repository  
**Delta** = Backup repository (not deployed to AWS)

## AWS Deployment

**Production URL:**  
https://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/

**Environment:** `light-engine-foxtrot-prod`  
**Status:** Active (Green)  
**Region:** us-east-1  
**Platform:** Node.js 20 on Amazon Linux 2023

## Deployment Commands

```bash
# Check status
eb status light-engine-foxtrot-prod

# Deploy to production
git add -A
git commit -m "Your commit message"
git push origin main
eb deploy light-engine-foxtrot-prod

# View logs
eb logs light-engine-foxtrot-prod

# Check health
eb health light-engine-foxtrot-prod
```

## Recent Fixes (Dec 19, 2025)

- ✅ Wizard CSS moved to `<head>` for proper timing
- ✅ Dynamic style injection removed
- ✅ Z-index increased to 99999
- ✅ All wizard buttons now functional

## Working Directory

Always work from: `/Users/petergilbert/Light-Engine-Foxtrot`

Delta terminated from AWS on: December 19, 2025 at 16:44 UTC
