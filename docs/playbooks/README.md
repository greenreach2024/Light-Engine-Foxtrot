# Foxtrot Playbooks

This directory holds category-specific playbooks for the Light Engine Foxtrot platform. Each playbook is the authoritative "first read" before touching code in that domain. The top-down architecture playbook lives at [`00-top-down-architecture.md`](./00-top-down-architecture.md); the numbered files below drill into each category.

## Reading order

| # | Playbook | Scope | Primary owner |
|---|---|---|---|
| 00 | [Top-Down Architecture](./00-top-down-architecture.md) | Whole platform, four apps, seven agents, shared-vs-private data split | Everyone |
| 01 | [Security & Multi-Tenant Isolation](./01-security-multi-tenant.md) | RLS, auth systems, feature gates, tenant context, client storage rules | F.A.Y.E. / platform admins |
| 02 | [AI Agent Platform](./02-ai-agent-platform.md) | All seven agents, tool gateway, enforcement, escalation, cost | F.A.Y.E. |
| 03 | [Commerce (Wholesale, Farm Sales, Payments)](./03-commerce.md) | Square OAuth per farm, 12% commission, wholesale checkout, Stripe, accounting | Central admin |
| 04 | [Distribution & Delivery](./04-distribution-delivery.md) | Delivery settings, zones, drivers, farm-to-door MVP | Central admin |
| 05 | [Marketing Platform](./05-marketing.md) | S.C.O.T.T., campaigns, public pages, email/SMS, per-farm branding (subdomain storefront **planned**, not live) | Central admin / marketing |
| 06 | [Research Platform](./06-research.md) | Four-phase research workspace, G.W.E.N., governance, partners | Research tier farms |
| 07 | [Farm Operations (LE runtime)](./07-farm-operations.md) | SwitchBot, EnvStore, VPD, automation, tray lifecycle, harvest, ML | Farm operators |
| 08 | [DevOps & Deployment](./08-devops-deployment.md) | Cloud Run, AlloyDB, Secret Manager, dual-deploy registry, banned commands | Platform engineers |
| 09 | [Admin & Platform Ops](./09-admin-platform-ops.md) | Farm registration, user mgmt, feature flags, network intelligence | Central admins |

## How these relate to other docs

- `.github/` contains the **canonical reference docs** (CLOUD_ARCHITECTURE, COMPLETE_SYSTEM_MAP, PAYMENT_WORKFLOW, SENSOR_DATA_PIPELINE, RESEARCH_PLATFORM_AUDIT, AGENT_SKILLS_FRAMEWORK). Playbooks cite them; they do not replace them.
- `docs/architecture/`, `docs/security/`, `docs/delivery/`, `docs/wholesale/`, `docs/ai-agents/`, `docs/billing/`, `docs/features/`, `docs/operations/`, `docs/onboarding/` contain deep technical notes and audit reports. Playbooks summarize and link to them.
- `CONTRIBUTING.md` defines workflow rules (branch naming, dual-deploy file registry, review gates). Playbooks assume you've read it.

## Conventions used in every playbook

Each playbook uses the same section structure:

1. **Purpose & scope** — one paragraph
2. **Who owns this** — agent / role / team
3. **Top-level data model** — the key tables / JSON keys
4. **Key files** — concrete paths, split by LE and Central
5. **API surface** — routes and what they do
6. **Data flows** — end-to-end, step-numbered
7. **Security / tenancy rules** — what must not leak, how it's enforced
8. **Configuration** — env vars, secrets, feature flags
9. **Known gaps / open items** — cited from audit reports
10. **Never do** — hard rules for humans and agents
11. **References** — links to canonical docs

## Keeping these playbooks accurate

- Update the playbook when you change code in its domain; PRs that drift should be rejected.
- The "Known gaps" section is the living changelog for each domain; keep it current with audit findings.
- If you create a new category (e.g., Notifications, Observability), add a numbered playbook and update this README's table.
