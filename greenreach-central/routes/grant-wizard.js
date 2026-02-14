/**
 * Grant Wizard API Routes
 * 
 * Endpoints for the grant writing wizard:
 *   - User registration & auth (CASL-compliant)
 *   - Program discovery & matching
 *   - Corporation search (federal registry integration)
 *   - Wizard step progression
 *   - Application CRUD with autosave
 *   - Export pack generation
 *   - Outcome tracking
 *   - Weekly program sync
 *
 * AUTOMATION OPPORTUNITIES (Future Enhancements):
 * ================================================
 * 
 * 1. CRA Business Number Validation
 *    - Auto-verify BN format and check-digit
 *    - Optional: query CRA registry for business status
 * 
 * 2. Provincial Corporation Search
 *    - Ontario: https://www.ontario.ca/page/search-business-name-database
 *    - BC: https://www.bcregistry.ca/
 *    - Auto-detect province and suggest relevant registry
 * 
 * 3. Address Validation & Auto-complete
 *    - Canada Post API or Google Places
 *    - Verify postal codes, auto-fill city/province
 *    - Standardize address format for applications
 * 
 * 4. Document Intelligence
 *    - Scan uploaded PDFs for key data (OCR)
 *    - Auto-extract: financial statements, incorporation docs
 *    - Mark checklist items complete based on uploads
 *    - Flag missing required sections
 * 
 * 5. Financial Data Pre-fill
 *    - Secure upload of past tax returns (T2, T4)
 *    - Extract: revenue, expenses, employee count
 *    - Calculate cost-share ratios automatically
 * 
 * 6. AI-Powered Expense Categorization
 *    - User pastes expense list → AI categorizes by program rules
 *    - Suggest eligible vs ineligible items
 *    - Auto-calculate totals per category
 * 
 * 7. Project Cost Estimation
 *    - Based on project type, AI suggests typical costs
 *    - Historical data from similar approved applications
 *    - Industry benchmarks for equipment, labour, materials
 * 
 * 8. Past Application Reuse
 *    - If user applied to similar program → auto-populate common fields
 *    - Version control for project descriptions
 *    - "Copy from previous application" feature
 * 
 * 9. Eligibility Pre-screening
 *    - Answer eligibility questions once in profile
 *    - Auto-filter incompatible programs
 *    - Suggest strongest fit programs
 * 
 * 10. Multi-Program Application
 *     - Apply same project to multiple compatible programs
 *     - Adjust budget/scope per program requirements
 *     - Track submission status across programs
 * 
 * 11. Deadline Tracking & Reminders
 *     - Email/SMS alerts for upcoming deadlines
 *     - Calendar integration (iCal/Google Calendar)
 *     - Flag intake closing dates
 * 
 * 12. Grant Officer Preview Mode
 *     - Show application as grant officer will see it
 *     - Flag common rejection reasons
 *     - Completeness score before submission
 * 
 * IMPLEMENTATION PRIORITY:
 * - High: Document intelligence (#4), Expense categorization (#6)
 * - Medium: Address validation (#3), Past app reuse (#8)
 * - Low: Multi-program (#10), Officer preview (#12)
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import OpenAI from 'openai';
import PDFDocument from 'pdfkit';
import axios from 'axios';
import * as cheerio from 'cheerio';
import logger from '../utils/logger.js';
import { getDatabase } from '../config/database.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
const RETENTION_MONTHS = 6; // 6 months from last sign-in, not from creation

// Initialize OpenAI for AI drafting (grant-specific key takes priority)
let openai = null;
const grantAiKey = process.env.GRANT_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
if (grantAiKey) {
  openai = new OpenAI({ apiKey: grantAiKey });
  logger.info('[Grant Wizard] OpenAI initialized for AI drafting' +
    (process.env.GRANT_OPENAI_API_KEY ? ' (dedicated key)' : ' (shared key)'));
} else {
  logger.warn('[Grant Wizard] No OpenAI API key set - AI drafting disabled');
}

// ============================================================
// Auth middleware for grant users
// ============================================================
function authenticateGrantUser(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'grant_user') {
      return res.status(403).json({ success: false, error: 'Invalid token type' });
    }
    req.grantUserId = decoded.userId;
    req.grantUserEmail = decoded.email;
    next();
  } catch (error) {
    return res.status(403).json({ success: false, error: 'Invalid or expired token' });
  }
}

// Optional auth — sets req.grantUserId if token present, continues either way
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.type === 'grant_user') {
        req.grantUserId = decoded.userId;
        req.grantUserEmail = decoded.email;
      }
    } catch {}
  }
  next();
}

// ============================================================
// Helper: get DB pool
// ============================================================
function getPool(req) {
  try {
    return getDatabase();
  } catch {
    return null;
  }
}

// ============================================================
// POST /register - Create free grant user account
// ============================================================
router.post('/register', async (req, res) => {
  try {
    const pool = getPool(req);
    if (!pool) return res.status(500).json({ success: false, error: 'Database unavailable' });

    const {
      email, password, contactName, businessName, phone,
      province, postalCode, organizationType,
      consentServiceEmails = true,
      consentMarketingEmails = false,
      consentDataImprovement = false
    } = req.body;

    // Validation
    if (!email || !password || !contactName) {
      return res.status(400).json({
        success: false,
        error: 'Email, password, and contact name are required'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters'
      });
    }

    // Check existing
    const existing = await pool.query(
      'SELECT id FROM grant_users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase().trim()]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'An account with this email already exists'
      });
    }

    // Create user
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(`
      INSERT INTO grant_users (
        email, password_hash, contact_name, business_name, phone,
        province, postal_code, organization_type,
        consent_service_emails, consent_marketing_emails, consent_data_improvement,
        consent_obtained_at, consent_method
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), 'registration_form')
      RETURNING id, email, contact_name, created_at
    `, [
      email.toLowerCase().trim(), passwordHash, contactName, businessName || null,
      phone || null, province || null, postalCode || null, organizationType || null,
      consentServiceEmails, consentMarketingEmails, consentDataImprovement
    ]);

    const user = result.rows[0];
    const token = jwt.sign(
      { type: 'grant_user', userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          contactName: user.contact_name,
          createdAt: user.created_at
        }
      }
    });
  } catch (error) {
    logger.error('[grant-wizard] Registration error:', error);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// ============================================================
// POST /login - Authenticate grant user
// ============================================================
router.post('/login', async (req, res) => {
  try {
    const pool = getPool(req);
    if (!pool) return res.status(500).json({ success: false, error: 'Database unavailable' });

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    const result = await pool.query(
      'SELECT id, email, password_hash, contact_name, business_name FROM grant_users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    // Update last login + sign-in count + extend all active application expiry dates
    await pool.query('UPDATE grant_users SET last_login_at = NOW(), updated_at = NOW(), sign_in_count = COALESCE(sign_in_count, 0) + 1 WHERE id = $1', [user.id]);
    await pool.query(`
      UPDATE grant_applications
      SET expires_at = NOW() + INTERVAL '${RETENTION_MONTHS} months'
      WHERE user_id = $1 AND status NOT IN ('submitted', 'awarded', 'expired')
    `, [user.id]);

    const token = jwt.sign(
      { type: 'grant_user', userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          contactName: user.contact_name,
          businessName: user.business_name
        }
      }
    });
  } catch (error) {
    logger.error('[grant-wizard] Login error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// ============================================================
// GET /profile - Get user profile
// ============================================================
router.get('/profile', authenticateGrantUser, async (req, res) => {
  try {
    const pool = getPool(req);
    const result = await pool.query(`
      SELECT id, email, contact_name, business_name, phone, province, postal_code,
             organization_type, cra_business_number, incorporation_status, employee_count,
             ownership_demographics, farm_details,
             consent_service_emails, consent_marketing_emails, consent_data_improvement,
             created_at, updated_at
      FROM grant_users WHERE id = $1 AND deleted_at IS NULL
    `, [req.grantUserId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('[grant-wizard] Profile fetch error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch profile' });
  }
});

// ============================================================
// PUT /profile - Update user profile & farm details
// ============================================================
router.put('/profile', authenticateGrantUser, async (req, res) => {
  try {
    const pool = getPool(req);
    const {
      contactName, businessName, phone, province, postalCode,
      organizationType, craBusinessNumber, incorporationStatus,
      employeeCount, ownershipDemographics, farmDetails,
      consentMarketingEmails, consentDataImprovement
    } = req.body;

    await pool.query(`
      UPDATE grant_users SET
        contact_name = COALESCE($2, contact_name),
        business_name = COALESCE($3, business_name),
        phone = COALESCE($4, phone),
        province = COALESCE($5, province),
        postal_code = COALESCE($6, postal_code),
        organization_type = COALESCE($7, organization_type),
        cra_business_number = COALESCE($8, cra_business_number),
        incorporation_status = COALESCE($9, incorporation_status),
        employee_count = COALESCE($10, employee_count),
        ownership_demographics = COALESCE($11, ownership_demographics),
        farm_details = COALESCE($12, farm_details),
        consent_marketing_emails = COALESCE($13, consent_marketing_emails),
        consent_data_improvement = COALESCE($14, consent_data_improvement),
        updated_at = NOW()
      WHERE id = $1
    `, [
      req.grantUserId, contactName, businessName, phone, province, postalCode,
      organizationType, craBusinessNumber, incorporationStatus,
      employeeCount,
      ownershipDemographics ? JSON.stringify(ownershipDemographics) : null,
      farmDetails ? JSON.stringify(farmDetails) : null,
      consentMarketingEmails, consentDataImprovement
    ]);

    res.json({ success: true, message: 'Profile updated' });
  } catch (error) {
    logger.error('[grant-wizard] Profile update error:', error);
    res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

// ============================================================
// DELETE /profile - Soft delete account & purge data
// ============================================================
router.delete('/profile', authenticateGrantUser, async (req, res) => {
  try {
    const pool = getPool(req);
    const { password } = req.body || {};

    if (!password) {
      return res.status(400).json({ success: false, error: 'Password required' });
    }

    const passResult = await pool.query(
      'SELECT password_hash FROM grant_users WHERE id = $1 AND deleted_at IS NULL',
      [req.grantUserId]
    );

    if (!passResult.rows.length) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const passMatch = await bcrypt.compare(password, passResult.rows[0].password_hash);
    if (!passMatch) {
      return res.status(401).json({ success: false, error: 'Invalid password' });
    }
    
    // Soft-delete user
    await pool.query('UPDATE grant_users SET deleted_at = NOW() WHERE id = $1', [req.grantUserId]);
    
    // Delete application content (keep de-identified analytics if consented)
    await pool.query(`
      UPDATE grant_applications SET
        answers = '{}', facts_ledger = '{}', answers_document = NULL,
        budget_workbook = NULL, organization_profile = '{}', project_profile = '{}',
        budget = '{}', contacts = '[]', attachments_checklist = '[]'
      WHERE user_id = $1
    `, [req.grantUserId]);

    // Delete export packs
    await pool.query('DELETE FROM grant_export_packs WHERE user_id = $1', [req.grantUserId]);

    res.json({ success: true, message: 'Account and data deleted' });
  } catch (error) {
    logger.error('[grant-wizard] Account deletion error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete account' });
  }
});

// ============================================================
// POST /wizard-events - Log wizard analytics events
// ============================================================
router.post('/wizard-events', authenticateGrantUser, async (req, res) => {
  try {
    const pool = getPool(req);
    if (!pool) return res.status(500).json({ success: false, error: 'Database unavailable' });

    const { applicationId, eventType, pageId, durationMs } = req.body || {};
    if (!eventType) {
      return res.status(400).json({ success: false, error: 'eventType is required' });
    }

    await pool.query(
      `INSERT INTO grant_wizard_events (user_id, application_id, event_type, page_id, duration_ms)
       VALUES ($1, $2, $3, $4, $5)` ,
      [
        req.grantUserId,
        applicationId || null,
        String(eventType),
        pageId ? String(pageId) : null,
        Number.isFinite(durationMs) ? Math.round(durationMs) : null
      ]
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('[grant-wizard] Wizard event error:', error);
    res.status(500).json({ success: false, error: 'Failed to log event' });
  }
});

// ============================================================
// GET /programs - Browse funding programs
// ============================================================
router.get('/programs', async (req, res) => {
  try {
    const pool = getPool(req);
    if (!pool) return res.status(500).json({ success: false, error: 'Database unavailable' });

    const { status, type, search, limit = 50, offset = 0 } = req.query;
    
    let where = ['active = TRUE'];
    let params = [];
    let paramIdx = 1;

    if (status) {
      where.push(`intake_status = $${paramIdx++}`);
      params.push(status);
    }
    if (type) {
      where.push(`funding_type = $${paramIdx++}`);
      params.push(type);
    }
    if (search) {
      // Split search into individual terms for OR matching across all fields
      const terms = search.split(/\s+/).filter(Boolean);
      if (terms.length === 1) {
        where.push(`(program_name ILIKE $${paramIdx} OR description ILIKE $${paramIdx} OR administering_agency ILIKE $${paramIdx} OR objectives ILIKE $${paramIdx} OR priority_areas::text ILIKE $${paramIdx})`);
        params.push(`%${terms[0]}%`);
        paramIdx++;
      } else {
        // Multiple terms: match ANY term across any field
        const termClauses = terms.map(term => {
          const clause = `(program_name ILIKE $${paramIdx} OR description ILIKE $${paramIdx} OR administering_agency ILIKE $${paramIdx} OR objectives ILIKE $${paramIdx} OR priority_areas::text ILIKE $${paramIdx})`;
          params.push(`%${term}%`);
          paramIdx++;
          return clause;
        });
        where.push(`(${termClauses.join(' OR ')})`);
      }
    }

    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(`
      SELECT id, program_code, program_name, administering_agency, source_url,
             intake_status, intake_deadline, description, funding_type,
             min_funding, max_funding, cost_share_ratio, application_method,
             has_fillable_pdf, priority_areas, equity_enhanced,
             last_checked_at
      FROM grant_programs
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE intake_status
          WHEN 'open' THEN 1
          WHEN 'upcoming' THEN 2
          WHEN 'continuous' THEN 3
          ELSE 4
        END,
        intake_deadline ASC NULLS LAST
      LIMIT $${paramIdx++} OFFSET $${paramIdx}
    `, params);

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM grant_programs WHERE ${where.join(' AND ')}`,
      params.slice(0, -2)
    );

    res.json({
      success: true,
      data: {
        programs: result.rows,
        total: parseInt(countResult.rows[0].count),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    logger.error('[grant-wizard] Programs fetch error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch programs' });
  }
});

// ============================================================
// GET /programs/:id - Get full program details
// ============================================================
router.get('/programs/:id', async (req, res) => {
  try {
    const pool = getPool(req);
    if (!pool) return res.status(500).json({ success: false, error: 'Database unavailable' });

    const result = await pool.query(
      'SELECT * FROM grant_programs WHERE id = $1 AND active = TRUE',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Program not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('[grant-wizard] Program detail error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch program' });
  }
});

// ============================================================
// POST /programs/:id/check-eligibility - Quick eligibility triage
// ============================================================
router.post('/programs/:id/check-eligibility', async (req, res) => {
  try {
    const pool = getPool(req);
    if (!pool) return res.status(500).json({ success: false, error: 'Database unavailable' });

    const program = await pool.query(
      'SELECT eligibility_rules, eligibility_summary, equity_enhanced, equity_details FROM grant_programs WHERE id = $1',
      [req.params.id]
    );

    if (program.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Program not found' });
    }

    const rules = program.rows[0].eligibility_rules || {};
    const answers = req.body; // { province, organizationType, employeeCount, sector, ... }
    
    const results = [];
    let eligible = true;
    let maybeEligible = false;

    // Check each rule against provided answers
    for (const [field, rule] of Object.entries(rules)) {
      const answer = answers[field];
      if (answer === undefined || answer === null) {
        results.push({ field, status: 'unknown', message: rule.question || `Please provide: ${field}` });
        maybeEligible = true;
        continue;
      }

      let passed = true;
      if (rule.type === 'includes' && Array.isArray(rule.values)) {
        passed = rule.values.includes(answer);
      } else if (rule.type === 'min') {
        passed = Number(answer) >= rule.value;
      } else if (rule.type === 'max') {
        passed = Number(answer) <= rule.value;
      } else if (rule.type === 'equals') {
        passed = answer === rule.value;
      } else if (rule.type === 'province_list') {
        passed = rule.provinces.includes(answer);
      }

      if (!passed) {
        eligible = false;
        results.push({ field, status: 'ineligible', message: rule.failMessage || `Does not meet requirement: ${field}` });
      } else {
        results.push({ field, status: 'eligible', message: rule.passMessage || `Meets requirement: ${field}` });
      }
    }

    res.json({
      success: true,
      data: {
        eligible: eligible && !maybeEligible,
        maybeEligible,
        results,
        equityEnhanced: program.rows[0].equity_enhanced,
        equityDetails: program.rows[0].equity_details,
        summary: program.rows[0].eligibility_summary
      }
    });
  } catch (error) {
    logger.error('[grant-wizard] Eligibility check error:', error);
    res.status(500).json({ success: false, error: 'Eligibility check failed' });
  }
});

// ============================================================
// GET /corporation-search?name=xyz - Search federal corporations registry
// ============================================================
router.get('/corporation-search', async (req, res) => {
  try {
    const { name } = req.query;
    if (!name || name.length < 3) {
      return res.status(400).json({ success: false, error: 'Company name required (min 3 characters)' });
    }

    // Search ISED Corporations Canada database
    const searchUrl = `https://ised-isde.canada.ca/cc/lgcy/fdrlCrpSrch.html`;

    try {
      // ISED requires a POST with corpName field
      const response = await axios.post(
        `${searchUrl}?searchType=freetext&freeTextSearch=${encodeURIComponent(name.trim())}&lang=eng`,
        `corpName=${encodeURIComponent(name.trim())}&buttonNext=Search`,
        {
          timeout: 12000,
          headers: {
            'User-Agent': 'GreenReach-Grant-Wizard/1.0',
            'Accept': 'text/html',
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      const $ = cheerio.load(response.data);
      const results = [];

      // Results are in <ol class="list-unstyled"> > <li> items
      $('ol.list-unstyled > li').each((i, li) => {
        const $li = $(li);
        const text = $li.text();

        // Corporation name is in the first <a> with an href containing fdrlCrpDtls
        const nameLink = $li.find('a[href*="fdrlCrpDtls"]');
        const corpName = nameLink.text().trim();
        if (!corpName) return;

        // Extract corporation number
        const numberMatch = text.match(/Corporation\s+number:\s*([\d-]+)/i);
        const corpNumber = numberMatch ? numberMatch[1].trim() : '';

        // Extract status
        const statusMatch = text.match(/Status:\s*(\w+)/i);
        const corpStatus = statusMatch ? statusMatch[1].trim() : 'Unknown';

        // Extract business number
        const bnMatch = text.match(/Business\s+Number:\s*([\w]+)/i);
        const businessNumber = bnMatch ? bnMatch[1].trim() : null;

        // Extract corp ID from link for detail lookup
        const hrefMatch = (nameLink.attr('href') || '').match(/corpId=(\d+)/);
        const corpId = hrefMatch ? hrefMatch[1] : null;

        results.push({
          name: corpName,
          corporationNumber: corpNumber,
          status: corpStatus,
          businessNumber: businessNumber,
          corpId: corpId,
          source: 'federal',
          confidence: corpName.toLowerCase().includes(name.toLowerCase()) ? 'high' : 'medium'
        });
      });

      res.json({
        success: true,
        data: {
          query: name,
          results: results.slice(0, 10), // Limit to 10 results
          total: results.length,
          searchUrl: searchUrl
        }
      });

    } catch (searchError) {
      logger.warn('[grant-wizard] Corporation search fetch error:', searchError.message);
      
      // Return empty results rather than failing completely
      res.json({
        success: true,
        data: {
          query: name,
          results: [],
          total: 0,
          error: 'Search service temporarily unavailable. You can manually search at: ' + searchUrl
        }
      });
    }

  } catch (error) {
    logger.error('[grant-wizard] Corporation search error:', error);
    res.status(500).json({ success: false, error: 'Corporation search failed' });
  }
});

// ============================================================
// POST /scrape-website - Scrape user's website for positioning intel
// ============================================================
router.post('/scrape-website', optionalAuth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'URL required' });

    // Validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid URL' });
    }

    const baseUrl = parsedUrl.origin;
    const intelligence = {
      url: parsedUrl.href,
      scrapedAt: new Date().toISOString(),
      companyDescription: null,
      mission: null,
      products: [],
      achievements: [],      // awards, milestones
      communityEvents: [],   // events, partnerships, community involvement
      newsHighlights: [],    // recent news, press releases, developments
      teamInfo: null,
      socialProof: [],       // testimonials, partnerships, certifications
      keywords: [],          // extracted keywords for program matching
      rawSections: {}
    };

    // Scrape homepage
    try {
      const homePage = await axios.get(parsedUrl.href, {
        timeout: 12000,
        headers: { 'User-Agent': 'GreenReach-Grant-Wizard/1.0 (research assistant)', Accept: 'text/html' },
        maxRedirects: 3
      });
      const $ = cheerio.load(homePage.data);

      // Remove script/style noise
      $('script, style, noscript, iframe').remove();

      // Extract meta description
      const metaDesc = $('meta[name="description"]').attr('content') || '';
      const ogDesc = $('meta[property="og:description"]').attr('content') || '';
      intelligence.companyDescription = metaDesc || ogDesc || '';

      // Extract main headings and body text
      const headings = [];
      $('h1, h2, h3').each((_, el) => {
        const txt = $(el).text().trim();
        if (txt.length > 3 && txt.length < 200) headings.push(txt);
      });
      intelligence.rawSections.headings = headings.slice(0, 20);

      // Look for mission / about content
      const missionPatterns = /mission|about\s*us|our\s*story|who\s*we\s*are|our\s*vision|our\s*purpose/i;
      $('section, div, article').each((_, el) => {
        const heading = $(el).find('h1, h2, h3').first().text().trim();
        if (missionPatterns.test(heading)) {
          const text = $(el).find('p').map((_, p) => $(p).text().trim()).get().join(' ');
          if (text.length > 30 && text.length < 2000) {
            intelligence.mission = text.substring(0, 800);
          }
        }
      });

      // Look for awards, achievements, community involvement
      const achievementPatterns = /award|certif|recogni|achievement|honour|honor|accredit|milestone/i;
      const communityPatterns = /communit|event|partner|sponsor|volunt|outreach|donat|food\s*bank|school|local|workshop/i;
      const newsPatterns = /news|press|announce|update|blog|what.s\s*new|latest|recent/i;

      $('section, div, article, li, p').each((_, el) => {
        const text = $(el).text().trim();
        if (text.length < 15 || text.length > 500) return;

        if (achievementPatterns.test(text) && intelligence.achievements.length < 8) {
          intelligence.achievements.push(text.substring(0, 300));
        }
        if (communityPatterns.test(text) && intelligence.communityEvents.length < 8) {
          intelligence.communityEvents.push(text.substring(0, 300));
        }
        if (newsPatterns.test(text) && intelligence.newsHighlights.length < 8) {
          intelligence.newsHighlights.push(text.substring(0, 300));
        }
      });

      // Extract product/service info
      const productPatterns = /product|service|grow|offer|special|crop|produce|supply/i;
      $('section, div, article').each((_, el) => {
        const heading = $(el).find('h1, h2, h3').first().text().trim();
        if (productPatterns.test(heading) && intelligence.products.length < 10) {
          $(el).find('li, h4, h5').each((_, li) => {
            const t = $(li).text().trim();
            if (t.length > 3 && t.length < 150) intelligence.products.push(t);
          });
        }
      });

      // Social proof: testimonials, certifications, partner logos
      const proofPatterns = /testimoni|review|partner|client|certif|organic|haccp|gap\s*certified|member/i;
      $('section, div, blockquote').each((_, el) => {
        const text = $(el).text().trim();
        if (proofPatterns.test(text) && text.length > 20 && text.length < 400 && intelligence.socialProof.length < 6) {
          intelligence.socialProof.push(text.substring(0, 300));
        }
      });

      // Discover internal links for about/news/team pages
      const subPages = [];
      $('a[href]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const linkText = $(a).text().trim().toLowerCase();
        if (/about|team|story|news|blog|event|award|community/i.test(linkText) || 
            /about|team|news|blog|event|award|community/i.test(href)) {
          try {
            const full = new URL(href, baseUrl);
            if (full.origin === baseUrl && !subPages.includes(full.href)) {
              subPages.push(full.href);
            }
          } catch {}
        }
      });

      // Scrape up to 3 sub-pages for deeper intelligence
      for (const subUrl of subPages.slice(0, 3)) {
        try {
          const subRes = await axios.get(subUrl, {
            timeout: 8000,
            headers: { 'User-Agent': 'GreenReach-Grant-Wizard/1.0', Accept: 'text/html' },
            maxRedirects: 2
          });
          const $sub = cheerio.load(subRes.data);
          $sub('script, style, noscript').remove();

          // Extract paragraphs from sub-pages
          $sub('p, li').each((_, el) => {
            const text = $sub(el).text().trim();
            if (text.length < 20 || text.length > 600) return;

            if (achievementPatterns.test(text) && intelligence.achievements.length < 12) {
              intelligence.achievements.push(text.substring(0, 300));
            }
            if (communityPatterns.test(text) && intelligence.communityEvents.length < 12) {
              intelligence.communityEvents.push(text.substring(0, 300));
            }
            if (newsPatterns.test(text) && intelligence.newsHighlights.length < 12) {
              intelligence.newsHighlights.push(text.substring(0, 300));
            }
          });

          // Team info from about/team pages
          if (/team|about|people/i.test(subUrl)) {
            const teamText = $sub('main, article, .content, [role="main"]').first().text().trim();
            if (teamText.length > 50) {
              intelligence.teamInfo = teamText.substring(0, 600);
            }
          }
        } catch { /* sub-page fetch failed, continue */ }
      }

    } catch (fetchErr) {
      logger.warn('[grant-wizard] Website scrape fetch error:', fetchErr.message);
      return res.json({
        success: true,
        data: {
          ...intelligence,
          error: 'Could not access website. Please check the URL and try again.'
        }
      });
    }

    // De-duplicate extracted items
    intelligence.achievements = [...new Set(intelligence.achievements)].slice(0, 8);
    intelligence.communityEvents = [...new Set(intelligence.communityEvents)].slice(0, 8);
    intelligence.newsHighlights = [...new Set(intelligence.newsHighlights)].slice(0, 8);
    intelligence.products = [...new Set(intelligence.products)].slice(0, 10);
    intelligence.socialProof = [...new Set(intelligence.socialProof)].slice(0, 6);

    // Extract keywords for program matching
    const allText = [
      intelligence.companyDescription,
      intelligence.mission,
      ...intelligence.products,
      ...intelligence.achievements,
      ...intelligence.communityEvents
    ].filter(Boolean).join(' ').toLowerCase();

    const grantKeywords = [
      'innovation', 'sustainable', 'organic', 'local food', 'food security',
      'export', 'technology', 'automation', 'clean tech', 'renewable',
      'community', 'indigenous', 'youth', 'training', 'workforce',
      'vertical farm', 'greenhouse', 'controlled environment', 'hydroponic',
      'equipment', 'expansion', 'processing', 'value-added', 'market access',
      'climate', 'resilience', 'diversity', 'inclusion', 'research'
    ];
    intelligence.keywords = grantKeywords.filter(kw => allText.includes(kw));

    // Use AI to generate a positioning summary if OpenAI is available
    if (openai && (intelligence.companyDescription || intelligence.mission || intelligence.achievements.length > 0)) {
      try {
        const contextParts = [];
        if (intelligence.companyDescription) contextParts.push(`Description: ${intelligence.companyDescription}`);
        if (intelligence.mission) contextParts.push(`Mission: ${intelligence.mission}`);
        if (intelligence.achievements.length) contextParts.push(`Achievements: ${intelligence.achievements.slice(0, 5).join('; ')}`);
        if (intelligence.communityEvents.length) contextParts.push(`Community involvement: ${intelligence.communityEvents.slice(0, 5).join('; ')}`);
        if (intelligence.products.length) contextParts.push(`Products/Services: ${intelligence.products.slice(0, 5).join(', ')}`);
        if (intelligence.newsHighlights.length) contextParts.push(`Recent news: ${intelligence.newsHighlights.slice(0, 3).join('; ')}`);

        const aiRes = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: 'You are a grant writing strategist with deep expertise in agricultural funding. Given web-scraped data about a North American agricultural business, produce a concise 2-3 paragraph "positioning summary" that highlights the strongest angles for a funding application.\n\n' +
                'Apply these grant writing principles:\n' +
                '- Identify the most compelling STORY this organization can tell funders — what makes them unique?\n' +
                '- Highlight evidence of community support, partnerships, and in-kind contributions (funders value diversified backing)\n' +
                '- Note any preliminary data or track record that demonstrates feasibility and credibility\n' +
                '- Flag strengths across key funder priorities: community impact, innovation, sustainability, job creation, food security, Indigenous/underserved community support, and awards/recognition\n' +
                '- Identify potential "stacking" angles — areas where multiple programs might fund different aspects\n' +
                '- Use confident, forward-looking language that positions the organization as capable and ambitious\n\n' +
                'Write in third person. Be factual — only reference what the data supports. Emphasize measurable outcomes wherever possible.'
            },
            {
              role: 'user',
              content: `Website data for grant positioning analysis:\n\n${contextParts.join('\n\n')}\n\nGenerate a positioning summary this applicant can use to strengthen their grant narrative.`
            }
          ],
          temperature: 0.6,
          max_tokens: 500
        });
        intelligence.positioningSummary = aiRes.choices[0].message.content;
      } catch (aiErr) {
        logger.warn('[grant-wizard] AI positioning summary failed:', aiErr.message);
      }
    }

    // Save to user profile (only if authenticated)
    if (req.grantUserId) {
      const pool = getPool(req);
      if (pool) {
        await pool.query(
          'UPDATE grant_users SET website_url = $2, updated_at = NOW() WHERE id = $1',
          [req.grantUserId, parsedUrl.href]
        );
      }
    }

    res.json({ success: true, data: intelligence });

  } catch (error) {
    logger.error('[grant-wizard] Website scrape error:', error);
    res.status(500).json({ success: false, error: 'Website analysis failed' });
  }
});

// ============================================================
// POST /applications/:id/characterize - Save project discovery data
// ============================================================
router.put('/applications/:id/characterize', authenticateGrantUser, async (req, res) => {
  try {
    const pool = getPool(req);
    const { characterization, websiteIntelligence } = req.body;

    const updates = ['updated_at = NOW()'];
    const values = [req.params.id, req.grantUserId];
    let idx = 3;

    if (characterization) {
      updates.push(`project_characterization = $${idx++}`);
      values.push(JSON.stringify(characterization));
    }
    if (websiteIntelligence) {
      updates.push(`website_intelligence = $${idx++}`);
      values.push(JSON.stringify(websiteIntelligence));
    }

    await pool.query(
      `UPDATE grant_applications SET ${updates.join(', ')} WHERE id = $1 AND user_id = $2`,
      values
    );

    res.json({ success: true, message: 'Project discovery saved' });
  } catch (error) {
    logger.error('[grant-wizard] Characterize error:', error);
    res.status(500).json({ success: false, error: 'Failed to save project discovery' });
  }
});

// ============================================================
// POST /applications/:id/match-programs - Smart program matching
// ============================================================
router.post('/applications/:id/match-programs', authenticateGrantUser, async (req, res) => {
  try {
    const pool = getPool(req);

    // Get application characterization
    const appResult = await pool.query(
      'SELECT project_characterization, website_intelligence, organization_profile FROM grant_applications WHERE id = $1 AND user_id = $2',
      [req.params.id, req.grantUserId]
    );
    if (appResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    const app = appResult.rows[0];
    const char = app.project_characterization || {};
    const webIntel = app.website_intelligence || {};
    const org = app.organization_profile || {};

    // Get all active programs
    const programsResult = await pool.query(`
      SELECT id, program_code, program_name, administering_agency, description,
             funding_type, min_funding, max_funding, cost_share_ratio,
             intake_status, intake_deadline, priority_areas, eligibility_rules,
             equity_enhanced, source_url, objectives
      FROM grant_programs
      WHERE active = TRUE
      ORDER BY intake_status, program_name
    `);

    const programs = programsResult.rows;
    const scored = programs.map(p => {
      let score = 0;
      const reasons = [];

      // 1. Match project goals to priority areas
      const goals = char.projectGoals || [];
      const priorities = (p.priority_areas || []).map(pa => pa.toLowerCase());
      const desc = (p.description || '').toLowerCase();
      const objectives = (p.objectives || '').toLowerCase();

      const goalKeywordMap = {
        'establish_vertical_farm': ['vertical farm', 'controlled environment', 'innovation', 'technology', 'greenhouse', 'indoor'],
        'expand_operation': ['expansion', 'scale', 'growth', 'capacity', 'production'],
        'equipment_purchase': ['equipment', 'machinery', 'capital', 'technology', 'automation'],
        'export_market': ['export', 'trade', 'international', 'market access', 'market development'],
        'workforce_training': ['training', 'workforce', 'hiring', 'employment', 'labour', 'skills', 'youth'],
        'innovation_rd': ['innovation', 'research', 'development', 'r&d', 'technology', 'novel', 'pilot'],
        'risk_management': ['risk', 'insurance', 'business risk', 'agri-stability', 'agri-insurance'],
        'clean_tech': ['clean tech', 'sustainability', 'environment', 'renewable', 'energy efficiency', 'climate', 'emission'],
        'community_food': ['food security', 'community', 'local food', 'food access', 'food sovereignty'],
        'value_added': ['processing', 'value-added', 'value added', 'product development', 'packaging']
      };

      for (const goal of goals) {
        const keywords = goalKeywordMap[goal] || [];
        for (const kw of keywords) {
          if (priorities.some(pa => pa.includes(kw)) || desc.includes(kw) || objectives.includes(kw)) {
            score += 15;
            reasons.push(`Matches your "${goal.replace(/_/g, ' ')}" goal`);
            break;
          }
        }
      }

      // 2. Budget range check
      const budget = char.budgetRange || null;
      if (budget && p.max_funding) {
        const maxFunding = parseFloat(p.max_funding);
        const budgetRanges = {
          'under_25k': [0, 25000],
          '25k_100k': [25000, 100000],
          '100k_500k': [100000, 500000],
          '500k_1m': [500000, 1000000],
          'over_1m': [1000000, Infinity]
        };
        const [lo, hi] = budgetRanges[budget] || [0, Infinity];
        if (maxFunding >= lo) {
          score += 10;
          reasons.push(`Budget range fits (up to $${maxFunding.toLocaleString()})`);
        }
      }

      // 3. Status bonus — open programs rank higher
      if (p.intake_status === 'open') {
        score += 20;
        reasons.push('Currently accepting applications');
      } else if (p.intake_status === 'continuous') {
        score += 15;
        reasons.push('Continuous intake');
      } else if (p.intake_status === 'upcoming') {
        score += 5;
        reasons.push('Opening soon');
      }

      // 4. Province match from eligibility rules
      const province = org.province || char.province;
      if (province && p.eligibility_rules?.province) {
        const provRule = p.eligibility_rules.province;
        if (provRule.type === 'province_list' && provRule.provinces?.includes(province)) {
          score += 10;
          reasons.push(`Available in ${province}`);
        }
      }

      // 5. Website intelligence keyword match
      const webKeywords = webIntel.keywords || [];
      for (const kw of webKeywords) {
        if (desc.includes(kw) || priorities.some(pa => pa.includes(kw))) {
          score += 5;
          reasons.push(`Website mentions "${kw}"`);
          break; // Only count first match to avoid over-scoring
        }
      }

      // 6. Equity enhancement bonus if applicable
      if (p.equity_enhanced) {
        score += 3;
        reasons.push('Enhanced cost-share available');
      }

      // 7. Employee count match
      const employees = char.currentEmployees || org.employeeCount;
      if (employees !== undefined && p.eligibility_rules?.employeeCount) {
        const empRule = p.eligibility_rules.employeeCount;
        if (empRule.type === 'max' && parseInt(employees) <= empRule.value) {
          score += 5;
          reasons.push(`Employee count qualifies`);
        }
      }

      return {
        ...p,
        matchScore: score,
        matchReasons: [...new Set(reasons)].slice(0, 5),
        matchPercentage: Math.min(100, Math.round((score / 80) * 100))
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.matchScore - a.matchScore);

    res.json({
      success: true,
      data: {
        programs: scored,
        characterization: char,
        totalPrograms: scored.length,
        strongMatches: scored.filter(p => p.matchScore >= 30).length
      }
    });

  } catch (error) {
    logger.error('[grant-wizard] Match programs error:', error);
    res.status(500).json({ success: false, error: 'Program matching failed' });
  }
});

// ============================================================
// POST /applications/:id/ai-recommend - AI-powered recommendations
// Uses GPT-4 to analyze project profile vs programs and suggest
// direct matches + complementary/strategic funding opportunities
// ============================================================
router.post('/applications/:id/ai-recommend', authenticateGrantUser, async (req, res) => {
  if (!openai) {
    return res.status(503).json({
      success: false,
      error: 'AI recommendation service not available (OpenAI API key not configured)'
    });
  }

  try {
    const pool = getPool(req);
    if (!pool) return res.status(500).json({ success: false, error: 'Database unavailable' });

    // Get application + characterization
    const appResult = await pool.query(
      `SELECT project_characterization, website_intelligence, organization_profile, project_profile, budget
       FROM grant_applications WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.grantUserId]
    );
    if (appResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    const app = appResult.rows[0];
    const char = app.project_characterization || {};
    const webIntel = app.website_intelligence || {};
    const org = app.organization_profile || {};
    const proj = app.project_profile || {};
    const budget = app.budget || {};

    // Get all active programs
    const programsResult = await pool.query(`
      SELECT id, program_code, program_name, administering_agency, description,
             funding_type, min_funding, max_funding, intake_status, priority_areas
      FROM grant_programs
      WHERE active = TRUE
      ORDER BY program_name
    `);

    const programs = programsResult.rows;

    // Build context for AI
    const projectSummary = [
      proj.title ? `Project: ${proj.title}` : '',
      proj.description ? `Description: ${proj.description}` : '',
      org.legalName ? `Organization: ${org.legalName}` : '',
      org.type ? `Org Type: ${org.type}` : '',
      org.province ? `Province: ${org.province}` : '',
      char.projectGoals?.length ? `Goals: ${char.projectGoals.join(', ')}` : '',
      char.budgetRange ? `Budget Range: ${char.budgetRange}` : '',
      budget.totalAmount ? `Budget Total: $${budget.totalAmount}` : '',
      webIntel.keywords?.length ? `Keywords from website: ${webIntel.keywords.join(', ')}` : ''
    ].filter(Boolean).join('\n');

    const programList = programs.map(p =>
      `[${p.program_code || p.id}] ${p.program_name} — ${p.administering_agency || ''}. ` +
      `${(p.description || '').substring(0, 200)}. ` +
      `Funding: ${p.funding_type || 'N/A'}, Max: $${p.max_funding || '?'}. ` +
      `Status: ${p.intake_status}. ` +
      `Priorities: ${(p.priority_areas || []).join(', ')}`
    ).join('\n\n');

    const prompt = `You are a senior agricultural grant strategist with deep expertise in Canadian and US funding landscapes. Analyze this project against available programs using grant writing best practices.

PROJECT PROFILE:
${projectSummary}

AVAILABLE PROGRAMS:
${programList}

STRATEGIC ANALYSIS FRAMEWORK:
- Consider funder alignment: Does this project use the funder's language and match their stated priorities?
- Assess budget feasibility: Is the requested amount realistic relative to each program's typical gift size?
- Evaluate storytelling angle: What compelling narrative connects this project to each program's mission?
- Check stacking potential: Which programs can fund different aspects without overlap?
- Identify preparation gaps: What boilerplate materials, attachments, or data would strengthen applications?

Respond in JSON with this exact structure:
{
  "directMatches": [
    {
      "programCode": "...",
      "programName": "...",
      "confidence": "high|medium|low",
      "rationale": "2-sentence explanation of why this is a strong match",
      "applicationTip": "1-sentence tactical advice for the application",
      "keyTermsToUse": ["funder-specific terms to mirror in the application"]
    }
  ],
  "complementaryMatches": [
    {
      "programCode": "...",
      "programName": "...",
      "rationale": "Why this program is worth exploring even if not an obvious fit",
      "stackingNote": "How to combine with other grants"
    }
  ],
  "strategicAdvice": "2-3 sentence overall funding strategy recommendation",
  "fundingStackSuggestion": "How to combine multiple programs for maximum funding",
  "preparationChecklist": ["Key items to prepare before applying (e.g., audits, board lists, budget narratives)"]
}

Rules:
- directMatches: max 5 programs from the list above, ranked by fit
- complementaryMatches: max 3 programs that could supplement the direct matches
- Only use programs from the provided list (reference by programCode)
- Be specific about WHY each program fits this particular project
- Include funder-specific terminology the applicant should mirror
- Return ONLY valid JSON, no markdown formatting`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are an expert agricultural grant strategist specializing in Canadian and US funding programs. Apply best practices from leading grant writing frameworks: tell a compelling story, mirror funder terminology, ensure budget-narrative alignment, and recommend diversified funding strategies. Respond only with valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.5,
      max_tokens: 1500
    });

    let recommendations;
    try {
      const raw = completion.choices[0].message.content.trim();
      // Strip markdown code fences if present
      const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '');
      recommendations = JSON.parse(cleaned);
    } catch (parseErr) {
      logger.warn('[grant-wizard] AI recommend parse error, returning raw:', parseErr.message);
      recommendations = {
        directMatches: [],
        complementaryMatches: [],
        strategicAdvice: completion.choices[0].message.content,
        fundingStackSuggestion: '',
        _parseError: true
      };
    }

    res.json({
      success: true,
      data: {
        recommendations,
        tokensUsed: completion.usage.total_tokens,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('[grant-wizard] AI recommend error:', error);
    res.status(500).json({ success: false, error: 'AI recommendation failed', details: error.message });
  }
});

// ============================================================
// POST /match-programs-public - Smart matching WITHOUT auth
// Accepts characterization + websiteIntelligence in body directly
// ============================================================
router.post('/match-programs-public', async (req, res) => {
  try {
    const { characterization, websiteIntelligence } = req.body;
    const char = characterization || {};
    const webIntel = websiteIntelligence || {};

    const pool = getPool(req);
    if (!pool) return res.status(500).json({ success: false, error: 'Database unavailable' });

    const programsResult = await pool.query(`
      SELECT id, program_code, program_name, administering_agency, description,
             funding_type, min_funding, max_funding, cost_share_ratio,
             intake_status, intake_deadline, priority_areas, eligibility_rules,
             equity_enhanced, source_url, objectives
      FROM grant_programs
      WHERE active = TRUE
      ORDER BY intake_status, program_name
    `);

    const programs = programsResult.rows;
    const scored = programs.map(p => {
      let score = 0;
      const reasons = [];

      const goals = char.projectGoals || [];
      const priorities = (p.priority_areas || []).map(pa => pa.toLowerCase());
      const desc = (p.description || '').toLowerCase();
      const objectives = (p.objectives || '').toLowerCase();

      const goalKeywordMap = {
        'establish_vertical_farm': ['vertical farm', 'controlled environment', 'innovation', 'technology', 'greenhouse', 'indoor'],
        'expand_operation': ['expansion', 'scale', 'growth', 'capacity', 'production'],
        'equipment_purchase': ['equipment', 'machinery', 'capital', 'technology', 'automation'],
        'export_market': ['export', 'trade', 'international', 'market access', 'market development'],
        'workforce_training': ['training', 'workforce', 'hiring', 'employment', 'labour', 'skills', 'youth'],
        'innovation_rd': ['innovation', 'research', 'development', 'r&d', 'technology', 'novel', 'pilot'],
        'risk_management': ['risk', 'insurance', 'business risk', 'agri-stability', 'agri-insurance'],
        'clean_tech': ['clean tech', 'sustainability', 'environment', 'renewable', 'energy efficiency', 'climate', 'emission'],
        'community_food': ['food security', 'community', 'local food', 'food access', 'food sovereignty'],
        'value_added': ['processing', 'value-added', 'value added', 'product development', 'packaging']
      };

      for (const goal of goals) {
        const keywords = goalKeywordMap[goal] || [];
        for (const kw of keywords) {
          if (priorities.some(pa => pa.includes(kw)) || desc.includes(kw) || objectives.includes(kw)) {
            score += 15;
            reasons.push(`Matches your "${goal.replace(/_/g, ' ')}" goal`);
            break;
          }
        }
      }

      const budget = char.budgetRange || null;
      if (budget && p.max_funding) {
        const maxFunding = parseFloat(p.max_funding);
        const budgetRanges = {
          'under_25k': [0, 25000], '25k_100k': [25000, 100000],
          '100k_500k': [100000, 500000], '500k_1m': [500000, 1000000],
          'over_1m': [1000000, Infinity]
        };
        const [lo] = budgetRanges[budget] || [0, Infinity];
        if (maxFunding >= lo) {
          score += 10;
          reasons.push(`Budget range fits (up to $${maxFunding.toLocaleString()})`);
        }
      }

      if (p.intake_status === 'open') { score += 20; reasons.push('Currently accepting applications'); }
      else if (p.intake_status === 'continuous') { score += 15; reasons.push('Continuous intake'); }
      else if (p.intake_status === 'upcoming') { score += 5; reasons.push('Opening soon'); }

      const province = char.province;
      if (province && p.eligibility_rules?.province) {
        const provRule = p.eligibility_rules.province;
        if (provRule.type === 'province_list' && provRule.provinces?.includes(province)) {
          score += 10;
          reasons.push(`Available in ${province}`);
        }
      }

      const webKeywords = webIntel.keywords || [];
      for (const kw of webKeywords) {
        if (desc.includes(kw) || priorities.some(pa => pa.includes(kw))) {
          score += 5; reasons.push(`Website mentions "${kw}"`);
          break;
        }
      }

      if (p.equity_enhanced) { score += 3; reasons.push('Enhanced cost-share available'); }

      const employees = char.currentEmployees;
      if (employees !== undefined && p.eligibility_rules?.employeeCount) {
        const empRule = p.eligibility_rules.employeeCount;
        if (empRule.type === 'max' && parseInt(employees) <= empRule.value) {
          score += 5; reasons.push('Employee count qualifies');
        }
      }

      return {
        ...p,
        matchScore: score,
        matchReasons: [...new Set(reasons)].slice(0, 5),
        matchPercentage: Math.min(100, Math.round((score / 80) * 100))
      };
    });

    scored.sort((a, b) => b.matchScore - a.matchScore);

    res.json({
      success: true,
      data: {
        programs: scored,
        totalPrograms: scored.length,
        strongMatches: scored.filter(p => p.matchScore >= 30).length
      }
    });
  } catch (error) {
    logger.error('[grant-wizard] Public match error:', error);
    res.status(500).json({ success: false, error: 'Program matching failed' });
  }
});

// ============================================================
// POST /applications - Start a new application
// ============================================================
router.post('/applications', authenticateGrantUser, async (req, res) => {
  try {
    const pool = getPool(req);
    const { programId } = req.body;

    // Pull user profile to pre-populate
    const userResult = await pool.query(
      `SELECT contact_name, business_name, phone, province, postal_code,
              organization_type, cra_business_number, incorporation_status,
              employee_count, farm_details
       FROM grant_users WHERE id = $1`,
      [req.grantUserId]
    );
    const user = userResult.rows[0] || {};

    // Build initial facts ledger from user profile
    const factsLedger = {
      contactName: user.contact_name,
      businessName: user.business_name,
      phone: user.phone,
      province: user.province,
      postalCode: user.postal_code,
      organizationType: user.organization_type,
      craBusinessNumber: user.cra_business_number,
      incorporationStatus: user.incorporation_status,
      employeeCount: user.employee_count
    };

    const organizationProfile = {
      legalName: user.business_name,
      type: user.organization_type,
      craBusinessNumber: user.cra_business_number,
      incorporationStatus: user.incorporation_status,
      employeeCount: user.employee_count,
      province: user.province,
      postalCode: user.postal_code
    };

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + RETENTION_MONTHS);

    const result = await pool.query(`
      INSERT INTO grant_applications (
        user_id, program_id, status, wizard_step, percent_complete,
        organization_profile, facts_ledger, expires_at
      ) VALUES ($1, $2, 'draft', 1, 0, $3, $4, $5)
      RETURNING id, status, wizard_step, percent_complete, expires_at, created_at
    `, [
      req.grantUserId, programId || null,
      JSON.stringify(organizationProfile),
      JSON.stringify(factsLedger),
      expiresAt
    ]);

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('[grant-wizard] Application create error:', error);
    res.status(500).json({ success: false, error: 'Failed to create application' });
  }
});

// ============================================================
// GET /applications - List user's applications
// ============================================================
router.get('/applications', authenticateGrantUser, async (req, res) => {
  try {
    const pool = getPool(req);
    const result = await pool.query(`
          SELECT a.id, a.program_id, a.status, a.wizard_step, a.percent_complete, a.started_at,
            a.last_saved_at, a.expires_at, a.outcome, a.answers,
             p.program_name, p.program_code, p.administering_agency, p.intake_deadline
      FROM grant_applications a
      LEFT JOIN grant_programs p ON a.program_id = p.id
      WHERE a.user_id = $1
      ORDER BY a.last_saved_at DESC
    `, [req.grantUserId]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('[grant-wizard] Applications list error:', error);
    res.status(500).json({ success: false, error: 'Failed to list applications' });
  }
});

// ============================================================
// GET /applications/:id - Get full application with progress
// ============================================================
router.get('/applications/:id', authenticateGrantUser, async (req, res) => {
  try {
    const pool = getPool(req);
    const result = await pool.query(`
      SELECT a.*, p.program_name, p.program_code, p.question_map,
             p.priority_lexicon, p.evidence_snippets, p.required_documents,
             p.budget_template_url, p.budget_categories, p.has_fillable_pdf, p.pdf_template_url
      FROM grant_applications a
      LEFT JOIN grant_programs p ON a.program_id = p.id
      WHERE a.id = $1 AND a.user_id = $2
    `, [req.params.id, req.grantUserId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('[grant-wizard] Application fetch error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch application' });
  }
});

// ============================================================
// PUT /applications/:id - Autosave / update application
// ============================================================
router.put('/applications/:id', authenticateGrantUser, async (req, res) => {
  try {
    const pool = getPool(req);
    const {
      wizardStep, percentComplete, status, programId,
      organizationProfile, projectProfile, budget, contacts,
      attachmentsChecklist, priorFunding, answers, factsLedger,
      procurementItems, milestones, supportLetters
    } = req.body;

    // Consistency check: compare incoming facts with stored facts
    let consistencyWarnings = [];
    if (factsLedger) {
      const existing = await pool.query(
        'SELECT facts_ledger FROM grant_applications WHERE id = $1 AND user_id = $2',
        [req.params.id, req.grantUserId]
      );
      if (existing.rows.length > 0) {
        const oldFacts = existing.rows[0].facts_ledger || {};
        for (const [key, newVal] of Object.entries(factsLedger)) {
          if (oldFacts[key] !== undefined && oldFacts[key] !== null && oldFacts[key] !== newVal) {
            consistencyWarnings.push({
              field: key,
              oldValue: oldFacts[key],
              newValue: newVal,
              message: `"${key}" changed from "${oldFacts[key]}" to "${newVal}". Update everywhere?`
            });
          }
        }
      }
    }

    const setClauses = ['last_saved_at = NOW()', 'updated_at = NOW()'];
    const values = [req.params.id, req.grantUserId];
    let idx = 3;

    const addField = (field, dbCol, val) => {
      if (val !== undefined) {
        setClauses.push(`${dbCol} = $${idx++}`);
        values.push(typeof val === 'object' ? JSON.stringify(val) : val);
      }
    };

    addField('wizardStep', 'wizard_step', wizardStep);
    addField('percentComplete', 'percent_complete', percentComplete);
    addField('status', 'status', status);
    addField('programId', 'program_id', programId);
    addField('organizationProfile', 'organization_profile', organizationProfile);
    addField('projectProfile', 'project_profile', projectProfile);
    addField('budget', 'budget', budget);
    addField('contacts', 'contacts', contacts);
    addField('attachmentsChecklist', 'attachments_checklist', attachmentsChecklist);
    addField('priorFunding', 'prior_funding', priorFunding);
    addField('answers', 'answers', answers);
    addField('factsLedger', 'facts_ledger', factsLedger);
    addField('procurementItems', 'procurement_items', procurementItems);
    addField('milestones', 'milestones', milestones);
    addField('supportLetters', 'support_letters', supportLetters);

    await pool.query(
      `UPDATE grant_applications SET ${setClauses.join(', ')} WHERE id = $1 AND user_id = $2`,
      values
    );

    res.json({
      success: true,
      message: 'Application saved',
      consistencyWarnings: consistencyWarnings.length > 0 ? consistencyWarnings : undefined
    });
  } catch (error) {
    logger.error('[grant-wizard] Application save error:', error);
    res.status(500).json({ success: false, error: 'Failed to save application' });
  }
});

// ============================================================
// POST /applications/:id/export - Generate export pack
// ============================================================
router.post('/applications/:id/export', authenticateGrantUser, async (req, res) => {
  try {
    const pool = getPool(req);
    
    // Get full application + program data
    const appResult = await pool.query(`
      SELECT a.*, p.program_name, p.question_map, p.required_documents,
             p.priority_lexicon, p.evidence_snippets
      FROM grant_applications a
      LEFT JOIN grant_programs p ON a.program_id = p.id
      WHERE a.id = $1 AND a.user_id = $2
    `, [req.params.id, req.grantUserId]);

    if (appResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    const app = appResult.rows[0];
    const org = app.organization_profile || {};
    const proj = app.project_profile || {};

    // Build answers document (program question order)
    const questionMap = app.question_map || [];
    const answers = app.answers || {};
    let answersDoc = `# ${app.program_name || 'Grant Application'}\n`;
    answersDoc += `## Draft Answers Document\n`;
    answersDoc += `Generated: ${new Date().toISOString().split('T')[0]}\n`;
    answersDoc += `Status: DRAFT — Review and submit through the official program portal\n\n`;

    // Include org summary
    answersDoc += `## Applicant\n`;
    answersDoc += `Organization: ${org.legalName || 'N/A'}\n`;
    answersDoc += `Type: ${org.type || 'N/A'}\n`;
    answersDoc += `Province: ${org.province || 'N/A'}\n`;
    if (org.craBusinessNumber) answersDoc += `CRA BN: ${org.craBusinessNumber}\n`;
    answersDoc += `\n`;

    // Include project summary
    if (proj.title) {
      answersDoc += `## Project: ${proj.title}\n`;
      if (proj.description) answersDoc += `${proj.description}\n`;
      if (proj.startDate && proj.endDate) answersDoc += `Timeline: ${proj.startDate} to ${proj.endDate}\n`;
      answersDoc += `\n`;
    }

    // Program-mapped questions
    if (questionMap.length > 0) {
      answersDoc += `## Program Questions\n\n`;
      questionMap.forEach((q, i) => {
        answersDoc += `### Q${i + 1}: ${q.question}\n`;
        answersDoc += `${answers[q.fieldKey] || '[Not yet answered]'}\n\n`;
      });
    }

    // Narrative answers (outcomes, risks, alignment)
    answersDoc += `## Narrative Responses\n\n`;
    if (answers.outcomes) answersDoc += `### Outcomes\n${answers.outcomes}\n\n`;
    if (answers.risks) answersDoc += `### Risks & Mitigation\n${answers.risks}\n\n`;
    if (answers.alignment) answersDoc += `### Program Alignment\n${answers.alignment}\n\n`;
    if (proj.needStatement) answersDoc += `### Need Statement\n${proj.needStatement}\n\n`;

    // Build budget cross-check
    const budget = app.budget || {};
    const budgetItems = budget.items || [];
    const budgetTotal = budgetItems.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
    const categoryTotals = {};
    budgetItems.forEach(item => {
      const cat = item.category || 'other';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + (parseFloat(item.amount) || 0);
    });

    const budgetSummary = {
      items: budgetItems,
      totalProjectCost: budgetTotal,
      categoryBreakdown: categoryTotals,
      otherFunding: budget.otherFunding || null,
      crossCheck: {
        itemCount: budgetItems.length,
        allHaveDescriptions: budgetItems.every(i => i.description?.trim()),
        allHaveAmounts: budgetItems.every(i => parseFloat(i.amount) > 0),
        totalMatchesSum: Math.abs(budgetTotal - (budget.totalAmount || 0)) < 0.01,
        warnings: []
      }
    };
    if (!budgetSummary.crossCheck.allHaveDescriptions) {
      budgetSummary.crossCheck.warnings.push('Some budget items are missing descriptions');
    }
    if (budgetItems.length === 0) {
      budgetSummary.crossCheck.warnings.push('No budget items entered');
    }

    // Build checklist
    const requiredDocs = app.required_documents || [];
    const attachments = app.attachments_checklist || [];
    const checklist = requiredDocs.map(doc => {
      const attached = attachments.find(a => a.docType === doc);
      return {
        document: doc,
        status: attached ? 'ready' : 'missing',
        filename: attached?.filename
      };
    });
    const missingDocs = checklist.filter(c => c.status === 'missing').length;

    // Build citations with source links
    const evidenceSnippets = app.evidence_snippets || [];
    const citations = evidenceSnippets.map((e, i) => ({
      number: i + 1,
      topic: e.topic,
      text: e.text,
      source: e.source,
      url: e.url || null
    }));

    // Milestone summary for export
    const milestonesList = app.milestones || [];
    const milestonesSummary = milestonesList.map((ms, i) => ({
      number: i + 1,
      title: ms.title || 'Untitled',
      startDate: ms.startDate || null,
      endDate: ms.endDate || null,
      budgetAmount: parseFloat(ms.budgetAmount) || 0,
      deliverables: ms.deliverables || '',
      completionCriteria: ms.completionCriteria || ''
    }));
    const milestoneBudgetTotal = milestonesList.reduce((sum, ms) => sum + (parseFloat(ms.budgetAmount) || 0), 0);
    const milestoneWarnings = [];
    if (milestonesSummary.length === 0) milestoneWarnings.push('No milestones defined — most programs require 3-5 milestones');
    if (milestonesSummary.length > 0 && !milestonesSummary.every(ms => ms.title && ms.title !== 'Untitled')) milestoneWarnings.push('Some milestones are missing titles');
    if (milestonesSummary.length > 0 && Math.abs(budgetTotal - milestoneBudgetTotal) > 0.01) milestoneWarnings.push(`Milestone budgets ($${milestoneBudgetTotal.toFixed(2)}) don't match total project budget ($${budgetTotal.toFixed(2)})`);

    // Build pack
    const pack = {
      answersDocument: answersDoc,
      budget: budgetSummary,
      milestones: {
        items: milestonesSummary,
        milestoneBudgetTotal,
        crossCheck: {
          count: milestonesSummary.length,
          allHaveTitles: milestonesSummary.every(ms => ms.title && ms.title !== 'Untitled'),
          allHaveDates: milestonesSummary.every(ms => ms.startDate && ms.endDate),
          allHaveBudgets: milestonesSummary.every(ms => ms.budgetAmount > 0),
          budgetDelta: budgetTotal - milestoneBudgetTotal,
          warnings: milestoneWarnings
        }
      },
      checklist,
      missingDocuments: missingDocs,
      supportLetters: {
        items: (app.support_letters || []).map(lt => ({
          contactName: lt.contactName || '',
          organization: lt.organization || '',
          email: lt.email || '',
          relationship: lt.relationship || '',
          status: lt.status || 'draft'
        })),
        summary: {
          total: (app.support_letters || []).length,
          received: (app.support_letters || []).filter(lt => lt.status === 'received').length,
          requested: (app.support_letters || []).filter(lt => lt.status === 'requested').length,
          draft: (app.support_letters || []).filter(lt => lt.status !== 'received' && lt.status !== 'requested').length
        }
      },
      citations,
      publicDisclosureWarning: 'Some programs publish project summaries or recipient details. ' +
        'Review the program\'s disclosure requirements before submitting. ' +
        'Under Canada\'s Grants and Contributions disclosure, recipient name, summary, and amount may be made public.',
      disclosureNote: 'DRAFT — This document was generated by the GreenReach Grant Wizard. ' +
        'All content must be reviewed and submitted by the applicant through the official program portal. ' +
        'GreenReach does not submit applications on your behalf.',
      retentionNote: `Your application data is retained for 6 months from your last sign-in and can be deleted at any time from your profile.`,
      generatedAt: new Date().toISOString()
    };

    // Store export pack
    await pool.query(`
      INSERT INTO grant_export_packs (application_id, user_id, pack_type, contents)
      VALUES ($1, $2, $3, $4)
    `, [req.params.id, req.grantUserId, req.body.packType || 'manual', JSON.stringify(pack)]);

    // Update answers document on application
    await pool.query(
      'UPDATE grant_applications SET answers_document = $1, updated_at = NOW() WHERE id = $2',
      [answersDoc, req.params.id]
    );

    res.json({ success: true, data: pack });
  } catch (error) {
    logger.error('[grant-wizard] Export pack error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate export' });
  }
});

// ============================================================
// GET /applications/:id/export/pdf - Download application as PDF
// ============================================================
router.get('/applications/:id/export/pdf', authenticateGrantUser, async (req, res) => {
  try {
    const pool = getPool(req);
    
    // Get application with program details
    const appResult = await pool.query(`
      SELECT a.*, p.program_name, p.administering_agency, 
             u.business_name, u.contact_name, u.email
      FROM grant_applications a
      LEFT JOIN grant_programs p ON a.program_id = p.id
      LEFT JOIN grant_users u ON a.user_id = u.id
      WHERE a.id = $1 AND a.user_id = $2
    `, [req.params.id, req.grantUserId]);

    if (appResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    const app = appResult.rows[0];
    
    // Create PDF document
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 72, bottom: 72, left: 72, right: 72 }
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="grant-application-${app.id}.pdf"`);
    
    // Pipe PDF to response
    doc.pipe(res);

    // Title page
    doc.fontSize(24).font('Helvetica-Bold')
       .text('Grant Application Draft', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(18).font('Helvetica')
       .text(app.program_name || 'Funding Program', { align: 'center' });
    doc.moveDown(2);

    // Applicant info
    doc.fontSize(12).font('Helvetica-Bold').text('Applicant Information');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Organization: ${app.business_name || 'N/A'}`);
    doc.text(`Contact: ${app.contact_name}`);
    doc.text(`Email: ${app.email}`);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-CA')}`);
    doc.moveDown(2);

    // Draft disclaimer
    doc.fontSize(10).font('Helvetica-Bold')
       .fillColor('#d32f2f')
       .text('DRAFT DOCUMENT', { align: 'center' });
    doc.fontSize(9).font('Helvetica').fillColor('#000000')
       .text('This document was generated by the GreenReach Grant Wizard. All content must be reviewed and submitted by the applicant through the official program portal.', 
             { align: 'center' });
    doc.moveDown(2);

    // Organization profile
    if (app.organization_profile && Object.keys(app.organization_profile).length > 0) {
      doc.addPage();
      doc.fontSize(16).font('Helvetica-Bold').text('Organization Profile');
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica');
      
      const org = app.organization_profile;
      if (org.legalName) doc.text(`Legal Name: ${org.legalName}`);
      if (org.type) doc.text(`Business Structure: ${org.type}`);
      if (org.province) doc.text(`Province: ${org.province}`);
      if (org.craBusinessNumber) doc.text(`CRA Business Number: ${org.craBusinessNumber}`);
      if (org.employeeCount) doc.text(`Employees: ${org.employeeCount}`);
      doc.moveDown();
    }

    // Project profile
    if (app.project_profile && Object.keys(app.project_profile).length > 0) {
      doc.addPage();
      doc.fontSize(16).font('Helvetica-Bold').text('Project Profile');
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica');
      
      const proj = app.project_profile;
      if (proj.title) doc.text(`Title: ${proj.title}`);
      if (proj.description) { doc.moveDown(0.3); doc.text(proj.description, { width: 468 }); }
      if (proj.needStatement) { doc.moveDown(0.5); doc.font('Helvetica-Bold').text('Need Statement:'); doc.font('Helvetica').text(proj.needStatement, { width: 468 }); }
      if (proj.startDate && proj.endDate) doc.text(`Timeline: ${proj.startDate} to ${proj.endDate}`);
      doc.moveDown();
    }

    // Narrative answers
    if (app.answers && Object.keys(app.answers).length > 0) {
      doc.addPage();
      doc.fontSize(16).font('Helvetica-Bold').text('Application Responses');
      doc.moveDown(1);
      
      const answerLabels = {
        outcomes: 'Outcomes & Measurable Impacts',
        risks: 'Risks & Mitigation Strategies',
        alignment: 'Program Priority Alignment'
      };

      Object.entries(app.answers).forEach(([key, value], index) => {
        if (!value || typeof value !== 'string') return;
        if (doc.y > 650) doc.addPage();
        
        doc.fontSize(12).font('Helvetica-Bold').text(answerLabels[key] || `Question: ${key}`);
        doc.fontSize(10).font('Helvetica').text(String(value), { width: 468 });
        doc.moveDown(1.5);
      });
    }

    // Budget summary
    if (app.budget && Object.keys(app.budget).length > 0) {
      doc.addPage();
      doc.fontSize(16).font('Helvetica-Bold').text('Budget Summary');
      doc.moveDown(1);
      doc.fontSize(10).font('Helvetica');
      
      const budget = app.budget;
      const items = budget.items || [];
      const total = items.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);

      if (items.length > 0) {
        // Table header
        doc.font('Helvetica-Bold');
        doc.text('Description', 72, doc.y, { width: 250, continued: false });
        const headerY = doc.y - 12;
        doc.text('Category', 330, headerY, { width: 100 });
        doc.text('Amount', 440, headerY, { width: 100, align: 'right' });
        doc.moveDown(0.3);
        doc.moveTo(72, doc.y).lineTo(540, doc.y).stroke();
        doc.moveDown(0.5);

        // Table rows
        doc.font('Helvetica');
        items.forEach(item => {
          if (doc.y > 680) doc.addPage();
          const rowY = doc.y;
          doc.text(item.description || '—', 72, rowY, { width: 250 });
          doc.text(item.category || '—', 330, rowY, { width: 100 });
          doc.text('$' + (parseFloat(item.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }), 440, rowY, { width: 100, align: 'right' });
          doc.moveDown(0.3);
          // Show breakdown details if present
          const details = [];
          if (item.units) details.push(`Qty: ${item.units}`);
          if (item.unitCost) details.push(`@ $${parseFloat(item.unitCost).toFixed(2)}/unit`);
          if (item.supplierName) details.push(`Supplier: ${item.supplierName}`);
          if (details.length > 0) {
            doc.fontSize(8).fillColor('#666666').text(`  ${details.join(' | ')}`, 72);
            doc.fillColor('#000000').fontSize(10);
          }
          if (item.justification) {
            doc.fontSize(8).fillColor('#666666').text(`  Justification: ${item.justification}`, 72, doc.y, { width: 468 });
            doc.fillColor('#000000').fontSize(10);
          }
          doc.moveDown(0.3);
        });

        doc.moveDown(0.5);
        doc.moveTo(72, doc.y).lineTo(540, doc.y).stroke();
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold');
        doc.text('Total Project Cost: $' + total.toLocaleString(undefined, { minimumFractionDigits: 2 }));
      } else {
        doc.text('No budget items entered.');
      }

      if (budget.otherFunding) {
        doc.moveDown(1);
        doc.font('Helvetica-Bold').text('Other Funding Sources:');
        doc.font('Helvetica').text(budget.otherFunding);
      }
      doc.moveDown();
    }

    // Milestones
    const milestones = app.milestones || [];
    if (milestones.length > 0) {
      doc.addPage();
      doc.fontSize(16).font('Helvetica-Bold').text('Project Milestones');
      doc.moveDown(1);

      milestones.forEach((ms, i) => {
        doc.fontSize(12).font('Helvetica-Bold').text(`Milestone ${i + 1}: ${ms.title || 'Untitled'}`);
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica');

        if (ms.startDate || ms.endDate) {
          doc.text(`Timeline: ${ms.startDate || '?'} — ${ms.endDate || '?'}`);
        }
        if (ms.budgetAmount) {
          doc.text(`Budget: $${parseFloat(ms.budgetAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        }
        if (ms.deliverables) {
          doc.moveDown(0.3);
          doc.font('Helvetica-Bold').text('Deliverables:');
          doc.font('Helvetica').text(ms.deliverables);
        }
        if (ms.completionCriteria) {
          doc.moveDown(0.3);
          doc.font('Helvetica-Bold').text('Completion Criteria:');
          doc.font('Helvetica').text(ms.completionCriteria);
        }
        doc.moveDown(1);
      });

      // Milestone budget subtotal
      const msBudgetTotal = milestones.reduce((sum, ms) => sum + (parseFloat(ms.budgetAmount) || 0), 0);
      doc.font('Helvetica-Bold');
      doc.text(`Milestone Budget Subtotal: $${msBudgetTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
      doc.moveDown();
    }

    // Letters of Support
    const supportLetters = app.support_letters || [];
    if (supportLetters.length > 0) {
      doc.addPage();
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#000000').text('Letters of Support');
      doc.moveDown(1);

      // Summary row
      const received = supportLetters.filter(l => l.status === 'received').length;
      const requested = supportLetters.filter(l => l.status === 'requested').length;
      doc.fontSize(10).font('Helvetica');
      doc.text(`Total supporters: ${supportLetters.length}  |  Received: ${received}  |  Requested: ${requested}  |  Draft: ${supportLetters.length - received - requested}`);
      doc.moveDown(1);

      supportLetters.forEach((lt, i) => {
        const statusLabel = lt.status === 'received' ? 'Received' : lt.status === 'requested' ? 'Requested' : 'Draft';
        doc.fontSize(11).font('Helvetica-Bold').text(`${i + 1}. ${lt.contactName || 'Unnamed'}  [${statusLabel}]`);
        doc.fontSize(10).font('Helvetica');
        if (lt.organization) doc.text(`Organization/Role: ${lt.organization}`);
        if (lt.email) doc.text(`Email: ${lt.email}`);
        if (lt.relationship) doc.text(`Relationship: ${lt.relationship}`);
        doc.moveDown(0.8);
      });
    }

    // Footer on all pages
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).font('Helvetica')
         .fillColor('#666666')
         .text(`Page ${i + 1} of ${pages.count}`, 
               72, doc.page.height - 50, 
               { align: 'center' });
    }

    // Finalize PDF
    doc.end();

  } catch (error) {
    logger.error('[grant-wizard] PDF export error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to generate PDF' });
    }
  }
});

// ============================================================
// POST /applications/:id/outcome - Record outcome
// ============================================================
router.post('/applications/:id/outcome', authenticateGrantUser, async (req, res) => {
  try {
    const pool = getPool(req);
    const { outcome, outcomeDate, outcomeAmount, outcomeNotes } = req.body;

    if (!outcome || !['awarded', 'rejected', 'withdrawn', 'no_response'].includes(outcome)) {
      return res.status(400).json({ success: false, error: 'Valid outcome required: awarded, rejected, withdrawn, no_response' });
    }

    await pool.query(`
      UPDATE grant_applications SET
        outcome = $3, outcome_date = $4, outcome_amount = $5, outcome_notes = $6,
        status = $3, updated_at = NOW()
      WHERE id = $1 AND user_id = $2
    `, [req.params.id, req.grantUserId, outcome, outcomeDate, outcomeAmount, outcomeNotes]);

    // Store de-identified analytics if user consented
    const userConsent = await pool.query(
      'SELECT consent_data_improvement FROM grant_users WHERE id = $1',
      [req.grantUserId]
    );

    if (userConsent.rows[0]?.consent_data_improvement) {
      const appData = await pool.query(
        `SELECT a.budget, a.program_id, p.funding_type
         FROM grant_applications a
         LEFT JOIN grant_programs p ON a.program_id = p.id
         WHERE a.id = $1`,
        [req.params.id]
      );
      const ad = appData.rows[0];
      const totalBudget = ad?.budget?.totalAmount || 0;
      const band = totalBudget < 10000 ? '<10K' :
                   totalBudget < 50000 ? '10K-50K' :
                   totalBudget < 100000 ? '50K-100K' : '100K+';

      await pool.query(`
        INSERT INTO grant_outcome_analytics (
          program_id, program_type, budget_band, outcome
        ) VALUES ($1, $2, $3, $4)
      `, [ad?.program_id, ad?.funding_type, band, outcome]);
    }

    res.json({ success: true, message: 'Outcome recorded' });
  } catch (error) {
    logger.error('[grant-wizard] Outcome recording error:', error);
    res.status(500).json({ success: false, error: 'Failed to record outcome' });
  }
});

// ============================================================
// GET /programs/stats/outcomes - Aggregated outcome stats (public)
// ============================================================
router.get('/programs/stats/outcomes', async (req, res) => {
  try {
    const pool = getPool(req);
    if (!pool) return res.status(500).json({ success: false, error: 'Database unavailable' });

    const result = await pool.query(`
      SELECT program_type, budget_band, outcome, COUNT(*) as count
      FROM grant_outcome_analytics
      GROUP BY program_type, budget_band, outcome
      ORDER BY program_type, budget_band
    `);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('[grant-wizard] Stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// ============================================================
// POST /consent/update - Update consent preferences (CASL)
// ============================================================
router.post('/consent/update', authenticateGrantUser, async (req, res) => {
  try {
    const pool = getPool(req);
    const { consentMarketingEmails, consentDataImprovement } = req.body;

    await pool.query(`
      UPDATE grant_users SET
        consent_marketing_emails = COALESCE($2, consent_marketing_emails),
        consent_data_improvement = COALESCE($3, consent_data_improvement),
        updated_at = NOW()
      WHERE id = $1
    `, [req.grantUserId, consentMarketingEmails, consentDataImprovement]);

    res.json({ success: true, message: 'Consent preferences updated' });
  } catch (error) {
    logger.error('[grant-wizard] Consent update error:', error);
    res.status(500).json({ success: false, error: 'Failed to update consent' });
  }
});

// ============================================================
// POST /unsubscribe/:token - CASL unsubscribe mechanism
// ============================================================
router.post('/unsubscribe/:token', async (req, res) => {
  try {
    const pool = getPool(req);
    if (!pool) return res.status(500).json({ success: false, error: 'Database unavailable' });

    // Token is a signed JWT with user ID
    const decoded = jwt.verify(req.params.token, JWT_SECRET);
    
    await pool.query(`
      UPDATE grant_users SET
        consent_marketing_emails = FALSE,
        updated_at = NOW()
      WHERE id = $1
    `, [decoded.userId]);

    res.json({ success: true, message: 'You have been unsubscribed from marketing emails' });
  } catch (error) {
    res.status(400).json({ success: false, error: 'Invalid or expired unsubscribe link' });
  }
});

// ============================================================
// POST /applications/:id/ai-draft - Generate AI draft for narrative question
// ============================================================
router.post('/applications/:id/ai-draft', authenticateGrantUser, async (req, res) => {
  if (!openai) {
    return res.status(503).json({
      success: false,
      error: 'AI drafting service not available (OpenAI API key not configured)'
    });
  }

  try {
    const pool = getPool(req);
    if (!pool) return res.status(500).json({ success: false, error: 'Database unavailable' });

    const appId = parseInt(req.params.id);
    const { question, userInput, programContext, organizationProfile, projectProfile } = req.body;

    if (!question || !userInput) {
      return res.status(400).json({
        success: false,
        error: 'Question and user input required'
      });
    }

    // Verify ownership
    const appResult = await pool.query(
      'SELECT id FROM grant_applications WHERE id = $1 AND user_id = $2',
      [appId, req.grantUserId]
    );
    if (appResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    // Build AI prompt — enriched with grant writing best practices from
    // U of T Anesthesia, Funding For Good, Imagine Canada, Western/UWO
    let prompt = `You are an expert grant writer helping a Canadian farmer write a compelling grant application. Transform their informal notes into polished, reviewer-ready narrative.\n\n`;
    prompt += `QUESTION: ${question}\n\n`;
    prompt += `FARMER'S NOTES: ${userInput}\n\n`;

    if (programContext) {
      prompt += `PROGRAM PRIORITIES & TERMINOLOGY: ${programContext}\n`;
      prompt += `(Mirror this exact language and terminology in the draft — funders use specific terms for a reason.)\n\n`;
    }

    if (organizationProfile) {
      prompt += `ORGANIZATION CONTEXT:\n`;
      if (organizationProfile.businessName) prompt += `- Business: ${organizationProfile.businessName}\n`;
      if (organizationProfile.organizationType) prompt += `- Type: ${organizationProfile.organizationType}\n`;
      if (organizationProfile.province) prompt += `- Location: ${organizationProfile.province}\n`;
      if (organizationProfile.employeeCount) prompt += `- Employees: ${organizationProfile.employeeCount}\n`;
      if (organizationProfile.farmDetails) prompt += `- Farm details: ${JSON.stringify(organizationProfile.farmDetails)}\n`;
    }

    if (projectProfile) {
      prompt += `\nPROJECT CONTEXT:\n`;
      if (projectProfile.projectTitle) prompt += `- Project: ${projectProfile.projectTitle}\n`;
      if (projectProfile.crops) prompt += `- Crops: ${projectProfile.crops}\n`;
      if (projectProfile.description) prompt += `- Description: ${projectProfile.description}\n`;
      if (projectProfile.startDate) prompt += `- Timeline: ${projectProfile.startDate} to ${projectProfile.endDate || 'TBD'}\n`;
    }

    prompt += `\nGRANT WRITING BEST PRACTICES TO APPLY:\n`;
    prompt += `1. Tell a compelling story — every paragraph should advance the narrative of community need and the plan to address it\n`;
    prompt += `2. Open each paragraph with a clear topic sentence so reviewers (who read dozens of grants) can navigate quickly\n`;
    prompt += `3. Use confident future-tense language ("will" not "might") and terms like "ground-breaking" and "cutting-edge" where appropriate\n`;
    prompt += `4. Include specific, measurable outcomes — reviewers need metrics they can show their board\n`;
    prompt += `5. Provide research context: "While X has been achieved, this project will advance the field by doing Y"\n`;
    prompt += `6. Connect budget line items to narrative claims — every dollar should support the story\n`;
    prompt += `7. Articulate the "so what?" — why this work is urgent, innovative, and ground-breaking in context\n`;
    prompt += `8. Write for generalist reviewers but with enough depth to convince experts\n`;
    prompt += `9. Emphasize community impact, food security, sustainability, innovation, and job creation\n`;
    prompt += `10. Maintain the farmer's authentic voice and specific details — don't genericize\n\n`;
    prompt += `Provide a polished 2-4 paragraph response. Return ONLY the draft text, no meta-commentary.`;

    // Call GPT-4
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are an expert grant writer specializing in Canadian and North American agricultural funding programs. Apply these core principles:\n" +
            "- STORYTELLING: Every grant is a story about real community needs and a credible plan to address them. Make the reviewer as excited as the applicant.\n" +
            "- REVIEWER EMPATHY: Write as if the reviewer has already read dozens of proposals today. Be concise, well-organized, and easy to follow.\n" +
            "- FUNDER ALIGNMENT: Mirror the funder's exact terminology and stated priorities. If they say 'food sovereignty' don't write 'food security'.\n" +
            "- EVIDENCE-BASED: Support claims with preliminary data, statistics, or concrete examples. Show feasibility.\n" +
            "- MEASURABLE IMPACT: Include specific numbers — acres, jobs, families served, yield improvements, revenue targets.\n" +
            "- FORWARD-LOOKING: Use future tense ('will achieve') not conditional ('might achieve'). Show confidence and capability.\n" +
            "- BUDGET-NARRATIVE LINK: Every budget item should connect to a narrative claim. Every narrative claim should be supported in the budget.\n" +
            "- PROACTIVE RISK: Address potential concerns before reviewers raise them.\n" +
            "- CLEAR STRUCTURE: Use topic sentences, logical paragraph flow, and section summaries. Bold headings when appropriate.\n" +
            "Write in clear, professional language. Maintain the applicant's authentic voice while elevating the prose to professional grant standards."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 800
    });

    const draftText = completion.choices[0].message.content;

    res.json({
      success: true,
      data: {
        draftText,
        originalInput: userInput,
        tokensUsed: completion.usage.total_tokens
      }
    });

  } catch (error) {
    logger.error('[grant-wizard] AI draft error:', error);
    res.status(500).json({
      success: false,
      error: 'AI drafting failed',
      details: error.message
    });
  }
});

// ============================================================
// Cleanup: expire old applications (called by cron/interval)
// ============================================================
export async function cleanupExpiredApplications(pool) {
  try {
    // Expire applications where the user hasn't signed in for 6+ months
    // Uses COALESCE: if user never logged in, fall back to account creation date
    const result = await pool.query(`
      UPDATE grant_applications a SET
        answers = '{}', facts_ledger = '{}', answers_document = NULL,
        budget_workbook = NULL, organization_profile = '{}', project_profile = '{}',
        budget = '{}', contacts = '[]', attachments_checklist = '[]',
        procurement_items = '[]', status = 'expired'
      FROM grant_users u
      WHERE a.user_id = u.id
        AND a.status NOT IN ('submitted', 'awarded', 'expired')
        AND COALESCE(u.last_login_at, u.created_at) + INTERVAL '${RETENTION_MONTHS} months' < NOW()
      RETURNING a.id
    `);

    // Delete associated export packs
    if (result.rows.length > 0) {
      const ids = result.rows.map(r => r.id);
      await pool.query(
        'DELETE FROM grant_export_packs WHERE application_id = ANY($1)',
        [ids]
      );
    }

    if (result.rows.length > 0) {
      logger.info(`[grant-wizard] Cleaned up ${result.rows.length} expired applications`);
    }
  } catch (error) {
    logger.error('[grant-wizard] Cleanup error:', error);
  }
}

export default router;
