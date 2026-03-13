# Light Engine Pricing: Base Subscription + Data Usage Model

**Prepared:** March 13, 2026  
**Status:** PROPOSAL — For Review  
**Replaces:** Flat $1.00 CAD soft-launch pricing (Cloud & Edge)

---

## Context

- All current farms operate with **1 grow room**. Room-based tiering is premature.
- The real cost differentiator is **how much of the platform a farm uses** — which maps directly to data flowing through Light Engine.
- A farm that only monitors sensors costs almost nothing to serve.
- A farm running AI insights + wholesale + delivery + marketing + grants generates 5–10x the data transfer and API costs.
- Pricing should scale with data usage so new AI features **generate revenue** instead of eroding margins.

---

## How Light Engine Data Usage Works

Every service in Light Engine generates measurable data transfer — API calls, database writes, AI token processing, and sync payloads. The more services a farm activates, the more data flows.

### Measured Data Flow Per Service (1-room farm, per month)

| Service | Monthly Data | % of Total | Cost Driver |
|---------|:-----------:|:----------:|:------------|
| **Sensor telemetry sync** (every 2–5 min) | 28–41 MB | ~80% | DB writes, storage |
| **AI Recommendations pusher** (every 30 min) | ~7.2 MB | ~15% | GPT-4 API calls |
| **Wholesale / Orders** | 1–7 MB | ~2–5% | DB writes, payment processing |
| **POS / Inventory sync** | 0.5–1.2 MB | ~1–2% | DB writes |
| **AI Insights** (on-demand) | ~400 KB | <1% | GPT-4 API calls |
| **Grant Wizard** (per application) | 0.7–2.3 MB | ~1–3% | GPT-4 API calls, PDF generation |
| **Marketing AI** | 80–320 KB | <1% | Claude/GPT API calls |
| **Sustainability / ESG** | 75–200 KB | <1% | Compute only |
| **Delivery coordination** | 50–150 KB | <1% | DB writes |
| **WebSocket** | 10–30 KB | <1% | Connection overhead |
| **Total (active 1-room farm)** | **~38–60 MB** | | |

A farm using only monitoring + inventory sits at ~30 MB/month.  
A farm using every service (AI, wholesale, grants, marketing, delivery) pushes ~60+ MB/month.

---

## The Pricing Model

### One Base Subscription. Data Usage On Top.

| Component | Amount (CAD) | What It Covers |
|-----------|:-------------|:---------------|
| **Light Engine Base** | **$29/month** | Platform access, sensor monitoring, inventory, POS, online store, 1 user seat, 50 MB data included |

The base subscription covers a farm that monitors sensors and manages inventory — the core Light Engine experience. Every farm pays this. It covers our infrastructure baseline (~$5–8/mo cost to serve).

### Data Usage Pricing

Usage beyond the included 50 MB is billed per GB at tiered rates. Farms using more services naturally consume more data.

| Monthly Data Usage | Rate (CAD per GB) | Effective Monthly Add-On |
|:------------------:|:-----------------:|:------------------------:|
| First 50 MB | **Included** in base | $0 |
| 50 MB – 500 MB | **$9.99 / GB** | $0.50 – $4.50 |
| 500 MB – 2 GB | **$7.99 / GB** | $4.00 – $12.00 |
| 2 GB+ | **$4.99 / GB** | Scales |

### What Drives Data Usage Up

| Farm Activity | Data Impact | Who Hits This |
|:-------------|:------------|:-------------|
| Enable AI Recommendations (every 30 min) | +7 MB/mo | Any farm wanting AI farm ops |
| Use AI Insights frequently | +0.5–1 MB/mo | Active growers checking insights daily |
| Sell through Wholesale Marketplace | +1–7 MB/mo | Commercial farms with buyer relationships |
| Run AI Marketing Agent | +0.1–0.3 MB/mo | Farms generating social content |
| Submit Grant Applications | +0.7–2.3 MB/mo per app | Farms applying for funding |
| Increase telemetry frequency (2-min vs 5-min) | +15–20 MB/mo | Farms wanting tighter monitoring |
| Add more grow zones | +15–30 MB/mo per zone | Expanding operations |
| Enable Managed Delivery | +0.05–0.15 MB/mo | Farms using driver network |

### AI Actions — Metered Separately

AI API calls are the highest-cost variable. Data usage captures the data transfer, but AI calls carry additional per-call API costs (GPT-4, Claude). These are tracked as **AI Actions** on top of data usage.

| AI Action | Cost to GreenReach | Billed to Farm |
|-----------|:-----------------:|:--------------:|
| Farm Insight (sensor analysis) | $0.03–0.06 | **$0.10** |
| AI Recommendation Push (per push) | $0.03–0.06 | **$0.10** |
| AI Pricing Suggestion | $0.03–0.05 | **$0.10** |
| Marketing Post (generate) | $0.05–0.10 | **$0.20** |
| Grant Program Matching | $0.10–0.15 | **$0.30** |
| Grant Section Drafting | $0.15–0.25 | **$0.50** |
| Grant Website Analysis | $0.10–0.15 | **$0.30** |
| Crop Optimization (future) | $0.05–0.10 | **$0.20** |
| Demand Forecasting (future) | $0.05–0.10 | **$0.20** |
| Pest/Disease Detection (future) | $0.10–0.15 | **$0.30** |

**Included with base subscription:** 25 AI Actions per month (covers occasional insight checks).

**AI Action Packs:** Farms can pre-purchase packs at a discount:
- 100 Actions — **$8** ($0.08 each, 20% discount)
- 500 Actions — **$35** ($0.07 each, 30% discount)

### Transaction Fees

| Fee | Amount | What It Covers |
|-----|:------:|:---------------|
| **Wholesale Platform Fee** | 3% of order value | Marketplace routing, buyer management, invoicing |
| **Managed Delivery** | $2.50 per delivery | Route optimization, driver coordination, tracking |
| **Payment Processing** | Pass-through | Square 2.9% + $0.30 (no markup) |
| **Grant Export Pack** | $4.99 per export | PDF generation + formatted application sections |

---

## What Farms Actually Pay — Real Scenarios

### Scenario 1: Hobby Grower — "I just monitor my room"

| Line Item | Monthly |
|-----------|:-------:|
| Base subscription | $29.00 |
| Data: ~30 MB (under 50 MB cap) | $0.00 |
| AI Actions: 5 insight checks | $0.00 (within 25 free) |
| Wholesale: none | $0.00 |
| **Monthly total** | **$29.00** |
| Cost to serve | ~$5 |
| **Margin** | **83%** |

### Scenario 2: Active Grower — "I use AI and sell wholesale"

| Line Item | Monthly |
|-----------|:-------:|
| Base subscription | $29.00 |
| Data: ~80 MB (30 MB overage × $9.99/GB) | $0.30 |
| AI Actions: 60 total (25 free + 35 overage × $0.10) | $3.50 |
| AI Recommendation Pusher: 1,440 pushes × $0.10 | $144.00* |
| Wholesale: $3,000 orders × 3% | $90.00 |
| **Monthly total** | **$266.80** |
| Cost to serve | ~$25 |
| **Margin** | **91%** |

*Note: The AI Pusher runs automatically every 30 min. Farms that enable it opt into the cost. See "Pusher Pricing" below.*

### Scenario 3: Power User — "Everything on, AI-driven operations"

| Line Item | Monthly |
|-----------|:-------:|
| Base subscription | $29.00 |
| Data: ~150 MB (100 MB overage × $9.99/GB) | $1.00 |
| AI Recommendation Pusher (enabled) | $49.00/mo flat |
| AI Actions: 120 (insights + marketing + pricing) | 100 pack ($8) + 20 × $0.10 = $10.00 |
| Grant Wizard: 2 applications (match + draft + export) | $3.18 |
| Wholesale: $8,000 orders × 3% | $240.00 |
| Managed Delivery: 40 deliveries × $2.50 | $100.00 |
| Grant Export: 2 × $4.99 | $9.98 |
| **Monthly total** | **$442.16** |
| Cost to serve | ~$55 |
| **Margin** | **88%** |

---

## AI Recommendation Pusher — Special Pricing

The AI Pusher is unique: it runs automatically every 30 minutes (1,440 times/month), each call costing $0.03–0.06 in GPT-4 fees. At per-action pricing, this would cost farms $144/month — too steep for most.

**Proposed: Flat monthly add-on for the pusher.**

| Option | Price | What You Get |
|--------|:-----:|:-------------|
| **Pusher Off** | $0 | No automatic AI recommendations. Use on-demand insights only. |
| **Pusher On** | $49/mo | Unlimited AI recommendations every 30 min. GreenReach absorbs the GPT-4 cost (~$43–86/mo) at reduced margin. |

At $49/mo with ~$65/mo average API cost, the pusher is a **loss leader** that drives platform stickiness and upsells wholesale/delivery usage. Alternatively, reduce pusher frequency from 30-min to 2-hour for a $19/mo tier (360 calls/mo, ~$18 API cost, profitable).

| Pusher Tier | Frequency | Pushes/Mo | API Cost | Price | Margin |
|-------------|:--------:|:---------:|:--------:|:-----:|:------:|
| **Lite** | Every 2 hours | 360 | ~$18 | **$19/mo** | 5% |
| **Standard** | Every 30 min | 1,440 | ~$65 | **$49/mo** | -33%* |
| **Off** | — | 0 | $0 | $0 | — |

*Standard is a strategic loss leader — only sustainable if it drives wholesale/delivery revenue that more than compensates.

**Recommendation:** Launch with **Lite ($19/mo)** only. Add Standard once per-farm wholesale revenue validates the cross-subsidy.

---

## Revenue Model — 50 Farm Network

Assumes realistic mix based on current farm sizes:

| Farm Type | Count | Base | Data | AI Pusher | AI Actions | Wholesale | Delivery | Mo. Revenue |
|-----------|:-----:|:----:|:----:|:---------:|:----------:|:---------:|:--------:|:-----------:|
| Hobby (monitor only) | 20 | $29 | $0 | $0 | $0 | $0 | $0 | **$580** |
| Active (AI + some sales) | 20 | $29 | $0.30 | $19 | $8 | $30 | $0 | **$1,726** |
| Power (full platform) | 10 | $29 | $1 | $19 | $10 | $150 | $50 | **$2,590** |
| **Network Total** | **50** | | | | | | | **$4,896/mo** |

| Metric | Usage Model | Old $1/mo |
|--------|:----------:|:---------:|
| Monthly revenue | **$4,896** | $50 |
| Monthly cost to serve (infra + AI) | ~$650 | ~$650 |
| **Gross profit** | **$4,246** | -$600 |
| **Gross margin** | **87%** | -1,200% |

---

## Implementation Plan

### Phase 1 — Usage Metering (Week 1–2)

Build the tracking layer. No billing changes yet.

1. **Create `data_usage` table:**
   ```
   farm_id, service (telemetry|ai_insights|wholesale|pos|grants|marketing|delivery|esg),
   bytes_in, bytes_out, request_count, period (YYYY-MM), created_at
   ```

2. **Create `ai_actions` table:**
   ```
   farm_id, action_type (insight|recommendation|pricing|marketing|grant_match|grant_draft|grant_analysis),
   model (gpt-4|claude-sonnet|gpt-4o-mini), tokens_in, tokens_out, cost_usd, created_at
   ```

3. **Create `farm_billing` table:**
   ```
   farm_id, plan (base), plan_amount_cents, pusher_tier (off|lite|standard),
   data_included_mb, ai_actions_included, billing_period_start, billing_period_end, status
   ```

4. **Instrument all endpoints:**
   - Middleware to measure request/response size per farm per service
   - Wrap AI calls in metering function (already partially done for marketing agent)
   - Log wholesale order values, delivery counts

### Phase 2 — Dashboard & Billing (Week 3–4)

1. **Usage dashboard in farm admin:**
   - Current period: data consumed (MB), AI actions used, transaction fees accrued
   - Bar chart: usage by service category
   - Projected monthly bill based on current pace

2. **Square Subscriptions API:**
   - Base subscription: recurring $29/mo charge
   - Pusher add-on: recurring $19/mo (optional)
   - Usage invoice: end-of-period charge for overages + transaction fees

### Phase 3 — Go Live (Week 5–6)

1. **Update purchase.html:**
   - Single plan: Light Engine — $29/mo
   - "Add AI Recommendations" toggle: +$19/mo
   - Usage pricing table: data rates + AI action costs
   - Usage estimator: "Tell us what you'll use → estimated monthly cost"

2. **Soft enforcement:**
   - No hard cutoffs on data or AI actions
   - Dashboard warnings at 80% and 100% of included allotments
   - Overages billed at end of period

3. **Grandfather existing farms:**
   - 90-day grace period at current pricing
   - Pre-transition usage report so farms see what they'd pay
   - Email 30 days before new pricing activates

---

## Competitive Positioning

| Platform | Pricing Model | Our Advantage |
|----------|:-------------|:-------------|
| Artemis | $500–2,000/mo flat | 17x cheaper entry. Pay only for what you use. |
| Priva | Enterprise-only sales | Accessible to any size farm. Self-serve. |
| Agrilyst (defunct) | $199–499/mo flat | $29 entry. No feature lockouts. Scale on usage. |
| CropKing | Hardware bundles only | Software-only option. No hardware commitment. |
| **Light Engine** | **$29/mo + usage** | **Lowest entry in the market. AI included. You only pay more when you use more.** |

---

## Why This Model Works

1. **$29/mo gets any farm started.** A single room, basic monitoring, inventory, POS — covered. The barrier to adoption is as low as possible.

2. **Usage scales with value.** A farm paying $400/mo is a farm doing $8K+ in wholesale, using AI daily, and running managed deliveries. They're getting enormous value and paying proportionally.

3. **AI features become profit centers.** Every new AI capability (pest detection, demand forecasting, recipe optimization) adds metered actions. Launch features without worrying about margin erosion — farms that use them fund them.

4. **Wholesale commission aligns incentives.** GreenReach earns 3% when farms sell. The platform succeeds when farms succeed.

5. **No complexity.** One plan. One price. Use more, pay more. No tier selection, no feature comparison charts, no upgrade gates. The farm grows, the bill grows naturally.

6. **Protected margins at every level.** Even the cheapest hobby farm at $29/mo on ~$5 cost delivers 83% margins. Power users at $440 on ~$55 cost deliver 88%. No farm can outrun the pricing model.

---

*Recommendation: Implement Phase 1 metering immediately. Collect 30 days of real usage data to validate the data thresholds and AI action volumes before setting final prices.*
