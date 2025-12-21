# AWS Deployment Checklist - Light Engine Foxtrot

Use this checklist to ensure a smooth production deployment to AWS.

## Pre-Deployment

### ✅ Prerequisites
- [ ] AWS Account created and billing enabled
- [ ] IAM user created with required policies
- [ ] AWS CLI installed and configured (`aws --version`)
- [ ] EB CLI installed (`eb --version`)
- [ ] Credentials tested (`aws sts get-caller-identity`)

### ✅ Code Preparation
- [ ] All production tasks completed (9/13 done)
- [ ] Code committed to git repository
- [ ] .env.example updated with all variables
- [ ] package.json dependencies up to date
- [ ] No sensitive data in repository

### ✅ Configuration Review
- [ ] .ebextensions/nodejs.config reviewed
- [ ] DEMO_MODE set to false in production config
- [ ] PORT set to 8091
- [ ] CloudWatch enabled in config

---

## Deployment Steps

### 1. Database Setup
- [ ] RDS PostgreSQL instance created (db.t3.micro)
- [ ] Database credentials generated
- [ ] DB password stored in Secrets Manager (`foxtrot/db-password`)
- [ ] Security groups configured (port 5432)
- [ ] DB subnet group created
- [ ] RDS instance is available (check status)
- [ ] RDS endpoint retrieved and saved

### 2. Secrets Management
- [ ] JWT secret generated (64 bytes, base64)
- [ ] JWT secret stored in Secrets Manager (`foxtrot/jwt-secret`)
- [ ] Square Access Token stored (if using Square)
- [ ] Square Location ID stored (if using Square)
- [ ] All secrets verified in AWS console

### 3. Elastic Beanstalk
- [ ] EB application initialized (`eb init`)
- [ ] Environment name chosen (foxtrot-production)
- [ ] Instance type selected (t3.small)
- [ ] Environment variables configured
- [ ] IAM roles configured for EC2 instances
- [ ] EB environment created
- [ ] Health checks configured (/health endpoint)

### 4. Networking
- [ ] EB security group identified
- [ ] RDS security group allows EB instances (port 5432)
- [ ] VPC and subnets configured
- [ ] Load balancer configured (if using)

### 5. Application Deployment
- [ ] Code deployed to EB (`eb deploy`)
- [ ] Deployment successful (no errors)
- [ ] Application health is "Green"
- [ ] Health endpoint accessible (`/health`)
- [ ] Database connection verified

### 6. Database Initialization
- [ ] SSH into EB instance
- [ ] Alembic migrations run (`alembic upgrade head`)
- [ ] Database tables created
- [ ] Initial data seeded (if needed)

### 7. Monitoring & Alerts
- [ ] CloudWatch metrics verified (7 custom metrics)
- [ ] SNS topic created for alerts
- [ ] Email subscribed to SNS topic
- [ ] SNS subscription confirmed (check email)
- [ ] 4 CloudWatch alarms created:
  - [ ] High error rate alarm
  - [ ] Slow response time alarm
  - [ ] Database disconnection alarm
  - [ ] High memory usage alarm
- [ ] CloudWatch dashboard created (optional)

---

## Post-Deployment Testing

### Functional Tests
- [ ] Health endpoint returns 200: `curl https://app-url/health`
- [ ] Metrics endpoint accessible: `curl https://app-url/metrics`
- [ ] API endpoints respond correctly
- [ ] Database queries working
- [ ] Authentication working (JWT tokens)
- [ ] Farm API key authentication working

### Security Tests
- [ ] HTTPS enabled (no HTTP access)
- [ ] Security headers present (Helmet.js)
- [ ] Rate limiting active (test with curl loop)
- [ ] Input validation working (test with bad data)
- [ ] SQL injection prevention verified
- [ ] XSS prevention verified

### Performance Tests
- [ ] Response time < 200ms for simple endpoints
- [ ] Database query latency < 50ms
- [ ] Memory usage < 70% under normal load
- [ ] No memory leaks detected

### Monitoring Tests
- [ ] CloudWatch metrics publishing (check AWS console)
- [ ] API metrics visible in CloudWatch
- [ ] Database metrics visible in CloudWatch
- [ ] Memory metrics visible in CloudWatch
- [ ] Test alarm triggers (intentionally cause error)
- [ ] SNS notifications received

---

## Configuration Verification

### Environment Variables
Verify these are set correctly in EB environment:

```bash
eb printenv foxtrot-production
```

Expected values:
- [ ] `NODE_ENV=production`
- [ ] `PORT=8091`
- [ ] `DB_ENABLED=true`
- [ ] `DB_HOST=<rds-endpoint>`
- [ ] `DB_PORT=5432`
- [ ] `DB_NAME=foxtrot_production`
- [ ] `DB_USER=foxtrot_admin`
- [ ] `RATE_LIMITING_ENABLED=true`
- [ ] `AUDIT_LOG_ENABLED=true`
- [ ] `CLOUDWATCH_ENABLED=true`
- [ ] `CLOUDWATCH_REGION=us-east-1`
- [ ] `CLOUDWATCH_NAMESPACE=LightEngine/Foxtrot`

### Secrets Verification
Check secrets are accessible from EB instance:

```bash
eb ssh foxtrot-production
printenv | grep -E '(JWT_SECRET|DB_PASSWORD|SQUARE_)'
exit
```

---

## Documentation

- [ ] Deployment date and time recorded
- [ ] RDS endpoint documented
- [ ] SNS topic ARN documented
- [ ] Application URL documented
- [ ] Database credentials saved in password manager
- [ ] Deployment guide reviewed by team
- [ ] Runbook created for operations team
- [ ] Rollback procedures tested
- [ ] Incident response plan documented

---

## Cost Monitoring

- [ ] AWS Cost Explorer reviewed
- [ ] Estimated monthly cost: $34 (or ~$2-5 with Free Tier)
- [ ] Billing alerts set up
- [ ] Cost allocation tags added (optional)
- [ ] Budget created in AWS Budgets

**Cost Breakdown**:
- Elastic Beanstalk (t3.small): ~$15/month
- RDS PostgreSQL (db.t3.micro): ~$16/month
- CloudWatch (7 metrics, 4 alarms): ~$1/month
- Secrets Manager (3 secrets): ~$1/month
- Data Transfer: ~$1/month

---

## Rollback Preparation

- [ ] Previous version label noted: `________________`
- [ ] Rollback command tested in staging
- [ ] Database snapshot taken before deployment
- [ ] Rollback procedures documented
- [ ] Team trained on rollback process

**Rollback Command**:
```bash
eb deploy foxtrot-production --version <previous-version>
```

---

## Sign-Off

### Deployment Team

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Developer | _____________ | ______ | _________ |
| DevOps | _____________ | ______ | _________ |
| QA | _____________ | ______ | _________ |
| Manager | _____________ | ______ | _________ |

### Deployment Details

- **Deployment Date**: _________________
- **Deployment Time**: _________________
- **Version Deployed**: _________________
- **Application URL**: _________________
- **RDS Endpoint**: _________________
- **SNS Topic ARN**: _________________

---

## Post-Deployment Monitoring (24 hours)

### Hour 1
- [ ] Application health is "Green"
- [ ] No errors in logs
- [ ] CloudWatch metrics publishing
- [ ] Memory usage < 70%

### Hour 4
- [ ] Application still healthy
- [ ] No database connection issues
- [ ] No alarm notifications received
- [ ] Response times normal

### Hour 12
- [ ] Overnight stability verified
- [ ] Automated tasks running (if any)
- [ ] Backup completed successfully
- [ ] No unexpected costs

### Hour 24
- [ ] Full 24-hour stability confirmed
- [ ] Performance metrics within acceptable range
- [ ] No critical issues reported
- [ ] Ready for production traffic

---

## Next Steps

After successful deployment:

1. **Configure Custom Domain**: Use Route 53 to set up custom domain
2. **Set up WAF Rules**: Add AWS WAF for additional security
3. **Configure CDN**: Use CloudFront for static assets
4. **Set up CI/CD**: Automate deployments with GitHub Actions
5. **Load Testing**: Perform comprehensive load testing
6. **Disaster Recovery**: Test backup and restore procedures
7. **Documentation**: Complete operational runbook
8. **Training**: Train operations team on monitoring and incident response

---

## Issues & Notes

Document any issues encountered during deployment:

| Issue | Resolution | Date | By |
|-------|------------|------|-----|
|  |  |  |  |
|  |  |  |  |
|  |  |  |  |

---

## Approval

**Deployment Approved for Production**: [ ] Yes [ ] No

**Approver**: _____________________  
**Date**: _____________  
**Signature**: _____________________

---

**Checklist Version**: 1.0.0  
**Last Updated**: Task #10 - AWS Infrastructure Deployment  
**Contact**: support@lightenginefoxtrot.com
