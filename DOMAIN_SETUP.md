# Domain Configuration - urbanyeild.ca

**Domain:** urbanyeild.ca  
**Registrar:** GoDaddy  
**Status:** ✅ Configured in CORS settings

## 🎯 What's Been Configured

### 1. CORS Settings Updated
- ✅ [server/middleware/cors.js](server/middleware/cors.js) - Main app CORS
- ✅ [greenreach-central/.env](greenreach-central/.env) - Central server CORS
- ✅ [greenreach-central/.env.example](greenreach-central/.env.example) - Example file

**Allowed Origins:**
- `https://urbanyeild.ca` (primary, HTTPS recommended)
- `http://urbanyeild.ca` (HTTP fallback)
- `https://www.urbanyeild.ca` (with www)
- `http://www.urbanyeild.ca` (with www, HTTP)

### 2. Frontend API Configuration
The frontend already uses flexible API endpoints that work with any domain:
- Most pages use `window.location.origin` for API base URL
- Relative paths like `/api/...` automatically work with custom domain
- No hardcoded localhost URLs in production HTML files

## 📋 GoDaddy DNS Configuration Steps

### For AWS Deployment:

**If using Elastic Beanstalk directly:**
1. Log into GoDaddy DNS management
2. Add/Update A Record:
   - **Type:** A
   - **Name:** @ (for urbanyeild.ca)
   - **Value:** [Your EB instance IP address]
   - **TTL:** 600 (or default)
3. Add CNAME for www:
   - **Type:** CNAME
   - **Name:** www
   - **Value:** urbanyeild.ca
   - **TTL:** 600

**If using CloudFront + ALB (recommended):**
1. Get CloudFront distribution domain (e.g., `d123abc.cloudfront.net`)
2. Add CNAME Record:
   - **Type:** CNAME
   - **Name:** @ or urbanyeild.ca
   - **Value:** [CloudFront domain]
   - **TTL:** 600
3. Add www CNAME:
   - **Type:** CNAME
   - **Name:** www
   - **Value:** urbanyeild.ca
   - **TTL:** 600

**If using AWS Certificate Manager (ACM) for HTTPS:**
1. Request certificate in AWS ACM for:
   - `urbanyeild.ca`
   - `*.urbanyeild.ca` (wildcard for subdomains)
2. ACM will provide CNAME records for validation
3. Add those CNAMEs to GoDaddy DNS
4. Wait for validation (5-30 minutes)
5. Attach certificate to CloudFront or ALB

## 🔐 SSL/HTTPS Setup

**Option 1: Let's Encrypt (Free)**
```bash
# Install certbot
sudo apt-get update
sudo apt-get install certbot python3-certbot-nginx

# Generate certificate
sudo certbot --nginx -d urbanyeild.ca -d www.urbanyeild.ca

# Auto-renewal
sudo certbot renew --dry-run
```

**Option 2: AWS Certificate Manager (Recommended for AWS)**
1. Request certificate in ACM console
2. Add DNS validation records to GoDaddy
3. Associate with CloudFront/ALB
4. Automatic renewal

**Option 3: GoDaddy SSL**
- Purchase SSL from GoDaddy
- Download certificate files
- Configure in nginx or load balancer

## 🚀 Deployment Checklist

### Pre-Deployment
- [ ] DNS propagated (check with `dig urbanyeild.ca` or [whatsmydns.net](https://www.whatsmydns.net/))
- [ ] SSL certificate provisioned and validated
- [ ] CORS settings updated (already done ✅)
- [ ] Environment variables configured with production values

### Server Configuration
```bash
# Update .env for production
PORT=443
HOST=0.0.0.0
NODE_ENV=production
AUTH_ENABLED=true
RATE_LIMITING_ENABLED=true
CLOUDWATCH_ENABLED=true

# Database
DB_ENABLED=true
DB_HOST=your-rds-endpoint.amazonaws.com
DATABASE_URL=postgresql://user:pass@host:5432/lightengine?sslmode=require

# Security
JWT_SECRET=[generate with: openssl rand -base64 64]
```

### Nginx Configuration (if using)
```nginx
server {
    listen 80;
    server_name urbanyeild.ca www.urbanyeild.ca;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name urbanyeild.ca www.urbanyeild.ca;
    
    ssl_certificate /etc/letsencrypt/live/urbanyeild.ca/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/urbanyeild.ca/privkey.pem;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    
    location / {
        proxy_pass http://localhost:8091;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Post-Deployment Testing
```bash
# Test DNS resolution
dig urbanyeild.ca
dig www.urbanyeild.ca

# Test HTTP access
curl -I http://urbanyeild.ca
curl -I https://urbanyeild.ca

# Test API endpoint
curl https://urbanyeild.ca/api/health

# Test CORS
curl -H "Origin: https://urbanyeild.ca" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: Content-Type" \
     -X OPTIONS \
     https://urbanyeild.ca/api/auth/login
```

## 📊 Monitoring

### Check Domain Propagation
```bash
# Global DNS propagation checker
https://www.whatsmydns.net/#A/urbanyeild.ca

# Command line
dig @8.8.8.8 urbanyeild.ca      # Google DNS
dig @1.1.1.1 urbanyeild.ca      # Cloudflare DNS
nslookup urbanyeild.ca
```

### SSL Certificate Check
```bash
# Check certificate validity
echo | openssl s_client -servername urbanyeild.ca \
      -connect urbanyeild.ca:443 2>/dev/null | \
      openssl x509 -noout -dates

# Check SSL configuration
https://www.ssllabs.com/ssltest/analyze.html?d=urbanyeild.ca
```

## 🔧 Troubleshooting

### DNS Not Resolving
- **Wait:** DNS propagation can take 4-48 hours
- **Check TTL:** Lower TTL for faster updates (300-600 seconds)
- **Verify Records:** Use GoDaddy DNS management console
- **Test Global:** Use whatsmydns.net to check worldwide propagation

### CORS Errors in Browser
- **Check:** Browser console for specific error
- **Verify:** Domain matches ALLOWED_ORIGINS exactly (with/without www)
- **Protocol:** Ensure http vs https matches
- **Restart:** Restart Node.js server after updating CORS config

### SSL Certificate Issues
- **Mixed Content:** Ensure all assets load via HTTPS
- **Chain Issues:** Verify full certificate chain is installed
- **Expired:** Check certificate expiration date
- **ACM:** Ensure certificate is in same region as CloudFront/ALB

### Server Not Responding
- **Security Groups:** Check AWS security group allows ports 80/443
- **Firewall:** Check server firewall (`ufw status` or `iptables -L`)
- **Logs:** Check application logs (`pm2 logs` or `journalctl -u lightengine`)
- **Process:** Ensure Node.js process is running (`pm2 status` or `ps aux | grep node`)

## 📖 Additional Resources

- [AWS Route 53 Documentation](https://docs.aws.amazon.com/route53/)
- [Let's Encrypt Certbot Guide](https://certbot.eff.org/)
- [GoDaddy DNS Management](https://www.godaddy.com/help/manage-dns-records-680)
- [CORS MDN Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)

## 🎯 Quick Reference

| Resource | Current Value | Notes |
|----------|---------------|-------|
| Domain | urbanyeild.ca | GoDaddy registered |
| Primary URL | https://urbanyeild.ca | Recommended |
| API Base | https://urbanyeild.ca/api | Relative paths |
| Health Check | https://urbanyeild.ca/api/health | Test endpoint |
| Frontend Files | /public | Static assets |
| CORS Status | ✅ Configured | Both apps updated |

## ⚠️ Important Notes

1. **HTTPS First:** Always use HTTPS in production
2. **www Redirect:** Configure redirect from www to non-www or vice versa
3. **Environment Variables:** Keep production secrets in AWS Secrets Manager or secure vault
4. **Rate Limiting:** Enable in production (already configured)
5. **Monitoring:** Set up CloudWatch alarms for domain health checks

## 🔄 Next Steps

1. **Configure DNS in GoDaddy** pointing to your server IP or CloudFront distribution
2. **Set up SSL certificate** (Let's Encrypt or AWS ACM recommended)
3. **Test HTTPS access** at https://urbanyeild.ca
4. **Update environment variables** with production values
5. **Enable security features** (auth, rate limiting, monitoring)
6. **Test all pages** work correctly with the custom domain
