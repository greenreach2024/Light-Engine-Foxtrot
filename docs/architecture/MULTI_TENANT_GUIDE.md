# Multi-Tenant Cloud Deployment

Light Engine supports multi-tenant cloud hosting where multiple farms share a single instance with complete data isolation.

## Architecture

### Subdomain Routing
Each farm gets their own subdomain:
- `butterhead-farm.greenreach.io` → Tenant: butterhead-farm
- `urban-greens.greenreach.io` → Tenant: urban-greens
- `demo-farm.greenreach.io` → Tenant: demo-farm

### Data Isolation
- **Database Level**: Every table has `tenant_id` column
- **Query Level**: All queries automatically filtered by tenant
- **Storage Level**: S3 files organized by tenant prefix
- **Row-Level Security**: PostgreSQL policies enforce isolation

## Database Schema

### Tenants Table
```sql
CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  subdomain VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  tier VARCHAR(50) DEFAULT 'inventory-only',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Tenant-Scoped Tables
All tables include `tenant_id`:
```sql
ALTER TABLE crops ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE inventory ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE orders ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
-- ... etc
```

## Middleware

### Tenant Extraction
```javascript
import { tenantMiddleware } from './server/middleware/multi-tenant.js';

app.use(tenantMiddleware); // Extracts tenant from subdomain
```

### Tenant Validation
```javascript
import { validateTenant } from './server/middleware/multi-tenant.js';

app.use('/api/*', validateTenant); // Validates tenant exists and is active
```

### Tenant-Scoped Database
```javascript
import { getTenantDb } from './server/middleware/multi-tenant.js';

router.get('/crops', (req, res) => {
  const db = getTenantDb(req); // Automatically scoped to req.tenantId
  
  // This query only returns crops for the current tenant
  const crops = await db.query('SELECT * FROM crops');
  
  res.json({ crops });
});
```

## API Endpoints

### Admin Endpoints

**Register New Tenant**
```http
POST /api/tenants/register
Content-Type: application/json

{
  "farmName": "Butterhead Lettuce Farm",
  "contactEmail": "admin@butterhead.com",
  "subdomain": "butterhead-farm",
  "tier": "inventory-only"
}

Response:
{
  "ok": true,
  "tenant": {
    "id": 1,
    "subdomain": "butterhead-farm",
    "name": "Butterhead Lettuce Farm",
    "tier": "inventory-only",
    "url": "https://butterhead-farm.greenreach.io",
    "activationCode": "GR-A1B2C3"
  }
}
```

**List All Tenants**
```http
GET /api/tenants?active=true&tier=inventory-only

Response:
{
  "ok": true,
  "count": 15,
  "tenants": [...]
}
```

**Get Tenant Details**
```http
GET /api/tenants/butterhead-farm

Response:
{
  "ok": true,
  "tenant": {
    "id": 1,
    "subdomain": "butterhead-farm",
    "name": "Butterhead Lettuce Farm",
    "tier": "inventory-only",
    "active": true,
    "url": "https://butterhead-farm.greenreach.io"
  }
}
```

**Update Tenant**
```http
PATCH /api/tenants/butterhead-farm
Content-Type: application/json

{
  "tier": "full",
  "active": true
}
```

**Delete Tenant** (⚠️ Dangerous - deletes all data)
```http
DELETE /api/tenants/butterhead-farm
Content-Type: application/json

{
  "confirm": "butterhead-farm"
}
```

## Deployment

### AWS Configuration

**RDS PostgreSQL**
```bash
# Create RDS instance
aws rds create-db-instance \
  --db-instance-identifier lightengine-prod \
  --db-instance-class db.t3.medium \
  --engine postgres \
  --engine-version 15.3 \
  --master-username admin \
  --master-user-password <secure-password> \
  --allocated-storage 100 \
  --storage-type gp3 \
  --multi-az \
  --backup-retention-period 7
```

**Subdomain Routing** (Route 53)
```bash
# Create wildcard DNS record
*.greenreach.io → ALB DNS name

# All subdomains route to same load balancer
# App extracts tenant from subdomain
```

**Load Balancer** (ALB)
```bash
# Create application load balancer
aws elbv2 create-load-balancer \
  --name lightengine-prod \
  --subnets subnet-xxx subnet-yyy \
  --security-groups sg-xxx
```

**Auto-Scaling** (EC2 or ECS)
```yaml
# Auto-scaling based on CPU/Memory
MinInstances: 2
MaxInstances: 10
TargetCPU: 70%
```

### Environment Variables

```bash
# Multi-tenant mode
DEPLOYMENT_MODE=cloud
MULTI_TENANT=true

# Database
DATABASE_URL=postgresql://admin:password@lightengine-prod.rds.amazonaws.com/lightengine

# S3 Storage
AWS_S3_BUCKET=lightengine-prod-uploads
AWS_REGION=us-east-1

# Domain
ROOT_DOMAIN=greenreach.io
```

### Nginx Configuration

```nginx
server {
  listen 80;
  server_name *.greenreach.io;
  
  location / {
    proxy_pass http://localhost:8091;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Migration

### From SQLite (Desktop) to PostgreSQL (Cloud)

```bash
# Export from desktop app
curl http://localhost:8091/api/export/full > farm-data.json

# Register tenant in cloud
curl https://api.greenreach.io/tenants/register \
  -H "Content-Type: application/json" \
  -d '{
    "farmName": "My Farm",
    "subdomain": "my-farm",
    "contactEmail": "admin@myfarm.com"
  }'

# Import to cloud
curl https://my-farm.greenreach.io/api/import/full \
  -H "Content-Type: application/json" \
  -d @farm-data.json
```

## Security

### Tenant Isolation
- ✅ Database queries filtered by tenant_id
- ✅ S3 files prefixed by tenant
- ✅ No cross-tenant access possible
- ✅ Row-level security policies
- ✅ CASCADE delete on tenant removal

### Access Control
- ✅ Tenant validation middleware
- ✅ Active status checking
- ✅ Tier-based feature flags
- ✅ Admin-only tenant management

## Monitoring

### Per-Tenant Metrics
- Active users per tenant
- API requests per tenant
- Database queries per tenant
- Storage usage per tenant
- Error rates per tenant

### CloudWatch Dashboards
```javascript
// Custom metric
cloudwatch.putMetricData({
  Namespace: 'LightEngine/Tenants',
  MetricData: [{
    MetricName: 'ActiveTenants',
    Value: activeTenantCount,
    Unit: 'Count',
    Timestamp: new Date()
  }]
});
```

## Backup Strategy

### Per-Tenant Backups
```bash
# Backup single tenant
pg_dump -h lightengine-prod.rds.amazonaws.com \
  -U admin \
  -d lightengine \
  --table 'crops' \
  --table 'inventory' \
  --where "tenant_id = 123" \
  > butterhead-farm-backup.sql
```

### Full Database Backups
- RDS Automated Backups: Daily at 3 AM UTC
- Retention: 7 days
- Cross-region replication: Enabled
- Point-in-time recovery: Enabled

## Scaling

### Vertical Scaling
- Start: db.t3.medium (2 vCPU, 4 GB RAM)
- Growth: db.m5.large (2 vCPU, 8 GB RAM)
- Production: db.m5.xlarge (4 vCPU, 16 GB RAM)

### Horizontal Scaling
- Read replicas for reporting queries
- Connection pooling (PgBouncer)
- Redis for session caching
- CloudFront for static assets

### Partitioning
For very large deployments:
```sql
-- Partition tables by tenant_id
CREATE TABLE crops_partition_1 PARTITION OF crops
  FOR VALUES FROM (1) TO (1000);

CREATE TABLE crops_partition_2 PARTITION OF crops
  FOR VALUES FROM (1000) TO (2000);
```

## Cost Optimization

### Per-Tenant Billing
Track usage for each tenant:
- API requests
- Database queries
- Storage (GB)
- Data transfer (GB)

### Tiered Pricing
- **Inventory-Only**: $49/month
- **Full**: $199/month
- **Enterprise**: $499/month

## Support

For multi-tenant deployment help:
- Email: devops@greenreach.io
- Docs: https://docs.greenreach.io/multi-tenant
- Slack: #multi-tenant-support
