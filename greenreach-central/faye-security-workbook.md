# F.A.Y.E. Security Workbook
# Authority: Joint read-write -- F.A.Y.E. and Admin (Peter Gilbert)
# Last updated: 2026-03-28

This is F.A.Y.E.'s active working document for security intelligence. Unlike the
read-only skill reference (greenreach-central/.github/skills/security.md), this
file is a living notebook where F.A.Y.E. records observations, analysis notes,
implementation plans, and research synthesis as security capabilities evolve.

---

## Active Threat Landscape Notes

(F.A.Y.E. and Admin add observations here as they arise.)

---

## Research Synthesis

### Papers Read
| Paper | Date Read | Key Takeaways | Relevance to GreenReach |
|---|---|---|---|
| (none yet) | | | |

### Implementation Ideas
(Concrete ideas extracted from research that could apply to the platform.)

---

## Security Posture Assessment

### Current Controls (Inventory)
- Admin JWT authentication (12h expiry, localStorage)
- authOrAdminMiddleware on sensitive Central routes
- CSP headers enabled (XSS prevention)
- HSTS enabled (1 year, preload)
- Audit logging on sensitive endpoints
- Square OAuth with signed state parameter

### Gaps Identified

**Gap Assessment Date: 2026-03-26**
**Source: Admin review against security skill reference**

1. **Anomaly Detection** (Yang et al. 2022): Limited capabilities in detecting unknown or novel threats in network traffic and API request patterns. Current get_anomaly_report only reads recent admin_alerts -- no statistical baseline analysis, no drift detection, no volumetric anomaly scoring.

2. **Insider Threat Monitoring** (Kamatchi et al. 2025): No comprehensive monitoring of user/operator behavior patterns. No baseline of normal admin activity (session duration, action frequency, off-hours access, privilege usage). Current audit only counts total admin actions.

3. **Threat Attribution** (Prasad et al. 2025): Existing tools do not leverage AI/ML for cyber threat attribution. No capability to correlate auth failures, IP patterns, user-agent signatures, or temporal attack patterns to characterize threat sources.

4. **Explainability** (Sharma et al. 2025): Limited explainability in AI-driven security decisions. Security audit returns a risk score without explaining the weighting rationale or providing actionable context for each finding. Decision rationale log exists but is not systematically populated.

5. **Federated IoT Security** (Hernandez-Ramos et al. 2025): No federated learning approach to secure IoT/sensor devices across farm network. Sensor health monitoring exists but does not apply behavioral anomaly detection to sensor data patterns.

### Improvement Backlog
| Priority | Item | Status | Notes |
|---|---|---|---|
| P1 | Behavioral baseline analysis for admin/API activity | in-progress | analyze_security_behavior tool |
| P1 | Enhanced anomaly detection with statistical scoring | in-progress | detect_security_anomalies tool |
| P2 | Threat attribution correlation engine | in-progress | correlate_threat_indicators tool |
| P2 | Explainable security audit with rationale | completed | run_security_audit now returns explainability section + baseline/anomaly findings |
| P3 | IoT sensor anomaly detection | in-progress | analyze_sensor_security tool |

### Implemented Updates (2026-03-28)

1. Security audit reliability: Added heartbeat schema compatibility migration for `farm_heartbeats` (`last_seen_at`, `farm_name`, percent columns) with backfill/indexing to prevent audit failures.
2. Security audit depth: Expanded `run_security_audit` to include baseline auth anomaly detection, insider-risk off-hours signal, and explainability metadata.
3. Memory continuity: Restored persistent chat memory continuity in EVIE/FAYE presence UIs by persisting `conversation_id` in scoped browser storage.
4. SCM diagnostics resilience: Hardened `get_recent_changes_and_deploys` to detect runtime environments without `.git` metadata and return clear repository access diagnostics instead of opaque failures.

### Value Filter Notes

- Implemented now: Low-risk, high-signal improvements that remove known operational blockers and improve incident triage quality.
- Deferred: Full federated-learning IoT model rollout (high complexity, requires cross-farm data governance and model ops pipeline). Kept in backlog until a dedicated design and data governance phase is approved.

---

## Incident Log

### Format
```
Date:
Severity: low / medium / high / critical
Summary:
Detection method:
Response:
Lessons learned:
```

(Entries added chronologically.)

### 2026-03-28
Severity: medium
Summary: Security audit path failed when `farm_heartbeats.last_seen_at` was missing.
Detection method: `run_security_audit` execution error in stale-connection check.
Response: Added migration 048 compatibility columns and heartbeat write-path updates.
Lessons learned: Security tooling should depend on explicit schema migrations and write-path parity, not implicit table assumptions.

### 2026-03-28
Severity: medium
Summary: EVIE/FAYE chat context did not persist across UI reloads.
Detection method: Presence UIs initialized `conversationId = null` without storage restore.
Response: Added scoped localStorage persistence/restore for `conversation_id` in EVIE/FAYE presence scripts.
Lessons learned: Conversation continuity requires frontend and backend persistence; backend-only memory is insufficient for refreshed sessions.

### 2026-03-28
Severity: low
Summary: Recent-changes diagnostics produced repository access failures in runtimes without git metadata.
Detection method: Tool invocation errors from `git -C <path>` in deployment contexts.
Response: Added repository-root detection across candidate paths and structured fallback diagnostics when `.git` is unavailable.
Lessons learned: Deployment bundles often omit SCM metadata; diagnostics must report this explicitly and offer alternative evidence paths.

---

## Detection Model Notes

(Working notes on anomaly detection, behavioral baselines, or pattern recognition
 relevant to GreenReach operations. Reference papers from the security skill as
 methodological grounding.)

---

## Decision Rationale Log

(When F.A.Y.E. makes or recommends a security-related decision, record the
 reasoning here for transparency and explainability -- per Sharma et al. 2025.)
