# Grant Wizard Intelligence Architecture
## Vision: From Wizard to Autonomous Research Assistant

**Last Updated**: 2026-02-07  
**Status**: Architecture & Roadmap  
**Goal**: Minimize user input, maximize application quality through AI-powered automation

---

## 🎯 Core Philosophy

**"The wizard should do everything possible to reduce user input and improve quality"**

Transform the grant wizard from:
- ❌ **Before**: User fills 50+ fields manually
- ✅ **After**: User answers 10 strategic questions, AI researches and drafts everything else

---

## 🏗️ Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│              PRE-WIZARD: PROJECT DISCOVERY               │
│  • Select project goals (6-10 standard options)          │
│  • Budget range, timeline, current/future employees      │
│  • Website URL, existing business plan upload            │
└─────────────────────┬────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────────────────┐
│          SMART PROGRAM MATCHING ENGINE                   │
│  • Score programs by characterization data               │
│  • Pull application PDFs + guidelines from gov sites     │
│  • Parse PDF questions, map to wizard fields             │
└─────────────────────┬────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────────────────┐
│         AUTOMATED RESEARCH & DATA GATHERING              │
│  ├─ Corporation Search (✅ IMPLEMENTED)                  │
│  ├─ Website Scraping → Company profile, products, team   │
│  ├─ Competitor Analysis → Geographic + industry data     │
│  ├─ Market Research → Industry trends, demand signals    │
│  └─ Document Intelligence → Compare existing biz plan    │
└─────────────────────┬────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────────────────┐
│           DYNAMIC WIZARD WITH TAILORED QUESTIONS         │
│  • Questions reference actual application form ("Q23a")  │
│  • Fields pre-populated from research                    │
│  • Steps adapt to program requirements                   │
└─────────────────────┬────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────────────────┐
│      SPECIALIZED MODULES (e.g., Vertical Farm Calc)      │
│  • Production modeling, HVAC sizing, financial forecast  │
│  • Generates business plan sections for grants           │
└──────────────────────────────────────────────────────────┘
```

---

## 📋 Implementation Phases

### **PHASE 1: Foundation (2-3 weeks)** 🔄 PRIORITY
**Goal**: Capture strategic intent, enable basic research automation

#### 1.1 Pre-Wizard Questionnaire
- **UI**: New view before program selection
- **Collects**:
  - Project goals (checkboxes): "Establish vertical farm", "Expand operation", "Equipment purchase", "Export market entry", "Workforce training", "Innovation/R&D", "Risk management", "Clean tech adoption"
  - Budget range: slider/select ($10k-$50k, $50k-$250k, $250k-$1M, $1M+)
  - Current employees: number input
  - Target employees (post-project): number input
  - Project timeline: start month + duration
  - Website URL: text input (optional)
  - Existing business plan: file upload (PDF, docx)
- **Storage**: New `project_characterization` JSONB column in `grant_applications`
- **Complexity**: **LOW** (2-3 days)

#### 1.2 Enhanced Program Matching
- **Algorithm**: Score programs by characterization data
  - Match project goals → `priority_areas` keywords
  - Check budget range → `funding_amount_min/max`
  - Verify employee count → eligibility rules
  - Timeline compatibility → application deadlines
- **UX**: Sort programs by relevance score, show "Match: 85%" badge
- **Backend**: New `POST /applications/:id/match-programs` endpoint
- **Complexity**: **LOW** (2 days)

#### 1.3 Website Scraping Module
- **Tech Stack**: Puppeteer (headless Chrome) or Playwright
- **Extracts**:
  - Homepage: company mission, product descriptions
  - About page: founding year, team size, key personnel
  - Products/services: offerings list
  - News/blog: recent milestones (funding, expansion, partnerships)
- **Endpoint**: `POST /api/grant-wizard/scrape-website` (body: `{url}`)
- **Storage**: `scraped_data` JSONB in `grant_applications`
- **Auto-populate**: Business description, team context for narrative
- **Complexity**: **MEDIUM** (4-5 days including error handling)

---

### **PHASE 2: Document Intelligence (3-4 weeks)**
**Goal**: Parse funding applications, tailor questions to actual forms

#### 2.1 Application PDF Scraper
- **Sources**: 
  - AAFC programs: https://agriculture.canada.ca/programs
  - Bioenterprise: https://bioenterprise.ca/funding-programs/
  - CFIN: https://cfin.ca/programs/
  - Provincial programs: ON, QC, BC, AB pages
- **Tech**: `pdf-parse` or `pdfjs-dist` for text extraction
- **Parser Logic**:
  - Detect question structure: "Q1.", "Section A", numbered lists
  - Extract eligibility criteria, required attachments
  - Identify character limits per field
- **Endpoint**: `POST /api/grant-wizard/parse-application-pdf`
- **Storage**: New table `grant_application_forms`
  ```sql
  CREATE TABLE grant_application_forms (
    id SERIAL PRIMARY KEY,
    program_id INTEGER REFERENCES grant_programs(id),
    pdf_url TEXT,
    parsed_questions JSONB, -- {sections: [{title, questions: [{ref, text, charLimit}]}]}
    required_attachments TEXT[],
    scraped_at TIMESTAMPTZ
  );
  ```
- **Complexity**: **HIGH** (10-12 days - PDFs vary wildly)

#### 2.2 Question Mapping & Tailoring
- **Wizard Enhancement**: Show application reference in field labels
  - Example: "Project Description (Application Q2a, 500 char max)"
- **Dynamic Steps**: Generate wizard steps from parsed PDF structure
  - Instead of hardcoded `WIZARD_STEPS`, build dynamically per program
- **Backend**: `GET /api/grant-wizard/tailored-questions/:programId`
- **Complexity**: **MEDIUM-HIGH** (6-7 days)

#### 2.3 Business Plan Integration
- **Upload Handler**: Parse user's existing business plan (PDF/docx)
- **Comparison Engine**:
  - Extract sections: executive summary, market analysis, financials
  - Compare to grant template requirements
  - Highlight gaps: "Your plan has no risk mitigation section"
- **Auto-merge**: Populate wizard with extracted data
- **Tech**: `mammoth` (docx → HTML), `pdf-parse` for PDFs
- **Endpoint**: `POST /api/grant-wizard/compare-business-plan`
- **Complexity**: **HIGH** (8-10 days - document structure varies)

---

### **PHASE 3: Advanced Research (3-4 weeks)**
**Goal**: Autonomous market/competitor analysis

#### 3.1 Competitor Analysis Module
- **Inputs**: User's industry, geographic region, product type
- **Data Sources**:
  - Google Places API: nearby businesses in same category
  - LinkedIn Company Search: competitor size, employee growth
  - Crunchbase API: funding history, investor signals
  - Industry associations: member directories (scraping)
- **Output**: Competitor landscape report
  - Top 5 competitors: size, location, unique positioning
  - Market gap analysis: what user offers that competitors don't
  - Threat assessment: established players vs. user's startup
- **Endpoint**: `POST /api/grant-wizard/analyze-competitors`
- **Storage**: `competitor_analysis` JSONB in `grant_applications`
- **Auto-populate**: Market positioning, competitive advantage sections
- **Complexity**: **VERY HIGH** (15+ days - APIs, rate limits, data quality)

#### 3.2 Market Research Automation
- **Industry Trends**:
  - Google Trends: search volume for user's product category
  - Stats Canada: agricultural production data, trade stats
  - Industry reports: scrape public/free market research
- **Demand Signals**:
  - Amazon/Walmart product listings: price points, review volume
  - Export data: target countries, tariff rates (if export-focused)
- **Output**: Market opportunity brief (3-5 paragraphs)
- **Endpoint**: `POST /api/grant-wizard/market-research`
- **Complexity**: **VERY HIGH** (12-15 days)

---

### **PHASE 4: Vertical Farm Production Calculator (2-3 weeks)**
**Goal**: Generate detailed business plans for vertical farm grant applications

#### 4.1 Production Model
**Based on user's specifications**:

**Assumptions (Container-Scale)**:
- **Rack System**: 3 levels, 24"×28" trays
- **Lighting**: 2×100W LED per level, $119/pair
- **Pumps**: $800 supply + $400 return per 10k plants
- **Plant Density**: Variable by crop (leafy greens: ~30/tray, microgreens higher)

**Calculator Inputs**:
1. Production scale: number of trays (or sq ft)
2. Crop selection: lettuce, pak choi, microgreens, herbs
3. Location: province (for electricity rates)
4. Growth cycle: days from seed to harvest
5. Operational hours: 24/7 or staged lighting
6. Target production: kg/month or plants/week

**Calculations**:
- **Transpiration & HVAC**: 
  - 30g water/plant/day → BTU load
  - HVAC sizing: tons of cooling required
  - Dehumidification capacity
- **Electricity**:
  - Lighting: `(numTrays / 2) × 200W × hoursPerDay × daysPerMonth × localRate`
  - HVAC: estimated kWh based on transpiration load
  - Pumps: continuous vs. intermittent operation
- **Labour**:
  - 2 FTE for 4k plants
  - 3 FTE at 10k plants
  - +1 FTE per additional 10k plants
  - Wage assumptions: $18-$22/hr depending on province
- **Revenue**:
  - Yield: kg/harvest × harvests/month
  - Pricing: wholesale $/kg by crop type
  - Packaging costs: ~15% of revenue
- **Capital Costs**:
  - Infrastructure: racks, trays, reservoirs
  - Lighting: $119 per tray pair
  - Pumps: $1200 per 10k plants
  - HVAC: quoted based on BTU requirement
  - Controls: sensors, automation ($5k-$20k depending on scale)

**Outputs**:
- 5-year financial projection (Excel-style table)
- Break-even analysis: months to profitability
- Sensitivity analysis: ±20% on energy costs, yield, pricing
- Business plan narrative sections:
  - Operations plan (production schedule)
  - Technology description (HVAC, lighting, controls)
  - Financial overview (CAPEX, OPEX, revenue forecast)

#### 4.2 Integration with Grant Wizard
- **Trigger**: User selects "Establish vertical farm" in pre-wizard
- **Flow**: After characterization, redirect to calculator before wizard
- **Storage**: New table `farm_production_models`
  ```sql
  CREATE TABLE farm_production_models (
    id SERIAL PRIMARY KEY,
    application_id INTEGER REFERENCES grant_applications(id),
    inputs JSONB, -- {scale, crops, location, etc.}
    outputs JSONB, -- {capex, opex, revenue, projections[]}
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  ```
- **Auto-populate**: Budget section, narrative financials, project description

**Complexity**: **HIGH** (12-15 days - complex domain model)

---

### **PHASE 5: Background Job System (1-2 weeks)**
**Goal**: Handle long-running research tasks asynchronously

#### 5.1 Problem Statement
Research tasks take 30s - 5min:
- Website scraping: 10-30s
- PDF parsing: 20-60s
- Competitor analysis: 2-5min
- Market research: 3-5min

Can't block HTTP requests → need job queue.

#### 5.2 Tech Stack Options
1. **Bull (Redis-based)**: Most popular, requires Redis server
2. **BullMQ**: Modern Bull rewrite, better TypeScript support
3. **pg-boss**: PostgreSQL-based, no extra infrastructure
4. **AWS SQS + Lambda**: Cloud-native, scales automatically

**Recommendation**: **pg-boss** (uses existing PostgreSQL, zero new dependencies)

#### 5.3 Implementation
- **Queue**: `research-tasks` (website, pdf, competitor, market)
- **Worker**: Separate process or same server (low volume OK)
- **Status Tracking**: New table `research_jobs`
  ```sql
  CREATE TABLE research_jobs (
    id SERIAL PRIMARY KEY,
    application_id INTEGER REFERENCES grant_applications(id),
    job_type TEXT, -- 'website', 'competitor', 'market', 'pdf-parse'
    status TEXT, -- 'queued', 'processing', 'completed', 'failed'
    input_data JSONB,
    result_data JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
  );
  ```
- **Frontend**: Poll for job completion, show progress spinner
- **Endpoint**: `GET /api/grant-wizard/research-status/:applicationId`

**Complexity**: **MEDIUM** (5-7 days)

---

## 🗄️ Database Schema Additions

```sql
-- Phase 1
ALTER TABLE grant_applications 
ADD COLUMN project_characterization JSONB,
ADD COLUMN scraped_data JSONB;

-- Phase 2
CREATE TABLE grant_application_forms (
  id SERIAL PRIMARY KEY,
  program_id INTEGER REFERENCES grant_programs(id),
  pdf_url TEXT,
  parsed_questions JSONB,
  required_attachments TEXT[],
  scraped_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE research_jobs (
  id SERIAL PRIMARY KEY,
  application_id INTEGER REFERENCES grant_applications(id),
  job_type TEXT,
  status TEXT,
  input_data JSONB,
  result_data JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Phase 4
CREATE TABLE farm_production_models (
  id SERIAL PRIMARY KEY,
  application_id INTEGER REFERENCES grant_applications(id),
  inputs JSONB,
  outputs JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 📦 NPM Dependencies to Add

```json
{
  "puppeteer": "^21.0.0",        // Website scraping
  "pdf-parse": "^1.1.1",         // PDF text extraction
  "mammoth": "^1.6.0",           // DOCX → HTML conversion
  "pg-boss": "^9.0.0",           // Background job queue
  "cheerio": "^1.0.0-rc.12"      // ✅ Already added for corporation search
}
```

**Optional (if using external APIs)**:
- `@google/maps`: Google Places API
- `axios-retry`: Robust HTTP client for scraping
- `rate-limiter-flexible`: Prevent scraping ban

---

## 🚀 Deployment Considerations

### Current Infrastructure
- **Platform**: AWS Elastic Beanstalk (AL2023, Node 20)
- **Database**: PostgreSQL RDS (private VPC)
- **File Storage**: Local disk (ephemeral) - **PROBLEM** for PDF cache

### Required Changes
1. **Add S3 Bucket** for scraped PDFs, uploaded business plans
2. **Increase Instance Size**: t3.small → t3.medium (web scraping CPU-intensive)
3. **Add Redis** (if using Bull instead of pg-boss): ElastiCache instance
4. **Environment Variables**:
   - `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`
   - `GOOGLE_PLACES_API_KEY` (if competitor analysis)
   - `OPENAI_API_KEY` (already set for AI drafting)

### Cost Impact
- **Current**: ~$50-70/month (t3.micro, RDS db.t3.micro)
- **After Phase 1-2**: ~$100-120/month (t3.small, increased RDS queries)
- **After Phase 3-5**: ~$180-250/month (t3.medium, S3 storage, API calls)

---

## 🎬 Recommended First Step: PHASE 1 ONLY

**Scope**: Pre-wizard + website scraping + enhanced matching  
**Timeline**: 10-12 days  
**Value**: Captures strategic intent, enables 30-40% automation  
**Risk**: LOW (no external APIs, PostgreSQL-only)

**Deliverables**:
1. ✅ "Project Discovery" view before program selection
2. ✅ Website URL field → auto-scrape on wizard load
3. ✅ Smart program scoring/sorting by characterization
4. ✅ Auto-populate narrative from scraped data
5. ✅ Documentation for future phases

**Phase 2-5 Decision Point**: After Phase 1 lands in production, validate:
- Is auto-population accurate enough?
- Do users upload business plans (determines Phase 2 priority)?
- Is vertical farm calculator needed urgently (determines Phase 4)?

---

## 📊 Success Metrics

**Current Baseline** (without intelligence features):
- Time to complete wizard: ~45-60 minutes
- Fields requiring manual entry: ~50
- Programs matched per user: ~3-5 (random browsing)

**Phase 1 Target**:
- Time to complete: **30-40 minutes** (30% reduction)
- Fields requiring manual entry: **35-40** (20% pre-filled from website)
- Programs matched: **8-12** (smarter scoring)

**Phase 4 Target** (full intelligence):
- Time to complete: **20-25 minutes** (60% reduction)
- Fields requiring manual entry: **15-20** (70% automation)
- Programs matched: **15-20** (comprehensive research)
- Application quality: +40% (measured by AI draft coherence score)

---

## 🚧 Known Limitations & Risks

### Phase 1
- Website scraping breaks if site uses heavy JavaScript (SPAs)
- No guarantee user's website has useful info (sparse/outdated)

### Phase 2
- PDF parsing highly fragile (each agency uses different formats)
- No OCR for scanned PDFs (would need Tesseract.js → adds complexity)
- Character limits from PDFs may be inaccurate (need manual verification)

### Phase 3
- Competitor/market APIs cost money (Google Places: $0.02/request)
- Rate limiting may slow down or block scraping
- Data quality varies wildly (LinkedIn/Crunchbase have partial coverage)

### Phase 4
- Vertical farm calculator assumptions may not fit user's specific setup
- HVAC sizing is approximate (real systems need HVAC engineer)
- Financial projections highly dependent on accurate inputs

### General
- All automation requires **extensive testing** before users trust it
- Bad data → bad applications → user distrust → feature abandonment
- Complexity increases maintenance burden (more things can break)

---

## 🗳️ Decision: What to Build First?

**Option A**: Implement Phase 1 only (10-12 days)  
**Option B**: Phase 1 + Basic Phase 2 (PDF scraping only, 3 weeks)  
**Option C**: Phase 1 + Phase 4 (vertical farm calc, 4 weeks)  
**Option D**: Full roadmap (3-6 months)

**Recommend**: **Option A** → validate approach → prioritize Phase 2, 3, or 4 based on user feedback.

---

**Next Action**: User approval on which phase(s) to implement first.
