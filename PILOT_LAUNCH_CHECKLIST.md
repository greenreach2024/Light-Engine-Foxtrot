# Pilot Program Launch Checklist

**Target Launch Date**: January 15, 2026

---

## Pre-Launch Tasks

### Technical Systems ✅ COMPLETE

- [x] Notification system (SMS, Push, Email)
- [x] Inventory reservation API
- [x] Overselling prevention tested
- [x] Deadline monitor deployed (cron job)
- [x] Alert monitoring system
- [x] AWS production deployment
- [x] Security hardening complete

### Farm Onboarding (Todos #10)

**Target**: 2-3 pilot farms by Jan 10, 2026

#### Farm Selection Criteria
- [ ] Located within 50km of pilot buyer cluster
- [ ] Existing relationship/trusted source
- [ ] Capable of 48hr order turnaround
- [ ] Has minimum 10-15 SKUs available
- [ ] Willing to participate in 3-month pilot

#### Selected Farms (Target: 3)

**Farm 1: _________________________**
- [ ] Initial contact made
- [ ] Onboarding guide shared
- [ ] Farm profile completed
- [ ] API key generated
- [ ] Notifications tested (SMS, Push, Email)
- [ ] Inventory uploaded (min 10 SKUs)
- [ ] Test order processed successfully
- [ ] Training call completed
- [ ] Added to pilot Slack channel

**Farm 2: _________________________**
- [ ] Initial contact made
- [ ] Onboarding guide shared
- [ ] Farm profile completed
- [ ] API key generated
- [ ] Notifications tested (SMS, Push, Email)
- [ ] Inventory uploaded (min 10 SKUs)
- [ ] Test order processed successfully
- [ ] Training call completed
- [ ] Added to pilot Slack channel

**Farm 3: _________________________**
- [ ] Initial contact made
- [ ] Onboarding guide shared
- [ ] Farm profile completed
- [ ] API key generated
- [ ] Notifications tested (SMS, Push, Email)
- [ ] Inventory uploaded (min 10 SKUs)
- [ ] Test order processed successfully
- [ ] Training call completed
- [ ] Added to pilot Slack channel

#### Farm Onboarding Commands

```bash
# Onboard new farm (interactive)
node scripts/onboard-farm.js

# Test farm notifications
FARM_ID=GR-00001 npm run test:notifications

# Verify farm API key
node scripts/verify-farm-api.js --farm=GR-00001
```

---

### Buyer Onboarding (Todo #11)

**Target**: 2-3 pilot buyers by Jan 10, 2026

#### Buyer Selection Criteria
- [ ] Known/trusted business or individual
- [ ] Located within delivery radius of pilot farms
- [ ] Predictable ordering pattern (weekly/bi-weekly)
- [ ] Willing to provide detailed feedback
- [ ] Can commit to minimum 6 orders during pilot

#### Selected Buyers (Target: 3)

**Buyer 1: _________________________**
**Type**: Restaurant / Café / Catering / Retail / Individual

- [ ] Initial contact made
- [ ] Buyer guide shared
- [ ] Account created
- [ ] Login credentials sent
- [ ] Profile completed
- [ ] Payment method configured
- [ ] First order placed (test order)
- [ ] Training call completed
- [ ] Added to pilot Slack channel

**Buyer 2: _________________________**
**Type**: Restaurant / Café / Catering / Retail / Individual

- [ ] Initial contact made
- [ ] Buyer guide shared
- [ ] Account created
- [ ] Login credentials sent
- [ ] Profile completed
- [ ] Payment method configured
- [ ] First order placed (test order)
- [ ] Training call completed
- [ ] Added to pilot Slack channel

**Buyer 3: _________________________** (Optional)
**Type**: Restaurant / Café / Catering / Retail / Individual

- [ ] Initial contact made
- [ ] Buyer guide shared
- [ ] Account created
- [ ] Login credentials sent
- [ ] Profile completed
- [ ] Payment method configured
- [ ] First order placed (test order)
- [ ] Training call completed
- [ ] Added to pilot Slack channel

#### Buyer Onboarding Commands

```bash
# Onboard new buyer (interactive)
node scripts/onboard-buyer.js

# Send welcome email
node scripts/send-welcome-email.js --buyer=BUYER-123456

# Generate login credentials
node scripts/reset-buyer-password.js --buyer=BUYER-123456
```

---

## Pilot Program Operations

### Communication Channels

**Slack Workspace**: GreenReach Pilot
- [ ] Create #greenreach-pilot channel
- [ ] Invite all farms
- [ ] Invite all buyers
- [ ] Invite ops team
- [ ] Post welcome message and guidelines

**Email Lists**:
- [ ] Create pilot-farms@greenreachgreens.com distribution list
- [ ] Create pilot-buyers@greenreachgreens.com distribution list
- [ ] Create weekly update email template

**Support**:
- [ ] ops@greenreachgreens.com monitored 9am-6pm EST
- [ ] +1-709-398-3166 SMS for urgent issues
- [ ] Response SLA: 4 hours (business days)

### Launch Week Schedule (Jan 15-21, 2026)

**Monday, Jan 15** - Soft Launch
- 9am: Send launch announcement emails
- 10am: Farms upload fresh inventory
- 11am: Buyers invited to browse
- 2pm: First pilot orders expected
- 5pm: Check-in with all participants

**Tuesday, Jan 16** - First Orders
- Monitor order notifications
- Track farm verification responses
- Assist with any issues
- Collect initial feedback

**Wednesday, Jan 17** - First Deliveries
- Monitor fulfillment
- Track delivery confirmations
- Handle any quality issues
- Payment release verification

**Thursday, Jan 18** - Mid-Week Check
- Review metrics dashboard
- Address any pain points
- Adjust processes as needed
- Collect detailed feedback

**Friday, Jan 21** - Week 1 Wrap-Up
- Weekly metrics report
- Participant survey
- Team retrospective
- Plan Week 2 improvements

### Monitoring & Metrics

**Track Daily**:
- [ ] Orders placed
- [ ] Order verification rate (target: >90%)
- [ ] Order fulfillment rate (target: >95%)
- [ ] Average verification time
- [ ] Deadline misses (target: 0)
- [ ] System alerts triggered
- [ ] Support requests

**Track Weekly**:
- [ ] Total transaction volume
- [ ] Average order value
- [ ] Farm participation rate
- [ ] Buyer repeat rate
- [ ] Satisfaction scores (farms & buyers)
- [ ] Inventory turnover
- [ ] Payment settlement time

**Dashboard**: Create in wholesale admin portal

---

## Contingency Plans

### Farm Offline
- [ ] Automatic alternative farm notification
- [ ] Manual reassignment process documented
- [ ] Backup farm list maintained

### Payment Issues
- [ ] Stripe backup account configured
- [ ] Manual payment process documented
- [ ] Refund process tested

### System Outage
- [ ] AWS backup region ready
- [ ] Manual order tracking spreadsheet
- [ ] Phone tree for critical communications

### Quality Disputes
- [ ] Mediation process documented
- [ ] Refund thresholds defined
- [ ] Photo documentation requirements

---

## Success Criteria (3-Month Pilot)

### Technical Performance
- [ ] 99% system uptime
- [ ] <1% overselling incidents
- [ ] 95%+ notification delivery rate
- [ ] <5s average page load time

### Operational Performance
- [ ] 90%+ farm verification rate
- [ ] 95%+ order fulfillment rate
- [ ] 85%+ buyer satisfaction
- [ ] 85%+ farm satisfaction

### Business Metrics
- [ ] $10,000+ total transaction volume
- [ ] 50+ orders processed
- [ ] 75% buyer retention (place 2+ orders)
- [ ] 2+ new farms request to join
- [ ] 2+ new buyers request to join

---

## Documentation

### Guides Created ✅
- [x] Farm Onboarding Guide (FARM_ONBOARDING_GUIDE.md)
- [x] Buyer Onboarding Guide (BUYER_ONBOARDING_GUIDE.md)

### Scripts Created ✅
- [x] scripts/onboard-farm.js - Interactive farm setup
- [x] scripts/onboard-buyer.js - Interactive buyer setup

### Additional Docs Needed
- [ ] Operations playbook (daily procedures)
- [ ] Troubleshooting guide (common issues)
- [ ] Metrics dashboard guide
- [ ] End-of-pilot report template

---

## Go/No-Go Decision (Jan 12, 2026)

### Required for Go-Live:
- [ ] Minimum 2 farms fully onboarded
- [ ] Minimum 2 buyers fully onboarded
- [ ] All technical systems tested on production
- [ ] Support channels operational
- [ ] Contingency plans documented
- [ ] Team trained and ready

**Final Approval**: _____________________________ Date: _______

---

## Post-Launch

### Week 2-4 Focus
- Refine workflows based on feedback
- Address technical issues promptly
- Gather detailed user stories
- Optimize notification timing

### Month 2 Focus
- Expand farm network (+2-3 farms)
- Expand buyer base (+3-5 buyers)
- Implement feature requests
- Improve documentation

### Month 3 Focus
- Prepare pilot report
- Gather testimonials
- Plan full launch
- Pricing model finalization

---

**Pilot Coordinator**: _________________________

**Launch Status**: ⏳ In Progress

**Last Updated**: December 28, 2025
