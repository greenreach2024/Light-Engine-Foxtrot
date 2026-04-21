# 05 — Marketing Platform Playbook

**Owner:** Central admin / marketing, agent-supported by S.C.O.T.T.
**Primary agent:** S.C.O.T.T. (junior to F.A.Y.E.) — see Playbook 02
**Related docs:** `greenreach-central/services/marketing-*.js`, `docs/ai-agents/AI_AGENT_DOCUMENTATION.md`

---

## 1. Purpose & scope

Foxtrot's marketing layer produces, schedules, auto-approves, and publishes content across multiple social platforms, runs campaigns, serves public landing pages, and — once subdomain multi-tenancy ships — will power the per-farm branded storefront experience. Read this before adding a new platform integration, new S.C.O.T.T. tool, new campaign type, or new landing page template.

## 2. Surfaces

| Surface | Audience | Entry point |
|---|---|---|
| Public landing pages | Prospective farms, buyers, investors | `landing-*.html`, `about.html`, `blog.html` |
| Per-farm storefront (subdomain branding **planned**, not live) | Retail buyers | `public/farm-sales-shop.html` on LE Cloud Run today; target URL `<slug>.greenreachgreens.com/farm-sales-shop.html` once subdomain routing ships (see Playbook 01 §7) |
| Admin Marketing | GreenReach marketing ops | `GR-central-admin.html` → Marketing tab |
| S.C.O.T.T. chat + publish UI | Admin / F.A.Y.E. delegation | S.C.O.T.T. panel in admin UI |
| Email + SMS alerts (also marketing broadcasts) | Farms + buyers | Google Workspace SMTP + Email-to-SMS gateway |

## 3. S.C.O.T.T. (marketing agent)

**File:** `greenreach-central/routes/scott-marketing-agent.js`
**LLM:** Gemini 2.5 Flash (via Vertex AI)
**Positioning:** Junior to F.A.Y.E. — all risky publishes can be escalated to or overridden by F.A.Y.E.

### 3.1 Endpoints
| Method | Path | Purpose |
|---|---|---|
| POST | `/chat` | Standard request/response chat |
| GET | `/status` | Health + model + enabled features |
| GET | `/state` | Current marketing state snapshot |
| GET | `/history/:conversationId` | Conversation history |

### 3.2 Tool capabilities (via `greenreach-central/services/marketing-ai-agent.js`)
- `generateSocialPost(platform, brief)` — single-platform copy
- `generateMultiPlatformPosts(brief, platforms[])` — platform-aware variants
- `checkCompliance(content)` — flags disallowed claims
- Skill system prompts (`SKILL_SYSTEM_PROMPTS`) for specific content types
- Platform rules (`PLATFORM_RULES`) for length, hashtag caps, emoji policy

### 3.3 Rules engine
**File:** `greenreach-central/services/marketing-rules-engine.js`
- `evaluateAutoApprove(content, context)` — returns `{ autoApprove: true/false, reasons[] }`
- `tryAutoApprove(content)` — one-shot auto-approve gate
- `loadAllRules()` — hot-reloadable rules from DB

### 3.4 Platforms
**File:** `greenreach-central/services/marketing-platforms.js`
- `publishToPlatform(platform, content, credentials)` — dispatches to the right SDK/API
- `getPlatformStatus(platform)` — connectivity + auth state
- `getPlatformAccountInfo(platform)` — linked account metadata

### 3.5 Settings
**File:** `greenreach-central/services/marketing-settings.js`
- Per-platform credentials, posting cadence, tone presets, blacklists
- `checkPlatformCredentials(platform)` — validates stored OAuth/API keys
- `getSetting(key)` / `setSetting(key, value)` / `deleteSetting(key)`

### 3.6 Skills registry
**File:** `greenreach-central/services/marketing-skills.js`
- `listSkills()` — returns available content-creation skills (e.g., "harvest announcement", "CSA pitch", "investor update")
- Each skill has its own system prompt fragment, example outputs, and compliance notes

## 4. Campaigns

**Route:** `greenreach-central/routes/campaign.js`
**Admin route:** `greenreach-central/routes/admin-marketing.js`

| Concept | Description |
|---|---|
| Campaign | A named effort with a goal, audience, duration, and set of posts |
| Content piece | A single post targeted at one or more platforms |
| Schedule | When a piece publishes (immediate, scheduled, recurring) |
| Metrics | Impressions, clicks, conversions (platform-reported) |

## 5. Public-facing pages

All marketing/landing pages are owned by Central and live under `greenreach-central/public/`. LE serves these by falling through to Central's `public/` tree (see Playbook 00 §4 and Playbook 08 §4). Do not add standalone copies at repo root `public/` unless the page needs to render before Central's middleware runs.

- `greenreach-central/public/landing-*.html` — marketing landing pages (home, cloud, edge, purchase-success, downloads, main)
- `greenreach-central/public/about.html` — company/mission
- `greenreach-central/public/id-buy-local.html` — programmatic + local campaigns
- `greenreach-central/public/blog.html`, `blog-post.html`, plus per-post content under `greenreach-central/public/blog/*/content.html` — blog system
- `greenreach-central/public/faye-demo.html`, `evie-demo.html`, `gwen-demo.html` — agent demo surfaces used as marketing assets (demo files `faye-demo.html`, `evie-core.html`, `gwen-core.html`, etc. are dual-deployed and also exist at repo root `public/`)

All landing pages use the shared theme tokens in `greenreach-central/public/styles/` — do not fork styles.

## 6. Per-farm branding (planned subdomain product)

Per-farm subdomain storefronts (see Playbook 01 §7) are the **intended** public face of each tenant but are **not live in production today** — `greenreachgreens.com` is Central's custom domain (pending DNS migration) and LE has no custom domain. Marketing designs and copy must still be produced against the target state, but before shipping anything that depends on a subdomain being live, verify:
- Has the subdomain rollout happened (Cloud Run domain mapping + wildcard TLS + DNS wildcard)?
- If not, does the rollout path use LE's Cloud Run URL or a path under Central's domain as a fallback?
- Does the farm's storefront inherit the new content/theme correctly under whichever host is actually serving it?
- Does the auto-injected `api-config.js` resolve under that host?
- Are Square OAuth redirect URIs aligned with the real live host?

## 7. Email & SMS

| Channel | Path | Purpose |
|---|---|---|
| Transactional email | Google Workspace SMTP (`info@greenreachgreens.com`) | Order confirmations, password resets, alerts |
| Marketing broadcasts | Same SMTP + audience lists | Farm newsletters, campaigns |
| SMS (critical alerts only) | Email-to-SMS gateway via SMTP | Sensor outages, payment failures |
| Templates | `greenreach-central/services/email-new-templates.js` (consumed via `greenreach-central/services/email.js`) | Inline HTML/text email templates (no separate `templates/` directory today) |

Unsubscribe handling: every marketing email includes a one-click unsubscribe link tied to the recipient's audience-list entry.

## 8. Security & tenancy rules

- **S.C.O.T.T. cannot publish outside the admin's authorized farms** — if the admin's JWT is farm-scoped, posts are farm-scoped
- Credentials for marketing platforms are stored in `marketing_settings` (admin-only; RLS-protected by `is_admin`)
- Rules engine rejects posts containing secrets, unapproved health claims, or competitor mentions
- Campaign metrics joined to `farm_id` — never mixed across farms in admin reporting for farm-admin viewers
- F.A.Y.E. can freeze S.C.O.T.T. publishing via a feature flag

## 9. Configuration

| Env var / setting | Purpose |
|---|---|
| Vertex AI via ADC | Gemini 2.5 Flash for S.C.O.T.T. |
| `MARKETING_AUTO_APPROVE_ENABLED` | Global kill switch for auto-approval |
| Per-platform creds (stored in `marketing_settings`) | OAuth / API keys for each social network |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | Email |
| `SCOTT_MAX_TOOL_LOOPS` | Safety cap on S.C.O.T.T. tool-call chain |

## 10. Adding a new platform

- [ ] Define platform rules (length, hashtag limits, media constraints) in `marketing-platforms.js`
- [ ] Add an OAuth / API-key flow with encrypted storage in `marketing_settings`
- [ ] Add a `publishToPlatform` handler
- [ ] Extend the rules engine with any platform-specific compliance rules
- [ ] Add `getPlatformStatus` + `getPlatformAccountInfo`
- [ ] Update this playbook's table of platforms

## 11. Never do

- Hard-code social credentials or API keys
- Publish without going through the rules engine + compliance check
- Let S.C.O.T.T. ship content for farms an admin isn't authorized for
- Skip the `unsubscribe` link in marketing emails
- Use transactional templates for marketing blasts (SPF/DKIM alignment differs)
- Inline large media as base64 in email — use GCS-hosted URLs

## 12. Known gaps / open items

- Platform OAuth token refresh is manual on some platforms; automate on platform addition
- Campaign ROI reporting depends on platform-provided metrics and is best-effort
- Unsubscribe tracking is per-list, not global preferences center
- No A/B testing framework for content yet (intentional MVP scope)
- S.C.O.T.T. does not yet integrate with the tool gateway's audit log — publish actions are logged in `marketing_audit` but should converge

## 13. References

- `greenreach-central/routes/scott-marketing-agent.js`
- `greenreach-central/routes/admin-marketing.js`, `campaign.js`
- `greenreach-central/services/marketing-ai-agent.js`, `marketing-rules-engine.js`, `marketing-platforms.js`, `marketing-settings.js`, `marketing-skills.js`
- `docs/ai-agents/AI_AGENT_DOCUMENTATION.md`
- Playbook 02 (AI Agent Platform) — S.C.O.T.T. role and escalation
