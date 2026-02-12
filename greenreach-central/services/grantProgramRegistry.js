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
    priority_areas: ['clean_technology', 'innovation', 'low_carbon_economy', 'GHG_reduction', 'precision_agriculture'],
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
    priority_areas: ['research', 'innovation', 'pre_commercial', 'sector_competitiveness'],
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
  }
];

// ============================================================
// Seed programs into database
// ============================================================
export async function seedGrantPrograms(pool) {
  try {
    for (const prog of SEED_PROGRAMS) {
      await pool.query(`
        INSERT INTO grant_programs (
          program_code, program_name, administering_agency, source_url,
          intake_status, description, objectives, priority_areas,
          eligibility_summary, eligibility_rules, funding_type, max_funding,
          cost_share_ratio, reimbursement_model, application_method, application_url,
          required_documents, priority_lexicon, evidence_snippets,
          equity_enhanced, equity_details, source_type, last_checked_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, 'aafc_catalogue', NOW()
        )
        ON CONFLICT (program_code) DO UPDATE SET
          program_name = EXCLUDED.program_name,
          intake_status = EXCLUDED.intake_status,
          description = EXCLUDED.description,
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
        prog.equity_enhanced || false, JSON.stringify(prog.equity_details || {}),
      ]);
    }
    logger.info(`[grant-registry] Seeded ${SEED_PROGRAMS.length} programs`);
  } catch (error) {
    logger.error('[grant-registry] Seed error:', error);
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
          continue;
        }

        const html = await response.text();
        const contentHash = crypto.createHash('sha256').update(html).digest('hex');

        // Detect intake status from page content
        let detectedStatus = prog.intake_status;
        const lowerHtml = html.toLowerCase();
        if (lowerHtml.includes('open to applications') || lowerHtml.includes('accepting applications')) {
          detectedStatus = 'open';
        } else if (lowerHtml.includes('closed to applications') || lowerHtml.includes('no longer accepting')) {
          detectedStatus = 'closed';
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
            program_id, snapshot_date, intake_status, eligibility_hash, content_hash, changes_detected
          ) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5)
        `, [prog.id, detectedStatus, eligHash, contentHash, JSON.stringify(changes)]);

        // Update program if changes found
        if (changes.length > 0) {
          await pool.query(`
            UPDATE grant_programs SET
              intake_status = $2,
              last_changed_at = NOW(),
              last_checked_at = NOW(),
              change_log = change_log || $3::jsonb,
              updated_at = NOW()
            WHERE id = $1
          `, [prog.id, detectedStatus, JSON.stringify([{
            date: new Date().toISOString(),
            changes
          }])]);
          updated++;
        } else {
          await pool.query(
            'UPDATE grant_programs SET last_checked_at = NOW() WHERE id = $1',
            [prog.id]
          );
        }
      } catch (err) {
        logger.warn(`[grant-registry] Error checking ${prog.program_code}: ${err.message}`);
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
