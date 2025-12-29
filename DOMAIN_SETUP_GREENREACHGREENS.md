# Domain Setup: greenreachgreens.com

**Status**: In Progress  
**Domain Registrar**: GoDaddy  
**DNS Provider**: AWS Route 53  
**SSL Certificate**: AWS Certificate Manager  
**Created**: December 28, 2025

---

## ✅ Completed Steps

### 1. SSL Certificate Requested
- **Certificate ARN**: `arn:aws:acm:us-east-1:634419072974:certificate/adfc4d01-f688-45a2-a313-24cb4601f8e1`
- **Domains**: greenreachgreens.com, www.greenreachgreens.com
- **Validation Method**: DNS (CNAME)
- **Status**: Pending validation

### 2. Route 53 Hosted Zone Created
- **Hosted Zone ID**: `Z02791482E5YFILHRDI2`
- **Nameservers**:
  - ns-1446.awsdns-52.org
  - ns-920.awsdns-51.net
  - ns-1925.awsdns-48.co.uk
  - ns-112.awsdns-14.com

### 3. DNS Validation Records Added
SSL certificate validation CNAME records have been added to Route 53:
- `_dd2e5c5369e9f3f3f91a42b835f0e3dc.greenreachgreens.com` → `_0df06ff326ddd12539fec87f9d1d0c87.jkddzztszm.acm-validations.aws.`
- `_f89e485e6a1c6b5487d57e5db2e93511.www.greenreachgreens.com` → `_ec09e1406b2bfd09b77b03af516df07e.jkddzztszm.acm-validations.aws.`

### 4. CORS Configuration Updated
Backend now allows requests from:
- http://greenreachgreens.com
- https://greenreachgreens.com
- http://www.greenreachgreens.com
- https://www.greenreachgreens.com

---

## 🔄 Next Steps (Manual Required)

### Step 1: Update GoDaddy Nameservers

**IMPORTANT**: You must update your domain's nameservers in GoDaddy to point to AWS Route 53.

1. Log in to your GoDaddy account: https://dcc.godaddy.com/
2. Navigate to: **My Products** > **Domains** > **greenreachgreens.com**
3. Click **Manage DNS** or **Change Nameservers**
4. Select **Custom Nameservers** or **I'll use my own nameservers**
5. Replace existing nameservers with these AWS Route 53 nameservers:

```
ns-1446.awsdns-52.org
ns-920.awsdns-51.net
ns-1925.awsdns-48.co.uk
ns-112.awsdns-14.com
```

6. Save changes

**Propagation Time**: DNS changes can take 24-48 hours to fully propagate globally, though often much faster.

---

### Step 2: Wait for SSL Certificate Validation

Once nameservers are updated in GoDaddy:
- AWS will automatically validate your SSL certificate via the DNS CNAME records
- This usually takes 5-30 minutes after DNS propagation
- Check status with:
  ```bash
  aws acm describe-certificate \
    --certificate-arn arn:aws:acm:us-east-1:634419072974:certificate/adfc4d01-f688-45a2-a313-24cb4601f8e1 \
    --region us-east-1 \
    --query 'Certificate.Status' \
    --output text
  ```

Expected result: `ISSUED` (currently: `PENDING_VALIDATION`)

---

### Step 3: Configure Elastic Beanstalk Load Balancer

After SSL certificate is validated (Status: ISSUED), configure HTTPS:

1. Go to AWS Console: **Elastic Beanstalk** > **light-engine-foxtrot-prod** > **Configuration**
2. Click **Edit** in the **Load balancer** section
3. Under **Listeners**, add new listener:
   - **Port**: 443
   - **Protocol**: HTTPS
   - **SSL Certificate**: Select `greenreachgreens.com` certificate
   - **SSL Policy**: ELBSecurityPolicy-TLS13-1-2-2021-06 (or latest recommended)
4. Click **Apply**
5. Wait for environment update to complete (~5-10 minutes)

---

### Step 4: Create Route 53 Alias Records

Point your domain to the Elastic Beanstalk environment:

```bash
# Get Elastic Beanstalk environment URL first
eb status

# Create A records (root domain)
aws route53 change-resource-record-sets \
  --hosted-zone-id Z02791482E5YFILHRDI2 \
  --change-batch '{
    "Changes": [
      {
        "Action": "CREATE",
        "ResourceRecordSet": {
          "Name": "greenreachgreens.com",
          "Type": "A",
          "AliasTarget": {
            "HostedZoneId": "Z35SXDOTRQ7X7K",
            "DNSName": "light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com",
            "EvaluateTargetHealth": true
          }
        }
      }
    ]
  }'

# Create A record (www subdomain)
aws route53 change-resource-record-sets \
  --hosted-zone-id Z02791482E5YFILHRDI2 \
  --change-batch '{
    "Changes": [
      {
        "Action": "CREATE",
        "ResourceRecordSet": {
          "Name": "www.greenreachgreens.com",
          "Type": "A",
          "AliasTarget": {
            "HostedZoneId": "Z35SXDOTRQ7X7K",
            "DNSName": "light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com",
            "EvaluateTargetHealth": true
          }
        }
      }
    ]
  }'
```

**Note**: `Z35SXDOTRQ7X7K` is the hosted zone ID for Elastic Beanstalk environments in us-east-1.

---

## 🎯 Final URLs

Once complete, your Greenreach platform will be accessible at:

### Production URLs
- **Main Domain**: https://greenreachgreens.com
- **WWW Domain**: https://www.greenreachgreens.com

### Key Pages
- **Farm Admin**: https://greenreachgreens.com/farm-admin.html
- **First-Time Setup**: https://greenreachgreens.com/farm-admin.html (auto-detects first run)
- **Farm Store**: https://greenreachgreens.com/farm-store.html
- **Farm Sales (POS)**: https://greenreachgreens.com/farm-sales.html
- **Wholesale Portal**: https://greenreachgreens.com/wholesale.html
- **Inventory Management**: https://greenreachgreens.com/views/tray-inventory.html
- **Orders**: https://greenreachgreens.com/orders.html

---

## 📊 Verification Commands

### Check DNS Propagation
```bash
# Check nameservers
dig NS greenreachgreens.com

# Check A record (after Step 4)
dig A greenreachgreens.com

# Check SSL validation CNAME
dig CNAME _dd2e5c5369e9f3f3f91a42b835f0e3dc.greenreachgreens.com
```

### Check SSL Certificate Status
```bash
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:634419072974:certificate/adfc4d01-f688-45a2-a313-24cb4601f8e1 \
  --region us-east-1
```

### Test HTTPS Access
```bash
# Test root domain
curl -I https://greenreachgreens.com/health

# Test www subdomain
curl -I https://www.greenreachgreens.com/health

# Check SSL certificate
openssl s_client -connect greenreachgreens.com:443 -servername greenreachgreens.com < /dev/null
```

---

## 🔒 Security Features

- ✅ HTTPS enforced via AWS Certificate Manager
- ✅ CORS configured for greenreachgreens.com
- ✅ TLS 1.3 support
- ✅ Automatic certificate renewal
- ✅ DNS managed by AWS Route 53

---

## 📝 Monthly Costs

- **Route 53 Hosted Zone**: $0.50/month
- **Route 53 Queries**: ~$0.40/month (standard usage)
- **ACM Certificate**: FREE
- **Total**: ~$0.90/month for domain services

---

## 🆘 Troubleshooting

### Domain doesn't resolve
- Check nameservers in GoDaddy match Route 53 nameservers
- Wait 24-48 hours for DNS propagation
- Use `dig NS greenreachgreens.com` to verify

### SSL Certificate stuck in "Pending Validation"
- Verify CNAME records exist in Route 53: `dig CNAME _dd2e5c5369e9f3f3f91a42b835f0e3dc.greenreachgreens.com`
- Ensure nameservers are updated in GoDaddy
- DNS must propagate before AWS can validate

### HTTPS not working
- Confirm SSL certificate status is `ISSUED`
- Verify HTTPS listener is configured on load balancer (port 443)
- Check security groups allow port 443

### CORS errors in browser console
- Already configured! greenreachgreens.com is in the allowed origins list
- Backend deployment with CORS update must complete successfully

---

## 📞 Support

**AWS Resources**:
- Certificate Manager: https://console.aws.amazon.com/acm/home?region=us-east-1
- Route 53: https://console.aws.amazon.com/route53/v2/hostedzones#ListRecordSets/Z02791482E5YFILHRDI2
- Elastic Beanstalk: https://console.aws.amazon.com/elasticbeanstalk/home?region=us-east-1#/environment/dashboard?applicationName=light-engine-foxtrot&environmentId=e-ukiyyqf9

**GoDaddy**:
- Domain Management: https://dcc.godaddy.com/domains

---

**Last Updated**: December 28, 2025  
**Next Action**: Update nameservers in GoDaddy (Step 1)
