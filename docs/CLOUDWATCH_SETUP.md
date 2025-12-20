# CloudWatch Metrics & Alerting Setup Guide

## Overview

Light Engine Foxtrot integrates with AWS CloudWatch for production monitoring, custom metrics publishing, and automated alerting. This guide covers configuration, metrics published, and alarm setup.

## Features

- **Custom Metrics Publishing**: API performance, database health, memory usage, order tracking
- **Automatic Sampling**: 10% request sampling to reduce costs (100% for errors)
- **Non-blocking**: Asynchronous metrics publishing doesn't impact request latency
- **Graceful Degradation**: Server continues if CloudWatch is unavailable
- **Cost-Optimized**: Stays within AWS Free Tier limits (10 custom metrics)

## Configuration

### Environment Variables

Add to your `.env` file or Elastic Beanstalk environment configuration:

```bash
# Enable CloudWatch metrics
CLOUDWATCH_ENABLED=true

# Custom metrics namespace (default: LightEngine/Foxtrot)
CLOUDWATCH_NAMESPACE=LightEngine/Foxtrot

# AWS region (default: us-east-1)
CLOUDWATCH_REGION=us-east-1

# AWS credentials (or use IAM roles)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

### IAM Permissions (Recommended for Production)

Create an IAM role with the following policy and attach to your EC2 instance or Elastic Beanstalk environment:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData",
        "cloudwatch:GetMetricStatistics",
        "cloudwatch:ListMetrics"
      ],
      "Resource": "*"
    }
  ]
}
```

## Published Metrics

### 1. API Performance Metrics

**Namespace**: `LightEngine/Foxtrot`

| Metric Name | Unit | Dimensions | Description |
|-------------|------|------------|-------------|
| `APIResponseTime` | Milliseconds | Endpoint, Method, StatusCode | Response time per endpoint |
| `APIRequests` | Count | Endpoint, Method, StatusCode | Total request count |
| `APIErrors` | Count | Endpoint, Method, StatusCode | Failed requests (status >= 400) |

**Sampling**: 10% of successful requests, 100% of errors

### 2. Database Health Metrics

**Namespace**: `LightEngine/Foxtrot`

| Metric Name | Unit | Dimensions | Description |
|-------------|------|------------|-------------|
| `DatabaseConnected` | Count | DatabaseMode | Connection status (1=connected, 0=disconnected) |
| `DatabaseLatency` | Milliseconds | DatabaseMode | Connection latency |

**Publishing**: Every `/health` endpoint call

### 3. Memory Metrics

**Namespace**: `LightEngine/Foxtrot`

| Metric Name | Unit | Dimensions | Description |
|-------------|------|------------|-------------|
| `MemoryUsed` | Megabytes | - | Heap memory used |
| `MemoryPercent` | Percent | - | Memory usage percentage |

**Publishing**: Every `/health` endpoint call

### 4. Wholesale Order Metrics

**Namespace**: `LightEngine/Foxtrot`

| Metric Name | Unit | Dimensions | Description |
|-------------|------|------------|-------------|
| `WholesaleOrders` | Count | FarmId, OrderStatus | Orders by status (reserved, confirmed, released) |
| `InventoryAvailable` | Count | FarmId | Available inventory |
| `InventoryReserved` | Count | FarmId | Reserved inventory |

**Publishing**: On order and inventory operations

## CloudWatch Alarms

### Creating Alarms via AWS CLI

#### 1. High Error Rate Alarm

Alert when error rate exceeds 5%:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name foxtrot-high-error-rate \
  --alarm-description "Alert when API error rate exceeds 5%" \
  --namespace LightEngine/Foxtrot \
  --metric-name APIErrors \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:foxtrot-alerts
```

#### 2. Slow Response Time Alarm

Alert when P95 response time exceeds 1 second:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name foxtrot-slow-response-time \
  --alarm-description "Alert when P95 response time exceeds 1s" \
  --namespace LightEngine/Foxtrot \
  --metric-name APIResponseTime \
  --statistic p95 \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 1000 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:foxtrot-alerts
```

#### 3. Database Connection Failure

Alert when database becomes disconnected:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name foxtrot-database-disconnected \
  --alarm-description "Alert when database connection fails" \
  --namespace LightEngine/Foxtrot \
  --metric-name DatabaseConnected \
  --statistic Average \
  --period 60 \
  --evaluation-periods 3 \
  --threshold 1 \
  --comparison-operator LessThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:foxtrot-alerts \
  --dimensions Name=DatabaseMode,Value=postgresql
```

#### 4. High Memory Usage

Alert when memory usage exceeds 80%:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name foxtrot-high-memory-usage \
  --alarm-description "Alert when memory usage exceeds 80%" \
  --namespace LightEngine/Foxtrot \
  --metric-name MemoryPercent \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:foxtrot-alerts
```

## SNS Topic Setup

Create an SNS topic for alarm notifications:

```bash
# Create SNS topic
aws sns create-topic --name foxtrot-alerts

# Subscribe email to topic
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:foxtrot-alerts \
  --protocol email \
  --notification-endpoint your-email@example.com

# Confirm subscription via email
```

## Testing Metrics

### 1. Enable CloudWatch in Development

```bash
export CLOUDWATCH_ENABLED=true
export CLOUDWATCH_REGION=us-east-1
npm start
```

### 2. Generate Test Traffic

```bash
# Send test requests
for i in {1..50}; do
  curl -s http://localhost:8091/health > /dev/null
done

# Trigger errors
curl -s http://localhost:8091/api/nonexistent
```

### 3. View Metrics in CloudWatch

```bash
# List published metrics
aws cloudwatch list-metrics --namespace LightEngine/Foxtrot

# Get metric statistics
aws cloudwatch get-metric-statistics \
  --namespace LightEngine/Foxtrot \
  --metric-name APIResponseTime \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum
```

## Cost Optimization

### Free Tier Limits

- **10 custom metrics**: Free forever
- **1 million API requests**: Free per month
- **10 alarms**: Free

### Our Usage

- **7 metrics**: APIResponseTime, APIRequests, APIErrors, DatabaseConnected, DatabaseLatency, MemoryUsed, MemoryPercent
- **10% sampling**: Reduces data points by 90%
- **Strategic publishing**: Only on /health calls and errors

### Estimated Monthly Cost

With 10% sampling at 1000 req/day:
- Data points: ~3,000/month
- Alarms: 4
- **Total**: $0.00 (within free tier)

## Monitoring Dashboard

Create a CloudWatch dashboard to visualize metrics:

```bash
aws cloudwatch put-dashboard \
  --dashboard-name foxtrot-production \
  --dashboard-body file://cloudwatch-dashboard.json
```

Example dashboard JSON:

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["LightEngine/Foxtrot", "APIResponseTime", {"stat": "Average"}],
          ["...", {"stat": "p95"}]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "API Response Time"
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["LightEngine/Foxtrot", "APIErrors", {"stat": "Sum"}],
          [".", "APIRequests", {"stat": "Sum"}]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "us-east-1",
        "title": "API Requests & Errors"
      }
    }
  ]
}
```

## Troubleshooting

### Metrics Not Appearing

1. **Check AWS credentials**:
   ```bash
   aws sts get-caller-identity
   ```

2. **Verify IAM permissions**:
   ```bash
   aws cloudwatch put-metric-data --namespace Test --metric-name TestMetric --value 1
   ```

3. **Check server logs**:
   ```bash
   grep "CloudWatch" /var/log/nodejs/nodejs.log
   ```

### High Costs

1. **Reduce sampling rate** in `lib/cloudwatch-metrics.js`:
   ```javascript
   const shouldSample = Math.random() < 0.05; // 5% instead of 10%
   ```

2. **Increase publish interval** in `.env`:
   ```bash
   CLOUDWATCH_PUBLISH_INTERVAL=300000  # 5 minutes instead of 1 minute
   ```

## Next Steps

1. ✅ Enable CloudWatch in production environment
2. ✅ Create SNS topic and subscribe email
3. ✅ Set up 4 critical alarms (errors, response time, database, memory)
4. ✅ Create monitoring dashboard
5. ⏳ Test alarm notifications
6. ⏳ Review metrics after 24 hours
7. ⏳ Adjust thresholds based on baseline

## Related Documentation

- [AWS CloudWatch Metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/working_with_metrics.html)
- [AWS CloudWatch Alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html)
- [Light Engine Health Monitoring](../PRODUCTION_DEPLOYMENT_SUMMARY.md#monitoring)
- [AWS Free Tier Limits](https://aws.amazon.com/cloudwatch/pricing/)
