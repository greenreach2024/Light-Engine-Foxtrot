# Future Features Gameplan

**Created**: 2026-02-12  
**Status**: Implementation-ready plans for the next 3 features  
**Audience**: Any developer (human or AI agent) continuing this work  
**Branch**: `wip/remove-debug-and-data-edits`

---

## Quick Reference

| # | Feature | Effort | Dependencies | DB Migration | NPM Packages |
|---|---------|--------|-------------|--------------|---------------|
| 6 | Vertical Farm Production Calculator | 12-15 days | Grant wizard (done) | 015 | None new |
| 7 | Business Plan PDF / Document Intel | 10-14 days | Feature 6 (optional) | 016 | `pdf-parse`, `mammoth` |
| 8 | Competitor Analysis Module | 15-18 days | Background jobs | 017 | `pg-boss`, Google Places API |

**Recommended order**: 6 → 7 → 8 (each builds on prior infrastructure)

---

## Feature 6: Vertical Farm Production Calculator

**Full spec**: [VERTICAL_FARM_CALCULATOR_SPEC.md](../VERTICAL_FARM_CALCULATOR_SPEC.md) (541 lines, complete)  
**Roadmap ref**: Phase 4 of [GRANT_WIZARD_INTELLIGENCE_ROADMAP.md](../GRANT_WIZARD_INTELLIGENCE_ROADMAP.md)

### What It Does
Takes user inputs (tray count, crop type, province, scale) and generates a complete financial model: CAPEX breakdown, monthly OPEX, revenue projections, 5-year forecast, break-even analysis, and sensitivity tables. Output auto-populates the grant wizard budget and narrative sections.

### Why It Matters
Founders currently spend 20-40 hours building financial models from scratch. Grant reviewers reject applications with unsubstantiated numbers. This calculator produces investor-grade projections with documented assumptions.

### Prerequisites
- [x] Grant wizard deployed with milestone/budget support (done — migration 014)
- [x] `grant_applications` table has `budget` JSONB column (done)
- [ ] No new NPM packages required (pure calculation logic)

### Files to Create

| File | Purpose | Est. Lines |
|------|---------|-----------|
| `greenreach-central/routes/farm-calculator.js` | Calculation engine + API routes | ~400 |
| `greenreach-central/public/farm-calculator.html` | Input form + results display | ~600 |
| `greenreach-central/config/database.js` | Migration 015 (new table) | +20 lines |

### Files to Modify

| File | Change |
|------|--------|
| `greenreach-central/server.js` | Mount `/api/farm-calculator` routes |
| `greenreach-central/public/grant-wizard.html` | Add "Launch Calculator" button in budget step |

### Step-by-Step Implementation

#### Step 1: Database Migration 015 (0.5 days)

Add to `database.js` migrations array:

```sql
CREATE TABLE IF NOT EXISTS farm_production_models (
  id SERIAL PRIMARY KEY,
  application_id INTEGER REFERENCES grant_applications(id) ON DELETE CASCADE,
  model_name TEXT DEFAULT 'default',
  inputs JSONB NOT NULL,
  outputs JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_fpm_application ON farm_production_models(application_id);
```

**`inputs` JSONB shape**:
```json
{
  "numTrays": 330,
  "crops": [
    { "type": "lettuce", "trayAllocation": 150 },
    { "type": "pakchoi", "trayAllocation": 100 },
    { "type": "microgreens", "trayAllocation": 50 },
    { "type": "basil", "trayAllocation": 30 }
  ],
  "province": "ON",
  "facilityType": "owned",
  "rentPerSqFt": null,
  "facilitySize": 800,
  "automationTier": "basic"
}
```

**`outputs` JSONB shape**:
```json
{
  "plants": 9900,
  "capex": { "racks": 13200, "trays": 4950, "lighting": 39270, "pumps": 1200, "hvac": 2100, "automation": 5000, "total": 65720 },
  "opex": { "labour": 13174, "electricity": 3368, "nutrients": 1485, "seeds": 495, "packaging": 2121, "other": 1500, "total": 22143 },
  "revenue": { "gross": 14142, "net": 12021, "kgPerMonth": 831 },
  "profitability": { "monthlyProfit": -10122, "breakEvenPlants": 27000, "breakEvenMonths": null },
  "projections": [ /* 5-year array */ ],
  "sensitivity": { /* ±20% electricity, ±15% yield, ±10% pricing */ }
}
```

#### Step 2: Calculation Engine — `routes/farm-calculator.js` (3 days)

Reference data (embed as constants — these come directly from the spec):

```javascript
const CROP_DATA = {
  lettuce:      { plantsPerTray: 30, daysToHarvest: 28, kgPerTray: 2.5, pricePerKg: 10 },
  pakchoi:      { plantsPerTray: 24, daysToHarvest: 32, kgPerTray: 3.0, pricePerKg: 12 },
  microgreens:  { plantsPerTray: 200, daysToHarvest: 10, kgPerTray: 0.8, pricePerKg: 50 },
  basil:        { plantsPerTray: 15, daysToHarvest: 35, kgPerTray: 1.2, pricePerKg: 22 },
  kale:         { plantsPerTray: 28, daysToHarvest: 30, kgPerTray: 2.8, pricePerKg: 14 }
};

const ELECTRICITY_RATES = { ON: 0.12, QC: 0.07, BC: 0.09, AB: 0.11 };
const WAGE_BY_PROVINCE  = { ON: 18.50, QC: 16.50, BC: 19.00, AB: 20.00 };
const BENEFITS_MULTIPLIER = 1.15;
const PACKAGING_RATE = 0.15; // 15% of gross revenue
```

**API endpoints**:

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/farm-calculator/calculate` | JWT | Run calculation, return results |
| `POST` | `/api/farm-calculator/save` | JWT | Save model to `farm_production_models` |
| `GET` | `/api/farm-calculator/models/:applicationId` | JWT | List saved models |
| `DELETE` | `/api/farm-calculator/models/:modelId` | JWT | Delete a model |
| `POST` | `/api/farm-calculator/apply-to-wizard` | JWT | Push outputs into grant app budget/narrative |

**Key calculation functions** (see spec for formulas):

1. `calculatePlants(crops)` — sum plants across crop allocations
2. `calculateCAPEX(numTrays, plants, automationTier)` — 4-tier breakdown
3. `calculateOPEX(plants, province, crops, facilityType, rentPerSqFt, facilitySize)` — monthly costs
4. `calculateRevenue(crops)` — kg/month × price, minus packaging
5. `calculateBreakEven(capex, opex, revenue)` — months to profitability
6. `generate5YearProjection(capex, opex, revenue)` — ramp 50%→75%→90%, apply inflation
7. `calculateSensitivity(base, variations)` — ±20% electricity, ±15% yield, ±10% price

**HVAC formula** (from spec):
```
BTU/hour = plants × 1.32
Add 30% sensible heat → total BTU
Tons = totalBTU / 12,000
kWh/month = tons × 1200W × 24h × 30d / 1000
```

**Labour formula** (from spec):
```
FTE = plants ≤ 4000 ? 2 : plants ≤ 10000 ? 3 : 3 + Math.floor((plants - 10000) / 10000)
monthlyCost = FTE × 40hrs × 4.33weeks × wageByProvince × 1.15
```

#### Step 3: Frontend — `public/farm-calculator.html` (3 days)

**Layout**: Match existing grant-wizard.html styling (same CSS framework, header, card layouts).

**Sections**:
1. **Input Form**: Tray count slider (10-2000), multi-crop selector with tray allocations, province dropdown, facility type (owned/rented), automation tier (basic/advanced)
2. **Results Dashboard**: CAPEX donut chart, OPEX bar chart, revenue vs. expense comparison, break-even timeline
3. **5-Year Projection Table**: Year-by-year with capacity ramp, inflation adjustments
4. **Sensitivity Analysis**: 3×3 matrix showing best/base/worst cases
5. **Export Actions**: "Apply to Grant Wizard" button, "Download PDF" button, "Save Model" button

**Charts**: Use Chart.js (already available in the project).

#### Step 4: Grant Wizard Integration (1 day)

In `grant-wizard.html` Step 4 (Budget), add:
```html
<button onclick="openCalculator()" class="btn-secondary">
  📊 Launch Production Calculator
</button>
```

The calculator page receives `applicationId` via query param. The "Apply to Wizard" button calls `POST /api/farm-calculator/apply-to-wizard` which writes:
- `budget.capex_items[]` ← from capex breakdown
- `budget.opex_items[]` ← from opex breakdown  
- `project_profile.production_model` ← summary outputs
- `milestones[]` ← auto-generated from ramp-up timeline

#### Step 5: PDF Export Enhancement (1 day)

Add calculator outputs to the existing PDF export (`/api/grant-wizard/export-pack`):
- Section: "Production & Financial Model"
- Tables: CAPEX, OPEX, Revenue, 5-Year Projection
- Footer: "Assumptions & Methodology" block (from spec)

#### Step 6: Testing Checklist (2 days)

- [ ] CAPEX totals match manual spreadsheet for 100, 330, 1000 trays
- [ ] OPEX scales linearly with plant count (±5% tolerance)
- [ ] Revenue matches: 330 trays lettuce = $8,250 gross (28-day cycle)
- [ ] Break-even: 10k plants in ON should show ~25-30k break-even scale
- [ ] 5-year projection: Year 1 at 50%, Year 3+ at 90% capacity
- [ ] Sensitivity: ±20% electricity changes monthly profit by ~15%
- [ ] Multi-crop allocation: tray totals must equal numTrays
- [ ] Saved model round-trips correctly (save → load → identical outputs)
- [ ] "Apply to Wizard" populates budget fields correctly
- [ ] PDF export includes calculator sections

### Deployment Notes
- No new NPM packages needed
- No new environment variables needed
- Database migration 015 runs automatically on deploy
- No infrastructure changes (stays on current t3 instance)

---

## Feature 7: Business Plan PDF / Document Intelligence

**Roadmap ref**: Phase 2 of [GRANT_WIZARD_INTELLIGENCE_ROADMAP.md](../GRANT_WIZARD_INTELLIGENCE_ROADMAP.md)  
**Code ref**: Automation opportunity #4 in [grant-wizard.js](../greenreach-central/routes/grant-wizard.js#L34-L39)

### What It Does
Allows users to upload existing business plans (PDF or DOCX) and grant application forms (PDF). The system extracts text, identifies sections, maps content to wizard fields, and highlights gaps ("Your plan has no risk mitigation section"). For grant application forms, it parses question structure and tailors the wizard steps to match.

### Why It Matters
- **Business plan upload**: Most applicants already have a business plan. Instead of re-typing everything into the wizard, the system extracts and pre-fills fields.
- **Application form parsing**: Each grant program has a unique application form. Parsing the PDF means the wizard can show the exact questions the grant reviewer will ask, with character limits and section references.

### Prerequisites
- [x] Grant wizard deployed (done)
- [x] `grant_applications` table exists (done)
- [ ] NPM packages: `pdf-parse`, `mammoth`
- [ ] S3 bucket for uploaded files (or local storage for dev)

### Files to Create

| File | Purpose | Est. Lines |
|------|---------|-----------|
| `greenreach-central/routes/document-intel.js` | Upload, parse, extract, compare | ~500 |
| `greenreach-central/services/pdfParser.js` | Low-level PDF text extraction + section detection | ~200 |
| `greenreach-central/services/docxParser.js` | DOCX → structured sections via mammoth | ~120 |
| `greenreach-central/config/database.js` | Migration 016 (new table) | +25 lines |

### Files to Modify

| File | Change |
|------|--------|
| `greenreach-central/server.js` | Mount `/api/document-intel` routes |
| `greenreach-central/public/grant-wizard.html` | Add upload UI in Step 1 (Organization) and Step 3 (Narrative) |
| `greenreach-central/routes/grant-wizard.js` | Call document-intel service when populating wizard |
| `package.json` | Add `pdf-parse`, `mammoth` |

### Step-by-Step Implementation

#### Step 1: Install Dependencies (0.5 days)

```bash
cd greenreach-central
npm install pdf-parse mammoth multer
```

`multer` handles file uploads (multipart/form-data). If already installed, skip.

#### Step 2: Database Migration 016 (0.5 days)

```sql
-- Parsed grant application forms (reusable across users)
CREATE TABLE IF NOT EXISTS grant_application_forms (
  id SERIAL PRIMARY KEY,
  program_id INTEGER REFERENCES grant_programs(id) ON DELETE CASCADE,
  form_name TEXT NOT NULL,
  pdf_url TEXT,
  parsed_structure JSONB NOT NULL,
  required_attachments TEXT[] DEFAULT '{}',
  field_limits JSONB DEFAULT '{}',
  parsed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(program_id, form_name)
);

-- User-uploaded documents
CREATE TABLE IF NOT EXISTS uploaded_documents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES grant_users(id) ON DELETE CASCADE,
  application_id INTEGER REFERENCES grant_applications(id) ON DELETE SET NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('business_plan', 'financial_statement', 'incorporation', 'other')),
  original_filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  extracted_text TEXT,
  extracted_sections JSONB,
  gap_analysis JSONB,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_uploaded_docs_user ON uploaded_documents(user_id);
CREATE INDEX idx_uploaded_docs_app ON uploaded_documents(application_id);
```

**`parsed_structure` JSONB shape** (for grant forms):
```json
{
  "sections": [
    {
      "ref": "Section A",
      "title": "Applicant Information",
      "questions": [
        { "ref": "Q1", "text": "Legal name of organization", "charLimit": 200, "fieldType": "text" },
        { "ref": "Q2a", "text": "Describe your project", "charLimit": 2000, "fieldType": "textarea" }
      ]
    }
  ],
  "totalQuestions": 24,
  "requiredAttachments": ["Business plan", "Financial statements", "Letters of support"],
  "deadline": "2026-03-31"
}
```

**`extracted_sections` JSONB shape** (for business plans):
```json
{
  "executive_summary": { "found": true, "text": "...", "confidence": 0.92 },
  "market_analysis": { "found": true, "text": "...", "confidence": 0.85 },
  "operations_plan": { "found": true, "text": "...", "confidence": 0.88 },
  "financial_projections": { "found": false, "text": null, "confidence": 0 },
  "risk_mitigation": { "found": false, "text": null, "confidence": 0 },
  "team_bios": { "found": true, "text": "...", "confidence": 0.79 }
}
```

**`gap_analysis` JSONB shape**:
```json
{
  "completeness_score": 0.67,
  "missing_sections": ["financial_projections", "risk_mitigation"],
  "weak_sections": ["market_analysis"],
  "suggestions": [
    "Your plan has no financial projections. Use the Production Calculator to generate these.",
    "Your plan has no risk mitigation section. Grant reviewers expect this.",
    "Market analysis is thin (< 200 words). Consider adding competitor data."
  ]
}
```

#### Step 3: PDF Parser Service — `services/pdfParser.js` (2 days)

```javascript
import pdfParse from 'pdf-parse';

export async function extractPdfText(buffer) { /* full text extraction */ }
export function detectSections(text) { /* regex/heuristic section boundary detection */ }
export function detectQuestions(text) { /* find Q1, Q2a, Section A patterns */ }
export function detectCharLimits(text) { /* find "(max 500 characters)" patterns */ }
export function classifyDocument(text) { /* business_plan | application_form | financial | unknown */ }
```

**Section detection heuristics** (ordered by reliability):
1. Headings in ALL CAPS followed by body text
2. Numbered sections: "1.0 Executive Summary", "2.0 Market Analysis"
3. Bold/large text (if PDF metadata preserves formatting)
4. Keywords: "executive summary", "market analysis", "financials", "risk"

**Known limitations**:
- Scanned PDFs (images) won't work — would need OCR (Tesseract.js), out of scope for v1
- Complex tables may not parse correctly
- Multi-column layouts may interleave text

#### Step 4: DOCX Parser Service — `services/docxParser.js` (1 day)

```javascript
import mammoth from 'mammoth';

export async function extractDocxSections(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;
  return detectSections(text); // reuse pdfParser's section detection
}

export async function extractDocxHtml(buffer) {
  const result = await mammoth.convertToHtml({ buffer });
  return result.value; // preserves headings, lists, tables
}
```

#### Step 5: Document Intelligence Routes — `routes/document-intel.js` (3 days)

**API endpoints**:

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/document-intel/upload-business-plan` | JWT | Upload & parse business plan |
| `POST` | `/api/document-intel/upload-application-form` | JWT (admin) | Parse grant application PDF |
| `GET` | `/api/document-intel/gap-analysis/:docId` | JWT | Get gap analysis for uploaded doc |
| `POST` | `/api/document-intel/apply-to-wizard` | JWT | Push extracted text into wizard fields |
| `GET` | `/api/document-intel/tailored-questions/:programId` | JWT | Get parsed form questions for a program |

**Upload flow**:
1. User uploads PDF/DOCX via multipart form
2. Server saves file to `uploads/` dir (or S3 in production)
3. Detect file type → call appropriate parser
4. Classify document (business plan vs. application form)
5. Extract sections and/or questions
6. Run gap analysis (compare to expected sections)
7. Store results in `uploaded_documents` table
8. Return extracted data + gap analysis to frontend

**Gap analysis logic**:
```javascript
const EXPECTED_SECTIONS = [
  'executive_summary', 'company_overview', 'market_analysis',
  'operations_plan', 'financial_projections', 'risk_mitigation',
  'team_bios', 'timeline', 'budget'
];

function analyzeGaps(extractedSections) {
  const missing = EXPECTED_SECTIONS.filter(s => !extractedSections[s]?.found);
  const weak = EXPECTED_SECTIONS.filter(s => 
    extractedSections[s]?.found && extractedSections[s].text.length < 200
  );
  return { completeness_score, missing_sections: missing, weak_sections: weak, suggestions };
}
```

#### Step 6: Grant Wizard UI Integration (2 days)

**In Step 1 (Organization Profile)**, add upload zone:
```
┌──────────────────────────────────────────┐
│ 📄 Upload Existing Business Plan         │
│                                          │
│  Drag & drop PDF or DOCX here            │
│  [Browse Files]                          │
│                                          │
│  We'll extract key sections and pre-fill │
│  your application. Nothing is submitted. │
└──────────────────────────────────────────┘
```

**After upload**, show gap analysis card:
```
┌──────────────────────────────────────────┐
│ Business Plan Analysis          67% ████░│
│                                          │
│ ✅ Executive Summary (found)             │
│ ✅ Market Analysis (found, but thin)     │
│ ✅ Operations Plan (found)               │
│ ❌ Financial Projections (missing)       │
│ ❌ Risk Mitigation (missing)             │
│                                          │
│ 💡 Use Production Calculator to generate │
│    your financial projections            │
│                                          │
│ [Apply to Wizard] [View Full Text]       │
└──────────────────────────────────────────┘
```

**In Step 3 (Narrative)**, show per-field mapping:
```
Project Description (Application Q2a, max 2000 chars)
[textarea pre-filled from extracted executive_summary]
```

#### Step 7: File Storage Strategy (1 day)

**Development**: `uploads/` directory with `multer` disk storage  
**Production**: AWS S3 bucket

```javascript
// Multer config for dev
const storage = multer.diskStorage({
  destination: 'uploads/documents/',
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

// For production: switch to multer-s3
// const s3Storage = multerS3({ s3: s3Client, bucket: 'greenreach-documents', ... });
```

Add `uploads/` to `.gitignore`.

**Environment variable** (production): `DOCUMENT_STORAGE=s3` or `DOCUMENT_STORAGE=local`

#### Step 8: Testing Checklist (2 days)

- [ ] PDF upload (< 10MB) parses without error
- [ ] DOCX upload parses without error
- [ ] Section detection finds ≥ 3 sections in a standard business plan
- [ ] Gap analysis correctly identifies missing sections
- [ ] "Apply to Wizard" populates correct fields
- [ ] Character limits display when available from parsed form
- [ ] Question refs (Q1, Q2a) appear in wizard labels
- [ ] File rejected if > 10MB or unsupported type
- [ ] Scanned PDF (image-only) returns helpful error message
- [ ] Uploaded files stored securely (not publicly accessible)

### Deployment Notes
- New NPM packages: `pdf-parse`, `mammoth`, `multer` (if not already)
- New env var: `DOCUMENT_STORAGE=local` (default) or `s3`
- For S3: need `AWS_S3_BUCKET`, `AWS_REGION` env vars (already have AWS credentials)
- Database migration 016 runs automatically
- Instance size: stays t3.small (PDF parsing is not CPU-heavy)

---

## Feature 8: Competitor Analysis Module

**Roadmap ref**: Phase 3 of [GRANT_WIZARD_INTELLIGENCE_ROADMAP.md](../GRANT_WIZARD_INTELLIGENCE_ROADMAP.md)  
**Complexity**: VERY HIGH — requires background job system, external API keys, rate limiting

### What It Does
Given a user's industry, location, and product type, the system:
1. Searches for competitors via Google Places API and web scraping
2. Builds a competitor landscape report (top 5 competitors with size, positioning, gaps)
3. Generates market research brief (trends, demand signals, pricing data)
4. Auto-populates the grant wizard's competitive advantage and market analysis sections

### Why It Matters
Grant reviewers expect applicants to demonstrate market awareness. Most founders skip this (too time-consuming) or produce weak competitor sections. Automated research fills this critical gap.

### Prerequisites
- [x] Grant wizard deployed (done)
- [x] `grant_research_jobs` table exists (migration 012 — can reuse for job queue)
- [ ] NPM package: `pg-boss` (PostgreSQL-native job queue)
- [ ] API key: Google Places API ($0.02/request)
- [ ] **Feature 7 recommended first** (document intelligence patterns reusable)

### ⚠️ Important: Background Job System Required

Competitor analysis takes 2-5 minutes. HTTP requests can't block that long. This feature requires a background job system.

**Recommended**: `pg-boss` — uses existing PostgreSQL, no new infrastructure.

The `grant_research_jobs` table (migration 012) is already designed for this:
```sql
-- Already exists:
-- grant_research_jobs (id, application_id, job_type, status, input_data, result_data, ...)
```

### Files to Create

| File | Purpose | Est. Lines |
|------|---------|-----------|
| `greenreach-central/services/jobQueue.js` | pg-boss wrapper, job registration, worker | ~150 |
| `greenreach-central/services/competitorResearch.js` | Google Places + web scraping logic | ~350 |
| `greenreach-central/services/marketResearch.js` | Trends, pricing, demand signals | ~250 |
| `greenreach-central/routes/research.js` | API routes for triggering/polling research | ~200 |
| `greenreach-central/config/database.js` | Migration 017 (competitor_analyses table) | +15 lines |

### Files to Modify

| File | Change |
|------|--------|
| `greenreach-central/server.js` | Mount `/api/research` routes, init job queue |
| `greenreach-central/public/grant-wizard.html` | Add research trigger in Step 3 (Narrative) |
| `package.json` | Add `pg-boss` |

### Step-by-Step Implementation

#### Step 1: Install pg-boss & Set Up Job Queue (2 days)

```bash
cd greenreach-central
npm install pg-boss
```

**`services/jobQueue.js`**:
```javascript
import PgBoss from 'pg-boss';

let boss;

export async function initJobQueue(connectionString) {
  boss = new PgBoss(connectionString);
  await boss.start();
  
  // Register workers
  boss.work('competitor-analysis', { teamSize: 1, teamConcurrency: 1 }, handleCompetitorJob);
  boss.work('market-research', { teamSize: 1, teamConcurrency: 1 }, handleMarketResearchJob);
  
  return boss;
}

export async function enqueueJob(type, data) {
  const jobId = await boss.send(type, data, {
    retryLimit: 2,
    retryDelay: 30,
    expireInMinutes: 10
  });
  return jobId;
}

async function handleCompetitorJob(job) {
  // Update grant_research_jobs status → 'processing'
  // Call competitorResearch.analyze()
  // Update status → 'completed' with result_data
}
```

**Init in server.js**:
```javascript
import { initJobQueue } from './services/jobQueue.js';
// After DB init:
await initJobQueue(process.env.DATABASE_URL);
```

#### Step 2: Database Migration 017 (0.5 days)

```sql
-- Optional: dedicated competitor analysis storage (or use grant_research_jobs.result_data JSONB)
ALTER TABLE grant_applications 
  ADD COLUMN IF NOT EXISTS competitor_analysis JSONB,
  ADD COLUMN IF NOT EXISTS market_research JSONB;
```

#### Step 3: Competitor Research Service — `services/competitorResearch.js` (5 days)

**Data collection pipeline**:

```
User Input → Google Places Search → Enrich Each Result → Score & Rank → Generate Report
```

**3a. Google Places API** (primary source):
```javascript
async function searchCompetitors(industry, lat, lng, radius = 50000) {
  // POST https://places.googleapis.com/v1/places:searchText
  // textQuery: `${industry} near ${lat},${lng}`
  // Return: name, address, rating, reviewCount, website, types
}
```

**3b. Website Enrichment** (reuse existing cheerio scraper):
```javascript
async function enrichCompetitor(website) {
  // Scrape competitor's website for:
  // - Product/service offerings
  // - Team size indicators ("our team of 20+")
  // - About page: founding year, mission
  // - Social media links (LinkedIn employee count proxy)
  // Rate limit: 1 request per 2 seconds
}
```

**3c. AI Analysis** (GPT-4, reuse existing OpenAI integration):
```javascript
async function analyzeCompetitorLandscape(competitors, userProfile) {
  // Prompt: Given these competitors and the user's business, generate:
  // 1. Competitive positioning map (text description)
  // 2. Market gaps the user can exploit
  // 3. Threats from established players
  // 4. Recommended competitive advantage narrative for grant application
}
```

**Output shape** (`competitor_analysis` JSONB):
```json
{
  "analyzed_at": "2026-02-12T...",
  "region": "Ontario, Canada",
  "industry": "Vertical Farming / Indoor Agriculture",
  "competitors": [
    {
      "name": "GoodLeaf Farms",
      "location": "Guelph, ON",
      "website": "https://goodleaffarms.com",
      "size_estimate": "50-200 employees",
      "products": ["Baby greens", "Lettuce", "Microgreens"],
      "strengths": ["Established brand", "Retail distribution"],
      "weaknesses": ["Higher price point", "Limited crop variety"],
      "rating": 4.2,
      "review_count": 45
    }
    // ... top 5
  ],
  "market_gaps": [
    "No local competitor offers pak choi or Asian greens",
    "Most competitors focus on retail — wholesale underserved"
  ],
  "competitive_advantage_narrative": "Unlike established competitors who focus on...",
  "threat_level": "moderate"
}
```

#### Step 4: Market Research Service — `services/marketResearch.js` (3 days)

**Data sources** (free/low-cost):
1. **Stats Canada API**: Agricultural production data, trade stats
2. **Google Trends** (unofficial): Search interest for product categories
3. **Web scraping**: Industry association reports, news articles

**Output shape** (`market_research` JSONB):
```json
{
  "analyzed_at": "2026-02-12T...",
  "market_size": { "canada_vertical_farming": "$350M (2025, est.)", "growth_rate": "25% CAGR" },
  "demand_signals": [
    "Google Trends: 'locally grown produce' up 40% in 2 years",
    "Stats Canada: greenhouse vegetable production up 12% YoY"
  ],
  "pricing_benchmarks": {
    "lettuce_wholesale_kg": { "low": 8, "mid": 12, "high": 18 },
    "microgreens_wholesale_kg": { "low": 35, "mid": 50, "high": 75 }
  },
  "narrative": "The Canadian vertical farming market is projected to..."
}
```

#### Step 5: Research API Routes — `routes/research.js` (2 days)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/research/competitor-analysis` | JWT | Start async competitor analysis |
| `POST` | `/api/research/market-research` | JWT | Start async market research |
| `GET` | `/api/research/status/:applicationId` | JWT | Poll job status |
| `GET` | `/api/research/results/:applicationId` | JWT | Get completed results |
| `POST` | `/api/research/apply-to-wizard` | JWT | Push results into wizard narrative |

**Async flow**:
1. `POST /competitor-analysis` → enqueue pg-boss job → return `{ jobId, status: 'queued' }`
2. Frontend polls `GET /status/:appId` every 5 seconds
3. When status = `completed`, frontend fetches `GET /results/:appId`
4. User reviews results → clicks "Apply to Wizard"

#### Step 6: Grant Wizard UI Integration (2 days)

**In Step 3 (Narrative)**, add research panel:

```
┌──────────────────────────────────────────┐
│ 🔍 Automated Research                   │
│                                          │
│ We can analyze your competitive          │
│ landscape and market opportunity.        │
│                                          │
│ Industry: [Vertical Farming     ▼]       │
│ Location: [Ontario, Canada      ▼]       │
│ Products: [Leafy greens, microgreens]    │
│                                          │
│ [Run Competitor Analysis] (~2-3 min)     │
│ [Run Market Research] (~3-5 min)         │
│                                          │
│ ⏳ Analyzing competitors... 45%          │
│ ░░░░░░░░░░████████░░░░░░░░░░            │
└──────────────────────────────────────────┘
```

**After completion**, show results card with "Apply to Wizard" button that populates:
- `answers.competitive_advantage` ← from `competitive_advantage_narrative`
- `answers.market_analysis` ← from `market_research.narrative`
- `project_profile.market_size` ← from `market_size`

#### Step 7: Rate Limiting & Cost Controls (1 day)

```javascript
// Per-user limits
const RESEARCH_LIMITS = {
  competitor_analysis: { perDay: 3, perMonth: 10 },
  market_research: { perDay: 3, perMonth: 10 }
};

// Google Places API cost tracking
// ~$0.02 per request × 5 competitors × enrichment = ~$0.50 per analysis
// Budget: ~$50/month for 100 analyses
```

**Environment variables**:
```
GOOGLE_PLACES_API_KEY=...
RESEARCH_DAILY_LIMIT=3
RESEARCH_MONTHLY_LIMIT=10
```

#### Step 8: Testing Checklist (2 days)

- [ ] Job enqueues and processes without error
- [ ] Job status transitions: queued → processing → completed
- [ ] Failed jobs retry up to 2 times
- [ ] Google Places returns ≥ 3 results for "vertical farming Ontario"
- [ ] Website enrichment handles timeout/404 gracefully
- [ ] AI analysis produces coherent 3-paragraph narrative
- [ ] Rate limits enforced (4th request in a day returns 429)
- [ ] Results persist across page refreshes
- [ ] "Apply to Wizard" populates correct narrative fields
- [ ] Job queue doesn't block Express server shutdown
- [ ] pg-boss tables auto-created on first run

### Deployment Notes
- New NPM package: `pg-boss`
- New env vars: `GOOGLE_PLACES_API_KEY`, `RESEARCH_DAILY_LIMIT`, `RESEARCH_MONTHLY_LIMIT`
- pg-boss creates its own tables in PostgreSQL (no manual setup)
- Cost impact: +$10-50/month for Google Places API depending on usage
- Consider upgrading to t3.small if not already (background workers + web server)
- Database migration 017 runs automatically

### ⚠️ Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Google Places API costs spiral | Daily/monthly per-user limits + cost tracking |
| Competitor websites block scraping | Graceful fallback: Google Places data only |
| AI hallucination in competitor analysis | Always show raw data alongside AI narrative |
| pg-boss conflicts with existing DB | Uses separate schema (`pgboss`), no table collisions |
| Long-running jobs crash | Job timeout (10 min), automatic retry, dead letter queue |

---

## Implementation Schedule

**If building all three sequentially (one developer)**:

```
Week 1-2:  Feature 6 — Calculator engine + frontend
Week 3:    Feature 6 — Wizard integration + PDF export + testing
Week 4-5:  Feature 7 — PDF parser + DOCX parser + upload UI
Week 6:    Feature 7 — Gap analysis + wizard integration + testing
Week 7-8:  Feature 8 — pg-boss setup + competitor research service
Week 9:    Feature 8 — Market research + wizard UI + testing
Week 10:   Integration testing across all 3 features + deploy
```

**Total**: ~10 weeks / 50 working days

**If parallelizing** (2 developers):
- Dev A: Feature 6 (weeks 1-3), Feature 8 backend (weeks 4-6)
- Dev B: Feature 7 (weeks 1-4), Feature 8 frontend + integration (weeks 5-6)
- Both: Integration testing (week 7)
- **Total**: ~7 weeks

---

## Agent Instructions

If an AI agent is implementing these features:

1. **Read the full spec** before starting: `VERTICAL_FARM_CALCULATOR_SPEC.md` for Feature 6
2. **Follow the Agent Skills Framework**: `.github/AGENT_SKILLS_FRAMEWORK.md`
3. **Multi-agent review required** for each feature before merge:
   - Implementation Agent: build it
   - Review Agent: validate claims and test
   - Architecture Agent: strategic approval
4. **Run `npm run validate-schemas`** before every commit
5. **Test locally** before requesting deployment approval
6. **No production deployment without user "APPROVED FOR DEPLOYMENT"**
7. **Each feature gets its own commit** with conventional message format:
   - `feat: add vertical farm production calculator (Phase 4)`
   - `feat: add document intelligence for business plans (Phase 2)`
   - `feat: add competitor analysis with pg-boss job queue (Phase 3)`
