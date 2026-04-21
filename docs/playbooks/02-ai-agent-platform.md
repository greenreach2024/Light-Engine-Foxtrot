# 02 — AI Agent Platform Playbook

**Owner:** F.A.Y.E. (with perimeter authority over all other agents)
**Canonical references:** `.github/AI_FIRST_VISION.md`, `.github/AGENT_SKILLS_FRAMEWORK.md`, `.github/ENFORCEMENT_MECHANISMS.md`, `greenreach-central/EVIE_VISION.md`, `greenreach-central/FAYE_VISION.md`, `docs/ai-agents/`

---

## 1. Purpose & scope

Foxtrot is an **AI-first** platform: agents are not a feature; they are the primary interface for most consequential actions. This playbook is the contract that keeps agents coordinated, safe, and auditable. Read it before:
- Adding a new agent
- Adding a tool to an existing agent
- Changing an agent's LLM, system prompt, or authority
- Building a UI that calls an agent endpoint

## 2. The agent family

| Agent | Full name | Scope | Audience | LLM | Authority | Backend |
|---|---|---|---|---|---|---|
| **E.V.I.E.** | Environmental Vision & Intelligence Engine | **One farm** | Growers, visitors, demo viewers | OpenAI GPT-4o (primary) + Anthropic Claude (fallback) | Farm-scoped read + act through Farm-Ops tool gateway | `greenreach-central/routes/assistant-chat.js` |
| **Farm-Ops-Agent** | Deterministic ops engine | One farm | Backend / E.V.I.E. tool gateway | Deterministic scoring + GPT-4o for NL parsing | Executes scored daily tasks, tool catalog, audit | `greenreach-central/routes/farm-ops-agent.js` |
| **Setup-Agent** | Farm setup orchestrator | One farm | Onboarding via E.V.I.E. | GPT-4o | 12-phase setup progress, template-aware room design, build-plan computation, phase-aware guidance | `greenreach-central/routes/setup-agent.js` |
| **F.A.Y.E.** | Farm Autonomy & Yield Engine | **All farms** | Platform admins / ops | GPT-4o | Cross-farm observation, recommendations, progressive automation, safe-patch approval | `greenreach-central/routes/admin-assistant.js` |
| **Admin-Ops-Agent** | Platform ops agent | Platform-wide | Admins | GPT-4o | Ops runbooks, system health, revenue analysis, feature flags | `greenreach-central/routes/admin-ops-agent.js` |
| **G.W.E.N.** | Grants, Workplans, Evidence & Navigation | Research bubble | Researchers, PIs, HQP | Gemini 2.5 Pro (Vertex AI) | Research workspace actions; `execute_code` gated | `greenreach-central/routes/gwen-research-agent.js` |
| **S.C.O.T.T.** | Social Content Optimization, Trends & Targeting | Marketing | Marketing / ops | Gemini 2.5 Flash (Vertex AI) | Multi-platform social publishing, rules-based auto-approval; junior to F.A.Y.E. | `greenreach-central/routes/scott-marketing-agent.js` |

### 2.1 Hard boundary rules

- **E.V.I.E. never operates across farms.** One farm per conversation; farm_id locked by auth.
- **F.A.Y.E. owns the perimeter.** All cross-agent escalations resolve to F.A.Y.E. or to an admin.
- **G.W.E.N. stays in the research bubble.** Anything outside research goes via F.A.Y.E. for safe-patch approval.
- **S.C.O.T.T. is junior to F.A.Y.E.** Publishing authority can be overridden by F.A.Y.E. at any time.
- **Setup-Agent and Farm-Ops-Agent are tool-layer agents.** They are invoked through E.V.I.E., not directly exposed to end users.

## 3. Interface contracts (shared across agents)

Every conversational agent exposes at minimum:

| Endpoint | Purpose |
|---|---|
| `POST /chat` | Standard request/response chat (with optional streaming) |
| `GET /status` | Agent health, model ID, enabled features |
| `GET /state` | Current snapshot of whatever the agent is watching |

Optional:

| Endpoint | Purpose |
|---|---|
| `GET /workspace` | Dynamic workspace data (charts, tables) — G.W.E.N. |
| `POST /parse-command` | Intent + slot extraction — Farm-Ops |
| `GET /tool-catalog` | Registered tools with schemas — Farm-Ops |
| `POST /tool-gateway` | Schema-validated tool execution + audit — Farm-Ops |
| `GET /audit-log` | Paginated audit trail — Farm-Ops |

## 4. The tool gateway (Farm-Ops-Agent)

**File:** `greenreach-central/routes/farm-ops-agent.js`

All consequential farm-side actions flow through this gateway. It:

1. **Parses** natural language via LLM (`POST /parse-command`) into intent + slots
2. **Validates** against a declared tool schema in the catalog (`GET /tool-catalog`)
3. **Executes** through declared handlers with farm tenant context
4. **Audits** every call with timestamps, inputs, outputs, errors (`GET /audit-log`)

### 4.1 Daily to-do scoring
```
score = 0.35*Urgency + 0.25*Impact + 0.15*Risk + 0.15*Confidence - 0.10*Effort
```
Inputs: `wholesale-orders-status.json`, `harvest-log.json`, `rooms.json`, `env-cache.json`, `target-ranges.json`, `system-alerts.json`, `crop-registry.json`, `device-meta.json`, demand succession suggestions, `ai-recommendations.json`.

### 4.2 Trust tiers on tools
Each tool declares a trust tier:

- `no_confirm` — read-only or idempotent
- `quick_confirm` — single-tap confirm, low blast radius (e.g., bulk alert resolve)
- `explicit_confirm` — modal with typed confirmation (e.g., "DELETE ALL INVENTORY")
- `admin_only` — requires admin JWT

When adding a tool, default to the highest tier the action can plausibly need.

### 4.3 `executeTool` sharing
G.W.E.N. imports `executeTool` from Farm-Ops and runs research-scoped tool calls through it, inheriting audit + farm isolation.

## 5. Enforcement middleware

**File:** `greenreach-central/middleware/agent-enforcement.js`

Injects `ENFORCEMENT_PROMPT_BLOCK` into every agent system prompt. Key invariants it enforces:

- Agent must not reveal internal chain-of-thought
- Agent must not execute unregistered actions
- Agent must honor trust tier confirmation states
- Agent must refuse to operate outside its declared scope
- Agent must surface uncertainty instead of fabricating data

`sendEnforcedResponse` wraps the response path so system-prompt violations can be post-processed.

## 6. AI usage & cost tracking

**File:** `greenreach-central/lib/ai-usage-tracker.js`

- Every agent call records: agent name, conversation ID, model, prompt tokens, completion tokens, estimated cost
- Cost helpers: `estimateChatCost(model, promptTokens, completionTokens)` and `estimateTtsCost(model, charCount)` live in `greenreach-central/lib/ai-usage-tracker.js`; `estimateGeminiCost(model, promptTokens, completionTokens)` lives in `greenreach-central/lib/gemini-client.js` alongside the Vertex client
- Exposed to admins via `/api/admin/ai` (`greenreach-central/routes/admin-ai-monitoring.js`, sub-mounted under `routes/admin.js`)
- Budget alerts are **not** automated today — consider this a future F.A.Y.E. tool

## 7. Escalation paths

```
E.V.I.E.  ──(low confidence / out of scope)──▶  F.A.Y.E.  ──▶  human admin
                                                   ▲
S.C.O.T.T. ──(policy violation / content risk)─────┘
                                                   ▲
G.W.E.N.  ──(outside research bubble)──────────────┘
```

- E.V.I.E. mode E ("Escalation") is explicit in `EVIE_VISION.md`
- F.A.Y.E. receives escalations and can delegate or decide
- G.W.E.N. refuses out-of-bubble actions; its prompt pins it to research scope
- S.C.O.T.T. escalates publishes that fail auto-approve rules

## 8. Memory & conversation history

- `conversation_history` is a **tenant table** (farm_id-scoped, RLS-enabled)
- Rolling window: last ~30 messages per conversation (`MAX_LLM_MESSAGES`)
- Tool loop cap: `MAX_TOOL_LOOPS` — `12` in G.W.E.N. (`gwen-research-agent.js:63`); `10` in E.V.I.E. (`assistant-chat.js:6684`), F.A.Y.E. (`admin-assistant.js:82`), S.C.O.T.T. (`scott-marketing-agent.js:51`). Prevents runaway tool cascades.
- Max tokens per reply: `MAX_TOKENS` — `4096` for G.W.E.N. (`gwen-research-agent.js:64`); `2048` for F.A.Y.E. (`admin-assistant.js:83`) and S.C.O.T.T. (`scott-marketing-agent.js:52`); E.V.I.E. does not define a module-level constant and varies per call.
- Briefings: E.V.I.E. generates daily briefings persisted per farm

## 9. Multi-agent contribution process (humans + AI)

**File:** `.github/AGENT_SKILLS_FRAMEWORK.md`

For any consequential code change:

1. **Implementation agent** proposes + writes code + tests
2. **Review agent** verifies investigation-first methodology (no re-building existing features, no guessed credentials, no flat-file cross-farm storage)
3. **Architecture agent** signs off on strategic changes (data model shifts, agent authority changes, new services)
4. Commit messages cite the review gate

The framework documents real past regressions (e.g., Incident #5: invented credentials) — use them as anti-patterns.

## 10. Agent UI surfaces

| Agent | UI file(s) |
|---|---|
| E.V.I.E. | `public/evie-core.html`, `public/styles/evie-core.css`, `public/js/evie-presence.js`, `public/js/farm-assistant.js` (~2,380-line chat widget) |
| F.A.Y.E. | `public/faye-demo.html`, F.A.Y.E. panel in `GR-central-admin.html` |
| G.W.E.N. | `public/gwen-core.html`, Research Workspace page |
| S.C.O.T.T. | Admin Marketing page (campaigns, content generation, publish queue) |
| Farm-Ops / Setup | Accessed via E.V.I.E. chat; no standalone UI |

Visual identity for each agent is declared in the vision docs (`EVIE_VISION.md`, `FAYE_VISION.md`). Do not re-skin without authorization.

## 11. Configuration

| Env var | Purpose |
|---|---|
| `OPENAI_API_KEY`, `OPENAI_MODEL` | E.V.I.E., F.A.Y.E., setup-agent |
| `ANTHROPIC_API_KEY` | E.V.I.E. fallback LLM |
| Vertex AI via ADC | G.W.E.N., S.C.O.T.T. (Gemini 2.5 Pro / Flash) |
| `GWEN_EXECUTE_CODE_ENABLED` | Enables G.W.E.N. Python/R execution (default off in production) |
| `FARM_OPS_AUDIT_RETENTION_DAYS` | Audit log retention |
| Rate limits | 20 req/min per farm on `/chat` endpoints |

## 12. Adding a new agent

Checklist:
- [ ] Define scope, audience, LLM, authority in a vision doc under `greenreach-central/*_VISION.md`
- [ ] Implement `POST /chat`, `GET /status`, `GET /state`
- [ ] Use `agent-enforcement.js` middleware
- [ ] Register tools through Farm-Ops tool gateway (do not invent a second gateway)
- [ ] Instrument via `ai-usage-tracker.js`
- [ ] Define escalation target (usually F.A.Y.E.)
- [ ] Write an entry in this playbook and in the top-down playbook's agent table
- [ ] Update feature flags + tier gating

## 13. Adding a tool

Checklist:
- [ ] Add declaration to `farm-ops-agent.js` tool catalog with JSON schema
- [ ] Choose trust tier (`no_confirm`, `quick_confirm`, `explicit_confirm`, `admin_only`)
- [ ] Implement handler with `ctx.farmId`, `ctx.userId`, `ctx.isAdmin`
- [ ] Use the DB `query()` wrapper (Playbook 01 §5.3)
- [ ] Write audit entry with before/after snapshots where applicable
- [ ] Cover with a unit test or smoke test script

## 14. Never do

- Expose a new consequential action as a raw REST endpoint without routing it through the tool gateway
- Let an agent mutate data in a farm whose JWT it does not hold
- Silently catch tool errors — audit log must record the failure
- Increase `MAX_TOOL_LOOPS` to work around a buggy prompt
- Ship an agent without cost tracking; unbounded spend is a platform risk
- Let S.C.O.T.T. publish with elevated tiers without a rules-engine rule
- Copy-paste prompt text from one agent into another without reviewing scope

## 15. Known gaps / open items

- **Budget alerts on AI spend** — not automated; daily dashboard only
- **G.W.E.N. `execute_code`** — gated off by default in cloud; enable per research program only
- **Prompt drift** — multiple vision docs describe related but not identical tones (E.V.I.E. vs F.A.Y.E.); reconcile before ambient-presence rollout
- **Cross-agent memory** — conversation history is per-agent today; unifying will require a memory-broker service
- ~~**Crop-scheduling tools are inconsistent.** `update_group_crop` stamps four fields but not `planConfig.anchor.seedDate`.~~ **RESOLVED** in Phase A (PR #41): all three crop-assignment call sites — `update_group_crop` (E.V.I.E.), the 3D viewer's `applyGroupEdits`, and the tray-seed endpoint — now delegate to `planAnchor.assignCropToGroup` (`public/js/plan-anchor.js`) which stamps all five scheduling fields and resolves aliases / `planIds[]` consistently. See Playbook 10 §11 item 4.
- **`recommend_farm_layout` has no UI entry point.** The tool (assistant-chat.js:1449–1574) is live at `quick_confirm` tier but reachable only through E.V.I.E. chat; neither `farm-setup.html`, `setup-wizard.html`, nor `3d-farm-viewer.html` surfaces a “recommend layout” affordance. Tracked in Playbook 10 Phase B.
- **Missing `accept_farm_proposal` tool.** Accepting a farm-builder proposal writes rooms / groups / devices in bulk; it must be `explicit_confirm`, not `quick_confirm`. To be added in Playbook 10 Phase B1.

## 16. References

- `.github/AI_FIRST_VISION.md`
- `.github/AGENT_SKILLS_FRAMEWORK.md`
- `.github/ENFORCEMENT_MECHANISMS.md`
- `greenreach-central/EVIE_VISION.md`, `FAYE_VISION.md`
- `docs/ai-agents/AI_AGENT_DOCUMENTATION.md`, `ML_AI_FEATURES_REPORT.md`, `FARM_OPS_AGENT_BUILD_PLAN_2026-03-08.md`
- `greenreach-central/routes/` — all agent route files
- Playbook 07 §7A (crop-scheduling contract), Playbook 10 (Farm Builder)
- `greenreach-central/lib/ai-usage-tracker.js`, `gemini-client.js`
