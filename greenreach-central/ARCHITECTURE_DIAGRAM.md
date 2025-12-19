# GreenReach System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        🌐 GREENREACH ECOSYSTEM                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                     CENTRAL COORDINATION LAYER                          │
│                    (greenreach-central API)                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │   Express.js │  │  PostgreSQL  │  │  WebSocket   │                │
│  │   REST API   │──│   Database   │  │   Server     │                │
│  │   Port 3000  │  │              │  │   Port 3001  │                │
│  └──────────────┘  └──────────────┘  └──────────────┘                │
│                                                                         │
│  Endpoints:                                                            │
│  • Farm Registration & Provisioning                                    │
│  • Real-time Monitoring Dashboard                                      │
│  • Inventory Aggregation                                               │
│  • Alert Management                                                    │
│  • Order Coordination                                                  │
│  • Sync Management                                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                    ▼             ▼             ▼
         
┌─────────────────────────────────────────────────────────────────────────┐
│                         EDGE DEVICE LAYER                               │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Farm 1          │    │  Farm 2          │    │  Farm 3          │
│  GR-00001        │    │  GR-00002        │    │  GR-00003        │
├──────────────────┤    ├──────────────────┤    ├──────────────────┤
│                  │    │                  │    │                  │
│ Raspberry Pi 5   │    │ Raspberry Pi 5   │    │ Raspberry Pi 5   │
│ server-foxtrot.js│    │ server-foxtrot.js│    │ server-foxtrot.js│
│                  │    │                  │    │                  │
│ ┌──────────────┐ │    │ ┌──────────────┐ │    │ ┌──────────────┐ │
│ │ Automation   │ │    │ │ Automation   │ │    │ │ Automation   │ │
│ │ Engine       │ │    │ │ Engine       │ │    │ │ Engine       │ │
│ └──────────────┘ │    │ └──────────────┘ │    │ └──────────────┘ │
│                  │    │                  │    │                  │
│ ┌──────────────┐ │    │ ┌──────────────┐ │    │ ┌──────────────┐ │
│ │ Devices      │ │    │ │ Devices      │ │    │ │ Devices      │ │
│ │ - Lights     │ │    │ │ - Lights     │ │    │ │ - Lights     │ │
│ │ - Fans       │ │    │ │ - Fans       │ │    │ │ - Fans       │ │
│ │ - Sensors    │ │    │ │ - Sensors    │ │    │ │ - Sensors    │ │
│ │ - Dehumidif. │ │    │ │ - Dehumidif. │ │    │ │ - Dehumidif. │ │
│ └──────────────┘ │    │ └──────────────┘ │    │ └──────────────┘ │
│                  │    │                  │    │                  │
│ Syncs every 5min │    │ Syncs every 5min │    │ Syncs every 5min │
│                  │    │                  │    │                  │
└──────────────────┘    └──────────────────┘    └──────────────────┘
         │                       │                       │
         └───────────────────────┴───────────────────────┘
                                 │
                   ┌─────────────▼─────────────┐
                   │     DATA SYNC FLOW        │
                   │                           │
                   │  • Inventory (products)   │
                   │  • Health Metrics         │
                   │  • Alerts                 │
                   │  • Heartbeats             │
                   │                           │
                   │  Auth: X-API-Key +        │
                   │        X-Farm-ID          │
                   └───────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                      DASHBOARD / ADMIN LAYER                            │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Web Dashboard   │    │  Mobile App      │    │  Admin Panel     │
│  (React/Vue)     │    │  (React Native)  │    │  (Management)    │
├──────────────────┤    ├──────────────────┤    ├──────────────────┤
│                  │    │                  │    │                  │
│ • Real-time Map  │    │ • Farm Status    │    │ • User Mgmt      │
│ • Health Monitor │    │ • Notifications  │    │ • Farm Provisioning│
│ • Inventory View │    │ • Quick Actions  │    │ • System Config  │
│ • Alert Feed     │    │ • Env. Metrics   │    │ • Reports        │
│ • Order Mgmt     │    │                  │    │                  │
│                  │    │                  │    │                  │
│ Auth: JWT Bearer │    │ Auth: JWT Bearer │    │ Auth: JWT Bearer │
│                  │    │                  │    │                  │
└──────────────────┘    └──────────────────┘    └──────────────────┘
         │                       │                       │
         └───────────────────────┴───────────────────────┘
                                 │
                   ┌─────────────▼─────────────┐
                   │   WEBSOCKET CONNECTION    │
                   │   ws://central:3001       │
                   │                           │
                   │  Real-time Updates:       │
                   │  • Farm offline alerts    │
                   │  • Health changes         │
                   │  • New orders             │
                   │  • Critical alerts        │
                   └───────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                     DEPLOYMENT ARCHITECTURE                             │
└─────────────────────────────────────────────────────────────────────────┘

PRODUCTION (AWS):
┌────────────────────────────────────────────────────────────────────────┐
│  Current Edge Deployment (Phase 1 ✅)                                  │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ AWS Elastic Beanstalk (light-engine-foxtrot-prod)                │ │
│  │ • Instance: t3.small (us-east-1)                                 │ │
│  │ • Status: Green, 0.35% CPU                                       │ │
│  │ • Monitoring: CloudWatch + SNS                                   │ │
│  │ • Security: Rate limiting, audit logging, JWT                    │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘

PLANNED (Central API):
┌────────────────────────────────────────────────────────────────────────┐
│  Central Coordination (Phase 2 - Ready for Deployment 🔄)             │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ Separate Deployment                                              │ │
│  │ • Nginx reverse proxy with SSL/TLS                               │ │
│  │ • PM2 process manager                                            │ │
│  │ • PostgreSQL database (RDS or self-hosted)                       │ │
│  │ • CloudWatch monitoring                                          │ │
│  │ • AWS Secrets Manager                                            │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                         DATA FLOW DIAGRAM                               │
└─────────────────────────────────────────────────────────────────────────┘

Edge Device                Central API               Dashboard
    │                          │                          │
    │─────Register Farm───────>│                          │
    │<────API Credentials──────│                          │
    │                          │                          │
    │─────Provision Device────>│                          │
    │<────Activation OK────────│                          │
    │                          │                          │
    │─────Heartbeat (5min)────>│                          │
    │                          │                          │
    │─────Sync Inventory──────>│                          │
    │                          │──────Update DB───────────│
    │                          │                          │
    │─────Sync Health─────────>│                          │
    │                          │──────WebSocket Update───>│
    │                          │                          │
    │─────Sync Alerts─────────>│                          │
    │                          │──────WebSocket Alert────>│
    │                          │                          │
    │                          │<─────Query Health────────│
    │                          │──────Health Data────────>│
    │                          │                          │
    │<────Control Command──────│<─────User Action─────────│
    │                          │                          │

┌─────────────────────────────────────────────────────────────────────────┐
│                      SECURITY ARCHITECTURE                              │
└─────────────────────────────────────────────────────────────────────────┘

Authentication Methods:
┌──────────────────┐              ┌──────────────────┐
│  Edge Devices    │              │  Dashboard Users │
├──────────────────┤              ├──────────────────┤
│ X-API-Key header │              │ JWT Bearer Token │
│ X-Farm-ID header │              │ 24-hour expiry   │
│ bcrypt hashed    │              │ Refresh tokens   │
│ Per-farm keys    │              │ Role-based access│
└──────────────────┘              └──────────────────┘

Rate Limiting:
• 100 requests per 15 minutes per IP
• Applied to all /api/* routes

Security Headers (Helmet.js):
• X-Content-Type-Options: nosniff
• X-Frame-Options: DENY
• X-XSS-Protection: 1; mode=block
• Strict-Transport-Security: max-age=31536000

CORS:
• Whitelist of allowed origins
• Credentials: true for cookies
• Specific methods and headers allowed

Database:
• Parameterized queries (SQL injection protection)
• Connection pooling with timeouts
• Hashed API secrets (bcrypt, 10 rounds)

┌─────────────────────────────────────────────────────────────────────────┐
│                     MONITORING & LOGGING                                │
└─────────────────────────────────────────────────────────────────────────┘

Background Services:
┌───────────────────────────────────────────────────────────────────────┐
│ Health Check Service (every 30 seconds)                               │
│ • Detects offline farms (no heartbeat for 10+ minutes)                │
│ • Updates farm_health.overall_status to 'offline'                     │
│ • Broadcasts WebSocket alerts to dashboard                            │
└───────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│ Sync Monitor Service (every 5 minutes)                                │
│ • Detects stale syncs (no sync for 15+ minutes)                       │
│ • Creates alerts in farm_alerts table                                 │
│ • Tracks sync patterns for anomaly detection                          │
└───────────────────────────────────────────────────────────────────────┘

Logging (Winston):
┌───────────────────────────────────────────────────────────────────────┐
│ • Console: Real-time colored output                                   │
│ • logs/combined.log: All logs (5MB × 5 files rotation)                │
│ • logs/error.log: Errors only (5MB × 5 files rotation)                │
│                                                                        │
│ Log Levels: error | warn | info | debug                               │
└───────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                        PHASE ROADMAP                                    │
└─────────────────────────────────────────────────────────────────────────┘

✅ Phase 1: Security & Production Deployment (COMPLETE)
   • Rate limiting, audit logging, JWT secrets
   • AWS Elastic Beanstalk deployment
   • CloudWatch monitoring + SNS alerts
   • Production documentation

✅ Phase 2: Central Infrastructure (COMPLETE)
   • Separate GreenReach Central API server
   • PostgreSQL multi-tenant database
   • Farm registration & provisioning
   • Real-time WebSocket monitoring
   • Inventory & alert aggregation
   • Background services

⏳ Phase 3: First-Run Setup Wizard (NEXT)
   • Touchscreen-optimized UI (Symcod W101M)
   • Network configuration wizard
   • Central API connection setup
   • Farm provisioning flow
   • Device pairing

⏳ Phase 4: Data Synchronization
   • Offline queue with retry logic
   • Conflict resolution strategies
   • Bandwidth optimization
   • Sync status dashboard

⏳ Phase 5: Security & Certificates
   • Mutual TLS for edge-to-central
   • Certificate rotation automation
   • HTTPS for edge device UI
   • Secure credential storage

⏳ Phase 6: Wholesale Integration
   • Multi-farm order routing
   • Automated fulfillment
   • Inventory reservation
   • Customer portal

⏳ Phase 7: Testing & Documentation
   • End-to-end test suite
   • Load testing
   • Installation guides
   • Admin/farmer documentation

┌─────────────────────────────────────────────────────────────────────────┐
│                    🎉 CURRENT STATUS 🎉                                 │
└─────────────────────────────────────────────────────────────────────────┘

Phase 1: ✅ COMPLETE & DEPLOYED
Phase 2: ✅ COMPLETE & READY FOR DEPLOYMENT

Next Steps:
1. Deploy GreenReach Central API to production
2. Set up PostgreSQL RDS instance
3. Configure SSL/TLS certificates
4. Begin Phase 3 implementation (First-Run Wizard)

┌─────────────────────────────────────────────────────────────────────────┐
│              Built with ❤️ for sustainable agriculture                  │
└─────────────────────────────────────────────────────────────────────────┘
```
