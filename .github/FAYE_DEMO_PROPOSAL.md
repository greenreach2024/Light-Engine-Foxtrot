# F.A.Y.E. Demo Proposal -- Cinematic Capability Showcase

**File:** `greenreach-central/public/faye-demo.html`
**Format:** Single-page cinematic scroll, auto-play, narrated scenes
**Matches:** EVIE demo pattern (starfield, scene fade-ins, live canvas charts, smooth auto-scroll)
**Color Palette:** Deep navy/slate base. Accent: amber (#f59e0b) instead of EVIE green. Secondary: rose (#f43f5e), violet (#8b5cf6), cyan (#06b6d4)
**Duration:** ~90-120s auto-scroll from top to bottom

---

## Scene Architecture (8 Scenes)

### Scene 1: TITLE -- "F.A.Y.E."

**Visual:** Full-viewport amber orb with three pulsing rings (same animation pattern as EVIE orb, amber palette). Starfield background.

**Content:**
```
F.A.Y.E.
FARM AUTONOMY & YIELD ENGINE
Governed Operations Intelligence

99 Tools  |  8 Operational Domains  |  6-Layer Security  |  Earned Autonomy
```

**Design notes:**
- Large "F.A.Y.E." in amber with text-shadow glow
- Subtitle: "Farm Autonomy & Yield Engine"
- Tagline: "Governed Operations Intelligence"
- Four stat counters animate in (same pattern as EVIE's 59 tools stat)
- Stats: "99 Tools", "8 Domains", "6-Layer Security", "Earned Autonomy"
- Brief tool domain descriptors below each stat (same as EVIE demo):
  - 99 Tools: "Accounting, orders, security, diagnostics, learning, analytics"
  - 8 Domains: "Alert triage, farm health, payments, market intel, network, E.V.I.E. oversight, accounting, orders"
  - 6-Layer Security: "Behavioral, anomaly, correlation, explainability, IoT, comprehensive audit"
  - Earned Autonomy: "L0 Reactive through L4 Autonomous -- trust earned through track record"

---

### Scene 2: COMMAND CENTER -- "Every Number. Every Signal. One Operator."

**Tag:** `Operational Awareness`
**Title:** "Every Number. Every Signal. One Operator."
**Desc:** "F.A.Y.E. runs a 15-minute intelligence loop across the entire network. Payment failures, heartbeat gaps, order volume anomalies, accounting imbalances -- detected and surfaced before you check."

**Panel A: Live Network Dashboard** (canvas chart)
- Animated real-time-style line chart showing 4 metrics over 24 hours:
  - "Orders" (amber line)
  - "Revenue" (cyan line)
  - "Alerts" (rose line, lower scale)
  - "Farm Uptime" (green line, near 100%)
- X-axis: time labels. Y-axis: dual scale
- Panel header: "Network Health -- 24 Hour Window"
- LIVE indicator dot

**Panel B: Alert Triage Cards** (4 cards, grid layout)
- Card 1: "Payment Failure Spike" -- severity: critical, domain: Payments, "3 failures in last hour -- 12% failure rate. Pattern matches Sunday evening batch cycle."
- Card 2: "Farm Heartbeat Gap" -- severity: high, domain: Network, "The Notable Sprout last seen 34 minutes ago. Pending orders: 2. Monitoring."
- Card 3: "Unclassified Transactions" -- severity: medium, domain: Accounting, "8 transactions ($2,340 CAD) pending classification. 3 are recurring patterns previously categorized as wholesale revenue."
- Card 4: "Order Volume Drop" -- severity: low, domain: Commerce, "Today 40% below 7-day average. Correlates with holiday schedule. No action recommended."
- Each card has severity color accent (rose/amber/blue/green), domain tag, auto-resolve indicator where applicable

**Panel C: Daily Briefing Preview** (compact card)
- Shows the 7 AM daily briefing format:
  - "12 orders yesterday | $847.20 CAD revenue | 1 farm online | 2 alerts open (0 critical)"
  - Sent to admin automatically

**Design notes:**
- This scene establishes F.A.Y.E. as the always-on operations layer
- Unlike EVIE (which shows sensor data), F.A.Y.E. shows business/operational signals
- The 15-minute loop concept should feel like a control room heartbeat

---

### Scene 3: EARNED AUTONOMY -- "Trust Is Not Given. It Is Earned."

**Tag:** `Progressive Autonomy`
**Title:** "Trust Is Not Given. It Is Earned."
**Desc:** "F.A.Y.E. starts in shadow mode -- logging what she would do without executing. As accuracy proves out over days and weeks, trust tiers promote automatically. Three failures demote instantly. This is governance, not automation."

**Panel A: Autonomy Ladder** (visual progression)
- Vertical or horizontal step diagram showing 5 levels:
  - L0 REACTIVE: "Responds only when asked"
  - L1 OBSERVANT: "Detects patterns, stays silent"
  - L2 ADVISORY: "Surfaces recommendations with confidence" (CURRENT -- highlighted amber)
  - L3 PROACTIVE: "Proposes actions, awaits confirmation"
  - L4 AUTONOMOUS: "Executes within policy guardrails"
- Current level (L2) has a pulsing amber indicator
- Arrow showing progression path with labels: "Shadow accuracy 90%+ over 14 days" between tiers

**Panel B: Trust Tier Matrix** (table/grid)
- Columns: Action Class | Current Tier | Promotion Threshold | Hard Cap
- Rows:
  - "Recommend" | AUTO | -- | --
  - "Classify" | QUICK_CONFIRM | 50 uses, 95% accuracy | --
  - "Notify" | AUTO | -- | --
  - "Modify" | CONFIRM | 50 uses, 95% accuracy | --
  - "Transact" | ADMIN | 100 uses, 98% accuracy | NEVER AUTO
  - "Override" | ADMIN | -- | ALWAYS ADMIN
- Color coding: AUTO=green, QUICK_CONFIRM=cyan, CONFIRM=amber, ADMIN=rose

**Panel C: Shadow Decision Log** (animated feed)
- Auto-playing feed showing shadow decisions with comparison:
  - "Shadow: Would classify TXN-4422 as Wholesale Revenue (confidence: 0.92). Actual: Admin classified as Wholesale Revenue. MATCH"
  - "Shadow: Would resolve Alert #118 (recurring heartbeat gap, resolved 4x prior). Actual: Admin resolved manually after 2 hours. MATCH"
  - "Shadow: Would send low-inventory notice. Actual: Admin sent identical notice. MATCH"
- Running accuracy counter: "Shadow Accuracy: 94.2% (47/50 matches over 14 days)"

**Design notes:**
- This is the key differentiator scene -- no other farm AI has this governance model
- The shadow log should feel like watching an AI prove itself in real time
- Hard caps on refunds/transactions are trust anchors -- show them prominently

---

### Scene 4: SECURITY OPERATIONS -- "Six Layers Deep. Zero Trust Assumed."

**Tag:** `Security Intelligence`
**Title:** "Six Layers Deep. Zero Trust Assumed."
**Desc:** "F.A.Y.E. runs continuous security analysis using peer-reviewed methodologies. Behavioral anomalies, statistical z-scores, multi-source threat correlation, and transparent explainability -- all surfaced with confidence levels and false-positive risk."

**Panel A: Six-Layer Security Stack** (vertical layered diagram)
- Layer 1: "Behavioral Analysis" -- Kamatchi et al. (2025) -- "Off-hours activity, new action types, auth surges"
- Layer 2: "Statistical Anomaly Detection" -- Yang et al. (2022) -- "z-score analysis on error rates, alert volumes"
- Layer 3: "Threat Correlation" -- Prasad et al. (2025) -- "Multi-source pattern matching, attack vector ID"
- Layer 4: "Explainable AI" -- Sharma et al. (2025) -- "Transparent rationale, confidence, false-positive risk"
- Layer 5: "IoT/Sensor Security" -- Hernandez-Ramos et al. (2025) -- "Heartbeat gaps, telemetry freshness"
- Layer 6: "Comprehensive Audit" -- "Auth patterns, stale connections, hard boundary verification"
- Each layer has a subtle animation (glow pulse traveling down from layer 1 to 6)

**Panel B: Live Threat Assessment** (simulated)
- Shows a security finding being generated:
  - Finding: "Concentrated error spike on /api/wholesale/checkout/execute"
  - Methodology: "Yang et al. z-score (2.4 sigma deviation)"
  - Data sources: "Error telemetry (last 4 hours), payment webhook logs"
  - Confidence: "Medium (72%)"
  - False-positive risk: "Moderate -- could be legitimate high-volume buyer"
  - Recommended response: "Monitor next 2 hours. Escalate if z-score exceeds 3.0"
- Shows the explainability chain -- from raw data to transparent recommendation

**Panel C: Security Workbook** (compact)
- Shows the persistent journal structure: "Threat Landscape | Research Synthesis | Detection Models | Incident Log | Implementation Ideas"
- Subtitle: "F.A.Y.E. maintains a living security workbook -- documenting findings, methodology, and evolving detection strategies."

**Design notes:**
- Academic citations are real and should be shown -- they demonstrate rigor
- The explainability chain (raw signal to recommendation with confidence) is the wow factor
- This scene should feel like a SOC (Security Operations Center) dashboard

---

### Scene 5: BUSINESS ENGINE -- "Revenue. Orders. Growers. Grocers."

**Tag:** `Commerce Intelligence`
**Title:** "Revenue. Orders. Growers. Grocers."
**Desc:** "F.A.Y.E. manages the full commerce lifecycle -- from producer applications to wholesale orders to payment reconciliation. Revenue trends, buyer analytics, fulfillment pipelines, and accounting -- all in one intelligence layer."

**Panel A: Revenue Trend** (canvas chart)
- Animated line chart: daily revenue over 30 days (amber line with gradient fill)
- Annotations: "Wholesale launch" marker, trend line showing growth
- Panel header: "Revenue Trend -- 30 Day Window (CAD)"

**Panel B: Order Pipeline** (visual funnel or status board)
- Status columns: "Pending" (3) | "Confirmed" (5) | "Fulfilling" (2) | "Delivered" (18) | "Cancelled" (1)
- Mini order cards showing: ID, buyer type, items, total
- Uses real format: "WO-2026-0401" style IDs
- Crops: Baby Arugula, Bibb Butterhead only

**Panel C: Buyer Analytics** (grid of mini stats)
- "Active Buyers: 4"
- "Repeat Rate: 62%"
- "Avg Order: $28.40 CAD"
- "Registration Trend: +2 this week"
- "Buyer Types: Grocery, Restaurant"

**Panel D: Producer Portal** (workflow cards)
- Shows the application review flow:
  - "New Application: Riverside Greens" -- Status: Pending -- "F.A.Y.E. reviews application, checks compliance, recommends approval"
  - Action: "approve_producer_application" -- creates farm account, assigns tier
  - "Rejection handled with clear reason and reapply guidance"

**Panel E: Accounting Snapshot** (compact)
- Trial balance summary: "Total Debits: $4,220.00 | Total Credits: $4,220.00 | BALANCED"
- "3 transactions pending classification"
- "Accounts Payable to farms: $1,840.00 across 1 farm"

**Design notes:**
- This scene shows F.A.Y.E. as the business brain -- not just monitoring, but managing commerce
- The producer portal flow shows F.A.Y.E. supporting both growers (onboarding) and buyers (analytics)
- Restaurant/grocer support = buyer analytics + fulfillment pipeline + delivery tracking

---

### Scene 6: AGENT SISTERHOOD -- "E.V.I.E. Reports. G.W.E.N. Researches. F.A.Y.E. Governs."

**Tag:** `Agent Collaboration`
**Title:** "E.V.I.E. Reports. G.W.E.N. Researches. F.A.Y.E. Governs."
**Desc:** "Three AI agents, each with distinct expertise, communicating through structured message channels. F.A.Y.E. oversees E.V.I.E.'s grower interactions, reviews G.W.E.N.'s research metrics, and coordinates cross-agent responses to complex situations."

**Panel A: Agent Overview Cards** (3 cards, horizontal)
- E.V.I.E. card (green accent):
  - "Environmental Vision & Intelligence Engine"
  - "59 tools | Grower-facing | Farm operations"
  - "Reports to F.A.Y.E. via escalations"
- G.W.E.N. card (violet accent):
  - "Grants, Workplans, Evidence & Navigation"
  - "103 tools | Research platform | Grant lifecycle"
  - "Shares engagement metrics with F.A.Y.E."
- F.A.Y.E. card (amber accent):
  - "Farm Autonomy & Yield Engine"
  - "99 tools | Operations governance | Business intelligence"
  - "Senior agent -- oversees both"

**Panel B: Live Conversation** (chat-style, auto-playing messages)

This is the centerpiece. An auto-playing multi-agent conversation showing a realistic operational scenario:

**Scenario: Wholesale order spike triggers cross-agent coordination**

Message 1 -- E.V.I.E. (green, escalation):
> "Escalation to F.A.Y.E.: Three wholesale orders received in 20 minutes. Current inventory: Baby Arugula 8oz x 12 available, Bibb Butterhead 16oz x 8 available. Combined order demand exceeds arugula stock by 4 units. Requesting fulfillment guidance."

Message 2 -- F.A.Y.E. (amber, directive):
> "Received. Checking order pipeline and buyer history."
> Tool call: `get_order_dashboard` -- "3 pending, 2 confirmed today"
> Tool call: `get_buyer_analytics` -- "Buyer WB-1044 is repeat (6 orders). WB-1051 is new."
> "Directive to E.V.I.E.: Prioritize repeat buyer WB-1044 for full fulfillment. Offer WB-1051 partial fill with next-available delivery date. Log as demand signal for harvest planning."

Message 3 -- E.V.I.E. (green, response):
> "Acknowledged. WB-1044 order confirmed and reserved. WB-1051 notified of partial availability. Flagging demand pattern -- arugula short 3 of last 5 order cycles."

Message 4 -- F.A.Y.E. (amber, observation to G.W.E.N.):
> "G.W.E.N. -- recurring arugula shortfall pattern. 3 of last 5 wholesale cycles show demand exceeding supply. Current tower allocation: 30 towers arugula, 48 towers butterhead. Requesting yield optimization analysis."

Message 5 -- G.W.E.N. (violet, response):
> "Reviewing tower allocation against 60-day demand data. Preliminary: reallocating 6 towers from butterhead to arugula would close the gap without impacting butterhead fulfillment (current surplus: 4 units avg). Publishing analysis to ELN with confidence interval."

Message 6 -- F.A.Y.E. (amber, decision):
> "Recommendation logged. Scheduling tower reallocation review for admin approval. Storing insight: 'Arugula demand exceeds allocation -- consider 36/42 split.' Shadow-logging this decision for trust evaluation."

**Panel C: E.V.I.E. Oversight Dashboard** (compact metrics)
- "E.V.I.E. Sessions (7d): 23"
- "Messages: 147"
- "Escalations to F.A.Y.E.: 4"
- "Feature Requests Submitted: 2"
- "Cost (7d): $2.84 CAD"
- "Top Ask: 'inventory status'"

**Design notes:**
- The conversation demonstrates: escalation flow, buyer prioritization, demand signal detection, cross-agent research request, shadow decision logging
- F.A.Y.E.'s tool calls are shown inline (like the EVIE demo shows tool invocations)
- The sisterly tone: "Received." "Good catch." -- professional but warm
- This is the scene that shows the three-agent ecosystem working as a unified intelligence

---

### Scene 7: LEARNING ENGINE -- "Every Outcome Teaches. Every Pattern Compounds."

**Tag:** `Adaptive Intelligence`
**Title:** "Every Outcome Teaches. Every Pattern Compounds."
**Desc:** "F.A.Y.E. stores insights, tracks outcomes, recognizes patterns, and evaluates her own accuracy. Knowledge persists across sessions. Patterns detected once inform decisions forever."

**Panel A: Knowledge Base** (animated card feed)
- Auto-playing insight cards being "stored":
  - Domain: "accounting" | Topic: "Sunday batch classification" | "Recurring Sunday evening transactions from Square webhook are wholesale revenue. 12 consecutive correct classifications." | Confidence: 0.96
  - Domain: "orders" | Topic: "Holiday volume dip" | "Order volume drops 35-45% on Canadian statutory holidays. Not anomalous -- suppress alert." | Confidence: 0.88
  - Domain: "farm_health" | Topic: "Heartbeat recovery" | "Farm heartbeat gaps under 15 minutes self-resolve 94% of the time. Escalate only after 30 minutes." | Confidence: 0.91

**Panel B: Outcome Tracking** (visual scoreboard)
- Shows a tool-by-tool accuracy grid:
  - "classify_transaction": 47/50 positive (94%) -- eligible for promotion
  - "resolve_alert": 38/42 positive (90.5%) -- monitoring
  - "get_market_overview": 12/12 positive (100%) -- AUTO tier confirmed
- Rolling 30-day success rate prominently displayed

**Panel C: Pattern Recognition** (timeline)
- Animated timeline showing detected patterns:
  - "Pattern: Sunday batch cycle detected (frequency: weekly, 52 occurrences)"
  - "Pattern: Arugula demand spike Thursdays (frequency: weekly, 8 occurrences)"
  - "Pattern: Farm heartbeat gap at 03:00 UTC (frequency: daily, maintenance window)"
- Each pattern shows: first seen, frequency, last seen, confidence

**Panel D: Domain Ownership Map** (radar chart or bar chart canvas)
- 8 domains displayed as a radar/spider chart:
  - alert_triage: L2 (Advisory)
  - accounting: L2 (Advisory)
  - farm_health: L2 (Advisory)
  - orders: L1 (Observant)
  - payments: L1 (Observant)
  - network: L2 (Advisory)
  - evie_oversight: L2 (Advisory)
  - market_intel: L1 (Observant)
- Pulsing amber on domains nearing promotion threshold

**Design notes:**
- This scene drives home that F.A.Y.E. is not static -- she evolves
- The knowledge base cards scrolling in feel like watching an AI build expertise in real time
- The domain ownership radar chart is the wow factor visual -- shows mastery across dimensions

---

### Scene 8: FULL TOOL INVENTORY -- "99 Tools. 8 Domains. One Governed Intelligence."

**Tag:** `Full Tool Inventory`
**Title:** "99 Tools. 8 Domains. One Governed Intelligence."
**Desc:** "Every tool in F.A.Y.E.'s operational catalog -- from security audits to revenue analysis to E.V.I.E. oversight. Each tool has an action class, a trust tier, and an accuracy record."

**Layout:** Same grid pattern as EVIE demo Scene 7 (category headers with tool name chips underneath)

**Categories and tool counts:**
1. System Health & Monitoring (3) -- get_system_health, get_farm_heartbeats, get_sync_status
2. Alerts Management (8) -- get_admin_alerts, create_alert, acknowledge_alert, resolve_alert, acknowledge_farm_alert, resolve_farm_alert, resolve_all_alerts, acknowledge_all_alerts
3. Accounting & Finance (7) -- get_trial_balance, get_unclassified_transactions, get_revenue_summary, get_accounts_payable, get_recent_transactions, classify_transaction, process_refund
4. Orders & Commerce (6) -- get_order_dashboard, get_order_detail, get_payment_status, get_refund_history, get_buyer_analytics, process_refund
5. Farm Network (2) -- get_network_overview, get_farm_detail
6. Market Intelligence (3) -- get_market_overview, fetch_market_trends, get_approved_market_sources
7. AI Costs (2) -- get_ai_usage_costs, get_aws_costs
8. E.V.I.E. & Agent Oversight (5) -- get_evie_engagement, get_agent_engagement_report, get_farm_alerts, get_evie_conversations, get_evie_conversation_summaries
9. Inter-Agent Communication (5) -- send_message_to_evie, get_evie_messages, get_agent_conversation, get_evie_conversations, get_evie_conversation_summaries
10. Security & Threat Detection (7) -- run_security_audit, analyze_security_behavior, detect_security_anomalies, correlate_threat_indicators, explain_security_finding, analyze_sensor_security, write_security_workbook
11. LE Diagnostics (7) -- diagnose_le_health, check_service_connectivity, get_le_inventory_status, read_le_source_file, get_le_config_and_permissions, get_recent_changes_and_deploys, check_dependencies
12. Learning & Knowledge (6) -- store_insight, get_knowledge, search_knowledge, archive_insight, record_outcome, get_patterns
13. Autonomy & Trust (6) -- evaluate_trust_promotion, get_domain_ownership, set_domain_ownership, log_shadow_decision, get_shadow_accuracy, get_action_class
14. Data Infrastructure (4) -- get_data_freshness, get_db_pool_status, check_certificate_expiry, get_setup_checklist
15. Analytics & Trends (5) -- analyze_revenue_trend, analyze_order_patterns, analyze_farm_performance, get_anomaly_report, get_decision_log
16. Producer Portal (3) -- review_producer_applications, approve_producer_application, reject_producer_application
17. Research Platform (4) -- get_research_dashboard, get_study_compliance_status, get_research_audit_log, manage_study_collaborators
18. Communications (4) -- send_admin_email, send_sms, get_email_status, get_webhook_config
19. Memory & Recall (4) -- save_admin_memory, recall_conversations, search_past_conversations, get_weekly_feature_request_todo
20. Feedback (3) -- record_recommendation_feedback, rate_alert, get_esg_summary

Each tool shown as a chip/tag with category color coding (same visual pattern as EVIE demo).

---

## Technical Implementation Notes

**File size target:** ~2000 lines (matching EVIE demo density)
**CSS:** Root variables use `--faye-amber` instead of `--evie-green`. Same layout system, panel structure, canvas rendering approach.
**Starfield:** Reuse identical starfield canvas code (just works).
**Auto-scroll:** Same `requestAnimationFrame` continuous scroll at 0.6px/frame.
**Scene transitions:** Same IntersectionObserver fade-in pattern.
**Canvas charts:** Revenue trend (Scene 2, 5), domain radar (Scene 7), autonomy ladder (Scene 3).
**No audio required:** Matches EVIE demo (audio control present but optional).
**No navigation bar:** Matches EVIE demo (removed per earlier request).
**Auto-play:** All animated feeds, chat messages, shadow logs auto-advance on timers.

**Linking:** Add a "Watch F.A.Y.E. Demo" button to GR-central-admin.html (where F.A.Y.E. lives), mirroring the "Watch Demo" button on evie-core.html.

---

## Factual Accuracy Guarantees

Every claim in this demo maps to real code:

| Demo Claim | Source of Truth |
|---|---|
| 99 tools | ADMIN_TOOL_CATALOG in admin-ops-agent.js |
| 8 operational domains | faye-learning.js domain ownership (alert_triage, accounting, farm_health, orders, payments, network, evie_oversight, market_intel) |
| 6-layer security | 6 security tools with cited methodologies in admin-ops-agent.js |
| Shadow decisions | log_shadow_decision + get_shadow_accuracy tools |
| Trust tiers | admin-ai-rules.json action_classes + trust promotion thresholds |
| L0-L4 autonomy | admin-ai-rules.json autonomy_levels |
| 15-minute intelligence loop | faye-intelligence.js runIntelligenceLoop() |
| Daily briefing | faye-intelligence.js sendDailyBriefing() |
| Weekly digest | faye-intelligence.js sendWeeklyDigest() |
| Inter-agent messaging | faye-learning.js sendAgentMessage() + admin-ops-agent.js tools |
| Knowledge persistence | faye-learning.js store/get/search/archive insights |
| Pattern recognition | faye-learning.js trackPattern/getPatterns |
| Crops: arugula + butterhead | Wholesale catalog (only 2 SKUs) |
| Farm: The Notable Sprout | farm.json |
| Producer portal | admin-ops-agent.js review/approve/reject tools |
| LE diagnostics (read-only) | 7 LE diagnostic tools with permitted path list |
| Revenue/order analytics | 5 analytics tools in admin-ops-agent.js |
| Academic citations | Real papers cited in tool descriptions |

---

## Wow Factor Summary

1. **Earned Autonomy visualization** -- No other farm AI has a governance model where the AI proves itself before gaining permissions. The shadow decision log and promotion ladder are unique.
2. **Six-layer security with real citations** -- Academic rigor shown transparently. This is not marketing -- it is methodology.
3. **Three-agent conversation** -- Watching E.V.I.E., G.W.E.N., and F.A.Y.E. coordinate in real time on a business scenario shows the platform as a living intelligence ecosystem, not three disconnected chatbots.
4. **Learning engine visualization** -- Watching knowledge accumulate, patterns compound, and domain mastery grow is compelling evidence that F.A.Y.E. gets better over time.
5. **Business operations scope** -- From producer onboarding to payment reconciliation to market intelligence to security audits. This is a full operations AI, not a chatbot wrapper.
6. **Hard boundaries shown proudly** -- "Refunds can NEVER be automated" is a trust signal, not a limitation. The demo shows governance as a feature.
