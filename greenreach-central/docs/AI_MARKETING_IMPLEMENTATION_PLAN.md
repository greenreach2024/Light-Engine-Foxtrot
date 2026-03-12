# AI Marketing Integration — GreenReach Central Implementation Plan

> **Version:** 1.0 | **Date:** March 12, 2026 | **Reference:** `greenreach2024/Real-Estate-Ready-MVP`
> **Target:** GreenReach Central Admin (`GR-central-admin.html`)
> **Stack:** Node/Express + PostgreSQL + OpenAI (existing) + Claude (new) + AWS SES (existing)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Reference Architecture Review](#2-reference-architecture-review)
3. [GreenReach Adaptation Strategy](#3-greenreach-adaptation-strategy)
4. [Architecture Overview](#4-architecture-overview)
5. [Database Schema](#5-database-schema)
6. [AI Agent System](#6-ai-agent-system)
7. [Social Media Integration](#7-social-media-integration)
8. [Rules Engine & Guardrails](#8-rules-engine--guardrails)
9. [Admin UI — GreenReach Central](#9-admin-ui--greenreach-central)
10. [API Routes](#10-api-routes)
11. [Notification Integration](#11-notification-integration)
12. [Implementation Phases](#12-implementation-phases)
13. [File Manifest](#13-file-manifest)
14. [Environment Variables](#14-environment-variables)
15. [Cost Projections](#15-cost-projections)
16. [Risk Register](#16-risk-register)

---

## 1. Executive Summary

### What We're Building

An AI-powered marketing automation system within GreenReach Central Admin that:
- **Generates** social media content using AI (Claude/OpenAI) from farm data, market intelligence, wholesale stats, and seasonal context
- **Publishes** to Twitter/X, LinkedIn, Instagram, and Facebook via platform APIs
- **Enforces** strict rules and compliance guardrails before any content goes live
- **Manages** a human-in-the-loop approval workflow with progressive trust automation
- **Tracks** performance metrics, costs, and audit trails

### What We're Adapting From

The `Real-Estate-Ready-MVP` repo implements a mature AI social media agent architecture with:
- Claude-powered content generation with brand voice system prompts
- Platform-specific adapters (Twitter OAuth 1.0a, LinkedIn UGC, Instagram Graph API, Facebook Pages)
- A rules engine supporting auto-approve with 6-rule evaluation chain
- 4-stage trust ladder (all-human → auto-approve-low-risk → supervised → full autonomy)
- Per-agent guardrail policies with risk tiers, allowed/blocked action lists, and audit logging
- Full audit trail via `social_post_history`

### Key Differences for GreenReach

| Aspect | Real Estate Ready | GreenReach Central |
|--------|------------------|--------------------|
| **Stack** | Next.js + Supabase + Vercel | Express + PostgreSQL + AWS EB |
| **Auth** | Supabase Auth + RLS | Admin JWT tokens + `adminAuthMiddleware` |
| **AI Provider** | Claude (Anthropic SDK) | OpenAI (existing) + Claude (to add) |
| **Email** | Resend REST API | AWS SES (existing `email-service.js`) |
| **Frontend** | React components | Single-page HTML + vanilla JS (existing pattern) |
| **Domain** | Real estate / agents / buyers | Agriculture / farms / wholesale / retail |
| **Content Focus** | Market trends, listings, buyer demand | Harvest updates, product availability, seasonal tips, wholesale promos, sustainability |

---

## 2. Reference Architecture Review

### What Real-Estate-Ready-MVP Implements

```
src/lib/ai/guardrails.ts        → Agent policies (5 roles, risk tiers, approval rules)
src/lib/social/agent.ts          → Claude content generation + compliance checker
src/lib/social/platforms.ts      → Twitter, LinkedIn, Instagram, Facebook adapters
src/lib/social/rules-engine.ts   → Auto-approve engine (6-rule chain)
src/lib/content/copy.ts          → Centralized brand voice + copy constants
src/lib/settings/reader.ts       → DB-first settings with env fallback
src/lib/notifications/notify.ts  → Email (Resend) + SMS (Twilio) unified service

src/app/api/admin/social/generate/route.ts  → POST — Claude generation + draft save
src/app/api/admin/social/queue/route.ts     → GET/PATCH/DELETE — approval workflow
src/app/api/admin/social/publish/route.ts   → POST — platform publishing
src/app/api/admin/social/cron/route.ts      → POST — scheduled post publisher
src/app/api/admin/social/metrics/route.ts   → PATCH/GET — engagement metrics

supabase/migrations/0016_social_media_agent.sql → Tables: social_posts, agent_rules, social_post_history
```

### Key Patterns Worth Adopting

1. **Stub-first platform adapters** — gracefully degrade when API keys aren't configured
2. **DB-first settings** — API keys configurable from admin UI, falling back to env vars
3. **Compliance checker as a pure function** — `checkCompliance(content): string[]`
4. **Auto-approve rules loaded from DB** — admin can toggle rules without code deploys
5. **Cost tracking per post** — `generation_cost_usd` field on every generated post
6. **Immutable audit trail** — every action (create, approve, reject, edit, publish) logged
7. **System prompt as a constant** — brand voice rules immutable in code, not user-editable

---

## 3. GreenReach Adaptation Strategy

### Brand Voice — GreenReach Farms

```
You are the official social media manager for GreenReach Farms — a Canadian
indoor agriculture technology company growing fresh microgreens and leafy greens
year-round using the Light Engine IoT platform.

Brand voice:
- Knowledgeable, sustainable, tech-forward
- Community-focused, supporting local food systems
- Educational about indoor farming and food freshness
- Canadian English (neighbourhood, favourite, centre)
- Seasonal awareness (growing year-round is a differentiator)

STRICT RULES:
1. NEVER make health claims or medical statements about products
2. NEVER reference competitors by name
3. NEVER disclose proprietary growing techniques or equipment specifics
4. NEVER use misleading language about organic/natural certification
5. Always include a subtle call to action (visit site, order, learn more)
6. All data points must come from the provided context — do not invent statistics
7. Comply with Canadian Food Inspection Agency (CFIA) guidelines for food marketing
8. Never claim "organic" unless explicitly certified
```

### Content Pillars — GreenReach

| Pillar | Weight | AI Role | Examples |
|--------|--------|---------|----------|
| **Product Freshness** | 30% | Draft seasonal availability posts | "Fresh basil harvested this morning" |
| **Sustainability** | 25% | Draft impact metrics posts | "90% less water than field farming" |
| **Farm Technology** | 20% | Draft innovation stories | "Light Engine monitors 24/7" |
| **Community & Wholesale** | 15% | Draft partner spotlights | "Proud to supply [Restaurant]" |
| **Education** | 10% | Draft growing tips | "Why microgreens pack 40x nutrients" |

### Content Sources — GreenReach Data

| Source Type | Data Pulled From | Best For |
|-------------|-----------------|----------|
| `harvest` | `farm_inventory`, harvest logs | "Just harvested" posts |
| `market` | `market-intelligence.js` data | Price/availability updates |
| `wholesale` | Wholesale order stats | Partner milestone posts |
| `sustainability` | Farm environmental data | Impact/sustainability metrics |
| `product` | Product catalog / recipes | Product spotlight posts |
| `milestone` | Farm stats, order counts | Growth milestone celebrations |
| `manual` | Admin-provided text | One-off creative posts |

---

## 4. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│               GreenReach Central Admin Dashboard                      │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌────────────────────┐   │
│  │ Generate  │ │  Queue    │ │ Published │ │    Analytics       │   │
│  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └──────────┬─────────┘   │
└────────┼──────────────┼─────────────┼───────────────────┼────────────┘
         │              │             │                   │
    ┌────▼─────┐   ┌────▼──────┐  ┌──▼──────────┐   ┌────▼────────┐
    │ Generate │   │ Queue     │  │ Publish     │   │ Metrics     │
    │ API      │   │ API       │  │ API         │   │ API         │
    └────┬─────┘   └───────────┘  └──┬────┬─────┘   └─────────────┘
         │                           │    │
    ┌────▼─────────────┐             │  ┌─▼─────────────────────┐
    │ AI Engine        │             │  │ Platform Adapters     │
    │ ├── Claude API   │             │  │ ├── Twitter/X         │
    │ └── OpenAI (alt) │             │  │ ├── LinkedIn          │
    └──────────────────┘             │  │ ├── Instagram         │
                                     │  │ └── Facebook          │
    ┌────────────────────────────────▼──┤                       │
    │         PostgreSQL                │                       │
    │  ┌─────────────────────────┐     └───────────────────────┘
    │  │ marketing_posts         │
    │  │ marketing_post_history  │     ┌───────────────────────┐
    │  │ marketing_rules         │     │ Notifications         │
    │  │ marketing_skills        │     │ └── AWS SES (existing)│
    │  │ farm_inventory          │     └───────────────────────┘
    │  │ farms / orders          │
    │  └─────────────────────────┘
    └────────────────────────────────┘
```

### File Layout — New Files

```
greenreach-central/
├── services/
│   ├── marketing-ai-agent.js        ← AI content generation engine
│   ├── marketing-platforms.js       ← Social platform adapters
│   ├── marketing-rules-engine.js    ← Auto-approve logic + content filter
│   └── marketing-skills.js          ← Agent skill definitions + registry
├── routes/
│   └── admin-marketing.js           ← All marketing API endpoints
├── migrations/
│   └── 018_marketing_ai_agent.sql   ← DB schema for marketing tables
├── public/
│   └── views/
│       └── admin-marketing.html     ← Marketing tab UI (loaded into GR-central-admin)
└── docs/
    └── AI_MARKETING_IMPLEMENTATION_PLAN.md  ← This file
```

---

## 5. Database Schema

### Migration: `018_marketing_ai_agent.sql`

```sql
-- ============================================================
-- Marketing AI Agent — GreenReach Central
-- Tables: marketing_posts, marketing_post_history, 
--         marketing_rules, marketing_skills
-- ============================================================

-- Marketing posts (drafts, approved, published, etc.)
CREATE TABLE IF NOT EXISTS marketing_posts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform        TEXT NOT NULL CHECK (platform IN ('twitter','linkedin','instagram','facebook','all')),
    content         TEXT NOT NULL,
    image_url       TEXT,
    hashtags        TEXT[] DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','approved','scheduled','published','failed','rejected')),
    rejection_reason TEXT,
    
    -- Source tracking
    source_type     TEXT CHECK (source_type IN ('harvest','market','wholesale','sustainability','product','milestone','manual')),
    source_id       TEXT,
    source_context  JSONB DEFAULT '{}',
    
    -- Scheduling
    scheduled_for   TIMESTAMPTZ,
    published_at    TIMESTAMPTZ,
    platform_post_id TEXT,
    
    -- Engagement metrics
    metrics         JSONB DEFAULT '{"impressions":0,"clicks":0,"likes":0,"shares":0,"comments":0}',
    
    -- AI generation metadata
    model_used      TEXT,
    prompt_tokens   INTEGER DEFAULT 0,
    output_tokens   INTEGER DEFAULT 0,
    generation_cost_usd NUMERIC(8,6) DEFAULT 0,
    skill_used      TEXT,
    
    -- Audit
    created_by      TEXT,
    approved_by     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Audit trail for every action on a marketing post
CREATE TABLE IF NOT EXISTS marketing_post_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     UUID NOT NULL REFERENCES marketing_posts(id) ON DELETE CASCADE,
    action      TEXT NOT NULL CHECK (action IN ('created','approved','rejected','published','failed','edited','auto_approved','scheduled')),
    actor_id    TEXT,
    details     JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Configurable rules (admin-togglable, no code deploy needed)
CREATE TABLE IF NOT EXISTS marketing_rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name   TEXT UNIQUE NOT NULL,
    rule_type   TEXT NOT NULL CHECK (rule_type IN ('auto_approve','always_block','rate_limit','content_filter','skill_gate')),
    conditions  JSONB DEFAULT '{}',
    enabled     BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Agent skills — registered capabilities with descriptions
CREATE TABLE IF NOT EXISTS marketing_skills (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_name      TEXT UNIQUE NOT NULL,
    description     TEXT,
    category        TEXT CHECK (category IN ('content','analytics','engagement','scheduling','compliance')),
    risk_tier       INTEGER DEFAULT 1 CHECK (risk_tier BETWEEN 0 AND 4),
    approval_mode   TEXT DEFAULT 'required' CHECK (approval_mode IN ('none','spot-check','required','prohibited')),
    allowed_actions TEXT[] DEFAULT '{}',
    blocked_actions TEXT[] DEFAULT '{}',
    system_prompt   TEXT,
    enabled         BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_marketing_posts_status ON marketing_posts(status);
CREATE INDEX IF NOT EXISTS idx_marketing_posts_platform ON marketing_posts(platform);
CREATE INDEX IF NOT EXISTS idx_marketing_posts_scheduled ON marketing_posts(scheduled_for) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_marketing_post_history_post ON marketing_post_history(post_id);
CREATE INDEX IF NOT EXISTS idx_marketing_rules_enabled ON marketing_rules(enabled) WHERE enabled = true;

-- Seed default rules
INSERT INTO marketing_rules (rule_name, rule_type, conditions, enabled) VALUES
    ('require_approval_all', 'always_block', '{"description":"Stage 1: all posts require human approval"}', true),
    ('rate_limit_daily', 'rate_limit', '{"max_per_day":10,"description":"Max 10 posts per day per platform"}', true),
    ('block_health_claims', 'content_filter', '{"description":"Block unsubstantiated health or medical claims"}', true),
    ('block_organic_misuse', 'content_filter', '{"description":"Block uncertified organic/natural claims"}', true),
    ('block_competitor_names', 'content_filter', '{"description":"Block posts mentioning competitor names"}', true)
ON CONFLICT (rule_name) DO NOTHING;

-- Seed default skills
INSERT INTO marketing_skills (skill_name, description, category, risk_tier, approval_mode, allowed_actions, blocked_actions) VALUES
    ('content-drafter', 'Draft social media content from farm data', 'content', 2, 'required',
     ARRAY['draft-caption','generate-calendar','repurpose-content','summarize-performance'],
     ARRAY['publish-post','send-direct-message','invent-testimonials']),
    ('compliance-screener', 'Check content against marketing regulations', 'compliance', 3, 'required',
     ARRAY['flag-risky-claims','block-draft','route-to-human-review'],
     ARRAY['override-human-decision','rewrite-policy']),
    ('analytics-summarizer', 'Summarize post performance metrics', 'analytics', 0, 'none',
     ARRAY['summarize-metrics','compare-periods','surface-anomalies'],
     ARRAY['change-tracking','publish-external-report']),
    ('engagement-responder', 'Draft responses to social media interactions', 'engagement', 2, 'required',
     ARRAY['draft-reply','suggest-escalation','classify-sentiment'],
     ARRAY['send-external-message','change-account-status']),
    ('schedule-optimizer', 'Recommend optimal posting times', 'scheduling', 1, 'spot-check',
     ARRAY['recommend-time','analyze-engagement-patterns','suggest-frequency'],
     ARRAY['auto-schedule-without-review','delete-scheduled-posts'])
ON CONFLICT (skill_name) DO NOTHING;
```

---

## 6. AI Agent System

### `services/marketing-ai-agent.js`

Core responsibilities:
- Generate platform-specific social media content using Claude API
- Enforce brand voice via immutable system prompt
- Run compliance checks (blocked phrases, health claims, organic misuse)
- Track token usage and cost per generation
- Support multiple content source types (harvest, market, wholesale, etc.)

#### System Prompt (GreenReach Brand Voice)

```javascript
const SYSTEM_PROMPT = `You are the official social media manager for GreenReach Farms — a Canadian indoor agriculture technology company growing fresh microgreens and leafy greens year-round using the Light Engine IoT platform in Ontario, Canada.

Brand voice:
- Knowledgeable, sustainable, tech-forward
- Community-focused, supporting local food systems
- Educational about indoor farming and food freshness
- Canadian English (neighbourhood, favourite, centre)
- Seasonal awareness (growing year-round is a differentiator vs field farms)
- Warm and approachable, never corporate or clinical

STRICT RULES:
1. NEVER make health claims or medical statements about products
2. NEVER reference competitors by name
3. NEVER disclose proprietary growing techniques, exact equipment specs, or trade secrets
4. NEVER use misleading language about organic/natural certification unless explicitly certified
5. NEVER fabricate customer testimonials, reviews, or statistics
6. Always include a subtle call to action (visit site, order, learn more about indoor farming)
7. All data points must come from the provided context — do not invent statistics
8. Comply with Canadian Food Inspection Agency (CFIA) guidelines for food marketing
9. Comply with Canada's Anti-Spam Legislation (CASL) for promotional content
10. If mentioning sustainability metrics, cite the source data provided

Respond with ONLY the post content. No preamble, no "Here's a post:", no meta-commentary.`;
```

#### Blocked Phrases

```javascript
const BLOCKED_PHRASES = [
    'cures', 'treats', 'prevents disease', 'medical grade',
    'certified organic',  // unless actually certified
    'guaranteed freshness',
    'chemical free', 'chemical-free',  // all food has chemicals
    'superfood',  // unregulated health claim
    'detox', 'cleanse',
    'all natural',  // unless certified
    'zero pesticides',  // needs qualification
    'doctor recommended',
    'clinically proven',
];
```

#### Platform Rules

```javascript
const PLATFORM_RULES = {
    twitter: 'Max 280 characters. Punchy, conversational. 2-3 hashtags. No markdown. Emoji OK.',
    linkedin: '150-300 words. Professional, data-driven. Use line breaks for readability. 3-5 hashtags at end. Focus on agriculture tech innovation.',
    instagram: 'Engaging caption, 150-250 words. Visual storytelling angle. 10-15 hashtags in separate block. Emoji-friendly.',
    facebook: '100-200 words. Warm, community-focused. 1-3 hashtags. Include a call to action. Highlight local/seasonal angle.',
    all: 'Write a LinkedIn-style post (150-300 words, professional, 3-5 hashtags).',
};
```

#### Data Context Builder

The agent pulls context from existing GreenReach data sources:

```javascript
async function buildSourceContext(sourceType, sourceId) {
    switch (sourceType) {
        case 'harvest':
            // Pull from farm_inventory + harvest logs
            // { crop, variety, quantity, harvest_date, freshness_hours }
            break;
        case 'market':
            // Pull from market-intelligence.js data
            // { crop, retail_price, trend, trend_percent, retailers }
            break;
        case 'wholesale':
            // Pull from wholesale order stats
            // { partner_name, order_count, total_revenue, top_products }
            break;
        case 'sustainability':
            // Pull from farm environmental data
            // { water_saved_pct, energy_source, co2_reduction, local_miles }
            break;
        case 'product':
            // Pull from product catalog
            // { product_name, description, nutrition_facts, growing_method }
            break;
        case 'milestone':
            // Pull aggregate stats
            // { total_harvests, farms_active, orders_fulfilled, days_growing }
            break;
        case 'manual':
            // Admin-provided custom context
            break;
    }
}
```

#### AI Provider Strategy

```javascript
// Primary: Claude (Anthropic) — content generation
// Fallback: OpenAI (already installed) — if Claude unavailable
// The system tries Claude first, falls back to OpenAI GPT-4o-mini

async function generateContent(platform, sourceType, context, customInstructions) {
    // 1. Try Claude (Anthropic)
    if (process.env.ANTHROPIC_API_KEY) {
        return generateWithClaude(platform, sourceType, context, customInstructions);
    }
    // 2. Fallback to OpenAI (already configured in GreenReach Central)
    if (process.env.OPENAI_API_KEY) {
        return generateWithOpenAI(platform, sourceType, context, customInstructions);
    }
    throw new Error('No AI provider configured — set ANTHROPIC_API_KEY or OPENAI_API_KEY');
}
```

---

## 7. Social Media Integration

### `services/marketing-platforms.js`

Direct port of the Real-Estate-Ready-MVP platform adapters, adapted for Express/Node.js:

| Platform | API | Auth Method | Notes |
|----------|-----|-------------|-------|
| **Twitter/X** | v2 Tweets API | OAuth 1.0a (HMAC-SHA1) | 280-char limit, Free tier = 1,500 tweets/month |
| **LinkedIn** | UGC Posts API | OAuth 2.0 Bearer token | Token expires 60 days, needs refresh |
| **Instagram** | Graph API (via Facebook) | Page Access Token | **Requires image_url** for every post |
| **Facebook** | Pages API | Page Access Token | System User token for non-expiring access |

#### Key Design Decision: Stub Mode

All adapters gracefully fall back to **stub mode** when credentials are missing:
- Returns `{ success: true, stubbed: true, platformPostId: 'stub-twitter-...' }`
- This means the system works end-to-end in development without any social API keys
- Production publishing requires actual keys (enforced by a `block_stubbed_in_production` rule)

#### Credential Resolution Order

1. **Database first** — `SELECT value FROM site_settings WHERE key = 'twitter_api_key'`
2. **Environment variable fallback** — `process.env.TWITTER_API_KEY`

This allows API keys to be managed from the Admin Settings panel without redeploying.

### Settings Storage

Add a `site_settings` table (or reuse existing config mechanism):

```sql
CREATE TABLE IF NOT EXISTS site_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

This mirrors the Real-Estate-Ready-MVP `reader.ts` pattern — a simple key-value store with env fallback.

---

## 8. Rules Engine & Guardrails

### `services/marketing-rules-engine.js`

#### 6-Rule Auto-Approve Chain

```
┌─ Rule 1: require_approval_all active? → BLOCK (Stage 1 mode)
├─ Rule 2: Content filter (blocked phrases)? → BLOCK
├─ Rule 3: Rate limit exceeded? → BLOCK
├─ Rule 4: Source type eligible? (only harvest/market/milestone auto-approve) → BLOCK
├─ Rule 5: Platform character limit exceeded? → BLOCK
├─ Rule 6: 30-day rejection rate > 5%? → BLOCK
└─ ALL PASSED → Auto-approve ✓
```

#### Strict Rules (Always Enforced, Not Toggleable)

These are **hardcoded** in the compliance checker — admin cannot disable:

| Rule | Rationale |
|------|-----------|
| No health/medical claims | CFIA compliance |
| No uncertified "organic" claims | CFIA / USDA organic certification law |
| No fabricated testimonials | Competition Act (Canada) |
| No competitor mentions | Brand policy |
| No proprietary technique disclosure | Trade secret protection |
| No protected-class targeting | Human Rights Code |

#### Trust Ladder (Stage Progression)

| Stage | Automation Level | Unlock Criteria | Default Rule Config |
|-------|-----------------|----------------|---------------------|
| **1** (Default) | All posts require human approval | Default | `require_approval_all` = enabled |
| **2** | Low-risk content auto-approved | 50+ published, <5% rejection | Enable `auto_approve_low_risk` |
| **3** | Supervised — 1hr kill window | 200+ published, <3% rejection | Enable `supervised_autonomy` |
| **4** | Full autonomy, weekly review | 500+ published, <2% rejection | Disable `require_approval_all` |

### `services/marketing-skills.js`

#### Skill Registry

Skills define **what the AI agent can and cannot do** — loaded from `marketing_skills` table:

| Skill | Category | Risk Tier | Approval | Allowed Actions | Blocked Actions |
|-------|----------|-----------|----------|-----------------|-----------------|
| `content-drafter` | Content | Tier 2 | Required | draft-caption, generate-calendar, repurpose-content | publish-post, send-DM, invent-testimonials |
| `compliance-screener` | Compliance | Tier 3 | Required | flag-risky-claims, block-draft, route-to-review | override-human-decision, rewrite-policy |
| `analytics-summarizer` | Analytics | Tier 0 | None | summarize-metrics, compare-periods, surface-anomalies | change-tracking, publish-external-report |
| `engagement-responder` | Engagement | Tier 2 | Required | draft-reply, suggest-escalation, classify-sentiment | send-external-message |
| `schedule-optimizer` | Scheduling | Tier 1 | Spot-check | recommend-time, analyze-patterns, suggest-frequency | auto-schedule-without-review |

#### Skill Execution Flow

```
Admin triggers action
  → Resolve skill from marketing_skills table
  → Verify skill is enabled
  → Check risk tier against approval mode
  → Execute allowed actions only
  → Log to marketing_post_history with skill reference
  → Block if action is in blocked_actions list
```

---

## 9. Admin UI — GreenReach Central

### Integration Point

Add a new **"Marketing AI"** section in the GR Central Admin sidebar navigation, alongside existing sections (Overview, Farms, AI Analytics, AI Rules, etc.).

### View: `admin-marketing.html`

Four-tab dashboard loaded as a view within `GR-central-admin.html`:

#### Tab 1: Generate

- Source type selector (harvest, market, wholesale, sustainability, product, milestone, manual)
- Platform selector (Twitter, LinkedIn, Instagram, Facebook, All)
- Custom instructions textarea
- "Generate Draft" button → calls `/api/admin/marketing/generate`
- Preview of generated content with compliance flag indicators
- Estimated cost display

#### Tab 2: Queue (Approval Workflow)

- Status filter tabs: Draft | Approved | Scheduled | Published | Rejected | All
- Post cards showing: content preview, platform badge, source type, status
- Action buttons per post:
  - **Approve** → moves to approved
  - **Reject** (with reason) → moves to rejected
  - **Edit** → inline content editor
  - **Schedule** → date/time picker
  - **Delete** → removes draft/rejected only
  - **Publish** → immediate platform publish
- Summary counts bar at top

#### Tab 3: Published

- Published posts with engagement metrics (impressions, clicks, likes, shares, comments)
- Platform-grouped view
- Cost per post display
- Performance trend charts (simple bar/line)

#### Tab 4: Settings & Skills

- **AI Agent Configuration:**
  - AI Provider toggle (Claude / OpenAI / Both with fallback)
  - API keys (masked, editable)
  - Model selection
- **Platform Credentials:**
  - Twitter, LinkedIn, Instagram, Facebook API key management
  - Connection status indicators (Connected / Stub Mode)
  - Test post button per platform
- **Rules Management:**
  - Toggle rules on/off from `marketing_rules`
  - View/edit rule conditions
  - Trust ladder stage indicator
- **Skills Registry:**
  - View all registered skills
  - Enable/disable skills
  - Risk tier and approval mode per skill
  - Allowed/blocked action lists
- **Content Pillars:**
  - Configure pillar weights
  - View content distribution analytics

### UI Pattern

Follows the existing GR Central Admin pattern:
- Dark theme (`--bg-primary: #0a0f1e`)
- Card-based layout with `var(--bg-card)`
- KPI cards at top of each view
- Tables with hover states and status badges
- Modal dialogs for edit/reject/schedule actions

---

## 10. API Routes

### `routes/admin-marketing.js`

All endpoints require `adminAuthMiddleware`:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/admin/marketing/generate` | Generate AI content draft(s) |
| `GET` | `/api/admin/marketing/queue` | List posts with status filter |
| `PATCH` | `/api/admin/marketing/queue` | Approve, reject, edit, schedule a post |
| `DELETE` | `/api/admin/marketing/queue` | Delete draft/rejected posts |
| `POST` | `/api/admin/marketing/publish` | Publish to social platform |
| `PATCH` | `/api/admin/marketing/metrics` | Update engagement metrics |
| `GET` | `/api/admin/marketing/metrics` | Get aggregate/per-post metrics |
| `GET` | `/api/admin/marketing/rules` | List marketing rules |
| `PATCH` | `/api/admin/marketing/rules` | Toggle/edit rules |
| `GET` | `/api/admin/marketing/skills` | List agent skills |
| `PATCH` | `/api/admin/marketing/skills` | Toggle/edit skills |
| `POST` | `/api/admin/marketing/cron` | Process scheduled posts (cron-triggered) |
| `GET` | `/api/admin/marketing/settings` | Get marketing-related settings |
| `PUT` | `/api/admin/marketing/settings` | Update marketing-related settings |

### Route Registration (server.js)

```javascript
import adminMarketingRoutes from './routes/admin-marketing.js';
// ...
app.use('/api/admin/marketing', adminAuthMiddleware, adminMarketingRoutes);
```

---

## 11. Notification Integration

### Leverage Existing Email Service

GreenReach Central already has `services/email-service.js` using AWS SES. Marketing notifications will use this existing service:

| Event | Email | In-App |
|-------|-------|--------|
| Draft generated | ✓ (to admin) | Badge on Queue tab |
| Post approved | ✓ | ✓ |
| Post published | ✓ (digest) | ✓ |
| Post failed | ✓ | Alert in Queue |
| Rate limit hit | ✓ | Alert in Generate tab |
| Auto-approve triggered | ✓ | Status update |
| Weekly digest | ✓ | Analytics summary |

### SMS (Future — Phase 3)

If Twilio is added later, critical alerts (failures, rate limits) can also be SMS'd. The notification service should be built with channel abstraction from day one (matching the reference `notify.ts` pattern).

---

## 12. Implementation Phases

### Phase 1: Foundation (Week 1-2) — Core Infrastructure

| Task | Priority | Est. Hours |
|------|----------|------------|
| Database migration `018_marketing_ai_agent.sql` | P0 | 2h |
| `services/marketing-ai-agent.js` — Claude/OpenAI content generation | P0 | 6h |
| `services/marketing-ai-agent.js` — compliance checker | P0 | 3h |
| `services/marketing-skills.js` — skill registry + enforcement | P0 | 4h |
| `routes/admin-marketing.js` — generate + queue + CRUD endpoints | P0 | 6h |
| Basic admin UI — Generate tab + Queue tab | P0 | 8h |
| Wire into `server.js` + `GR-central-admin.html` sidebar | P0 | 2h |
| Test with stub platforms | P0 | 3h |

**Deliverable:** Admin can generate content from farm data, review/approve/reject drafts, all with audit trail. No live publishing.

### Phase 2: Platform Publishing (Week 3-4) — Social Connectors

| Task | Priority | Est. Hours |
|------|----------|------------|
| `services/marketing-platforms.js` — Twitter adapter (OAuth 1.0a) | P1 | 4h |
| `services/marketing-platforms.js` — LinkedIn adapter (OAuth 2.0) | P1 | 3h |
| `services/marketing-platforms.js` — Instagram adapter (Graph API) | P1 | 4h |
| `services/marketing-platforms.js` — Facebook adapter (Pages API) | P1 | 3h |
| Publish endpoint + stub-mode enforcement | P1 | 3h |
| Settings UI — platform credential management | P1 | 4h |
| Published tab — engagement metrics display | P1 | 4h |
| Email notifications on publish/fail | P1 | 2h |

**Deliverable:** End-to-end flow — generate → approve → publish to real platforms. Stub mode for unconfigured platforms.

### Phase 3: Rules Engine & Automation (Week 5-6) — Trust Building

| Task | Priority | Est. Hours |
|------|----------|------------|
| `services/marketing-rules-engine.js` — 6-rule evaluation chain | P1 | 5h |
| Auto-approve flow integration | P1 | 3h |
| Rules management UI (toggle, edit conditions) | P1 | 4h |
| Skills management UI (view, toggle, risk tier display) | P2 | 3h |
| Scheduled posting (cron endpoint) | P2 | 4h |
| Engagement metrics update endpoint | P2 | 3h |
| Analytics tab — performance charts + cost tracking | P2 | 5h |
| Trust ladder visualization + stage indicator | P2 | 3h |

**Deliverable:** Rules-based auto-approve, scheduling, analytics, progressive autonomy.

### Phase 4: Advanced Features (Week 7-8) — Polish & Expansion

| Task | Priority | Est. Hours |
|------|----------|------------|
| Content calendar generation (weekly themes) | P3 | 4h |
| A/B variant generation (2 versions, admin picks) | P3 | 3h |
| Data context auto-enrichment (pull latest farm data into prompts) | P2 | 4h |
| Image URL support for Instagram/Facebook | P2 | 3h |
| Weekly digest email with metrics summary | P3 | 3h |
| Prompt versioning and audit logging | P2 | 2h |
| Settings page backup/export | P3 | 2h |

**Deliverable:** Mature marketing AI with content calendars, variant testing, and rich analytics.

---

## 13. File Manifest

### New Files to Create

| File | Type | Purpose |
|------|------|---------|
| `services/marketing-ai-agent.js` | Service | AI content generation + compliance checking |
| `services/marketing-platforms.js` | Service | Twitter, LinkedIn, Instagram, Facebook adapters |
| `services/marketing-rules-engine.js` | Service | Auto-approve logic, rate limits, content filters |
| `services/marketing-skills.js` | Service | Agent skill registry + enforcement |
| `services/marketing-settings.js` | Service | DB-first settings reader with env fallback |
| `routes/admin-marketing.js` | Route | All marketing admin API endpoints |
| `migrations/018_marketing_ai_agent.sql` | Migration | DB schema for marketing tables |
| `public/views/admin-marketing.html` | View | Marketing dashboard HTML (4-tab layout) |
| `docs/AI_MARKETING_IMPLEMENTATION_PLAN.md` | Docs | This plan |

### Files to Modify

| File | Change |
|------|--------|
| `server.js` | Add `import adminMarketingRoutes` + `app.use('/api/admin/marketing', ...)` |
| `public/GR-central-admin.html` | Add "Marketing AI" sidebar nav item + view container |
| `package.json` | Add `@anthropic-ai/sdk` dependency |

---

## 14. Environment Variables

### New Variables Required

```dotenv
# ── AI Agent (Claude) — Primary provider ──
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxx

# ── Social Platform APIs ──
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_SECRET=

LINKEDIN_ACCESS_TOKEN=
LINKEDIN_PERSON_URN=

INSTAGRAM_ACCESS_TOKEN=
INSTAGRAM_BUSINESS_ACCOUNT_ID=

FACEBOOK_PAGE_ACCESS_TOKEN=
FACEBOOK_PAGE_ID=
```

### Already Available

```dotenv
OPENAI_API_KEY=           # ✅ Already configured — fallback AI provider
AWS_REGION=               # ✅ Already configured — email via SES
FROM_EMAIL=               # ✅ Already configured — email from address
```

---

## 15. Cost Projections

### AI API Costs

| Provider | Model | Input/1K tokens | Output/1K tokens |
|----------|-------|-----------------|------------------|
| Claude | claude-sonnet-4-20250514 | $0.003 | $0.015 |
| OpenAI | gpt-4o-mini | $0.00015 | $0.0006 |

### Estimated Per-Post Cost

| Platform | Claude Est. | OpenAI Fallback Est. |
|----------|------------|---------------------|
| Twitter | ~$0.004 | ~$0.0003 |
| LinkedIn | ~$0.008 | ~$0.0006 |
| Instagram | ~$0.008 | ~$0.0006 |
| Facebook | ~$0.006 | ~$0.0005 |
| All (4x) | ~$0.026 | ~$0.002 |

### Monthly Budget Estimate

| Frequency | Posts/Month | Claude Cost | OpenAI Cost |
|-----------|------------|-------------|-------------|
| 1/day all platforms | 120 | ~$3.12 | ~$0.24 |
| 3/week all platforms | 48 | ~$1.25 | ~$0.10 |
| 1/week all platforms | 16 | ~$0.42 | ~$0.03 |

### Social Platform API Costs

| Platform | Free Tier | Paid Tier |
|----------|-----------|-----------|
| Twitter/X | 1,500 tweets/month | Basic $100/month (3,000) |
| LinkedIn | Free (share API) | Marketing API requires partnership |
| Instagram | Free (Graph API) | — |
| Facebook | Free (Pages API) | — |

---

## 16. Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| AI generates non-compliant content | High | Medium | Strict compliance checker + human approval gate (Stage 1 default) |
| Social API rate limits hit | Medium | Low | Rate limit rule (10/day/platform) + backoff |
| API key exposure | High | Low | DB-stored keys (not in code), env fallback only |
| Content posted without approval | Critical | Very Low | `require_approval_all` rule enabled by default, immutable strict rules |
| AI provider outage | Low | Low | Dual-provider support (Claude primary, OpenAI fallback) |
| CFIA complaint from food marketing claims | High | Low | Blocked phrases list + human review + audit trail |
| Token cost overrun | Low | Very Low | Per-post cost tracking + monthly budget alerts |
| Stale farm data in generated content | Medium | Medium | Context builder pulls latest DB data at generation time |

---

## Appendix A: Mapping from Real-Estate-Ready-MVP

| Reference File | GreenReach Equivalent | Notes |
|---------------|----------------------|-------|
| `src/lib/ai/guardrails.ts` | `services/marketing-skills.js` | Risk tiers, approval modes, allowed/blocked actions |
| `src/lib/social/agent.ts` | `services/marketing-ai-agent.js` | System prompt rewritten for agriculture, dual-provider support |
| `src/lib/social/platforms.ts` | `services/marketing-platforms.js` | Direct port — same APIs, JS instead of TS |
| `src/lib/social/rules-engine.ts` | `services/marketing-rules-engine.js` | Same 6-rule chain, table name changed |
| `src/lib/settings/reader.ts` | `services/marketing-settings.js` | PostgreSQL instead of Supabase, same pattern |
| `src/lib/notifications/notify.ts` | `services/email-service.js` (existing) | Reuse existing AWS SES service |
| `src/app/api/admin/social/*.ts` | `routes/admin-marketing.js` | Consolidated into single Express router |
| `supabase/migrations/0016_social_media_agent.sql` | `migrations/018_marketing_ai_agent.sql` | Added `marketing_skills` table, GreenReach-specific rules |
| `src/components/admin/social-agent-dashboard.tsx` | `public/views/admin-marketing.html` | Vanilla JS/HTML matching GR admin pattern |

---

## Appendix B: Agent Interaction Model

### How Agents (Skills) Interact

```
┌──────────────────────────────────────────────────────────────┐
│                    Admin Action / Cron Trigger                 │
│                           │                                   │
│                    ┌──────▼──────┐                            │
│                    │ Skill Router │                            │
│                    └──────┬──────┘                            │
│                           │                                   │
│          ┌────────────────┼────────────────┐                 │
│          ▼                ▼                ▼                  │
│  ┌───────────────┐ ┌────────────┐ ┌──────────────────┐      │
│  │content-drafter│ │schedule-   │ │compliance-       │      │
│  │               │ │optimizer   │ │screener          │      │
│  │ • draft-      │ │            │ │                  │      │
│  │   caption     │ │ • recommend│ │ • flag-risky-    │      │
│  │ • generate-   │ │   -time    │ │   claims         │      │
│  │   calendar    │ │ • analyze- │ │ • block-draft    │      │
│  │ • repurpose-  │ │   patterns │ │ • route-to-      │      │
│  │   content     │ │            │ │   human-review   │      │
│  └───────┬───────┘ └──────┬─────┘ └────────┬─────────┘      │
│          │                │                │                  │
│          └────────────────┼────────────────┘                 │
│                           ▼                                   │
│                   ┌──────────────┐                            │
│                   │ Audit Logger │                            │
│                   │ (immutable)  │                            │
│                   └──────────────┘                            │
└──────────────────────────────────────────────────────────────┘
```

### Skill Invocation Contract

Every skill invocation follows this contract:

```javascript
{
    skill: 'content-drafter',        // from marketing_skills.skill_name
    action: 'draft-caption',         // must be in allowed_actions
    input: { ... },                  // action-specific payload
    context: { ... },                // farm data / market data
    requestedBy: 'admin@...',        // actor identity
    timestamp: '2026-03-12T...',
}
```

Response:

```javascript
{
    success: true,
    output: { ... },                 // action-specific result
    skillUsed: 'content-drafter',
    riskTier: 2,
    requiresApproval: true,         // based on skill.approval_mode
    auditId: 'uuid',               // reference in marketing_post_history
}
```

---

*End of Implementation Plan*
