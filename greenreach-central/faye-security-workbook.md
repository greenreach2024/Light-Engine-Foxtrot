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
(Document gaps as they are discovered during reviews or incidents.)

### Improvement Backlog
| Priority | Item | Status | Notes |
|---|---|---|---|
| | | | |

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
