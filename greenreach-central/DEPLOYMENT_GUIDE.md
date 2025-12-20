# GreenReach Central API - Production Deployment Guide

## Pre-Deployment Checklist

- [ ] Ubuntu 22.04 LTS or Amazon Linux 2023 server
- [ ] Node.js 18+ installed
- [ ] PostgreSQL 14+ installed (or RDS instance)
- [ ] Nginx installed
- [ ] PM2 installed globally
- [ ] SSL certificate obtained (Let's Encrypt or AWS Certificate Manager)
- [ ] Domain name configured (e.g., api.greenreach.io)

---

## 1. Server Preparation

### Update System
```bash
sudo apt update && sudo apt upgrade -y
```

### Install Node.js 18
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # Should be 18+
```

### Install PostgreSQL
```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### Install Nginx
```bash
sudo apt install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

### Install PM2
```bash
sudo npm install -g pm2
pm2 startup  # Follow the instructions
```

---

## 2. Database Setup

### Create PostgreSQL Database
```bash
sudo -u postgres psql
```

```sql
-- Create database
CREATE DATABASE greenreach_central;

-- Create user with password
CREATE USER greenreach WITH PASSWORD 'your_secure_password_here';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE greenreach_central TO greenreach;

-- Connect to database
\c greenreach_central

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Grant schema privileges
GRANT ALL ON SCHEMA public TO greenreach;

\q
```

### Or Use AWS RDS
```bash
# Create RDS PostgreSQL instance
aws rds create-db-instance \
  --db-instance-identifier greenreach-central-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 14.9 \
  --master-username greenreach \
  --master-user-password YourSecurePassword123! \
  --allocated-storage 20 \
  --vpc-security-group-ids sg-xxxxx \
  --db-subnet-group-name your-subnet-group \
  --backup-retention-period 7 \
  --no-publicly-accessible
```

---

## 3. Application Deployment

### Create Application Directory
```bash
sudo mkdir -p /opt/greenreach-central
sudo chown $USER:$USER /opt/greenreach-central
cd /opt/greenreach-central
```

### Clone Repository
```bash
git clone https://github.com/greenreach2024/Light-Engine-Foxtrot.git .
cd greenreach-central
```

### Install Dependencies
```bash
npm install --production
```

### Configure Environment
```bash
cp .env.example .env
nano .env
```

Edit `.env` with production values:
```env
NODE_ENV=production
PORT=3000
API_VERSION=v1

# Database (Update with your values)
DB_HOST=your-rds-endpoint.rds.amazonaws.com
DB_PORT=5432
DB_NAME=greenreach_central
DB_USER=greenreach
DB_PASSWORD=YourSecurePassword123!
DB_POOL_MAX=20

# JWT (Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
JWT_SECRET=your_generated_jwt_secret_here
JWT_EXPIRY=24h
REFRESH_TOKEN_EXPIRY=7d

# CORS
ALLOWED_ORIGINS=https://dashboard.greenreach.io,https://app.greenreach.io

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# WebSocket
WS_PORT=3001
WS_HEARTBEAT_INTERVAL=30000

# Monitoring
HEALTH_CHECK_INTERVAL=30000
ALERT_EMAIL=ops@greenreachfarms.com

# Logging
LOG_LEVEL=info

# External Services (if using)
STRIPE_SECRET_KEY=sk_live_your_stripe_key
SENDGRID_API_KEY=your_sendgrid_key
```

### Create Logs Directory
```bash
mkdir -p logs
chmod 755 logs
```

### Run Database Migration
```bash
node scripts/migrate.js
```

### (Optional) Seed Test Data
```bash
node scripts/seed.js
```

---

## 4. Nginx Configuration

### Create Nginx Config
```bash
sudo nano /etc/nginx/sites-available/greenreach-central
```

```nginx
# Upstream for Node.js API
upstream greenreach_api {
    least_conn;
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
}

# Upstream for WebSocket
upstream greenreach_ws {
    server 127.0.0.1:3001;
}

# HTTP to HTTPS redirect
server {
    listen 80;
    server_name api.greenreach.io;
    
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS Server
server {
    listen 443 ssl http2;
    server_name api.greenreach.io;
    
    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/api.greenreach.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.greenreach.io/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Logging
    access_log /var/log/nginx/greenreach-central-access.log;
    error_log /var/log/nginx/greenreach-central-error.log;
    
    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req zone=api_limit burst=20 nodelay;
    
    # API Routes
    location /api/ {
        proxy_pass http://greenreach_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # WebSocket Routes
    location /ws {
        proxy_pass http://greenreach_ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket specific
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
    
    # Health Check (no auth)
    location /health {
        proxy_pass http://greenreach_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        access_log off;
    }
}
```

### Enable Site
```bash
sudo ln -s /etc/nginx/sites-available/greenreach-central /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 5. SSL Certificate (Let's Encrypt)

### Install Certbot
```bash
sudo apt install -y certbot python3-certbot-nginx
```

### Obtain Certificate
```bash
sudo certbot --nginx -d api.greenreach.io
```

### Auto-Renewal
```bash
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

---

## 6. Start Application with PM2

### Start Application
```bash
cd /opt/greenreach-central/greenreach-central
pm2 start ecosystem.config.cjs
```

### Save PM2 Configuration
```bash
pm2 save
```

### Monitor
```bash
pm2 status
pm2 logs greenreach-central
pm2 monit
```

---

## 7. Firewall Configuration

### UFW (Ubuntu)
```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### AWS Security Group
- Inbound: 22 (SSH), 80 (HTTP), 443 (HTTPS)
- Outbound: All traffic

---

## 8. Monitoring & Logging

### CloudWatch Agent (AWS)
```bash
wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
sudo dpkg -i -E ./amazon-cloudwatch-agent.deb

# Configure
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-config-wizard
```

### Log Rotation
```bash
sudo nano /etc/logrotate.d/greenreach-central
```

```
/opt/greenreach-central/greenreach-central/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 ubuntu ubuntu
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

---

## 9. Backups

### Database Backup Script
```bash
sudo nano /opt/scripts/backup-db.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/opt/backups/postgres"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_NAME="greenreach_central"
DB_USER="greenreach"

mkdir -p $BACKUP_DIR

PGPASSWORD=$DB_PASSWORD pg_dump -h $DB_HOST -U $DB_USER -d $DB_NAME | gzip > $BACKUP_DIR/greenreach_$TIMESTAMP.sql.gz

# Keep only last 7 days
find $BACKUP_DIR -type f -mtime +7 -delete

echo "Backup completed: greenreach_$TIMESTAMP.sql.gz"
```

### Cron Job
```bash
sudo chmod +x /opt/scripts/backup-db.sh
crontab -e
```

Add:
```
0 2 * * * /opt/scripts/backup-db.sh >> /var/log/db-backup.log 2>&1
```

---

## 10. Health Checks & Monitoring

### Test API
```bash
curl https://api.greenreach.io/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2024-12-19T...",
  "version": "v1",
  "uptime": 123.456
}
```

### Monitor Logs
```bash
pm2 logs greenreach-central --lines 100
tail -f /opt/greenreach-central/greenreach-central/logs/combined.log
tail -f /var/log/nginx/greenreach-central-access.log
```

---

## 11. Scaling

### Increase PM2 Instances
```bash
pm2 scale greenreach-central 4  # Scale to 4 instances
```

### Load Balancer (AWS ALB)
- Create Application Load Balancer
- Target Group: EC2 instances on port 80 (nginx)
- Health Check: /health
- SSL Certificate: ACM certificate

---

## 12. Troubleshooting

### Check Application Status
```bash
pm2 status
pm2 logs greenreach-central --err --lines 50
```

### Check Database Connection
```bash
psql -h your-rds-endpoint.rds.amazonaws.com -U greenreach -d greenreach_central
```

### Check Nginx
```bash
sudo nginx -t
sudo systemctl status nginx
tail -f /var/log/nginx/error.log
```

### Restart Services
```bash
pm2 restart greenreach-central
sudo systemctl restart nginx
```

---

## 13. Security Best Practices

✅ Use AWS Secrets Manager for sensitive credentials  
✅ Enable RDS encryption at rest  
✅ Enable CloudWatch detailed monitoring  
✅ Set up AWS GuardDuty  
✅ Configure AWS WAF for DDoS protection  
✅ Use AWS Systems Manager for patch management  
✅ Enable VPC Flow Logs  
✅ Implement least privilege IAM roles  
✅ Regular security audits with `npm audit`  
✅ Keep Node.js and dependencies updated  

---

## 14. Rollback Plan

### Rollback to Previous Version
```bash
cd /opt/greenreach-central
git log --oneline -5  # Find commit hash
git checkout <commit-hash>
npm install --production
pm2 restart greenreach-central
```

---

## Quick Deployment Script

```bash
#!/bin/bash
# deploy.sh

set -e

echo "🚀 Deploying GreenReach Central API..."

cd /opt/greenreach-central
git pull origin main
cd greenreach-central
npm install --production
pm2 restart greenreach-central

echo "✅ Deployment complete!"
pm2 status
```

---

## Support

**Operations**: ops@greenreachfarms.com  
**Technical**: development@greenreachfarms.com

---

**Deployment completed: Ready for production! 🎉**
