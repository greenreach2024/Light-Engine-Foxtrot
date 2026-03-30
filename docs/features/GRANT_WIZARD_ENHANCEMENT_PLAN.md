# Grant Wizard Enhancement Plan
**Date:** February 12, 2026  
**Status:** Implementation Roadmap for Review

---

## Executive Summary

This document outlines enhancements to transform the grant wizard from a generic form-filling tool into an intelligent, AI-powered grant application system that:
1. **Reduces user friction** by eliminating redundant search/filter inputs
2. **Leverages AI** to recommend programs based on user profile + stated goals
3. **Supports critical application components** (milestones, budgets, letters of support)
4. **Provides actionable templates** (email templates for letters of support)
5. **Asks program-specific questions** tailored to each funding opportunity

---

## Current Capabilities Assessment

### ✅ What Works Well

#### 1. Discovery Flow
- **Goal Selection Page** (`view-discovery`): 10 checkbox options for project goals
  - ✅ Establish vertical farm/CEA
  - ✅ Expand existing operation
  - ✅ Equipment purchase
  - ✅ Workforce training
  - ✅ Innovation & R&D
  - ✅ Export/new markets
  - ✅ Clean technology
  - ✅ Community food security
  - ✅ Risk management
  - ✅ Value-added processing
  
- **Project Scale Inputs**: Budget range, employees, duration, province
- **Website Intelligence**: Optional URL scraping to extract community events, achievements, products
- **Business Plan Status**: Yes/Partial/No radio selection

#### 2. Program Matching
- **Algorithm**: `POST /applications/:id/match-programs` endpoint exists
- **Scoring Logic**: Programs scored based on goal alignment
- **Match UI**: Programs displayed with match badges (strong/moderate)
- **Match Reasons**: Shows why each program matches user's goals

#### 3. Wizard Steps (6 stages)
1. **Organization**: Legal name, corp search, incorporation date, employees, CRA number
2. **Project**: Title, description, need statement, start/end dates
3. **Budget**: Line items (description, amount, category), other funding sources
4. **Narrative**: Outcomes, risks, alignment with program priorities
5. **Documents**: Checklist of required attachments
6. **Review**: Export draft pack, download PDF, record outcome

#### 4. Profile System
- User registration with business details
- Profile pre-fills wizard fields
- Dashboard tracks multiple applications
- Analytics tracking (page views, time spent)

#### 5. Admin Intelligence System
- Grant Summary analytics (KPIs, wizard analytics)
- Grant Users management
- AI Reference Sites library

---

## ❌ Current Gaps & Pain Points

### 1. **Redundant Search/Filter UI**
**Problem**: "Find Programs" tab has 3 filter inputs + 7 pill buttons on top of the discovery goal checkboxes
- `programSearch` text input
- `programStatusFilter` dropdown (open/closed/upcoming)
- `programTypeFilter` dropdown (grant/contribution/loan/tax credit)
- 7 pill buttons (Hiring, Equipment, Clean tech, Innovation, New farmers, Export, Risk management)

**User Complaint**: "The two fields that allow users to search for a program, plus the filter buttons, seem redundant due to the more detailed 'what do you want to accomplish' page."

**Impact**: Increases cognitive load, adds unnecessary steps, contradicts goal of "reducing user inputs"

---

### 2. **No AI-Powered Post-Profile Recommendations**
**Problem**: AI is not used to review completed profile + goals and suggest:
- **Direct match programs** (100% aligned with stated goals)
- **Complementary programs** (adjacent opportunities that expand reach)
- **Educational/community programs** that could unlock additional funding if user expands scope

**Example Scenario**: User states goal = "expansion only"  
**Desired AI Behavior**:
> "We see you're expanding. Have you considered adding a community education component? This would qualify you for [Program X: Community Food Security], which offers $50K-$200K and complements your expansion project."

**Current State**: Matching is purely rule-based keyword scoring, no LLM reasoning or strategic suggestions

---

### 3. **Generic Wizard Questions**
**Problem**: Wizard asks the same 6 steps for every program, regardless of specific requirements

**User Feedback**: "I have yet to read a question specific to the application."

**Examples of Missing Program-Specific Questions**:
- Indigenous-focused programs: "Are you Indigenous-led or partnered with Indigenous communities?"
- Clean tech programs: "What is your projected CO₂e reduction (tonnes/year)?"
- Export programs: "Which countries are you targeting? Do you have export permits?"
- Research grants: "Describe your research methodology and control groups."

**Current State**: Wizard uses generic fields (project description, budget, outcomes). No dynamic question rendering based on program requirements.

---

### 4. **No Milestone/Timeline Builder**
**Problem**: Wizard has NO milestone tracking or project timeline feature

**User Feedback**: "The wizard does not support the building of the most difficult part of the application, milestones and budgeting."

**Reality Check**: Nearly all funding applications require:
- Detailed project milestones with dates
- Deliverables tied to each milestone
- Budget allocation per milestone phase
- Reporting schedule aligned with milestones

**Current State**: Budget exists as line items, but no milestone/phase structure. Users must manually create milestone tables in external documents.

---

### 5. **No Letters of Support Workflow**
**Problem**: No built-in flow to help users request letters of support from community leaders, academic institutions, or partners

**User Feedback**: "The wizard should prompt several best practices including requesting letters of support from community leaders and academic leaders."

**Desired Features**:
1. **Best Practice Prompt**: "Strong applications include 2-3 letters of support. Would you like help requesting them?"
2. **Template Email Generator**: Pre-written email with dynamic fields (user name, project title, org name)
3. **Supporter Reply Template**: Simple template for supporters to fill in and send back

**Current State**: No mention of letters of support anywhere in the wizard flow.

---

### 6. **Underdeveloped Budget Features**
**Problem**: Budget entry is basic (description, amount, category). No:
- Budget justification per line item
- Cost breakdown (units × unit cost)
- Supplier quotes upload/linking
- Budget variance scenarios (e.g., if equipment cost increases by 10%)
- Budget-to-milestone mapping

**User Feedback**: "Nearly all funding application require a milestone and budget."

**Current State**: Budget items stored as JSON array, displayed in simple table, calculates total. That's it.

---

## 🎯 Enhancement Implementation Plan

### **Phase 1: Simplify & Optimize Discovery (HIGH PRIORITY)**

**Goal**: Reduce user inputs, eliminate redundancy

#### 1.1 Remove Search/Filter Bar from "Find Programs" Tab
- **Action**: Hide or remove filter bar (`programSearch`, `programStatusFilter`, `programTypeFilter`)
- **Rationale**: Discovery checkboxes already capture intent. Searching by keyword is less effective than goal-driven matching.
- **Implementation**:
  - Delete filter bar HTML from `tab-find-programs` section
  - Update `loadPrograms()` function to show ALL programs or goal-matched programs by default
  - Keep status pills (open/upcoming/closed) as a single filter option if needed

#### 1.2 Consolidate Goal Pills
- **Action**: Replace 7 standalone pills (Hiring, Equipment, Clean tech, etc.) with a single "Filter by Goal" dropdown that references the 10 discovery checkboxes
- **Rationale**: Avoids duplication of goal categories
- **Alternative**: Remove pills entirely; rely on discovery checkboxes for all filtering

**Estimated Effort**: 2 hours (frontend only)  
**Dependencies**: None  
**Risk**: Low (pure UI simplification)

---

### **Phase 2: AI-Powered Program Recommendations (HIGH PRIORITY)**

**Goal**: After profile creation, use AI to suggest direct + complementary programs

#### 2.1 Post-Profile AI Analysis Endpoint
- **Endpoint**: `POST /applications/:id/ai-recommend`
- **Inputs**:
  - User profile (organization type, province, employees, goals, website intelligence)
  - Selected goals from discovery
  - Budget range
  - Project description (if available)
  
- **AI Prompt** (OpenRouter/Claude):
```
You are a grant funding strategist for Canadian agriculture.

User Profile:
- Organization: {org_type}, {province}, {employees} employees
- Goals: {selected_goals}
- Budget: {budget_range}
- Website Intelligence: {websiteIntelligence}

Task:
1. Identify 3-5 "Direct Match" programs from the database that align 90%+ with stated goals.
2. Identify 2-3 "Complementary Opportunity" programs that don't directly match but could if the user expanded their scope (e.g., adding community education to an expansion project).
3. For each complementary program, explain: "If you added [X goal], you'd qualify for [Program Y], which offers [Z benefit]."
4. Output JSON:
{
  "directMatches": [{ "programId": "...", "reason": "..." }],
  "complementaryMatches": [{ "programId": "...", "expansionNeeded": "...", "benefit": "..." }],
  "strategicAdvice": "2-3 sentence summary of funding strategy"
}
```

#### 2.2 UI: AI Recommendations Card
- **Location**: Top of `view-matches` page (after discovery submission)
- **Design**:
  ```
  ┌─────────────────────────────────────────────────────┐
  │ 🤖 AI-Powered Funding Strategy                      │
  │                                                     │
  │ Direct Matches (5)                                  │
  │ ✅ Canadian Agricultural Partnership - 95% match   │
  │ ✅ Clean Growth Hub - 88% match                     │
  │                                                     │
  │ Expand Your Reach (2 suggestions)                  │
  │ 💡 Add "community food security" goal →            │
  │    Unlock Local Food Infrastructure Fund ($200K)   │
  │                                                     │
  │ [View All Recommendations]  [Refine Goals]         │
  └─────────────────────────────────────────────────────┘
  ```

#### 2.3 Interactive Expansion Flow
- **Feature**: "Add to Goals" button next to each complementary suggestion
- **Action**: Updates user's goal checkboxes, re-runs matching algorithm
- **User Prompt**: "Would you like me to help expand your reach and grow your funding opportunities?"

**Estimated Effort**: 8-12 hours (backend + frontend + AI prompt tuning)  
**Dependencies**: OpenRouter API key, grant_programs database  
**Risk**: Medium (AI output quality depends on program metadata richness)

---

### **Phase 3: Program-Specific Question Engine (HIGH PRIORITY)**

**Goal**: Wizard asks tailored questions based on selected program's requirements

#### 3.1 Database Schema: Program Questions Table
```sql
CREATE TABLE grant_program_questions (
  id SERIAL PRIMARY KEY,
  program_id INTEGER REFERENCES grant_programs(id),
  wizard_step VARCHAR(50), -- 'organization', 'project', 'budget', 'narrative', etc.
  question_key VARCHAR(100) UNIQUE NOT NULL,
  question_text TEXT NOT NULL,
  question_type VARCHAR(20), -- 'text', 'textarea', 'number', 'select', 'multiselect', 'date'
  options JSONB, -- for select/multiselect: ["option1", "option2"]
  validation_rules JSONB, -- { "required": true, "min": 0, "max": 1000000 }
  help_text TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_program_questions_program ON grant_program_questions(program_id);
CREATE INDEX idx_program_questions_step ON grant_program_questions(wizard_step);
```

#### 3.2 Seed Example Program-Specific Questions
```sql
-- Example: Canadian Agricultural Partnership (CAP)
INSERT INTO grant_program_questions (program_id, wizard_step, question_key, question_text, question_type, help_text)
VALUES
  (1, 'project', 'cap_sustainability_focus', 'Which sustainability practices will your project adopt?', 'multiselect', 'Select all that apply: water conservation, renewable energy, waste reduction, etc.'),
  (1, 'narrative', 'cap_climate_impact', 'Estimated annual CO₂e reduction (tonnes)', 'number', 'Use Agriculture Canada's GHG calculator if unsure.'),
  (1, 'organization', 'cap_indigenous_partnership', 'Are you Indigenous-led or partnered with Indigenous communities?', 'select', '');
```

#### 3.3 Dynamic Wizard Rendering
- **Logic**: When user selects a program in `loadWizard(appId)`, fetch program-specific questions:
  ```javascript
  const res = await fetch(`${API}/programs/${programId}/questions`);
  const questions = await res.json();
  ```
- **Rendering**: In `renderWizardStep()`, inject program-specific questions AFTER generic fields for each step
- **Storage**: Save answers to `application_answers` JSONB column with keys like `cap_sustainability_focus`

**Estimated Effort**: 12-16 hours (schema + API + frontend logic + seeding questions for 5 programs)  
**Dependencies**: Database migration, program metadata  
**Risk**: Medium-High (requires content creation for every program; could start with top 10 programs)

---

### **Phase 4: Milestone & Budget Phase Builder (CRITICAL)**

**Goal**: Support milestone-based project planning with budget allocation per phase

#### 4.1 Database Schema: Milestones Table
```sql
CREATE TABLE application_milestones (
  id SERIAL PRIMARY KEY,
  application_id INTEGER REFERENCES grant_applications(id) ON DELETE CASCADE,
  milestone_number INTEGER NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  start_date DATE,
  end_date DATE,
  deliverables TEXT[], -- array of deliverable descriptions
  budget_amount DECIMAL(12,2),
  completion_criteria TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_milestones_app ON application_milestones(application_id);
```

#### 4.2 Link Budget Items to Milestones
```sql
ALTER TABLE application_budget_items ADD COLUMN milestone_id INTEGER REFERENCES application_milestones(id);
CREATE INDEX idx_budget_items_milestone ON application_budget_items(milestone_id);
```

#### 4.3 Wizard Step: "Milestones & Timeline" (New Step Between Budget & Narrative)
- **UI**: Table with rows for each milestone:
  ```
  Milestone 1: Planning & Permitting
  - Start: Jan 2026, End: Mar 2026
  - Deliverables: [+] Site plan approved, [+] Building permit obtained
  - Budget: $25,000
  - Completion Criteria: All permits in hand
  
  [+ Add Milestone]
  ```

- **Budget View Enhancement**: Show budget items grouped by milestone:
  ```
  Milestone 1: Planning & Permitting ($25,000)
    - Architect fees: $15,000
    - Permit fees: $10,000
  
  Milestone 2: Construction ($250,000)
    - Building materials: $150,000
    - Labour: $100,000
  ```

#### 4.4 Export: Milestone Timeline Visualization
- **Feature**: Generate Gantt chart or timeline graphic for PDF export
- **Library**: Use Mermaid.js or Chart.js for browser-rendered timeline

**Estimated Effort**: 16-20 hours (schema + backend + frontend + export integration)  
**Dependencies**: Database migration, PDF generation library  
**Risk**: High (complex UX for milestone management; requires user testing)

---

### **Phase 5: Letters of Support Workflow (MEDIUM PRIORITY)**

**Goal**: Prompt users to request letters of support, provide email templates

#### 5.1 Wizard Step Addition: "Letters of Support" (After Narrative, Before Documents)
- **UI**:
  ```
  ┌──────────────────────────────────────────────────────┐
  │ 📨 Letters of Support (Best Practice)                │
  │                                                      │
  │ Strong applications include 2-3 letters of support  │
  │ from community leaders, academic partners, or        │
  │ industry associations.                               │
  │                                                      │
  │ [Generate Email Template]                            │
  └──────────────────────────────────────────────────────┘
  ```

#### 5.2 Email Template Generator
- **Inputs**: User's name, project title, organization name, project summary (pulled from wizard)
- **Template** (user can edit):
  ```
  Subject: Request for Letter of Support - {project_title}
  
  Dear {recipient_name},
  
  I am writing to request a letter of support for {organization_name}'s upcoming grant application to {program_name}.
  
  Our project, "{project_title}", aims to {project_summary_1sentence}.
  
  Your letter would help demonstrate community backing and strengthen our application. If you're able to support us, we've prepared a simple template below for your convenience.
  
  Thank you for considering this request.
  
  Best regards,
  {user_name}
  {organization_name}
  
  ---
  
  TEMPLATE FOR YOUR REPLY:
  
  To Whom It May Concern,
  
  I am pleased to support {organization_name}'s grant application for {project_title}.
  
  [Your 2-3 paragraph endorsement: mention your relationship to the organization, why the project matters to the community, and any specific benefits you foresee.]
  
  Sincerely,
  {recipient_name}
  {recipient_title}
  {recipient_organization}
  ```

#### 5.3 Tracking Letters
- **Database Table**:
  ```sql
  CREATE TABLE application_support_letters (
    id SERIAL PRIMARY KEY,
    application_id INTEGER REFERENCES grant_applications(id),
    recipient_name VARCHAR(255),
    recipient_email VARCHAR(255),
    status VARCHAR(50), -- 'requested', 'received', 'pending'
    requested_date DATE,
    received_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  ```

- **UI**: Simple checklist showing "Requested from X on Y date" with status indicator

**Estimated Effort**: 8-12 hours (template generation + tracking table + UI)  
**Dependencies**: Email sending infrastructure (optional; could be copy/paste only)  
**Risk**: Low (mostly templating; no complex logic)

---

### **Phase 6: Advanced Budget Features (MEDIUM PRIORITY)**

**Goal**: Enhance budget entry with justifications, unit cost breakdowns, quote linking

#### 6.1 Budget Item Schema Enhancement
```sql
ALTER TABLE application_budget_items ADD COLUMN justification TEXT;
ALTER TABLE application_budget_items ADD COLUMN units INTEGER;
ALTER TABLE application_budget_items ADD COLUMN unit_cost DECIMAL(12,2);
ALTER TABLE application_budget_items ADD COLUMN supplier_name VARCHAR(255);
ALTER TABLE application_budget_items ADD COLUMN quote_url TEXT;
```

#### 6.2 UI Enhancements
- **Budget Entry Form**:
  ```
  Description: LED grow lights
  Units: 50 × Unit Cost: $300 = $15,000
  Category: Equipment
  Justification: [textarea] "Required to meet 5000kg/year production target"
  Supplier: GrowTech Inc.
  Quote: [Upload or paste URL]
  ```

#### 6.3 Budget Justification Report in Export
- **Feature**: Auto-generate "Budget Justification" section in PDF export
- **Format**:
  ```
  BUDGET JUSTIFICATION
  
  Line Item: LED Grow Lights ($15,000)
  - 50 units @ $300/unit
  - Supplier: GrowTech Inc. (Quote: [link])
  - Justification: Required to achieve 5000kg/year production target per project plan.
  ```

**Estimated Effort**: 6-8 hours (schema + UI + export formatting)  
**Dependencies**: Budget milestone linking (Phase 4)  
**Risk**: Low (incremental enhancement to existing budget feature)

---

## 📋 Implementation Priority Matrix

| Phase | Feature | Priority | Effort (hrs) | User Impact | Risk |
|-------|---------|----------|--------------|-------------|------|
| 1 | Simplify Discovery UI | **HIGH** | 2 | High (reduces friction) | Low |
| 2 | AI Program Recommendations | **HIGH** | 10 | Very High (strategic value) | Med |
| 3 | Program-Specific Questions | **HIGH** | 14 | High (relevance) | Med-High |
| 4 | Milestone & Budget Builder | **CRITICAL** | 18 | **Very High** (core gap) | High |
| 5 | Letters of Support Workflow | MED | 10 | Medium (best practice) | Low |
| 6 | Advanced Budget Features | MED | 7 | Medium (polish) | Low |

**Total Estimated Effort**: 61 hours (~8 working days for 1 developer)

---

## 🚀 Recommended Rollout Sequence

### Sprint 1 (Week 1): Foundation & Quick Wins
1. **Phase 1**: Simplify Discovery UI (2 hrs) ✅ **DEPLOY IMMEDIATELY**
2. **Phase 4 (Milestone Schema)**: Create database tables and basic CRUD endpoints (8 hrs)

### Sprint 2 (Week 2): Milestone Builder MVP
3. **Phase 4 (Milestone UI)**: Build milestone management interface in wizard (10 hrs)
4. Test milestone + budget integration

### Sprint 3 (Week 3): AI Intelligence
5. **Phase 2**: AI Program Recommendations (10 hrs)
6. Test with real user profiles

### Sprint 4 (Week 4): Program Specificity
7. **Phase 3 (Schema)**: Create program_questions table + 5 pilot programs (8 hrs)
8. **Phase 3 (Frontend)**: Dynamic question rendering (6 hrs)

### Sprint 5 (Week 5): Best Practices & Polish
9. **Phase 5**: Letters of Support workflow (10 hrs)
10. **Phase 6**: Advanced Budget features (7 hrs)

---

## 📊 Success Metrics

### User Experience
- **Reduced Time to Match**: Measure avg time from registration to program match (target: <5 min)
- **Goal Expansion Rate**: % of users who expand goals based on AI complementary suggestions (target: 30%+)
- **Application Completion Rate**: % of users who complete all wizard steps (target: 60%+, up from current baseline)

### Application Quality
- **Milestone Adoption**: % of applications using milestone feature (target: 80%+)
- **Letter of Support Requests**: Avg # of letters requested per application (target: 2+)
- **Program-Specific Question Completion**: % of required fields completed (target: 95%+)

### Business Impact
- **Funded Applications**: Track how many wizard-assisted applications receive funding (requires user self-reporting or grant agency partnerships)

---

## 🔍 Open Questions for User

1. **Application Access**: Do you have access to actual program application PDFs/forms? This would help us extract program-specific questions accurately.
   - If yes, please upload PDFs for top 5 programs you want to prioritize.
   
2. **AI Complementary Suggestions**: Should the AI be conservative (only suggest programs with 80%+ fit) or aggressive (suggest stretch opportunities that require significant goal expansion)?

3. **Milestone Granularity**: How detailed should milestones be? Monthly? Quarterly? Flexible user choice?

4. **Letters of Support**: Should we integrate email sending (requires SMTP setup) or stick to copy/paste templates?

5. **Budget Export Format**: Do specific programs require budget templates in Excel/CSV format? Or is PDF sufficient?

---

## 📝 Next Steps

1. **User Review**: Please review this plan and provide feedback on:
   - Priority adjustments
   - Missing features
   - Feasibility concerns
   
2. **Phase 1 Approval**: If approved, I'll begin Phase 1 (Simplify Discovery UI) immediately — this is a 2-hour quick win.

3. **Content Collection**: If you have application PDFs, please share them so we can build the program-specific question library in Phase 3.

4. **Sprint Planning**: Once approved, I'll break down Phase 4 (Milestones) into detailed implementation tickets.

---

**END OF PLAN**
