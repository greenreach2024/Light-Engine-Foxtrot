# Production Monitoring Setup Guide

## Overview

This guide walks through enabling production monitoring for Light Engine Foxtrot using AWS CloudWatch, Sentry error tracking, and uptime monitoring. All infrastructure code is already built - this document covers configuration and deployment.

---

## ✅ What's Already Built

**CloudWatch Metrics** (`lib/cloudwatch-metrics.js`)
- API response time, request count, error rate
- Database connection health and latency
- Memory usage (MB and percentage)
- System health metrics

**CloudWatch Alarms** (`scripts/setup-cloudwatch-alarms.sh`)
- High 5xx error rate (>50 in 10 min)
- High CPU usage (>80% for 10 min)
- High WAF blocks (>1000 in 10 min)
- Slow response time (>2s for 10 min)
- Unhealthy targets (≥1 for 2 min)

**Python CloudWatch Integration** (`backend/aws_cloudwatch.py`)
- Structured logging to CloudWatch Logs
- Custom metrics from Python backend
- API request logging with metadata

---

## 🚀 Quick Start (15 Minutes)

### Step 1: Enable CloudWatch Metrics

```bash
# Enable CloudWatch in production
eb setenv \
  CLOUDWATCH_ENABLED=true \
  CLOUDWATCH_NAMESPACE=LightEngine/Foxtrot \
  CLOUDWATCH_REGION=us-east-1
```

**Verify:**
```bash
# Check environment variables
eb printenv | grep CLOUDWATCH

# Restart application
eb restart
```

### Step 2: Create SNS Topic for Alerts

```bash
# Create SNS topic
aws sns create-topic \
  --name foxtrot-production-alerts \
  --region us-east-1

# Output: arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:foxtrot-production-alerts
```

### Step 3: Subscribe to Alerts

```bash
# Subscribe your email
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:foxtrot-production-alerts \
  --protocol email \
  --notification-endpoint your-email@example.com

# Check your email and confirm subscription
```

### Step 4: Create CloudWatch Alarms

```bash
# Run alarm setup script
chmod +x scripts/setup-cloudwatch-alarms.sh
./scripts/setup-cloudwatch-alarms.sh arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:foxtrot-production-alerts
```

**Expected Output:**
```
✅ High 5xx Error Rate alarm created
✅ High CPU Usage alarm created
✅ High WAF Blocks alarm created
✅ High Request Latency alarm created
✅ Unhealthy Targets alarm created
```

### Step 5: Verify Metrics Publishing

Wait 5 minutes, then check CloudWatch:

```bash
# List published metrics
aws cloudwatch list-metrics \
  --namespace LightEngine/Foxtrot \
  --region us-east-1

# Check recent API metrics
aws cloudwatch get-metric-statistics \
  --namespace LightEngine/Foxtrot \
  --metric-name APIResponseTime \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum \
  --region us-east-1
```

---

## 📊 CloudWatch Dashboard (Optional but Recommended)

Create a visual dashboard in AWS Console:

### Navigate to CloudWatch Console

1. Go to AWS Console → CloudWatch
2. Click "Dashboards" → "Create dashboard"
3. Name: `foxtrot-production`
4. Add widgets:

### Widget 1: API Performance

- Type: Line graph
- Metrics:
  - `LightEngine/Foxtrot` → `APIResponseTime` (Average)
  - `LightEngine/Foxtrot` → `APIRequests` (Sum)
  - `LightEngine/Foxtrot` → `APIErrors` (Sum)
- Period: 5 minutes
- Title: "API Performance"

### Widget 2: Database Health

- Type: Line graph
- Metrics:
  - `LightEngine/Foxtrot` → `DatabaseConnected` (Average)
  - `LightEngine/Foxtrot` → `DatabaseLatency` (Average)
- Period: 5 minutes
- Title: "Database Health"

### Widget 3: Memory Usage

- Type: Line graph
- Metrics:
  - `LightEngine/Foxtrot` → `MemoryUsed` (Average)
  - `LightEngine/Foxtrot` → `MemoryPercent` (Average)
- Period: 5 minutes
- Title: "Memory Usage"

### Widget 4: Application Errors

- Type: Number
- Metrics:
  - `AWS/ApplicationELB` → `HTTPCode_Target_5XX_Count` (Sum, 1 hour)
- Title: "5xx Errors (Last Hour)"

### Save Dashboard

Click "Save dashboard" to persist your configuration.

---

## 🔍 Sentry Error Tracking (Recommended)

Sentry provides detailed error tracking, performance monitoring, and user context.

### Step 1: Create Sentry Account

1. Go to [sentry.io](https://sentry.io)
2. Sign up (free tier: 5,000 errors/month)
3. Create new project: "Light Engine Foxtrot" (Node.js)
4. Copy DSN: `https://xxxxx@xxxxx.ingest.sentry.io/xxxxx`

### Step 2: Install Sentry SDK

```bash
# Install Sentry SDK
npm install @sentry/node @sentry/profiling-node --save

# Update package.json in production
eb deploy
```

### Step 3: Configure Sentry

```bash
# Set Sentry DSN in production
eb setenv \
  SENTRY_DSN="https://xxxxx@xxxxx.ingest.sentry.io/xxxxx" \
  SENTRY_ENVIRONMENT="production" \
  SENTRY_TRACES_SAMPLE_RATE="0.1"
```

### Step 4: Add Sentry to Server

Edit `server-foxtrot.js` (after dependencies):

```javascript
// Add at top of file
import * as Sentry from "@sentry/node";
import { ProfilingIntegration } from "@sentry/profiling-node";

// Initialize Sentry (before other imports)
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || 'production',
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    profilesSampleRate: 0.1,
    integrations: [
      new ProfilingIntegration(),
    ],
  });
  console.log('[Sentry] Error tracking enabled');
}

// Add error handler middleware (before other middleware)
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());

// Add error handler (after routes, before final error handler)
app.use(Sentry.Handlers.errorHandler());
```

### Step 5: Test Sentry

```bash
# Trigger test error
curl https://your-domain.com/api/test-error

# Check Sentry dashboard for captured error
```

---

## 🌐 Uptime Monitoring

Use external monitoring to detect downtime and regional issues.

### Option 1: UptimeRobot (Free - Recommended)

1. Go to [uptimerobot.com](https://uptimerobot.com)
2. Sign up (free tier: 50 monitors, 5-min intervals)
3. Create monitors:

**Main App Health Check:**
- Type: HTTP(s)
- URL: `https://your-domain.com/health`
- Interval: 5 minutes
- Alert contacts: Your email, SMS

**Wholesale Portal:**
- Type: HTTP(s)
- URL: `https://your-domain.com/wholesale/index.html`
- Interval: 5 minutes
- Keyword: "Wholesale Buyers Portal"

**Farm Sales Portal:**
- Type: HTTP(s)
- URL: `https://your-domain.com/farm-sales.html`
- Interval: 5 minutes
- Keyword: "Farm Sales"

### Option 2: Pingdom (Paid - More Features)

- Real User Monitoring (RUM)
- Transaction monitoring (checkout flow)
- Performance insights
- Cost: $10/month

### Option 3: AWS Route 53 Health Checks

```bash
# Create health check
aws route53 create-health-check \
  --caller-reference $(date +%s) \
  --health-check-config \
    IPAddress=YOUR_ELB_IP,Port=443,Type=HTTPS,ResourcePath=/health,FullyQualifiedDomainName=your-domain.com \
  --region us-east-1

# Create alarm for health check
aws cloudwatch put-metric-alarm \
  --alarm-name foxtrot-health-check-failed \
  --alarm-description "Alert when health check fails" \
  --namespace AWS/Route53 \
  --metric-name HealthCheckStatus \
  --statistic Minimum \
  --period 60 \
  --threshold 1 \
  --comparison-operator LessThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:foxtrot-production-alerts
```

Cost: $0.50/health check/month

---

## 📈 Performance Monitoring

### Application Performance Monitoring (APM)

**Built-in CloudWatch Metrics:**
- API response time (P50, P95, P99)
- Database query latency
- Memory usage trends
- Error rates by endpoint

**Enhanced with Sentry Performance:**
- Distributed tracing across services
- Database query profiling
- External API call tracking
- Frontend performance monitoring

### Real User Monitoring (RUM)

Add to your frontend HTML (`wholesale/index.html`, `farm-sales.html`):

```html
<!-- Add before </body> -->
<script>
  // Simple performance tracking
  window.addEventListener('load', function() {
    if (window.performance) {
      const timing = window.performance.timing;
      const loadTime = timing.loadEventEnd - timing.navigationStart;
      
      // Send to your analytics endpoint
      fetch('/api/analytics/page-load', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          page: window.location.pathname,
          loadTime: loadTime,
          timestamp: new Date().toISOString()
        })
      }).catch(() => {});
    }
  });
</script>
```

---

## 🔔 Alert Configuration

### Critical Alerts (Immediate Response)

**High 5xx Error Rate**
- Threshold: >50 errors in 10 minutes
- Response: Check application logs, recent deployments
- SNS: Email + SMS

**Unhealthy Targets**
- Threshold: ≥1 unhealthy target for 2 minutes
- Response: Check instance health, CPU, memory
- SNS: Email + SMS

**Database Connection Failure**
- Threshold: DatabaseConnected = 0 for 2 data points
- Response: Check RDS status, connection strings
- SNS: Email + SMS + PagerDuty

### Warning Alerts (Investigate Soon)

**High CPU Usage**
- Threshold: >80% for 10 minutes
- Response: Review traffic patterns, optimize code
- SNS: Email only

**Slow Response Time**
- Threshold: >2 seconds average for 10 minutes
- Response: Check database queries, external APIs
- SNS: Email only

**High Memory Usage**
- Threshold: >80% for 10 minutes
- Response: Check for memory leaks, restart if needed
- SNS: Email only

### Informational (Monitor Trends)

**High Traffic**
- Threshold: >1000 requests/min
- Response: Celebrate! Monitor capacity
- SNS: Email daily digest

**Payment Processing Errors**
- Threshold: >5 Square errors in 1 hour
- Response: Check Square API status, credentials
- SNS: Email

---

## 🧪 Testing Your Monitoring

### Test CloudWatch Metrics

```bash
# Generate test traffic
for i in {1..100}; do
  curl -s https://your-domain.com/health > /dev/null
  sleep 0.1
done

# Wait 5 minutes, then check metrics
aws cloudwatch get-metric-statistics \
  --namespace LightEngine/Foxtrot \
  --metric-name APIRequests \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region us-east-1
```

### Test Alarm Notifications

```bash
# Manually trigger alarm (for testing)
aws cloudwatch set-alarm-state \
  --alarm-name foxtrot-high-5xx-errors \
  --state-value ALARM \
  --state-reason "Testing alarm notification" \
  --region us-east-1

# Check your email for SNS notification
# Reset alarm state after test
aws cloudwatch set-alarm-state \
  --alarm-name foxtrot-high-5xx-errors \
  --state-value OK \
  --state-reason "Test complete" \
  --region us-east-1
```

### Test Sentry Error Tracking

Add temporary test endpoint to `server-foxtrot.js`:

```javascript
// Test endpoint for Sentry
app.get('/api/test-error', (req, res, next) => {
  const error = new Error('This is a test error for Sentry');
  error.statusCode = 500;
  next(error);
});
```

```bash
# Trigger test error
curl https://your-domain.com/api/test-error

# Check Sentry dashboard
# Should see error with stack trace, environment context, request details
```

### Test Uptime Monitoring

```bash
# Temporarily stop application to trigger downtime alert
eb restart

# UptimeRobot should detect downtime and send alert
# Application will be back online after restart completes
```

---

## 📊 Metrics to Track

### Daily Review

Check these metrics every morning:

1. **Error Rate**: Should be <1%
2. **Response Time**: P95 should be <500ms
3. **Uptime**: Should be >99.9%
4. **Database Latency**: Should be <50ms
5. **Memory Usage**: Should be <70%

### Weekly Review

1. **Traffic Trends**: Growing? Declining?
2. **Popular Endpoints**: What's being used most?
3. **Error Patterns**: Any recurring issues?
4. **Performance Degradation**: Slowing over time?
5. **Cost Analysis**: CloudWatch costs staying in budget?

### Monthly Review

1. **Availability SLA**: Calculate uptime percentage
2. **Capacity Planning**: Do we need more resources?
3. **Security Events**: Any unusual patterns?
4. **User Experience**: Are performance targets met?
5. **Cost Optimization**: Can we reduce monitoring costs?

---

## 💰 Cost Breakdown

### Free Tier (First Year)

**CloudWatch:**
- 10 custom metrics: FREE
- 10 alarms: FREE
- 5GB logs ingestion: FREE
- 10 API requests/min sampling: ~$0/month

**Total Free Tier: $0/month**

### After Free Tier

**CloudWatch:**
- Custom metrics (7 metrics): $2.10/month
- Alarms (5 alarms): $0.50/month
- Logs ingestion (1GB): $0.50/month
- Logs storage (1GB): $0.03/month

**Sentry:**
- Free tier: 5,000 errors/month
- Team plan: $26/month (50,000 errors)

**UptimeRobot:**
- Free tier: 50 monitors, 5-min intervals
- Pro plan: $7/month (50 monitors, 1-min intervals)

**Total Estimated Cost: $3-10/month**

---

## 🎯 Production Checklist

### Before Launch

- [ ] CloudWatch metrics enabled in production
- [ ] SNS topic created and email confirmed
- [ ] 5 critical CloudWatch alarms created
- [ ] CloudWatch dashboard created
- [ ] Sentry account created and DSN configured
- [ ] Sentry error handler integrated in server
- [ ] UptimeRobot monitors created
- [ ] Test all alarm notifications
- [ ] Test Sentry error capturing
- [ ] Document on-call procedures

### Week 1 Post-Launch

- [ ] Review error rates daily
- [ ] Adjust alarm thresholds based on baseline
- [ ] Configure additional alarms if needed
- [ ] Set up PagerDuty for critical alerts (optional)
- [ ] Create runbook for common issues
- [ ] Train team on monitoring tools

### Month 1 Post-Launch

- [ ] Review all metrics trends
- [ ] Calculate uptime SLA
- [ ] Optimize alarm sensitivity
- [ ] Add performance benchmarks
- [ ] Document lessons learned
- [ ] Plan capacity upgrades if needed

---

## 🔧 Troubleshooting

### Metrics Not Appearing in CloudWatch

**Check environment variables:**
```bash
eb printenv | grep CLOUDWATCH
```

**Check application logs:**
```bash
eb logs | grep CloudWatch
```

**Verify IAM permissions:**
```bash
aws sts get-caller-identity
aws cloudwatch put-metric-data --namespace Test --metric-name TestMetric --value 1
```

### Alarm Notifications Not Received

**Check SNS subscription status:**
```bash
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:foxtrot-production-alerts
```

**Check alarm state:**
```bash
aws cloudwatch describe-alarms \
  --alarm-names foxtrot-high-5xx-errors
```

**Test SNS topic directly:**
```bash
aws sns publish \
  --topic-arn arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:foxtrot-production-alerts \
  --message "Test notification" \
  --subject "Test Alert"
```

### High CloudWatch Costs

**Reduce sampling rate** in `.env`:
```bash
CLOUDWATCH_SAMPLE_RATE=0.05  # 5% instead of 10%
```

**Reduce metrics published** in `lib/cloudwatch-metrics.js`:
- Only publish errors (remove success metrics)
- Increase aggregation period
- Use CloudWatch Embedded Metric Format (EMF)

**Reduce logs ingestion:**
```bash
# Set shorter retention period
aws logs put-retention-policy \
  --log-group-name /aws/elasticbeanstalk/light-engine-foxtrot-prod/var/log/nodejs/nodejs.log \
  --retention-in-days 7
```

---

## 📚 Related Documentation

- [CloudWatch Setup Guide](docs/CLOUDWATCH_SETUP.md) - Detailed metrics documentation
- [AWS Deployment Guide](docs/AWS_DEPLOYMENT_GUIDE.md) - Production deployment
- [Security Configuration](PRODUCTION_SECURITY_CONFIG.md) - Security monitoring
- [AWS Free Tier Usage](scripts/check-aws-free-tier-usage.sh) - Cost monitoring

---

## 🆘 Support & On-Call

### Severity Levels

**P0 - Critical (Respond immediately)**
- Application completely down
- Data loss or corruption
- Security breach

**P1 - High (Respond within 1 hour)**
- Major feature broken
- High error rate (>5%)
- Payment processing failing

**P2 - Medium (Respond within 4 hours)**
- Minor feature issues
- Performance degradation
- Non-critical errors

**P3 - Low (Respond within 1 business day)**
- Cosmetic issues
- Feature requests
- Documentation updates

### Escalation Path

1. **First Responder**: Check CloudWatch, Sentry, application logs
2. **Developer**: Review code, recent deployments, rollback if needed
3. **DevOps**: Check infrastructure, scale resources, database health
4. **Vendor Support**: AWS Support, Sentry Support, Square Support

### Useful Commands

```bash
# Check application status
eb status

# View recent logs
eb logs --stream

# Restart application
eb restart

# Rollback to previous version
eb deploy --version <previous-version>

# Check database
eb ssh
psql -h $RDS_HOSTNAME -U $RDS_USERNAME -d $RDS_DB_NAME

# Check CloudWatch alarms
aws cloudwatch describe-alarms --state-value ALARM

# Check Elastic Beanstalk health
eb health --refresh
```

---

## ✅ Success Metrics

After implementing monitoring, you should have:

1. **Visibility**: Know application health at all times
2. **Alerting**: Get notified of issues before users complain
3. **Debugging**: Quickly identify root cause of errors
4. **Performance**: Track and optimize response times
5. **Reliability**: Maintain >99.9% uptime
6. **Cost Control**: Stay within monitoring budget

**Target SLAs:**
- Uptime: 99.9% (43 minutes downtime/month)
- Error Rate: <0.5% of requests
- Response Time: P95 <500ms, P99 <1s
- Database Latency: P95 <100ms

---

**Setup Time: 15 minutes**  
**Monthly Cost: $0-10 (depending on usage)**  
**Impact: Critical for production operations** 🎯
