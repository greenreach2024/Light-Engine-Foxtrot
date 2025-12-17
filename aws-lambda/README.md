# AWS Lambda Deployment Guide

## Quick Deploy (AWS Console)

### Step 1: Create Lambda Function

1. Go to [AWS Lambda Console](https://console.aws.amazon.com/lambda)
2. Click **Create function**
3. Choose **Author from scratch**
4. Configure:
   - **Function name**: `light-engine-sensor-aggregator`
   - **Runtime**: Node.js 20.x
   - **Architecture**: arm64 (cheaper) or x86_64
5. Click **Create function**

### Step 2: Upload Code

**Option A: Inline Code Editor**
1. Copy contents of `index.mjs`
2. In Lambda console, go to **Code** tab
3. Replace `index.mjs` content
4. Click **Deploy**

**Option B: ZIP Upload**
```bash
cd aws-lambda
npm run package
# Upload function.zip via Lambda console
```

### Step 3: Configure Environment Variables

In Lambda console → **Configuration** → **Environment variables**:

Add these variables:
- `SWITCHBOT_TOKEN`: Your SwitchBot API token
- `SWITCHBOT_SECRET`: Your SwitchBot API secret

### Step 4: Adjust Function Settings

**Configuration** → **General configuration**:
- **Memory**: 256 MB
- **Timeout**: 10 seconds

### Step 5: Create Function URL

1. Go to **Configuration** → **Function URL**
2. Click **Create function URL**
3. **Auth type**: NONE (or AWS_IAM if you want auth)
4. **CORS**:
   - Allow origin: `*`
   - Allow methods: `GET`
   - Allow headers: `*`
5. Click **Save**
6. **Copy the Function URL** (e.g., `https://abc123.lambda-url.us-east-1.on.aws/`)

### Step 6: Test the Function

**In AWS Console**:
1. Go to **Test** tab
2. Create test event:
```json
{
  "queryStringParameters": {}
}
```
3. Click **Test**
4. Check response - should see sensor data array

**From command line**:
```bash
curl https://YOUR-FUNCTION-URL.lambda-url.us-east-1.on.aws/
```

Expected response:
```json
[
  {
    "zone": "zone-C3343035702D",
    "zoneName": "Strawberry Room",
    "deviceId": "C3343035702D",
    "temperature": 21.8,
    "humidity": 74,
    "battery": 95,
    "timestamp": "2025-10-25T14:30:00.000Z"
  }
]
```

## Deploy with AWS CLI

If you have AWS CLI configured:

```bash
cd aws-lambda

# Package the function
zip -r function.zip index.mjs package.json

# Create the function
aws lambda create-function \
  --function-name light-engine-sensor-aggregator \
  --runtime nodejs20.x \
  --role arn:aws:iam::YOUR-ACCOUNT-ID:role/lambda-execution-role \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --timeout 10 \
  --memory-size 256 \
  --environment Variables="{SWITCHBOT_TOKEN=your-token,SWITCHBOT_SECRET=your-secret}"

# Create function URL
aws lambda create-function-url-config \
  --function-name light-engine-sensor-aggregator \
  --auth-type NONE \
  --cors AllowOrigins="*",AllowMethods="GET",AllowHeaders="*"

# Get the function URL
aws lambda get-function-url-config \
  --function-name light-engine-sensor-aggregator
```

## Deploy with SAM (Recommended for Production)

See `template.yaml` for SAM deployment configuration.

```bash
sam build
sam deploy --guided
```

## Configure Light Engine Charlie

After deploying Lambda, configure your local environment:

### Option 1: Environment Variables

```bash
export ENV_SOURCE=cloud
export AWS_ENDPOINT_URL=https://YOUR-FUNCTION-URL.lambda-url.us-east-1.on.aws/
npm run start
```

### Option 2: .env File

Create `.env` in project root:
```bash
ENV_SOURCE=cloud
AWS_ENDPOINT_URL=https://YOUR-FUNCTION-URL.lambda-url.us-east-1.on.aws/
```

Then start the server:
```bash
npm run start
```

## Verify Integration

1. Start Light Engine Charlie server
2. Check configuration:
   ```bash
   curl http://localhost:8091/config | jq '.envSource, .cloudEndpointUrl'
   ```
   Should show:
   ```
   "cloud"
   "https://YOUR-FUNCTION-URL..."
   ```

3. Check sensor data:
   ```bash
   curl http://localhost:8091/env | jq '.zones[0]'
   ```

## Monitoring

**CloudWatch Logs**:
- Lambda → Monitor → View logs in CloudWatch

**Metrics to watch**:
- Invocation count
- Duration (should be < 2s)
- Error rate
- Throttles

## Cost Estimates

**Free Tier** (first 12 months):
- 1M Lambda requests/month
- 400,000 GB-seconds compute

**After Free Tier**:
- Requests: $0.20 per 1M requests
- Compute: $0.0000166667 per GB-second

**Example**: Polling every 30 seconds = ~86,400 requests/month = FREE

## Troubleshooting

**"Internal server error"**:
- Check CloudWatch logs
- Verify SWITCHBOT_TOKEN and SWITCHBOT_SECRET are set
- Check Lambda has internet access

**Empty array response**:
- Verify SwitchBot credentials are correct
- Check device types in SwitchBot app
- Review Lambda logs for API errors

**CORS errors**:
- Ensure Function URL CORS is configured
- Check Allow-Origin header in response

## Security Hardening

For production:
1. Change Auth type to AWS_IAM
2. Use Secrets Manager for credentials
3. Set up VPC if accessing private resources
4. Enable AWS X-Ray for tracing
5. Add rate limiting via API Gateway
