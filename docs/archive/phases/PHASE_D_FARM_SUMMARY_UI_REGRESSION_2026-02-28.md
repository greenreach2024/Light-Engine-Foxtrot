# Focused UI Regression — farm-summary.html (2026-02-28)

## Scope
Focused regression for Phase D surfaces in `public/views/farm-summary.html`:
- Harvest Readiness
- Loss Risk Alerts
- Learning Correlations
- Experiment Records
- AI interaction telemetry decision recording

## Method
1. Static wiring checks in `farm-summary.html` for card IDs and loader/telemetry functions.
2. API checks against `server-foxtrot.js` on `http://127.0.0.1:8091`.
3. Decision telemetry POST check to validate interaction event path.

Raw execution report:
- `/tmp/farm-summary-phaseD-regression.txt`

## Pass / Fail Matrix

### Static checks (10)
- PASS: `id="harvestReadinessCard"`
- PASS: `id="lossPredictionCard"`
- PASS: `id="learningCorrelationCard"`
- PASS: `id="experimentRecordCard"`
- PASS: `function loadHarvestReadiness()`
- PASS: `function loadLossPredictions()`
- PASS: `function loadLearningCorrelations()`
- PASS: `function loadExperimentRecords()`
- PASS: `async function trackAIInteraction`
- PASS: telemetry fetch call to `/api/ai/record-decision`

### API checks (6)
- PASS: `GET /api/harvest/readiness` → 200
- PASS: `GET /api/losses/predict` → 200
- PASS: `GET /api/ai/learning-correlations` → 200
- PASS: `GET /api/harvest/experiment-stats` → 200
- PASS: `GET /api/harvest/experiment-records?limit=5` → 200
- PASS: `POST /api/ai/record-decision` → 200

## Totals
- **PASS:** 12
- **FAIL:** 0

## Notes
- This is a focused regression for Phase D-specific farm-summary surfaces, not a full UI e2e suite.
- Sampled payloads showed valid responses; some AI surfaces may legitimately show low-data states (e.g., empty lists) depending on dataset maturity.