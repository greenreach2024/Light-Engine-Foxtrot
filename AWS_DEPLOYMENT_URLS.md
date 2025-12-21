# AWS Deployment URLs - Light Engine Foxtrot

**Deployment Date**: December 20, 2025  
**Environment**: Production  
**Status**: ✅ Live and Healthy  
**Base URL**: http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com

---

## 🌐 Public Access URLs

### Light Engine Farm Admin
**Farm Operations Dashboard**  
```
http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/farm-admin.html
```
- **Purpose**: Farm operations management
- **Features**: Inventory, grow rooms, automation, sensor monitoring
- **Users**: Farm operators and managers

---

### GreenReach Central - Admin Dashboard
**Wholesale Platform Administration**  
```
http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/central-admin.html
```
- **Purpose**: Wholesale platform administration
- **Features**: 
  - Farm onboarding & management
  - Product catalog oversight
  - Order management & fulfillment tracking
  - Payment monitoring
  - Compliance export tool (NEW)
- **Users**: GreenReach administrators

---

### Wholesale Buyer Portal
**B2B Ordering Platform**  
```
http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/wholesale.html
```
- **Purpose**: Buyer-facing wholesale ordering
- **Features**: 
  - Multi-farm product catalog
  - Shopping cart & checkout
  - Order history with reorder (NEW)
  - Invoice download (NEW)
  - Shipment tracking (NEW)
  - Multi-farm order splitting
- **Users**: Wholesale buyers (restaurants, retailers, distributors)

---

### Wholesale Admin
**Wholesale Operations Management**  
```
http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/wholesale-admin.html
```
- **Purpose**: Wholesale operations & fulfillment
- **Features**: 
  - Order management dashboard
  - Payment tracking & reconciliation
  - Farm fulfillment coordination
  - Buyer account management
  - Compliance export tool (NEW)
- **Users**: Wholesale operations team

---

### Farm Store (POS)
**Direct-to-Consumer Sales**  
```
http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/farm-store.html
```
- **Purpose**: Point of sale for farm retail
- **Features**: 
  - Product catalog
  - Cart & checkout
  - Inventory sync
  - Customer orders
- **Users**: Farm retail staff, on-site customers

---

### Farm Sales Dashboard
**Farm Sales Management**  
```
http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/farm-sales.html
```
- **Purpose**: Farm sales operations & analytics
- **Features**: 
  - Sales dashboard
  - Order fulfillment
  - Customer management
  - Revenue tracking
- **Users**: Farm sales managers

---

## 🔌 API Endpoints

### Base API URL
```
http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/api
```

### Key API Routes

#### Wholesale API
- **Catalog**: `/api/wholesale/catalog` - Multi-farm product catalog
- **Orders**: `/api/wholesale/orders` - Order placement & management
- **Inventory**: `/api/inventory/available` - Real-time inventory
- **Reservations**: `/api/inventory/reserve` - Inventory reservations

#### Farm API
- **Products**: `/api/products` - Farm product management
- **Inventory**: `/api/inventory` - Inventory updates
- **Orders**: `/api/orders` - Order fulfillment

#### Admin API
- **Farms**: `/api/admin/farms` - Farm management
- **Payments**: `/api/admin/payments` - Payment tracking
- **Compliance**: `/api/admin/compliance` - Compliance exports

#### Authentication
- **Login**: `/api/auth/login` - User authentication
- **Register**: `/api/auth/register` - User registration
- **Verify**: `/api/auth/verify` - Token verification

---

## 📊 Health & Monitoring

### Health Check
```
http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/health
```

### CloudWatch Logs
- **Log Group**: `/aws/elasticbeanstalk/light-engine-foxtrot-prod`
- **Streams**:
  - `/var/log/web.stdout.log` - Application logs
  - `/var/log/nginx/access.log` - Access logs
  - `/var/log/nginx/error.log` - Error logs

### CloudWatch Metrics
- **Namespace**: `LightEngine/Production`
- **Metrics**: Orders, Inventory, API Performance, Errors

---

## 🔐 Authentication

### Default Test Accounts (Demo Mode)

**Farm Admin:**
- Email: `farm@greenreach.farm`
- Password: Contact admin

**Wholesale Buyer:**
- Email: `buyer@restaurant.com`
- Password: Contact admin

**GreenReach Admin:**
- Email: `admin@greenreach.com`
- Password: Contact admin

---

## 🚀 Recent Features Deployed

### December 20, 2025 Deployment
✅ **TODO #8**: Buyer Order History Enhancements
- Invoice download (JSON format)
- Reorder functionality
- Enhanced order details
- Contact farms button

✅ **TODO #9**: Shipment Tracking Integration
- Tracking number display
- Carrier-specific tracking links (USPS, UPS, FedEx, DHL)
- Tracking availability indicators

✅ **TODO #10**: Compliance Export Tool
- Date range selection
- CSV/JSON export formats
- Data scope configuration (orders, farms, products, traceability)
- Export history tracking

✅ **Repository Cleanup**
- Removed 29 obsolete files
- Deleted old deployment archives (~900MB)
- Removed security risks (.env.rds credentials)
- Streamlined documentation

---

## 🔧 Environment Configuration

**Platform**: Node.js 20 on Amazon Linux 2023  
**Instance Type**: t3.micro (free tier eligible)  
**Region**: us-east-1 (US East, N. Virginia)  
**Load Balancer**: Application Load Balancer  
**Database**: RDS PostgreSQL (when configured)  
**Storage**: S3 for data/logs  

---

## 📝 Quick Access Links

**All Applications (Choose Your Role):**

| User Role | Primary URL | Description |
|-----------|-------------|-------------|
| Farm Operator | [farm-admin.html](http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/farm-admin.html) | Manage farm operations |
| Wholesale Buyer | [wholesale.html](http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/wholesale.html) | Browse & order products |
| Wholesale Admin | [wholesale-admin.html](http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/wholesale-admin.html) | Manage wholesale operations |
| GreenReach Admin | [central-admin.html](http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/central-admin.html) | Platform administration |
| Farm Retail Staff | [farm-store.html](http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/farm-store.html) | Point of sale |
| Farm Sales Manager | [farm-sales.html](http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/farm-sales.html) | Sales dashboard |

---

## 🔗 Shortened Base URL

For easier sharing, you can use:
```
light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com
```

**Bookmark This**: Add `/[page].html` to access any interface

---

## 🛠️ Deployment Commands

### Check Status
```bash
cd /Users/petergilbert/Light-Engine-Foxtrot
eb status
```

### Deploy Updates
```bash
git add .
git commit -m "Your update message"
eb deploy light-engine-foxtrot-prod
```

### View Logs
```bash
eb logs light-engine-foxtrot-prod
```

### Open in Browser
```bash
eb open light-engine-foxtrot-prod
```

---

## 📞 Support & Issues

**CloudWatch Dashboard**: [AWS Console](https://console.aws.amazon.com/cloudwatch)  
**Elastic Beanstalk Console**: [Environment Health](https://console.aws.amazon.com/elasticbeanstalk)  
**Application Logs**: Available via `eb logs` command

---

**Deployment Status**: ✅ **LIVE**  
**Last Updated**: December 20, 2025  
**Version**: pre-aws-deployment-backup-2-gde3b
