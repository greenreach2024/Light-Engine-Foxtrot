/**
 * Grant Program Registry Service
 * 
 * Manages funding program data from multiple sources:
 *   - AAFC programs catalogue (primary)
 *   - AgPal discovery (reference only, per Terms of Use)
 *   - Pocketed aggregator (weekly with credentials)
 *   - Manual entry (curated by GreenReach team)
 * 
 * Weekly change detection compares page snapshots to flag
 * deadline, eligibility, cost-share, and priority wording changes.
 */

import crypto from 'crypto';
import logger from '../utils/logger.js';
import { GRANT_PROGRAM_BUDGET_CATEGORIES, GRANT_PROGRAM_QUESTION_MAPS } from './grantQuestionMaps.js';

// ============================================================
// Seed data: Canadian agricultural programs relevant to growers
// ============================================================
export const SEED_PROGRAMS = [
  {
    program_code: 'AAFC-CALA',
    program_name: 'Canadian Agricultural Loans Act Program',
    administering_agency: 'Agriculture and Agri-Food Canada (AAFC)',
    source_url: 'https://agriculture.canada.ca/en/programs/canadian-agricultural-loans-act',
    intake_status: 'open',
    description: 'Makes loans available to farmers to establish, improve, and develop their farms and to marketing agencies to market commodities.',
    objectives: 'Support new and existing farmers in accessing credit for farm establishment, improvement, and development.',
    priority_areas: ['farm_establishment', 'farm_improvement', 'new_farmers', 'credit_access'],
    eligibility_summary: 'Canadian farmers (individuals or cooperatives) seeking loans for land, equipment, livestock, or farm improvements. Maximum loan limits apply.',
    eligibility_rules: {
      province: { type: 'province_list', provinces: ['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'], question: 'Which province or territory is your farm located in?', failMessage: 'Must be located in Canada' },
      organizationType: { type: 'includes', values: ['sole_proprietor','corporation','cooperative','partnership'], question: 'What is your business structure?', failMessage: 'Must be a farming entity' }
    },
    funding_type: 'loan',
    max_funding: 500000,
    application_method: 'lender',
    required_documents: ['Proof of farming operation', 'Business plan', 'Financial statements', 'Loan application through participating lender'],
    priority_lexicon: ['farm establishment', 'beginning farmers', 'farm improvement', 'agricultural development', 'credit access'],
    evidence_snippets: [
      { topic: 'New farmer support', text: 'The Canadian Agricultural Loans Act provides guaranteed loans to help new farmers overcome barriers to accessing agricultural credit.', source: 'AAFC CALA Program Page' }
    ]
  },
  {
    program_code: 'AAFC-ACT-RD',
    program_name: 'Agricultural Clean Technology: Research and Innovation Stream',
    administering_agency: 'Agriculture and Agri-Food Canada (AAFC)',
    source_url: 'https://agriculture.canada.ca/en/programs/agricultural-clean-technology-research-innovation',
    intake_status: 'open',
    description: 'Funds pre-market innovation, including research, development, demonstration and commercialization activities.',
    objectives: 'Help develop and enable the pre-commercialization of clean technologies and processes to advance the agricultural sector towards a low-carbon economy.',
    priority_areas: ['clean_technology', 'innovation', 'low_carbon_economy', 'GHG_reduction', 'precision_agriculture', 'hiring', 'workforce'],
    eligibility_summary: 'For-profit and not-for-profit organizations, Indigenous communities, and academic institutions undertaking clean technology research for agriculture.',
    eligibility_rules: {
      organizationType: { type: 'includes', values: ['corporation','cooperative','non_profit','indigenous_organization','academic'], question: 'What type of organization are you?', failMessage: 'Must be an eligible entity type' }
    },
    funding_type: 'contribution',
    max_funding: 2000000,
    cost_share_ratio: '50:50',
    reimbursement_model: 'reimbursement',
    application_method: 'portal',
    application_url: 'https://agriculture.canada.ca/en/programs/online-services-sign',
    required_documents: ['Project proposal', 'Detailed budget', 'Organization capacity documentation', 'Environmental impact assessment', 'Letters of support'],
    priority_lexicon: ['low-carbon economy', 'clean technology', 'GHG reduction', 'precision agriculture', 'sustainable practices', 'innovation', 'commercialization'],
    evidence_snippets: [
      { topic: 'Climate & emissions', text: 'AAFC prioritizes technologies supporting measurable reductions in GHG, fertilizer, and methane emissions in the agricultural sector.', source: 'ACT Research Stream Guidelines' }
    ],
    equity_enhanced: true,
    equity_details: { enhanced_ratio: '75:25', groups: ['Indigenous-owned', 'youth-led', 'women-owned'], attestation_required: true }
  },
  {
    program_code: 'AAFC-AGRIINVEST',
    program_name: 'AgriInvest',
    administering_agency: 'Agriculture and Agri-Food Canada (AAFC)',
    source_url: 'https://agriculture.canada.ca/en/programs/agriinvest',
    intake_status: 'open',
    description: 'Helps manage risk and small farming income declines.',
    objectives: 'Self-managed producer-government savings account to provide coverage for small income declines.',
    priority_areas: ['risk_management', 'income_stability', 'farm_business_management'],
    eligibility_summary: 'Canadian producers who file a Statement of Farming Activities with the Canada Revenue Agency.',
    eligibility_rules: {
      province: { type: 'province_list', provinces: ['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'], question: 'Where is your farm?', failMessage: 'Must farm in Canada' }
    },
    funding_type: 'contribution',
    application_method: 'portal',
    application_url: 'https://agriculture.canada.ca/en/programs/online-services-sign',
    required_documents: ['Statement of Farming Activities (T2042 or equivalent)', 'Financial records'],
    priority_lexicon: ['risk management', 'income stability', 'producer savings', 'business planning']
  },
  {
    program_code: 'AAFC-AGRISTABILITY',
    program_name: 'AgriStability',
    administering_agency: 'Agriculture and Agri-Food Canada (AAFC)',
    source_url: 'https://agriculture.canada.ca/en/programs/agristability',
    intake_status: 'open',
    description: 'Provides support to manage large farming income declines.',
    objectives: 'Income stabilization for producers experiencing large margin declines relative to their historical reference margins.',
    priority_areas: ['risk_management', 'income_stabilization', 'margin_protection'],
    eligibility_summary: 'Canadian producers with farming income documentation. Must enroll before the program deadline.',
    funding_type: 'contribution',
    application_method: 'portal',
    required_documents: ['Enrollment form', 'Financial statements', 'Tax return'],
    priority_lexicon: ['income stabilization', 'margin protection', 'risk management', 'farm resilience']
  },
  {
    program_code: 'AAFC-AGRIINSURANCE',
    program_name: 'AgriInsurance',
    administering_agency: 'Agriculture and Agri-Food Canada (AAFC)',
    source_url: 'https://agriculture.canada.ca/en/programs/agriinsurance',
    intake_status: 'open',
    description: 'Provides cost-shared insurance for natural hazards.',
    objectives: 'Production-risk insurance to minimize the financial impact of natural hazards on crop and forage production.',
    priority_areas: ['crop_insurance', 'natural_hazards', 'production_risk', 'climate_resilience'],
    eligibility_summary: 'Canadian producers growing insurable crops. Delivered provincially.',
    funding_type: 'contribution',
    application_method: 'provincial',
    required_documents: ['Crop inventory', 'Production records'],
    priority_lexicon: ['crop insurance', 'natural hazards', 'climate resilience', 'production risk']
  },
  {
    program_code: 'AAFC-AGRISCIENCE-PROJ',
    program_name: 'AgriScience Program – Projects Component',
    administering_agency: 'Agriculture and Agri-Food Canada (AAFC)',
    source_url: 'https://agriculture.canada.ca/en/programs/agriscience-projects',
    intake_status: 'open',
    description: 'Funds pre-commercial research and development projects that benefit the agriculture and agri-food sector and Canadians.',
    objectives: 'Support applied research addressing sector priorities and contributing to innovation in agriculture and agri-food.',
    priority_areas: ['research', 'innovation', 'pre_commercial', 'sector_competitiveness', 'hiring', 'workforce'],
    eligibility_summary: 'Industry organizations, academic institutions, and for-profit entities proposing research projects aligned with SCAP priority areas.',
    funding_type: 'contribution',
    max_funding: 5000000,
    cost_share_ratio: '50:50',
    application_method: 'portal',
    required_documents: ['Research proposal', 'Budget template', 'Letters of support', 'Organization capacity'],
    priority_lexicon: ['research', 'innovation', 'competitiveness', 'sector development', 'pre-commercial']
  },
  {
    program_code: 'AAFC-CASP',
    program_name: 'Canadian Agricultural Strategic Priorities Program',
    administering_agency: 'Agriculture and Agri-Food Canada (AAFC)',
    source_url: 'https://agriculture.canada.ca/en/programs/canadian-agricultural-strategic-priorities',
    intake_status: 'open',
    description: 'Provides support for projects that address national or sector-wide priorities that help industry address emerging issues and capitalize on opportunities.',
    objectives: 'Address national or sector-wide priorities; help industry respond to emerging issues and seize opportunities.',
    priority_areas: ['strategic_priorities', 'emerging_issues', 'sector_opportunities', 'trade', 'market_development'],
    eligibility_summary: 'National industry associations and eligible organizations with sector-wide impact.',
    funding_type: 'contribution',
    application_method: 'portal',
    required_documents: ['Project proposal', 'Budget', 'Partnership letters'],
    priority_lexicon: ['strategic priorities', 'emerging issues', 'market stability', 'trade disruption', 'sector resilience']
  },
  {
    program_code: 'AAFC-AGRIMARKETING',
    program_name: 'AgriMarketing Program',
    administering_agency: 'Agriculture and Agri-Food Canada (AAFC)',
    source_url: 'https://agriculture.canada.ca/en/programs/agrimarketing',
    intake_status: 'open',
    description: 'Provides support to increase and diversify exports to international markets and seize domestic market opportunities.',
    objectives: 'Support industry-led promotional activities that differentiate Canadian products and leverage Canada\'s reputation.',
    priority_areas: ['export_development', 'market_diversification', 'trade', 'brand_Canada'],
    eligibility_summary: 'Canadian agriculture and agri-food industry organizations seeking to promote Canadian products domestically and internationally.',
    funding_type: 'contribution',
    application_method: 'portal',
    required_documents: ['Marketing plan', 'Budget', 'Organization details'],
    priority_lexicon: ['market diversification', 'export development', 'trade', 'brand promotion', 'interprovincial trade']
  },
  {
    program_code: 'AAFC-FARM-DEBT',
    program_name: 'Farm Debt Mediation Service',
    administering_agency: 'Agriculture and Agri-Food Canada (AAFC)',
    source_url: 'https://agriculture.canada.ca/en/programs/farm-debt-mediation',
    intake_status: 'open',
    description: 'Provides financial counselling and mediation services to farmers in financial difficulty.',
    objectives: 'Help farmers and creditors reach mutually acceptable arrangements to resolve debt issues.',
    priority_areas: ['debt_mediation', 'financial_counselling', 'farm_viability'],
    eligibility_summary: 'Any farmer in Canada experiencing financial difficulty who wishes to reach arrangements with creditors.',
    funding_type: 'grant',
    application_method: 'portal',
    required_documents: ['Financial statements', 'Creditor information', 'Application form'],
    priority_lexicon: ['financial difficulty', 'debt mediation', 'farm viability', 'creditor arrangement']
  },
  {
    program_code: 'AAFC-APP',
    program_name: 'Advance Payments Program',
    administering_agency: 'Agriculture and Agri-Food Canada (AAFC)',
    source_url: 'https://agriculture.canada.ca/en/programs/advance-payments',
    intake_status: 'open',
    description: 'Provides low-interest cash advances on the value of eligible agricultural products.',
    objectives: 'Improve cash flow by providing producers access to low-interest cash advances that must be repaid as products are sold.',
    priority_areas: ['cash_flow', 'market_flexibility', 'producer_finance'],
    eligibility_summary: 'Canadian producers of eligible agricultural products. First $250,000 is interest-free.',
    funding_type: 'loan',
    max_funding: 1000000,
    application_method: 'lender',
    required_documents: ['Proof of eligible agricultural product', 'Production records', 'Advance application through administrator'],
    priority_lexicon: ['cash advance', 'cash flow', 'market flexibility', 'interest-free']
  },

  // ---- Bioenterprise Canada programs ----
  {
    program_code: 'BIO-OAFRI-COMM',
    program_name: 'OAFRI Commercialization Stream',
    administering_agency: 'Bioenterprise Canada / Ontario Ministry of Agriculture',
    source_url: 'https://bioenterprise.ca/programs/oafri/',
    intake_status: 'closed',
    intake_deadline: '2025-10-30',
    description: 'Funds market validation ($30K) and product development ($50K-$150K) projects for Ontario-based agri-food organizations through the Ontario Agri-Food Research Initiative.',
    objectives: 'Conduct activities that enable and support the agriculture, agri-food, and agri-based products sector through market validation and product development.',
    priority_areas: ['market_validation', 'product_development', 'commercialization', 'agri_food_innovation', 'clean_technology', 'hiring'],
    eligibility_summary: 'Ontario-based for-profit, not-for-profit, universities, colleges, and research institutions. Projects must address Ontario agriculture research priority areas.',
    eligibility_rules: {
      province: { type: 'province_list', provinces: ['ON'], question: 'Is your organization located in Ontario?', failMessage: 'Must be located in Ontario' },
      organizationType: { type: 'includes', values: ['corporation', 'cooperative', 'non_profit', 'academic'], question: 'What type of organization?', failMessage: 'Must be an eligible entity' }
    },
    funding_type: 'contribution',
    min_funding: 30000,
    max_funding: 150000,
    reimbursement_model: 'reimbursement',
    application_method: 'portal',
    application_url: 'https://agritechcentre.wufoo.com/forms/z1p1qgod1mp3dza/',
    required_documents: ['Proposal Workbook', 'Budget Workbook', 'OAFRI Intake Form'],
    priority_lexicon: ['market validation', 'product development', 'commercialization', 'agri-food innovation', 'Grow Ontario strategy', 'Sustainable CAP'],
    evidence_snippets: [
      { topic: 'Sustainable CAP funding', text: 'OAFRI is funded by the Governments of Canada and Ontario through the Sustainable Canadian Agricultural Partnership (Sustainable CAP), a five-year federal-provincial-territorial initiative.', source: 'Bioenterprise OAFRI page' }
    ],
    source_type: 'bioenterprise'
  },
  {
    program_code: 'BIO-SGAP',
    program_name: 'Sustainable Growth and Adoption Program (SGAP)',
    administering_agency: 'Bioenterprise Canada / FedDev Ontario',
    source_url: 'https://bioenterprise.ca/programs/sustainable-growth-and-adoption-program-sgap/',
    intake_status: 'open',
    intake_deadline: '2026-03-18',
    description: 'Non-repayable contributions of $40K-$100K for southern Ontario food and agri-food tech businesses to adopt clean technologies and sustainability enhancements.',
    objectives: 'Promote sustainability across value chains by de-risking adoption of clean technologies and integration of sustainable practices into operations.',
    priority_areas: ['clean_technology', 'sustainability', 'decarbonization', 'food_processing', 'agri_food_tech', 'hiring'],
    eligibility_summary: 'For-profit or not-for-profit in southern Ontario, food/agri-food tech sector, $200K+ annual revenue, able to provide 60% match of project costs.',
    eligibility_rules: {
      province: { type: 'province_list', provinces: ['ON'], question: 'Is your business located in southern Ontario?', failMessage: 'Must be in southern Ontario' },
      organizationType: { type: 'includes', values: ['corporation', 'cooperative', 'non_profit'], question: 'Are you a for-profit or not-for-profit corporation?', failMessage: 'Must be an incorporated business' }
    },
    funding_type: 'contribution',
    min_funding: 40000,
    max_funding: 100000,
    cost_share_ratio: '40:60',
    reimbursement_model: 'reimbursement',
    application_method: 'portal',
    application_url: 'https://agritechcentre.wufoo.com/forms/z1rtd13818motvz/',
    required_documents: ['Application Workbook', 'Budget Workbook', 'Sustainability Project Partner Statement of Work', 'Program Guide review'],
    priority_lexicon: ['clean technology adoption', 'sustainability enhancement', 'decarbonization', 'net zero', 'clean growth', 'green operations'],
    evidence_snippets: [
      { topic: 'Federal investment', text: 'SGAP is supported by a $5.95-million Government of Canada investment through the Federal Economic Development Agency for Southern Ontario (FedDev Ontario).', source: 'Bioenterprise SGAP page' }
    ],
    source_type: 'bioenterprise'
  },
  {
    program_code: 'BIO-GREENSHOOTS',
    program_name: 'GreenShoots',
    administering_agency: 'Bioenterprise Canada / Invest Nova Scotia',
    source_url: 'https://bioenterprise.ca/programs/greenshoots/',
    intake_status: 'closed',
    intake_deadline: '2025-02-28',
    description: 'Up to $40K in non-repayable, non-dilutive funding plus business guidance for high-potential, early-stage knowledge-based agri-tech companies in Nova Scotia.',
    objectives: 'Find and support high-potential, early-stage knowledge-based Nova Scotia companies and encourage entrepreneurial activity in the province.',
    priority_areas: ['early_stage', 'agri_tech', 'bioeconomy', 'clean_technology', 'startup_support'],
    eligibility_summary: 'Nova Scotia registered company, TRL 4+, for-profit, agri-tech or bioeconomy, <$1M cumulative sales, majority owner works full-time.',
    eligibility_rules: {
      province: { type: 'province_list', provinces: ['NS'], question: 'Is your company registered in Nova Scotia?', failMessage: 'Must be registered in or have significant presence in Nova Scotia' }
    },
    funding_type: 'grant',
    max_funding: 40000,
    application_method: 'portal',
    application_url: 'https://investns.formtitan.com/ftproject/greenshoots-application-2025',
    required_documents: ['Application Form', 'Revenue and payroll information', 'Pitch presentation (Phase 2)'],
    priority_lexicon: ['early-stage', 'knowledge-based', 'scale-up', 'export potential', 'rural economic impact', 'climate change'],
    evidence_snippets: [
      { topic: 'Multi-partner support', text: 'GreenShoots is a partnership between Invest Nova Scotia, the Greenspring Bioinnovation Hub, and Bioenterprise Canada to support early-stage agri-tech ventures.', source: 'Bioenterprise GreenShoots page' }
    ],
    source_type: 'bioenterprise'
  },

  // ---- CFIN (Canadian Food Innovation Network) programs ----
  {
    program_code: 'CFIN-OFTP',
    program_name: 'Ontario Food Technology Pilot',
    administering_agency: 'Canadian Food Innovation Network (CFIN) / FedDev Ontario',
    source_url: 'https://www.cfin-rcia.ca/funding/ontario-food-technology-pilot',
    intake_status: 'open',
    intake_deadline: '2026-02-19',
    description: 'Non-repayable funding up to $100K (50% match) for early-stage companies to pilot and demonstrate innovative food technologies in southern Ontario.',
    objectives: 'Accelerate commercialization of innovative, IP-driven food technologies through in-market pilot projects across processing, foodservice, retail, and distribution.',
    priority_areas: ['food_technology', 'pilot_projects', 'commercialization', 'food_manufacturing', 'food_safety', 'clean_technology', 'hiring'],
    eligibility_summary: 'Incorporated businesses in southern Ontario, <$5M annual revenue, food technology not yet commercialized, at TRL 6-7, CFIN member (free).',
    eligibility_rules: {
      province: { type: 'province_list', provinces: ['ON'], question: 'Is your business located in southern Ontario?', failMessage: 'Must be in southern Ontario' },
      organizationType: { type: 'includes', values: ['corporation'], question: 'Is your business incorporated?', failMessage: 'Must be an incorporated business' }
    },
    funding_type: 'contribution',
    min_funding: 10000,
    max_funding: 100000,
    cost_share_ratio: '50:50',
    reimbursement_model: 'reimbursement',
    application_method: 'portal',
    application_url: 'https://www.cfin-rcia.ca/funding/ontario-food-technology-pilot',
    required_documents: ['CFIN membership (free)', 'Application form', 'IP strategy/plan', 'Project partner identified', 'Program Guide review'],
    priority_lexicon: ['food technology pilot', 'food manufacturing', 'food waste', 'digital supply chain', 'food safety', 'traceability', 'NextGen ingredients', 'food packaging', 'cleantech'],
    evidence_snippets: [
      { topic: 'FedDev partnership', text: 'The Ontario Food Technology Pilot is delivered by CFIN and funded in part by the Government of Canada through the Federal Economic Development Agency for Southern Ontario (FedDev Ontario).', source: 'CFIN OFTP page' }
    ],
    source_type: 'cfin'
  },
  {
    program_code: 'CFIN-ISF',
    program_name: 'Innovation Scouting Fund',
    administering_agency: 'Canadian Food Innovation Network (CFIN)',
    source_url: 'https://www.cfin-rcia.ca/funding/innovation-scouting-fund',
    intake_status: 'open',
    intake_deadline: '2026-03-26',
    description: 'Up to $75K to support 12-month pilot collaborations between food tech innovators and leading Canadian food companies to test and validate solutions.',
    objectives: 'Directly address real-world business challenges identified by leading Canadian food companies through funded pilot projects with innovative SMEs.',
    priority_areas: ['food_innovation', 'processing', 'preservation', 'smart_manufacturing', 'packaging', 'pilot_projects', 'hiring'],
    eligibility_summary: 'Canadian SMEs with at least 1 year of incorporation, or academic researchers. Technology must be at TRL 3+ and align with call priorities.',
    eligibility_rules: {
      organizationType: { type: 'includes', values: ['corporation', 'cooperative', 'academic'], question: 'Are you an incorporated Canadian SME or academic?', failMessage: 'Must be Canadian SME (1+ year) or academic researcher' }
    },
    funding_type: 'contribution',
    max_funding: 75000,
    application_method: 'portal',
    application_url: 'https://www.cfin-rcia.ca/funding/innovation-scouting-fund',
    required_documents: ['CFIN membership (free)', 'Proposed solution outline', 'TRL evidence', 'Program Guide review', 'Call Details alignment'],
    priority_lexicon: ['innovation scouting', 'pilot project', 'food processing', 'preservation', 'smart manufacturing', 'AI quality', 'active packaging'],
    evidence_snippets: [
      { topic: 'Industry-matched funding', text: 'Each Innovation Scouting Fund call is sponsored by a potential technology adopter (food manufacturer, distributor, retailer) who collaborates directly with the winning innovator.', source: 'CFIN ISF page' }
    ],
    source_type: 'cfin'
  },
  {
    program_code: 'CFIN-UNPUZZLING',
    program_name: 'Unpuzzling: Foodtech Ontario',
    administering_agency: 'Canadian Food Innovation Network (CFIN) / FedDev Ontario',
    source_url: 'https://www.cfin-rcia.ca/unpuzzling-foodtech-ontario',
    intake_status: 'upcoming',
    intake_opens: '2026-02-26',
    intake_deadline: '2026-04-02',
    description: '12-week mentorship and peer cohort ($750) for up to 12 early-stage foodtech entrepreneurs in southern Ontario — expert sessions, mentorship, investor connections, and IP consulting.',
    objectives: 'Support early-stage foodtech entrepreneurs as they prepare to scale and commercialize their innovations through mentorship, peer learning, and industry connections.',
    priority_areas: ['mentorship', 'commercialization', 'food_technology', 'startup_acceleration', 'IP_strategy'],
    eligibility_summary: 'Incorporated Canadian businesses in southern Ontario, post-farmgate food innovation space, CFIN member (free). $750 program fee.',
    eligibility_rules: {
      province: { type: 'province_list', provinces: ['ON'], question: 'Is your business in southern Ontario?', failMessage: 'Must operate in southern Ontario' },
      organizationType: { type: 'includes', values: ['corporation', 'cooperative'], question: 'Is your business incorporated?', failMessage: 'Must be an incorporated Canadian business' }
    },
    funding_type: 'grant',
    application_method: 'portal',
    application_url: 'https://www.surveymonkey.com/r/unpuzzling-foodtech-ontario',
    required_documents: ['Application form', 'CFIN membership (free)'],
    priority_lexicon: ['mentorship', 'peer cohort', 'IP strategy', 'investor readiness', 'food commercialization', 'startup scaling', 'market entry'],
    evidence_snippets: [
      { topic: 'FedDev partnership', text: 'Unpuzzling: Foodtech Ontario is a collaborative initiative led by CFIN and funded in part by the Government of Canada through FedDev Ontario, created to turn early-stage food innovation into market-ready solutions.', source: 'CFIN Unpuzzling page' }
    ],
    source_type: 'cfin'
  },
  {
    program_code: 'AAFC-AGRIINNOVATE',
    program_name: 'AgriInnovate Program',
    administering_agency: 'Agriculture and Agri-Food Canada (AAFC)',
    source_url: 'https://agriculture.canada.ca/en/programs/agriinnovate-program',
    intake_status: 'open',
    description: 'Provides repayable contributions to support commercialization and demonstration of innovative products, technologies, and processes in the agriculture and agri-food sector.',
    objectives: 'Accelerate commercialization and adoption of innovation with sector-wide benefits.',
    priority_areas: ['commercialization', 'innovation', 'agri_food_tech', 'clean_technology'],
    eligibility_summary: 'Canadian agri-food businesses and other eligible organizations with commercialization-ready innovations.',
    eligibility_rules: {
      organizationType: { type: 'includes', values: ['corporation', 'cooperative'], question: 'Are you a Canadian incorporated organization?', failMessage: 'Must be an eligible incorporated organization' }
    },
    funding_type: 'repayable_contribution',
    max_funding: 5000000,
    application_method: 'portal',
    required_documents: ['Project proposal', 'Commercialization plan', 'Financial projections', 'Budget and cash flow plan'],
    priority_lexicon: ['commercialization', 'demonstration', 'adoption', 'innovation scale-up'],
    evidence_snippets: [
      { topic: 'Commercialization support', text: 'AgriInnovate supports commercialization, demonstration, and adoption of innovative products and technologies in agri-food.', source: 'AAFC AgriInnovate program page' }
    ],
    source_type: 'aafc_catalogue'
  },
  {
    program_code: 'NRC-IRAP',
    program_name: 'NRC Industrial Research Assistance Program (IRAP)',
    administering_agency: 'National Research Council of Canada (NRC)',
    source_url: 'https://nrc.canada.ca/en/support-technology-innovation/industrial-research-assistance-program',
    intake_status: 'open',
    description: 'Provides advisory services and innovation funding to help SMEs develop and commercialize technologies.',
    objectives: 'Support technology innovation and business growth through R&D and commercialization support.',
    priority_areas: ['research_and_development', 'innovation', 'commercialization', 'SME_growth'],
    eligibility_summary: 'Incorporated, profit-oriented SMEs in Canada with technology innovation projects.',
    eligibility_rules: {
      organizationType: { type: 'includes', values: ['corporation'], question: 'Are you an incorporated Canadian SME?', failMessage: 'Must be an incorporated Canadian SME' }
    },
    funding_type: 'contribution',
    application_method: 'advisor_intake',
    required_documents: ['Innovation project summary', 'Business profile', 'R&D workplan', 'Financial details'],
    priority_lexicon: ['R&D', 'innovation', 'technology development', 'SME', 'commercial potential'],
    evidence_snippets: [
      { topic: 'SME innovation', text: 'IRAP helps innovative SMEs develop and commercialize technologies through advisory services and funding support.', source: 'NRC IRAP program page' }
    ],
    source_type: 'manual'
  },
  {
    program_code: 'CSBFP-LOAN',
    program_name: 'Canada Small Business Financing Program',
    administering_agency: 'Innovation, Science and Economic Development Canada (ISED)',
    source_url: 'https://ised-isde.canada.ca/site/canada-small-business-financing-program/en',
    intake_status: 'open',
    description: 'Facilitates access to financing by sharing risk with lenders on eligible small business loans.',
    objectives: 'Improve access to financing for small businesses purchasing or improving assets and property.',
    priority_areas: ['business_financing', 'loan_guarantee', 'capital_investment'],
    eligibility_summary: 'Small businesses in Canada seeking financing through participating financial institutions.',
    eligibility_rules: {
      organizationType: { type: 'includes', values: ['corporation', 'sole_proprietor', 'partnership', 'cooperative'], question: 'Are you an eligible Canadian small business?', failMessage: 'Must be an eligible Canadian small business entity' }
    },
    funding_type: 'loan',
    max_funding: 1000000,
    application_method: 'lender',
    required_documents: ['Business plan', 'Financial statements', 'Asset purchase details', 'Lender application materials'],
    priority_lexicon: ['small business loan', 'loan guarantee', 'asset financing', 'growth financing'],
    evidence_snippets: [
      { topic: 'Lender risk-sharing', text: 'The program helps small businesses access financing by sharing loan default risk with lenders.', source: 'CSBFP program page' }
    ],
    source_type: 'manual'
  },
  {
    program_code: 'FCC-AG-LENDING',
    program_name: 'Farm Credit Canada Lending',
    administering_agency: 'Farm Credit Canada',
    source_url: 'https://www.fcc-fac.ca/en/financing',
    intake_status: 'open',
    description: 'Offers financing products for farm operations, equipment, land, and agri-food businesses.',
    objectives: 'Support growth and resilience of Canadian agriculture and agri-food operations through tailored financing.',
    priority_areas: ['ag_financing', 'equipment', 'working_capital', 'expansion'],
    eligibility_summary: 'Canadian farms and agri-food businesses that meet FCC lending requirements.',
    funding_type: 'loan',
    application_method: 'lender',
    required_documents: ['Business financials', 'Loan purpose details', 'Cash flow projections'],
    priority_lexicon: ['farm financing', 'agri-business lending', 'capital investment', 'operating loan'],
    evidence_snippets: [
      { topic: 'Agriculture-focused lending', text: 'FCC offers financing solutions tailored to Canadian agriculture and food businesses.', source: 'FCC financing page' }
    ],
    source_type: 'manual'
  },
  {
    program_code: 'ON-GROW-MARKET',
    program_name: 'Grow Ontario Market Initiative',
    administering_agency: 'Government of Ontario',
    source_url: 'https://www.ontario.ca/page/grow-ontario-market-initiative',
    intake_status: 'open',
    description: 'Supports Ontario agri-food businesses and organizations with market development projects.',
    objectives: 'Advance domestic and export market opportunities for Ontario agri-food products.',
    priority_areas: ['market_development', 'ontario_agri_food', 'promotion', 'trade'],
    eligibility_summary: 'Ontario-based agri-food businesses and organizations with eligible market projects.',
    eligibility_rules: {
      province: { type: 'province_list', provinces: ['ON'], question: 'Is your organization based in Ontario?', failMessage: 'Must be based in Ontario' }
    },
    funding_type: 'contribution',
    max_funding: 120000,
    application_method: 'portal',
    required_documents: ['Project workplan', 'Budget', 'Market objectives', 'Organization details'],
    priority_lexicon: ['market initiative', 'Ontario products', 'market access', 'promotion'],
    evidence_snippets: [
      { topic: 'Ontario market development', text: 'The initiative supports projects that build market opportunities for Ontario’s agri-food sector.', source: 'Ontario GOMI page' }
    ],
    source_type: 'manual'
  },
  {
    program_code: 'BDC-SUSTAINABILITY',
    program_name: 'BDC Sustainability Financing',
    administering_agency: 'Business Development Bank of Canada (BDC)',
    source_url: 'https://www.bdc.ca/en/financing/sustainability',
    intake_status: 'open',
    description: 'Financing options for projects that improve sustainability and business resilience.',
    objectives: 'Help businesses invest in sustainability initiatives and operational improvements.',
    priority_areas: ['sustainability', 'clean_technology', 'business_resilience'],
    eligibility_summary: 'Canadian businesses with projects aligned to BDC sustainability financing criteria.',
    funding_type: 'loan',
    application_method: 'lender',
    required_documents: ['Business plan', 'Project plan', 'Financial statements'],
    priority_lexicon: ['sustainability', 'financing', 'clean transition', 'efficiency'],
    evidence_snippets: [
      { topic: 'Sustainable growth', text: 'BDC provides financing solutions to support sustainability projects and long-term competitiveness.', source: 'BDC sustainability financing page' }
    ],
    source_type: 'manual'
  },
  {
    program_code: 'SDTC-SEED',
    program_name: 'Sustainable Development Technology Canada Seed Funding',
    administering_agency: 'Sustainable Development Technology Canada (SDTC)',
    source_url: 'https://www.sdtc.ca/en/funding/',
    intake_status: 'open',
    description: 'Supports early-stage clean technology ventures in building investment and commercialization readiness.',
    objectives: 'Advance clean technology ventures toward scale and market deployment.',
    priority_areas: ['clean_technology', 'venture_growth', 'commercialization', 'climate_solution'],
    eligibility_summary: 'Canadian companies developing clean technology solutions and seeking scale readiness support.',
    funding_type: 'contribution',
    application_method: 'portal',
    required_documents: ['Pitch deck', 'Technology overview', 'Commercialization plan', 'Financial profile'],
    priority_lexicon: ['clean tech', 'seed funding', 'scale-up', 'commercial readiness'],
    evidence_snippets: [
      { topic: 'Clean technology support', text: 'SDTC supports Canadian clean technology companies through staged funding programs.', source: 'SDTC funding page' }
    ],
    source_type: 'manual'
  },
  {
    program_code: 'GMF-GREEN-MUNICIPAL',
    program_name: 'Green Municipal Fund',
    administering_agency: 'Federation of Canadian Municipalities (FCM)',
    source_url: 'https://greenmunicipalfund.ca/',
    intake_status: 'open',
    description: 'Funding and financing for municipal sustainability and climate projects across Canada.',
    objectives: 'Support municipal projects that improve environmental outcomes and climate resilience.',
    priority_areas: ['municipal_sustainability', 'climate_action', 'infrastructure', 'food_systems'],
    eligibility_summary: 'Municipal governments and eligible municipal partners in Canada.',
    funding_type: 'grant_or_loan',
    max_funding: 10000000,
    application_method: 'portal',
    required_documents: ['Project proposal', 'Municipal endorsements', 'Budget and implementation plan'],
    priority_lexicon: ['municipal fund', 'climate resilience', 'sustainability projects', 'green infrastructure'],
    evidence_snippets: [
      { topic: 'Municipal climate projects', text: 'GMF supports Canadian municipal projects with environmental, economic, and social benefits.', source: 'FCM Green Municipal Fund site' }
    ],
    source_type: 'manual'
  },
  {
    program_code: 'TD-FOEF',
    program_name: 'TD Friends of the Environment Foundation Grants',
    administering_agency: 'TD Friends of the Environment Foundation',
    source_url: 'https://www.td.com/ca/en/about-td/ready-commitment/fes-grants',
    intake_status: 'open',
    description: 'Community environmental funding supporting local projects with measurable impact.',
    objectives: 'Fund grassroots environmental initiatives with community benefit.',
    priority_areas: ['community_environment', 'education', 'sustainability', 'food_systems'],
    eligibility_summary: 'Canadian charities and non-profits with eligible local environmental projects.',
    eligibility_rules: {
      organizationType: { type: 'includes', values: ['non_profit'], question: 'Are you a registered charity or non-profit?', failMessage: 'Must be an eligible non-profit organization' }
    },
    funding_type: 'grant',
    min_funding: 2000,
    max_funding: 8000,
    application_method: 'portal',
    required_documents: ['Project description', 'Budget', 'Organization details'],
    priority_lexicon: ['environmental grant', 'community project', 'local sustainability'],
    evidence_snippets: [
      { topic: 'Community impact funding', text: 'TD FEF supports local environmental initiatives through grants to eligible organizations.', source: 'TD FEF grants page' }
    ],
    source_type: 'manual'
  },
  {
    program_code: 'TELUS-FFF',
    program_name: 'TELUS Friendly Future Foundation Grants',
    administering_agency: 'TELUS Friendly Future Foundation',
    source_url: 'https://friendlyfuture.com/foundation',
    intake_status: 'open',
    description: 'Community and youth-focused grants supporting projects with measurable social impact.',
    objectives: 'Enable community organizations to deliver impactful local projects.',
    priority_areas: ['community_support', 'youth', 'food_security', 'social_impact'],
    eligibility_summary: 'Eligible Canadian charities and non-profit organizations.',
    eligibility_rules: {
      organizationType: { type: 'includes', values: ['non_profit'], question: 'Are you an eligible charity/non-profit?', failMessage: 'Must be an eligible charity or non-profit' }
    },
    funding_type: 'grant',
    min_funding: 10000,
    max_funding: 20000,
    application_method: 'portal',
    required_documents: ['Project proposal', 'Impact metrics', 'Budget'],
    priority_lexicon: ['community grant', 'friendly future', 'social impact'],
    evidence_snippets: [
      { topic: 'Community funding', text: 'TELUS Friendly Future Foundation provides grants to community organizations delivering measurable impact.', source: 'TELUS Friendly Future Foundation page' }
    ],
    source_type: 'manual'
  },
  {
    program_code: 'RALP-ON',
    program_name: 'Resilient Agricultural Landscape Program',
    administering_agency: 'Government of Canada / Provincial Delivery Partners',
    source_url: 'https://agriculture.canada.ca/en/programs/sustainable-cap',
    intake_status: 'open',
    description: 'Supports farming practices that improve environmental resilience and ecological outcomes.',
    objectives: 'Incentivize adoption of resilient agricultural practices and long-term environmental stewardship.',
    priority_areas: ['climate_resilience', 'landscape_health', 'sustainable_practices', 'soil_health'],
    eligibility_summary: 'Canadian producers and farm operators meeting provincial intake requirements.',
    funding_type: 'contribution',
    application_method: 'provincial',
    required_documents: ['Farm details', 'Practice adoption plan', 'Supporting records'],
    priority_lexicon: ['resilient landscape', 'sustainable cap', 'agri-environment'],
    evidence_snippets: [
      { topic: 'Resilience outcomes', text: 'The program supports adoption of practices that contribute to resilient agricultural landscapes and environmental outcomes.', source: 'Sustainable CAP overview' }
    ],
    source_type: 'manual'
  },
  {
    program_code: 'RBC-AG-LENDING',
    program_name: 'RBC Agriculture Financing',
    administering_agency: 'Royal Bank of Canada (RBC)',
    source_url: 'https://www.rbcroyalbank.com/business/agriculture/',
    intake_status: 'open',
    description: 'Agriculture-focused financing products for farm operations and agri-business growth.',
    objectives: 'Provide lending options aligned with farm and agri-business investment needs.',
    priority_areas: ['ag_financing', 'equipment', 'working_capital', 'expansion'],
    eligibility_summary: 'Canadian farm and agri-business borrowers meeting lender requirements.',
    funding_type: 'loan',
    application_method: 'lender',
    required_documents: ['Financial statements', 'Use of funds summary', 'Cash flow plan'],
    priority_lexicon: ['agriculture lending', 'farm finance', 'business growth'],
    evidence_snippets: [
      { topic: 'Farm lending support', text: 'RBC offers financing solutions tailored to agricultural producers and agri-businesses.', source: 'RBC agriculture page' }
    ],
    source_type: 'manual'
  },
  {
    program_code: 'SCOTIA-AG-LENDING',
    program_name: 'Scotiabank Agriculture Financing',
    administering_agency: 'Scotiabank',
    source_url: 'https://www.scotiabank.com/ca/en/small-business/industries/agriculture.html',
    intake_status: 'open',
    description: 'Financing services for Canadian agriculture producers and agribusiness operators.',
    objectives: 'Support farm and agri-business investment, liquidity, and growth through financing tools.',
    priority_areas: ['ag_financing', 'working_capital', 'equipment', 'growth'],
    eligibility_summary: 'Canadian farms and agri-businesses meeting lender criteria.',
    funding_type: 'loan',
    application_method: 'lender',
    required_documents: ['Business profile', 'Financial records', 'Project financing details'],
    priority_lexicon: ['agriculture banking', 'farm lending', 'agri-business financing'],
    evidence_snippets: [
      { topic: 'Agri-business financing', text: 'Scotiabank provides financing options for agriculture and agribusiness clients.', source: 'Scotiabank agriculture page' }
    ],
    source_type: 'manual'
  },
  {
    program_code: 'USDA-UAIP',
    program_name: 'USDA Urban Agriculture and Innovative Production Grants',
    administering_agency: 'United States Department of Agriculture (USDA)',
    source_url: 'https://www.usda.gov/urban',
    intake_status: 'open',
    description: 'Competitive grants supporting urban agriculture and innovative production projects in the United States.',
    objectives: 'Expand urban agriculture capacity, innovation, and community access to fresh food.',
    priority_areas: ['urban_agriculture', 'innovation', 'community_food', 'infrastructure'],
    eligibility_summary: 'Eligible U.S. organizations including non-profits, local governments, and producer groups.',
    funding_type: 'grant',
    max_funding: 500000,
    application_method: 'portal',
    required_documents: ['Application narrative', 'Budget', 'Project workplan'],
    priority_lexicon: ['urban agriculture', 'innovative production', 'USDA grant'],
    evidence_snippets: [
      { topic: 'Urban agriculture support', text: 'USDA provides urban agriculture and innovative production grants to strengthen local food systems.', source: 'USDA urban programs page' }
    ],
    source_type: 'manual'
  },
  {
    program_code: 'USDA-SCBGP',
    program_name: 'USDA Specialty Crop Block Grant Program',
    administering_agency: 'United States Department of Agriculture (USDA)',
    source_url: 'https://www.ams.usda.gov/services/grants/scbgp',
    intake_status: 'open',
    description: 'Block grants supporting projects that enhance competitiveness of specialty crops.',
    objectives: 'Advance market opportunities and competitiveness for specialty crop sectors.',
    priority_areas: ['specialty_crops', 'market_development', 'innovation', 'supply_chain'],
    eligibility_summary: 'U.S.-based applicants eligible under state department of agriculture administered intakes.',
    funding_type: 'grant',
    application_method: 'state_admin',
    required_documents: ['Project proposal', 'Budget', 'State intake forms'],
    priority_lexicon: ['specialty crops', 'USDA grants', 'crop competitiveness'],
    evidence_snippets: [
      { topic: 'Specialty crop competitiveness', text: 'SCBGP supports projects that enhance the competitiveness of specialty crops.', source: 'USDA AMS SCBGP page' }
    ],
    source_type: 'manual'
  },
  {
    program_code: 'USDA-LAMP',
    program_name: 'USDA Local Agriculture Market Program',
    administering_agency: 'United States Department of Agriculture (USDA)',
    source_url: 'https://www.ams.usda.gov/services/grants/lamp',
    intake_status: 'open',
    description: 'Supports local and regional food systems through market development and infrastructure projects.',
    objectives: 'Strengthen local and regional supply chains and market opportunities for agricultural producers.',
    priority_areas: ['local_food_systems', 'market_infrastructure', 'supply_chain', 'producer_access'],
    eligibility_summary: 'U.S. entities eligible under USDA AMS program requirements.',
    funding_type: 'grant',
    application_method: 'portal',
    required_documents: ['Project narrative', 'Budget', 'Implementation and outcomes plan'],
    priority_lexicon: ['local agriculture market', 'regional food systems', 'USDA market grant'],
    evidence_snippets: [
      { topic: 'Local market support', text: 'LAMP supports local and regional food systems by improving market opportunities and infrastructure.', source: 'USDA AMS LAMP page' }
    ],
    source_type: 'manual'
  },
  {
    program_code: 'US-AGFIRST-FCB',
    program_name: 'Agfirst Farm Credit Bank',
    administering_agency: 'Agfirst Farm Credit Bank',
    source_url: 'https://www.agfirst.com/',
    intake_status: 'open',
    description: 'Agricultural lending products for U.S. farm operations through the Farm Credit network.',
    objectives: 'Support farm working capital, equipment, and land financing needs.',
    priority_areas: ['ag_financing', 'farm_growth'],
    eligibility_summary: 'U.S. farm businesses meeting lender and Farm Credit eligibility criteria.',
    funding_type: 'loan',
    application_method: 'lender',
    required_documents: ['Financial statements', 'Business/farm plan'],
    priority_lexicon: ['farm credit', 'ag lending'],
    source_type: 'manual'
  },
  {
    program_code: 'AAFC-AGRISCIENCE',
    program_name: 'AgriScience Program',
    administering_agency: 'Government of Canada',
    source_url: 'https://agriculture.canada.ca/en/programs/agriscience',
    intake_status: 'open',
    description: 'Federal support for agriculture and agri-food research and innovation projects.',
    objectives: 'Advance sector competitiveness through collaborative research and innovation.',
    priority_areas: ['research', 'innovation'],
    eligibility_summary: 'Eligible organizations under federal AgriScience intake terms.',
    funding_type: 'contribution',
    max_funding: 5000000,
    application_method: 'portal',
    required_documents: ['Research proposal', 'Budget', 'Supporting documentation'],
    priority_lexicon: ['agriscience', 'research funding'],
    source_type: 'manual'
  },
  {
    program_code: 'US-AGRIBANK-FCB',
    program_name: 'Agribank Farm Credit Bank',
    administering_agency: 'Agribank Farm Credit Bank',
    source_url: 'https://www.agribank.com/',
    intake_status: 'open',
    description: 'Farm Credit lending support for agricultural producers and rural borrowers in the U.S.',
    objectives: 'Provide agriculture-focused financing for farm and rural business needs.',
    priority_areas: ['ag_financing', 'rural_development'],
    eligibility_summary: 'U.S. farm and rural borrowers eligible through Farm Credit associations.',
    funding_type: 'loan',
    application_method: 'lender',
    required_documents: ['Financial statements', 'Loan request details'],
    priority_lexicon: ['agribank', 'farm credit'],
    source_type: 'manual'
  },
  {
    program_code: 'US-SBA-SEED',
    program_name: "America's Seed Fund",
    administering_agency: 'Small Business Administration',
    source_url: 'https://www.sbir.gov/',
    intake_status: 'open',
    description: 'SBIR/STTR funding for high-impact innovation and early-stage commercialization.',
    objectives: 'Support small business R&D and commercialization pathways.',
    priority_areas: ['innovation', 'r_and_d'],
    eligibility_summary: 'U.S. small businesses eligible under SBIR/STTR criteria.',
    funding_type: 'grant',
    application_method: 'portal',
    required_documents: ['Proposal', 'Technical narrative', 'Budget'],
    priority_lexicon: ['sbir', 'seed fund'],
    source_type: 'manual'
  },
  {
    program_code: 'CA-FCC',
    program_name: 'Farm Credit Canada',
    administering_agency: 'Farm Credit Canada',
    source_url: 'https://www.fcc-fac.ca/',
    intake_status: 'open',
    description: 'Canadian lender providing financing and advisory services to agriculture and food businesses.',
    objectives: 'Support farm and agri-business investment and expansion.',
    priority_areas: ['ag_financing', 'business_growth'],
    eligibility_summary: 'Canadian agriculture and food businesses meeting lender criteria.',
    funding_type: 'loan',
    application_method: 'lender',
    required_documents: ['Business profile', 'Financial statements'],
    priority_lexicon: ['farm credit canada', 'ag lending'],
    source_type: 'manual'
  },
  {
    program_code: 'US-SARE-FARM-GRANTS',
    program_name: 'Farm Grants',
    administering_agency: 'Sustainable Agriculture Research & Education',
    source_url: 'https://www.sare.org/grants/',
    intake_status: 'open',
    description: 'Various SARE grant opportunities supporting sustainable agriculture projects.',
    objectives: 'Fund producer-led sustainability and innovation initiatives.',
    priority_areas: ['sustainability', 'research'],
    eligibility_summary: 'U.S. applicants eligible per SARE grant call requirements.',
    funding_type: 'grant',
    application_method: 'portal',
    required_documents: ['Grant application package'],
    priority_lexicon: ['sare', 'farm grants'],
    source_type: 'manual'
  },
  {
    program_code: 'US-USDA-FARM-LOANS',
    program_name: 'Farm Loan Programs',
    administering_agency: 'USDA',
    source_url: 'https://www.fsa.usda.gov/programs-and-services/farm-loan-programs/index',
    intake_status: 'open',
    description: 'USDA loan programs for farm ownership, operations, and emergency needs.',
    objectives: 'Expand access to agricultural credit for U.S. farmers and ranchers.',
    priority_areas: ['ag_financing', 'farm_operations'],
    eligibility_summary: 'U.S. farmers eligible under USDA Farm Service Agency criteria.',
    funding_type: 'loan',
    application_method: 'lender',
    required_documents: ['Loan application', 'Financial and farm records'],
    priority_lexicon: ['usda loan', 'farm service agency'],
    source_type: 'manual'
  },
  {
    program_code: 'NA-CLIMATEWORKS-FOOD',
    program_name: 'Food & Agriculture Grants',
    administering_agency: 'Climate Works Foundation',
    source_url: 'https://www.climateworks.org/',
    intake_status: 'open',
    description: 'Grantmaking support focused on climate and food/agriculture impact.',
    objectives: 'Advance climate-positive food and agriculture solutions.',
    priority_areas: ['climate_action', 'food_systems'],
    eligibility_summary: 'Organizations meeting funder-specific eligibility and intake terms.',
    funding_type: 'grant',
    application_method: 'portal',
    required_documents: ['Proposal and impact plan'],
    priority_lexicon: ['food grants', 'climate foundation'],
    source_type: 'manual'
  },
  {
    program_code: 'US-WF-FOOD-AGRIBIZ',
    program_name: 'Food and Agribusiness',
    administering_agency: 'Wells Fargo',
    source_url: 'https://www.wellsfargo.com/com/food-agribusiness/',
    intake_status: 'open',
    description: 'Financial services and lending for food and agribusiness operators.',
    objectives: 'Support capital and banking needs across the agribusiness value chain.',
    priority_areas: ['ag_financing', 'agribusiness'],
    eligibility_summary: 'Businesses eligible under commercial banking lending requirements.',
    funding_type: 'loan',
    application_method: 'lender',
    required_documents: ['Business financials', 'Financing request'],
    priority_lexicon: ['agribusiness financing', 'food business banking'],
    source_type: 'manual'
  },
  {
    program_code: 'CA-BDC-GENERAL',
    program_name: 'General Funding',
    administering_agency: 'Business Development Canada',
    source_url: 'https://www.bdc.ca/',
    intake_status: 'open',
    description: 'General business funding and financing support for eligible Canadian SMEs.',
    objectives: 'Improve access to capital for startup and growth-stage businesses.',
    priority_areas: ['sme_financing', 'business_growth'],
    eligibility_summary: 'Canadian businesses meeting BDC financing criteria.',
    funding_type: 'loan',
    application_method: 'lender',
    required_documents: ['Business profile', 'Financial statements'],
    priority_lexicon: ['bdc funding', 'business financing'],
    source_type: 'manual'
  },
  {
    program_code: 'US-ANNENBERG-GRANTMAKING',
    program_name: 'Grantmaking',
    administering_agency: 'Anneberg Foundation',
    source_url: 'https://annenberg.org/',
    intake_status: 'open',
    description: 'Foundation grantmaking support for eligible mission-aligned initiatives.',
    objectives: 'Fund high-impact projects that align with foundation priorities.',
    priority_areas: ['philanthropy', 'community_impact'],
    eligibility_summary: 'Eligible organizations and projects per foundation guidelines.',
    funding_type: 'grant',
    application_method: 'portal',
    required_documents: ['Proposal', 'Budget', 'Organization details'],
    priority_lexicon: ['grantmaking', 'foundation funding'],
    source_type: 'manual'
  },
  {
    program_code: 'CA-ON-GOMI',
    program_name: 'Grow Ontario Market Initiative Guidelines',
    administering_agency: 'Ontario Government',
    source_url: 'https://www.ontario.ca/',
    intake_status: 'open',
    description: 'Ontario program support for market initiatives in agriculture and food sectors.',
    objectives: 'Support market development and value-chain expansion in Ontario.',
    priority_areas: ['market_development', 'ontario_agri_food'],
    eligibility_summary: 'Ontario-based applicants meeting intake guideline requirements.',
    funding_type: 'contribution',
    max_funding: 120000,
    application_method: 'portal',
    required_documents: ['Application form', 'Project plan', 'Budget'],
    priority_lexicon: ['grow ontario', 'market initiative'],
    source_type: 'manual'
  },
  {
    program_code: 'US-HARVEST-RETURNS',
    program_name: 'Harvest Returns',
    administering_agency: 'Harvest Returns',
    source_url: 'https://www.harvestreturns.com/',
    intake_status: 'open',
    description: 'Agriculture-focused investment marketplace and capital access options.',
    objectives: 'Connect agricultural ventures with project-based investment capital.',
    priority_areas: ['investment', 'ag_finance'],
    eligibility_summary: 'Projects and issuers meeting platform listing and compliance requirements.',
    funding_type: 'investment',
    application_method: 'portal',
    required_documents: ['Project profile', 'Financial projections'],
    priority_lexicon: ['harvest returns', 'ag investment'],
    source_type: 'manual'
  },
  {
    program_code: 'CA-NRC-IRAP',
    program_name: 'NRC IRAP',
    administering_agency: 'Government of Canada',
    source_url: 'https://nrc.canada.ca/en/support-technology-innovation/nrc-irap',
    intake_status: 'open',
    description: 'Innovation assistance for Canadian SMEs through advisory and project support.',
    objectives: 'Accelerate SME technology innovation, commercialization, and growth.',
    priority_areas: ['innovation', 'r_and_d', 'commercialization'],
    eligibility_summary: 'Canadian SMEs with innovation projects aligned to IRAP criteria.',
    funding_type: 'contribution',
    application_method: 'portal',
    required_documents: ['Project summary', 'Budget', 'Company profile'],
    priority_lexicon: ['nrc irap', 'innovation assistance'],
    source_type: 'manual'
  },
  {
    program_code: 'CA-JGI-ROOTS-SHOOTS',
    program_name: 'Roots & Shoots',
    administering_agency: 'Jane Goddall Institute Canada',
    source_url: 'https://janegoodall.ca/roots-and-shoots/',
    intake_status: 'open',
    description: 'Small grants supporting youth-led and community environmental action projects.',
    objectives: 'Enable local environmental and community impact initiatives.',
    priority_areas: ['community_environment', 'youth', 'education'],
    eligibility_summary: 'Eligible groups and organizations per program guidelines.',
    funding_type: 'grant',
    min_funding: 500,
    max_funding: 1000,
    application_method: 'portal',
    required_documents: ['Project proposal', 'Budget'],
    priority_lexicon: ['roots and shoots', 'community grants'],
    source_type: 'manual'
  },
  {
    program_code: 'CA-RBC-AG-LENDING-ALT',
    program_name: 'Royal Bank of Canada (RBC) Agriculture Lending',
    administering_agency: 'RBC',
    source_url: 'https://www.rbcroyalbank.com/business/agriculture/',
    intake_status: 'open',
    description: 'Agricultural lending options from RBC for Canadian farm and agri-business clients.',
    objectives: 'Provide farm-focused financing for growth and operations.',
    priority_areas: ['ag_financing', 'farm_growth'],
    eligibility_summary: 'Canadian businesses meeting RBC lending criteria.',
    funding_type: 'loan',
    application_method: 'lender',
    required_documents: ['Financial statements', 'Business plan'],
    priority_lexicon: ['rbc agriculture lending'],
    source_type: 'manual'
  },
  {
    program_code: 'CA-SCOTIA-AG-ALT',
    program_name: 'Scotiabank Agriculture',
    administering_agency: 'Scotiabank',
    source_url: 'https://www.scotiabank.com/ca/en/small-business/industries/agriculture.html',
    intake_status: 'open',
    description: 'Agriculture banking and lending products for Canadian farm businesses.',
    objectives: 'Support financing needs for agricultural operations and investment.',
    priority_areas: ['ag_financing', 'ag_banking'],
    eligibility_summary: 'Applicants meeting Scotiabank agriculture financing requirements.',
    funding_type: 'loan',
    application_method: 'lender',
    required_documents: ['Business financials', 'Financing request'],
    priority_lexicon: ['scotiabank agriculture'],
    source_type: 'manual'
  },
  {
    program_code: 'CA-SDTC-SEED',
    program_name: 'Seed Funding',
    administering_agency: 'Sustainable Development Technology Canada',
    source_url: 'https://www.sdtc.ca/',
    intake_status: 'open',
    description: 'Early-stage funding support for cleantech ventures and innovation.',
    objectives: 'Advance commercialization of sustainable technology solutions.',
    priority_areas: ['cleantech', 'innovation'],
    eligibility_summary: 'Eligible Canadian companies under SDTC requirements.',
    funding_type: 'contribution',
    application_method: 'portal',
    required_documents: ['Project proposal', 'Commercialization plan', 'Budget'],
    priority_lexicon: ['seed funding', 'sdtc'],
    source_type: 'manual'
  },
  {
    program_code: 'US-CHS-SEED-GRANT',
    program_name: 'Seed Grant Program',
    administering_agency: 'Community Heart & Soul',
    source_url: 'https://www.communityheartandsoul.org/',
    intake_status: 'open',
    description: 'Seed grants to launch community-led planning and impact initiatives.',
    objectives: 'Enable early-stage community projects with catalytic funding.',
    priority_areas: ['community_development', 'planning'],
    eligibility_summary: 'Eligible U.S. community organizations under program terms.',
    funding_type: 'grant',
    max_funding: 10000,
    application_method: 'portal',
    required_documents: ['Application package', 'Project scope'],
    priority_lexicon: ['seed grant', 'community heart and soul'],
    source_type: 'manual'
  },
  {
    program_code: 'US-USDA-SFMNP',
    program_name: 'Seniors Farmers Market Nutrition Program',
    administering_agency: 'USDA',
    source_url: 'https://www.fns.usda.gov/sfmnp/senior-farmers-market-nutrition-program',
    intake_status: 'open',
    description: 'Nutrition support connecting eligible seniors with locally grown produce.',
    objectives: 'Improve access to fresh foods while supporting local producers.',
    priority_areas: ['nutrition', 'local_food_systems'],
    eligibility_summary: 'Program participants and administering entities as defined by USDA/FNS.',
    funding_type: 'grant',
    application_method: 'state_admin',
    required_documents: ['State or administering agency forms'],
    priority_lexicon: ['sfmnp', 'farmers market nutrition'],
    source_type: 'manual'
  },
  {
    program_code: 'CA-SDTC-SCALEUP',
    program_name: 'Start-Up/Scale-Up Funding',
    administering_agency: 'Sustainable Development Technology Canada',
    source_url: 'https://www.sdtc.ca/',
    intake_status: 'open',
    description: 'Funding pathways for startup and scale-up stages in sustainable technology sectors.',
    objectives: 'Support growth-stage companies from pilot to commercialization.',
    priority_areas: ['startup', 'scaleup', 'cleantech'],
    eligibility_summary: 'Eligible Canadian ventures under program intake requirements.',
    funding_type: 'contribution',
    application_method: 'portal',
    required_documents: ['Project and scaling plan', 'Budget'],
    priority_lexicon: ['scale-up funding', 'startup funding'],
    source_type: 'manual'
  },
  {
    program_code: 'CA-BDC-SUST-VENTURE',
    program_name: 'Sustainability Venture Fund',
    administering_agency: 'Business Development Canada',
    source_url: 'https://www.bdc.ca/',
    intake_status: 'open',
    description: 'Venture financing focused on sustainability-oriented business innovation.',
    objectives: 'Provide growth capital for high-impact sustainable ventures.',
    priority_areas: ['venture_capital', 'sustainability'],
    eligibility_summary: 'Companies meeting BDC fund investment criteria.',
    funding_type: 'investment',
    application_method: 'portal',
    required_documents: ['Pitch deck', 'Financial model', 'Impact thesis'],
    priority_lexicon: ['sustainability venture', 'bdc fund'],
    source_type: 'manual'
  },
  {
    program_code: 'CA-TD-FOEF-GRANT',
    program_name: 'TD Friends of the Environment Foundation Grant',
    administering_agency: 'TD',
    source_url: 'https://www.td.com/ca/en/about-td/ready-commitment/fes-grants',
    intake_status: 'open',
    description: 'Community environmental grant funding for eligible organizations in Canada.',
    objectives: 'Support local projects delivering measurable environmental outcomes.',
    priority_areas: ['community_environment', 'sustainability'],
    eligibility_summary: 'Eligible Canadian charities and non-profit organizations.',
    funding_type: 'grant',
    min_funding: 2000,
    max_funding: 8000,
    application_method: 'portal',
    required_documents: ['Project description', 'Budget'],
    priority_lexicon: ['td environment foundation grant'],
    source_type: 'manual'
  },
  {
    program_code: 'CA-TELUS-FFF',
    program_name: 'TELUS Friendly Future Foundation',
    administering_agency: 'Telus Business',
    source_url: 'https://friendlyfuture.com/foundation',
    intake_status: 'open',
    description: 'Grant support for community-focused and youth-serving projects.',
    objectives: 'Enable measurable local social impact through targeted grants.',
    priority_areas: ['community_support', 'youth'],
    eligibility_summary: 'Eligible Canadian organizations under TELUS Foundation guidelines.',
    funding_type: 'grant',
    min_funding: 10000,
    max_funding: 20000,
    application_method: 'portal',
    required_documents: ['Project proposal', 'Budget', 'Impact plan'],
    priority_lexicon: ['telus friendly future foundation'],
    source_type: 'manual'
  },
  {
    program_code: 'US-USDA-CSP',
    program_name: 'The Conservation Stewardship Program (CSP)',
    administering_agency: 'USDA',
    source_url: 'https://www.nrcs.usda.gov/programs-initiatives/csp-conservation-stewardship-program',
    intake_status: 'open',
    description: 'USDA conservation program supporting comprehensive stewardship on working lands.',
    objectives: 'Reward and expand conservation performance of agricultural producers.',
    priority_areas: ['conservation', 'soil_health', 'climate_resilience'],
    eligibility_summary: 'U.S. agricultural producers eligible under NRCS CSP criteria.',
    funding_type: 'contribution',
    application_method: 'portal',
    required_documents: ['Conservation plan', 'Eligibility records'],
    priority_lexicon: ['csp', 'conservation stewardship'],
    source_type: 'manual'
  },
  {
    program_code: 'US-USDA-EQIP',
    program_name: 'The Environmental Quality Incentives Program (EQIP)',
    administering_agency: 'USDA',
    source_url: 'https://www.nrcs.usda.gov/programs-initiatives/eqip-environmental-quality-incentives',
    intake_status: 'open',
    description: 'Cost-share and technical assistance program for conservation practices on working lands.',
    objectives: 'Improve environmental quality and resource stewardship in agriculture.',
    priority_areas: ['conservation', 'water_quality', 'soil_health'],
    eligibility_summary: 'U.S. agricultural producers eligible under NRCS EQIP requirements.',
    funding_type: 'contribution',
    application_method: 'portal',
    required_documents: ['Application forms', 'Conservation planning documents'],
    priority_lexicon: ['eqip', 'environmental quality incentives'],
    source_type: 'manual'
  },
  {
    program_code: 'CA-GMF-THE',
    program_name: 'The Green Municipal Fund',
    administering_agency: 'The Green Municipal Fund',
    source_url: 'https://greenmunicipalfund.ca/',
    intake_status: 'open',
    description: 'Municipal funding for sustainability, climate, and infrastructure initiatives in Canada.',
    objectives: 'Support municipal projects with measurable environmental outcomes.',
    priority_areas: ['municipal_sustainability', 'climate_action'],
    eligibility_summary: 'Canadian municipalities and eligible partners.',
    funding_type: 'grant_or_loan',
    max_funding: 10000000,
    application_method: 'portal',
    required_documents: ['Project proposal', 'Budget and implementation plan'],
    priority_lexicon: ['green municipal fund', 'municipal sustainability'],
    source_type: 'manual'
  },
  {
    program_code: 'US-USDA-UAIP-ALT',
    program_name: 'Urban Agriculture and Innovative Production Grants',
    administering_agency: 'USDA',
    source_url: 'https://www.usda.gov/urban',
    intake_status: 'open',
    description: 'USDA grants for urban agriculture and innovative production projects.',
    objectives: 'Increase local food production capacity and urban agriculture innovation.',
    priority_areas: ['urban_agriculture', 'innovation'],
    eligibility_summary: 'Eligible U.S. entities under USDA grant program rules.',
    funding_type: 'grant',
    max_funding: 500000,
    application_method: 'portal',
    required_documents: ['Application narrative', 'Budget', 'Work plan'],
    priority_lexicon: ['urban agriculture grants', 'usda urban'],
    source_type: 'manual'
  },
  {
    program_code: 'US-USDA-LAMP-ALT',
    program_name: 'Local Agriculture Market Program',
    administering_agency: 'USDA',
    source_url: 'https://www.ams.usda.gov/services/grants/lamp',
    intake_status: 'open',
    description: 'USDA support for local and regional food market development and infrastructure.',
    objectives: 'Strengthen local agriculture market access and producer participation.',
    priority_areas: ['local_food_systems', 'market_development'],
    eligibility_summary: 'Eligible U.S. entities under USDA AMS LAMP requirements.',
    funding_type: 'grant',
    application_method: 'portal',
    required_documents: ['Project narrative', 'Budget', 'Outcomes plan'],
    priority_lexicon: ['local agriculture market program', 'lamp'],
    source_type: 'manual'
  },
  {
    program_code: 'US-USDA-SCBGP-ALT',
    program_name: 'Specialty Crop Block Grant Program',
    administering_agency: 'USDA',
    source_url: 'https://www.ams.usda.gov/services/grants/scbgp',
    intake_status: 'open',
    description: 'USDA block grants to enhance specialty crop competitiveness.',
    objectives: 'Improve specialty crop value chains and market opportunities.',
    priority_areas: ['specialty_crops', 'market_development'],
    eligibility_summary: 'U.S. applicants eligible under state-administered SCBGP processes.',
    funding_type: 'grant',
    application_method: 'state_admin',
    required_documents: ['Project proposal', 'Budget', 'State intake forms'],
    priority_lexicon: ['specialty crop block grant program', 'scbgp'],
    source_type: 'manual'
  },
  {
    program_code: 'US-FFAR-VARIOUS',
    program_name: 'Various Grants',
    administering_agency: 'Foundation For Food And Agricultural Research',
    source_url: 'https://foundationfar.org/',
    intake_status: 'open',
    description: 'Multiple grant opportunities supporting food and agriculture research priorities.',
    objectives: 'Accelerate innovation and impact through targeted research funding.',
    priority_areas: ['research', 'innovation', 'food_systems'],
    eligibility_summary: 'Applicants eligible under individual FFAR funding calls.',
    funding_type: 'grant',
    application_method: 'portal',
    required_documents: ['Call-specific proposal package'],
    priority_lexicon: ['ffar', 'various grants'],
    source_type: 'manual'
  }
];

const seededProgramContent = SEED_PROGRAMS.map((program) => ({
  ...program,
  question_map: Array.isArray(program.question_map)
    ? program.question_map
    : (GRANT_PROGRAM_QUESTION_MAPS[program.program_code] || []),
  budget_categories: Array.isArray(program.budget_categories)
    ? program.budget_categories
    : (GRANT_PROGRAM_BUDGET_CATEGORIES[program.program_code] || [])
}));

// ============================================================
// Seed programs into database
// ============================================================
export async function seedGrantPrograms(pool) {
  try {
    for (const prog of seededProgramContent) {
      await pool.query(`
        INSERT INTO grant_programs (
          program_code, program_name, administering_agency, source_url,
          intake_status, description, objectives, priority_areas,
          eligibility_summary, eligibility_rules, funding_type, max_funding,
          cost_share_ratio, reimbursement_model, application_method, application_url,
          required_documents, priority_lexicon, evidence_snippets, question_map,
          budget_categories, equity_enhanced, equity_details, source_type, last_checked_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, NOW()
        )
        ON CONFLICT (program_code) DO UPDATE SET
          program_name = EXCLUDED.program_name,
          administering_agency = EXCLUDED.administering_agency,
          source_url = EXCLUDED.source_url,
          intake_status = EXCLUDED.intake_status,
          description = EXCLUDED.description,
          objectives = EXCLUDED.objectives,
          priority_areas = EXCLUDED.priority_areas,
          eligibility_summary = EXCLUDED.eligibility_summary,
          eligibility_rules = EXCLUDED.eligibility_rules,
          funding_type = EXCLUDED.funding_type,
          max_funding = EXCLUDED.max_funding,
          cost_share_ratio = EXCLUDED.cost_share_ratio,
          reimbursement_model = EXCLUDED.reimbursement_model,
          application_method = EXCLUDED.application_method,
          application_url = EXCLUDED.application_url,
          required_documents = EXCLUDED.required_documents,
          priority_lexicon = EXCLUDED.priority_lexicon,
          evidence_snippets = EXCLUDED.evidence_snippets,
          question_map = EXCLUDED.question_map,
          budget_categories = EXCLUDED.budget_categories,
          equity_enhanced = EXCLUDED.equity_enhanced,
          equity_details = EXCLUDED.equity_details,
          source_type = EXCLUDED.source_type,
          last_checked_at = NOW(),
          updated_at = NOW()
      `, [
        prog.program_code, prog.program_name, prog.administering_agency, prog.source_url,
        prog.intake_status, prog.description, prog.objectives, prog.priority_areas || [],
        prog.eligibility_summary, JSON.stringify(prog.eligibility_rules || {}),
        prog.funding_type, prog.max_funding || null,
        prog.cost_share_ratio || null, prog.reimbursement_model || null,
        prog.application_method, prog.application_url || null,
        prog.required_documents || [], prog.priority_lexicon || [],
        JSON.stringify(prog.evidence_snippets || []),
        JSON.stringify(prog.question_map || []),
        JSON.stringify(prog.budget_categories || []),
        prog.equity_enhanced || false, JSON.stringify(prog.equity_details || {}),
        prog.source_type || 'manual',
      ]);
    }
    logger.info(`[grant-registry] Seeded ${seededProgramContent.length} programs`);
  } catch (error) {
    logger.error('[grant-registry] Seed error:', error);
  }
}

async function createProgramChangeAlert(pool, programId, changeType, details) {
  try {
    await pool.query(
      `INSERT INTO grant_program_change_alerts (program_id, change_type, details)
       VALUES ($1, $2, $3)`,
      [programId, changeType, JSON.stringify(details || {})]
    );
  } catch (error) {
    logger.warn(`[grant-registry] Unable to create change alert (${changeType}) for program ${programId}: ${error.message}`);
  }
}

// ============================================================
// Weekly program check (change detection)
// ============================================================
export async function weeklyProgramCheck(pool) {
  try {
    const programs = await pool.query(
      'SELECT id, program_code, source_url, intake_status, intake_deadline, eligibility_summary FROM grant_programs WHERE active = TRUE AND source_url IS NOT NULL'
    );

    let updated = 0;

    for (const prog of programs.rows) {
      try {
        // Fetch program page
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(prog.source_url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
          logger.warn(`[grant-registry] Failed to fetch ${prog.program_code}: HTTP ${response.status}`);
          await pool.query(
            'UPDATE grant_programs SET needs_review = TRUE, last_checked_at = NOW(), updated_at = NOW() WHERE id = $1',
            [prog.id]
          );
          await createProgramChangeAlert(pool, prog.id, 'url_broken', {
            statusCode: response.status,
            sourceUrl: prog.source_url,
            checkedAt: new Date().toISOString()
          });
          continue;
        }

        const html = await response.text();
        const contentHash = crypto.createHash('sha256').update(html).digest('hex');

        // Detect intake status from page content
        let detectedStatus = prog.intake_status;
        let scrapingConfidence = 'low';
        const lowerHtml = html.toLowerCase();
        if (lowerHtml.includes('open to applications') || lowerHtml.includes('accepting applications')) {
          detectedStatus = 'open';
          scrapingConfidence = 'high';
        } else if (lowerHtml.includes('closed to applications') || lowerHtml.includes('no longer accepting')) {
          detectedStatus = 'closed';
          scrapingConfidence = 'high';
        }

        // Check for changes
        const changes = [];
        if (detectedStatus !== prog.intake_status) {
          changes.push({ field: 'intake_status', old: prog.intake_status, new: detectedStatus });
        }

        // Store snapshot
        const eligHash = crypto.createHash('sha256').update(prog.eligibility_summary || '').digest('hex');
        await pool.query(`
          INSERT INTO grant_program_snapshots (
            program_id, snapshot_date, intake_status, eligibility_hash, content_hash, scraping_confidence, changes_detected
          ) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6)
        `, [prog.id, detectedStatus, eligHash, contentHash, scrapingConfidence, JSON.stringify(changes)]);

        // Update program if changes found
        if (changes.length > 0) {
          await pool.query(`
            UPDATE grant_programs SET
              intake_status = $2,
              needs_review = $4,
              last_changed_at = NOW(),
              last_checked_at = NOW(),
              change_log = change_log || $3::jsonb,
              updated_at = NOW()
            WHERE id = $1
          `, [prog.id, detectedStatus, JSON.stringify([{
            date: new Date().toISOString(),
            changes
          }]), scrapingConfidence === 'low']);
          await createProgramChangeAlert(pool, prog.id, 'status_change', {
            previousStatus: prog.intake_status,
            detectedStatus,
            scrapingConfidence,
            checkedAt: new Date().toISOString()
          });
          updated++;
        } else {
          await pool.query(
            'UPDATE grant_programs SET last_checked_at = NOW(), needs_review = $2 WHERE id = $1',
            [prog.id, scrapingConfidence === 'low']
          );
        }

        if (scrapingConfidence === 'low') {
          await createProgramChangeAlert(pool, prog.id, 'scrape_uncertain', {
            sourceUrl: prog.source_url,
            reason: 'No known intake status markers detected in page content',
            checkedAt: new Date().toISOString()
          });
        }
      } catch (err) {
        logger.warn(`[grant-registry] Error checking ${prog.program_code}: ${err.message}`);
        await pool.query(
          'UPDATE grant_programs SET needs_review = TRUE, last_checked_at = NOW(), updated_at = NOW() WHERE id = $1',
          [prog.id]
        );
        await createProgramChangeAlert(pool, prog.id, 'fetch_error', {
          error: err.message,
          sourceUrl: prog.source_url,
          checkedAt: new Date().toISOString()
        });
      }
    }

    logger.info(`[grant-registry] Weekly check complete. ${programs.rows.length} programs checked, ${updated} updated.`);
    return { checked: programs.rows.length, updated };
  } catch (error) {
    logger.error('[grant-registry] Weekly check error:', error);
    return { checked: 0, updated: 0, error: error.message };
  }
}

// ============================================================
// Start weekly sync interval
// ============================================================
export function startGrantProgramSync(pool) {
  const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const INITIAL_DELAY = 60 * 1000; // 1 minute after startup

  // Seed on startup
  setTimeout(async () => {
    await seedGrantPrograms(pool);
  }, INITIAL_DELAY);

  // Weekly sync
  setInterval(async () => {
    logger.info('[grant-registry] Starting weekly program sync...');
    await weeklyProgramCheck(pool);
  }, WEEKLY_MS);

  logger.info('[grant-registry] Weekly program sync scheduled (every 7 days)');
}
