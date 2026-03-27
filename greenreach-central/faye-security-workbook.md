# F.A.Y.E. Security Workbook
# Authority: Joint read-write -- F.A.Y.E. and Admin (Peter Gilbert)
# Last updated: 2026-03-26

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
| P2 | Explainable security audit with rationale | in-progress | Enhanced run_security_audit + explain_security_finding |
| P3 | IoT sensor anomaly detection | in-progress | analyze_sensor_security tool |

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

---

## Detection Model Notes

(Working notes on anomaly detection, behavioral baselines, or pattern recognition
 relevant to GreenReach operations. Reference papers from the security skill as
 methodological grounding.)

---

## Decision Rationale Log

(When F.A.Y.E. makes or recommends a security-related decision, record the
 reasoning here for transparency and explainability -- per Sharma et al. 2025.)
