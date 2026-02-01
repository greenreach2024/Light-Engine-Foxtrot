import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { adminAuthMiddleware, requireAdminRole } from '../middleware/adminAuth.js';
import adminAuthRoutes from './admin-auth.js';
import adminWholesaleRoutes from './admin-wholesale.js';
import adminRecipesRoutes from './admin-recipes.js';
import adminPricingRoutes from './admin-pricing.js';
import { getInMemoryGroups } from './sync.js';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RECIPES_DIR = path.join(__dirname, '../data/recipes-v2');
const AI_RULES_PATH = path.join(__dirname, '../data/ai-rules.json');
const ADMIN_SALT_ROUNDS = 12;

function generateTempPassword() {
    return crypto.randomBytes(8).toString('base64url');
}

function normalizeAdminRole(role) {
    const normalized = String(role || '').trim().toLowerCase();
    if (['admin', 'operations', 'support', 'viewer'].includes(normalized)) return normalized;
    return 'viewer';
}

const DEFAULT_AI_RULES = [
    {
        id: 'decision-support-first',
        title: 'Decision support first',
        category: 'Operating role & guardrails',
        priority: 'high',
        requiresReview: false,
        enabled: true,
        content: 'Default to recommendations + predicted outcomes, not guaranteed fixes. If the system can auto-actuate (smart plugs, dimmable lights, irrigation, nutrients), recommend an action plan but require the control layer to enforce safety limits + rate limits.'
    },
    {
        id: 'never-assume-missing-equipment',
        title: 'Never assume missing equipment',
        category: 'Operating role & guardrails',
        priority: 'high',
        requiresReview: false,
        enabled: true,
        content: 'Only recommend actions that match the available actuators (fans, dehumidifier, humidifier, dimmable lights, irrigation timing, nutrient dosing). If the obvious tool is not available, offer alternatives instead of repeating the same suggestion.'
    },
    {
        id: 'explain-constraints',
        title: 'Explain constraints explicitly',
        category: 'Operating role & guardrails',
        priority: 'medium',
        requiresReview: false,
        enabled: true,
        content: 'Always state why a perfect solution may be unavailable (no exhaust, ambient air likely humid, no heater) and then propose the best achievable improvements.'
    },
    {
        id: 'human-oversight-high-risk',
        title: 'Human oversight for high-risk actions',
        category: 'Operating role & guardrails',
        priority: 'high',
        requiresReview: true,
        enabled: true,
        content: 'Any recommendation that could affect worker safety, electrical loading, or crop loss must be flagged as needs review.'
    },
    {
        id: 'validate-sensor-plausibility',
        title: 'Validate ranges and plausibility before acting',
        category: 'Sensor sanity',
        priority: 'high',
        requiresReview: false,
        enabled: true,
        content: 'Check for impossible or suspicious readings (RH > 100%, sudden CO₂ jumps, temperature step changes). If data looks wrong, recommend holding actions, verifying sensors, cross-checking with another sensor, and inspecting placement.'
    },
    {
        id: 'trend-over-snapshot',
        title: 'Use trend over snapshot',
        category: 'Sensor sanity',
        priority: 'medium',
        requiresReview: false,
        enabled: true,
        content: 'Require a short rolling window (10–20 minutes) before big changes. If readings are drifting, propose small, reversible steps first.'
    },
    {
        id: 'gas-relative-indicator',
        title: 'GAS is a relative indicator',
        category: 'Sensor sanity',
        priority: 'medium',
        requiresReview: false,
        enabled: true,
        content: 'Treat gas resistance (kΩ) as a broad proxy for indoor air quality/VOCs. Use it to detect change and suggest inspection (standing water, cleaning chemicals, biofilm, off-gassing plastics), not precise diagnoses.'
    },
    {
        id: 'pressure-contextual',
        title: 'Pressure is contextual',
        category: 'Sensor sanity',
        priority: 'low',
        requiresReview: false,
        enabled: true,
        content: 'Pressure helps interpret weather/infiltration context but rarely justifies direct control changes by itself unless consistent correlations are observed.'
    },
    {
        id: 'prioritize-outcomes',
        title: 'Prioritize outcomes',
        category: 'Decision framework',
        priority: 'high',
        requiresReview: false,
        enabled: true,
        content: 'Order of priorities: prevent plant damage and disease risk → restore stable transpiration (VPD/condensation control) → improve quality/yield → minimize energy and equipment wear.'
    },
    {
        id: 'vpd-over-rh',
        title: 'Use VPD + condensation risk, not RH alone',
        category: 'Decision framework',
        priority: 'high',
        requiresReview: false,
        enabled: true,
        content: 'RH is useful, but condensation risk depends on leaf/surface temperature vs dew point. At very high RH, tiny temperature drops can cause condensation. VPD is the plant-facing metric.'
    },
    {
        id: 'ranked-options',
        title: 'Always propose 2–5 ranked options',
        category: 'Decision framework',
        priority: 'medium',
        requiresReview: false,
        enabled: true,
        content: 'Provide a ranked list (Best, Second-best, If you can’t do X). Include at least one no-new-hardware option and one operational schedule option.'
    },
    {
        id: 'predict-side-effects',
        title: 'Predict side-effects',
        category: 'Decision framework',
        priority: 'medium',
        requiresReview: false,
        enabled: true,
        content: 'Every action must include likely tradeoffs (raising temp reduces RH but increases water use; more airflow may cool canopy).' 
    },
    {
        id: 'hysteresis-min-run-time',
        title: 'Hysteresis + minimum run times',
        category: 'Actuation rules',
        priority: 'high',
        requiresReview: false,
        enabled: true,
        content: 'Fans/dehumidifiers/humidifiers must not toggle rapidly. Enforce minimum ON/OFF times (10–20 min) and deadbands around targets.'
    },
    {
        id: 'rate-limit-lights-nutrients',
        title: 'Rate-limit light and nutrient changes',
        category: 'Actuation rules',
        priority: 'high',
        requiresReview: false,
        enabled: true,
        content: 'Lights: limit dimming steps and frequency (max ±10% per 10 minutes unless emergency). Nutrients: never chase EC/pH rapidly; recommend incremental changes with verification.'
    },
    {
        id: 'avoid-conflicting-actions',
        title: 'Avoid conflicting actions',
        category: 'Actuation rules',
        priority: 'high',
        requiresReview: false,
        enabled: true,
        content: 'Do not run humidifier and dehumidifier together. Do not increase irrigation to cool when humidity is already the main problem. Do not dim lights for cooling if it drives VPD toward condensation risk unless heat stress is worse.'
    },
    {
        id: 'co2-safety-separation',
        title: 'CO₂: plant benefit vs people safety',
        category: 'CO₂ safety',
        priority: 'critical',
        requiresReview: true,
        enabled: true,
        content: 'If CO₂ is elevated unexpectedly, prioritize human safety and ventilation/alerts. Occupational exposure limits commonly cite 5,000 ppm TWA and 30,000 ppm short-term.'
    },
    {
        id: 'co2-enrichment-guidance',
        title: 'CO₂ enrichment guidance',
        category: 'CO₂ safety',
        priority: 'medium',
        requiresReview: false,
        enabled: true,
        content: 'Only enrich during lights-on / active photosynthesis. Many greenhouse references recommend staying around ~1,000–1,200 ppm when not ventilating (crop dependent).' 
    },
    {
        id: 'high-humidity-playbook',
        title: 'High-humidity playbook',
        category: 'High humidity',
        priority: 'high',
        requiresReview: false,
        enabled: true,
        content: 'Checklist: (1) confirm VPD + condensation risk; flag nighttime VPD below ~0.2–0.3 kPa. (2) Choose best moisture removal: dehumidify; or vent + heat; or limited exchange when outside is drier; or slight temp increase with warnings. (3) Reduce moisture sources: adjust irrigation timing, remove standing water, cover reservoirs. (4) Improve circulation to remove microclimates and canopy stagnation. Provide ranked action bundles.'
    },
    {
        id: 'recommendation-format',
        title: 'Recommendation format rules',
        category: 'Recommendation format',
        priority: 'medium',
        requiresReview: false,
        enabled: true,
        content: 'Always output: current conditions (Temp, RH, VPD, CO₂, Pressure, GAS kΩ + trend), primary diagnosis + confidence, 2–5 ranked actions, expected impact + side-effects, stop conditions and recheck time.'
    },
    {
        id: 'logging-requirement',
        title: 'Log everything',
        category: 'Recommendation format',
        priority: 'high',
        requiresReview: false,
        enabled: true,
        content: 'Each recommendation should be stored with inputs used, chosen actions, expected outcome, and follow-up result. This enables continuous improvement and governance.'
    },
    {
        id: 'dont-be-dumb-limits',
        title: 'Practical “don’t be dumb” limits',
        category: 'Safety limits',
        priority: 'critical',
        requiresReview: true,
        enabled: true,
        content: 'Never recommend overheating plants to lower RH, drastic nutrient EC/pH jumps, disabling airflow when humidity is high, or actions exceeding electrical circuit or smart plug limits.'
    },
    {
        id: 'escalation-conditions',
        title: 'Escalation conditions',
        category: 'Safety limits',
        priority: 'high',
        requiresReview: true,
        enabled: true,
        content: 'Escalate to manual intervention when RH stays high for hours despite actions, condensation/mold risk persists, CO₂ enters unsafe ranges, or sensors disagree/appear miscalibrated.'
    },
    {
        id: 'targets-note',
        title: 'Targets note',
        category: 'Targets & context',
        priority: 'low',
        requiresReview: false,
        enabled: true,
        content: 'Do not hardcode a universal RH/VPD target. Use broad guidance and note crop/stage specificity (e.g., leafy greens respond to VPD bands).'
    }
];

function normalizeAiRule(rule) {
    const now = new Date().toISOString();
    const baseId = String(rule?.id || '').trim();
    return {
        id: baseId || `ai-rule-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        title: String(rule?.title || '').trim() || 'Untitled Rule',
        category: String(rule?.category || '').trim() || 'General',
        priority: ['low', 'medium', 'high', 'critical'].includes(String(rule?.priority || '').toLowerCase())
            ? String(rule.priority).toLowerCase()
            : 'medium',
        requiresReview: Boolean(rule?.requiresReview),
        enabled: rule?.enabled !== false,
        content: String(rule?.content || '').trim(),
        createdAt: rule?.createdAt || now,
        updatedAt: now
    };
}

async function loadAiRules() {
    try {
        const raw = await fs.readFile(AI_RULES_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        const rules = Array.isArray(parsed?.rules) ? parsed.rules.map(normalizeAiRule) : [];
        return {
            rules,
            updatedAt: parsed?.updatedAt || null,
            updatedBy: parsed?.updatedBy || null
        };
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const payload = {
            rules: DEFAULT_AI_RULES.map(normalizeAiRule),
            updatedAt: new Date().toISOString(),
            updatedBy: 'system'
        };
        await fs.mkdir(path.dirname(AI_RULES_PATH), { recursive: true });
        await fs.writeFile(AI_RULES_PATH, JSON.stringify(payload, null, 2));
        return payload;
    }
}

async function saveAiRules(rules, updatedBy) {
    const payload = {
        rules: rules.map(normalizeAiRule),
        updatedAt: new Date().toISOString(),
        updatedBy: updatedBy || 'unknown'
    };
    await fs.mkdir(path.dirname(AI_RULES_PATH), { recursive: true });
    await fs.writeFile(AI_RULES_PATH, JSON.stringify(payload, null, 2));
    return payload;
}

function normalizeRecipeName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function getRecipeCategory(name) {
    const lowerName = String(name || '').toLowerCase();
    if (lowerName.includes('basil') || lowerName.includes('cilantro') ||
        lowerName.includes('parsley') || lowerName.includes('thyme') ||
        lowerName.includes('oregano') || lowerName.includes('rosemary') ||
        lowerName.includes('sage') || lowerName.includes('dill') ||
        lowerName.includes('tarragon') || lowerName.includes('marjoram') ||
        lowerName.includes('mint') || lowerName.includes('chervil') ||
        lowerName.includes('lovage') || lowerName.includes('lemon balm')) {
        return 'Herbs';
    }
    if (lowerName.includes('lettuce') || lowerName.includes('arugula') ||
        lowerName.includes('spinach') || lowerName.includes('kale') ||
        lowerName.includes('chard') || lowerName.includes('endive') ||
        lowerName.includes('escarole') || lowerName.includes('frisée') ||
        lowerName.includes('romaine') || lowerName.includes('oakleaf') ||
        lowerName.includes('butterhead') || lowerName.includes('pak choi') ||
        lowerName.includes('mizuna') || lowerName.includes('tatsoi') ||
        lowerName.includes('komatsuna') || lowerName.includes('mustard') ||
        lowerName.includes('watercress') || lowerName.includes('sorrel')) {
        return 'Leafy Greens';
    }
    if (lowerName.includes('tomato') || lowerName.includes('boy') ||
        lowerName.includes('brandywine') || lowerName.includes('celebrity') ||
        lowerName.includes('heatmaster') || lowerName.includes('marzano') ||
        lowerName.includes('gold')) {
        return 'Tomatoes';
    }
    if (lowerName.includes('strawberry') || lowerName.includes('albion') ||
        lowerName.includes('chandler') || lowerName.includes('eversweet') ||
        lowerName.includes('mara') || lowerName.includes('monterey') ||
        lowerName.includes('ozark') || lowerName.includes('seascape') ||
        lowerName.includes('sequoia') || lowerName.includes('tribute') ||
        lowerName.includes('tristar') || lowerName.includes('fort laramie') ||
        lowerName.includes('jewel')) {
        return 'Berries';
    }
    return 'Vegetables';
}

async function parseRecipeCSV(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    if (lines.length < 3) {
        throw new Error('Invalid recipe file format');
    }

    const tableName = lines[0].trim();
    const headers = lines[1].split(',').map(h => h.trim());
    const dataLines = lines.slice(2);

    const phases = dataLines.map(line => {
        const values = line.split(',').map(v => v.trim());
        const phase = {};
        headers.forEach((header, index) => {
            const value = values[index];
            if (value && !isNaN(value) && value !== '') {
                phase[header] = parseFloat(value);
            } else {
                phase[header] = value || '';
            }
        });
        return phase;
    });

    return {
        tableName,
        headers,
        phases,
        totalDays: dataLines.length
    };
}

function getAverageTemperature(schedule) {
    if (!Array.isArray(schedule) || schedule.length === 0) return null;
    const temps = schedule
        .map(day => day.temperature || day.tempC || day.afternoon_temp || day['Afternoon Temp (C)'])
        .map(temp => (typeof temp === 'string' ? parseFloat(temp) : temp))
        .filter(t => !Number.isNaN(t) && t > 0);
    if (temps.length === 0) return null;
    const sum = temps.reduce((a, b) => a + b, 0);
    return Math.round((sum / temps.length) * 10) / 10;
}

// Mount authentication routes (no auth required for login)
router.use('/auth', adminAuthRoutes);

// All routes below require admin authentication
router.use(adminAuthMiddleware);

// Mount wholesale admin routes
router.use('/wholesale', adminWholesaleRoutes);

// Mount recipes admin routes
router.use('/recipes', adminRecipesRoutes);

// Mount pricing authority routes
router.use('/pricing', adminPricingRoutes);

/**
 * GET /api/admin/ai-rules
 * Retrieve AI policy rules
 */
router.get('/ai-rules', async (req, res) => {
    try {
        const payload = await loadAiRules();
        return res.json({
            success: true,
            rules: payload.rules,
            updatedAt: payload.updatedAt,
            updatedBy: payload.updatedBy
        });
    } catch (error) {
        console.error('[Admin API] Error loading AI rules:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to load AI rules',
            message: error.message
        });
    }
});

/**
 * POST /api/admin/ai-rules
 * Replace AI policy rules
 */
router.post('/ai-rules', async (req, res) => {
    try {
        const rules = Array.isArray(req.body?.rules) ? req.body.rules : null;
        if (!rules) {
            return res.status(400).json({
                success: false,
                error: 'Rules array is required'
            });
        }

        const updatedBy = req.admin?.email || 'admin';
        const payload = await saveAiRules(rules, updatedBy);
        return res.json({
            success: true,
            rules: payload.rules,
            updatedAt: payload.updatedAt,
            updatedBy: payload.updatedBy
        });
    } catch (error) {
        console.error('[Admin API] Error saving AI rules:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to save AI rules',
            message: error.message
        });
    }
});

/**
 * DELETE /api/admin/farms/:farmId
 * Delete a farm (requires admin password confirmation)
 * Restricted to: admin role only
 */
router.delete('/farms/:farmId', requireAdminRole('admin'), async (req, res) => {
    try {
        const farmId = req.params.farmId;
        const { password } = req.body || {};

        if (!farmId) {
            return res.status(400).json({ status: 'error', message: 'Farm ID is required' });
        }

        if (!password) {
            return res.status(400).json({ status: 'error', message: 'Admin password is required' });
        }

        const dbAvailable = await isDatabaseAvailable();
        if (!dbAvailable) {
            return res.status(503).json({ status: 'error', message: 'Database not available' });
        }

        const adminEmail = req.admin?.email;
        if (!adminEmail) {
            return res.status(401).json({ status: 'error', message: 'Admin session not found' });
        }

        const dbEnabled = String(process.env.DB_ENABLED || 'false').toLowerCase() === 'true';
        if (dbEnabled) {
            const adminResult = await query(
                'SELECT id, password_hash FROM admin_users WHERE email = $1',
                [adminEmail.toLowerCase()]
            );

            if (!adminResult.rows.length) {
                return res.status(401).json({ status: 'error', message: 'Admin account not found' });
            }

            const passwordMatch = await bcrypt.compare(password, adminResult.rows[0].password_hash);
            if (!passwordMatch) {
                return res.status(401).json({ status: 'error', message: 'Invalid admin password' });
            }
        } else {
            const FALLBACK_ADMIN = {
                email: 'info@greenreachfarms.com',
                password: 'Admin2025!'
            };

            if (adminEmail.toLowerCase() !== FALLBACK_ADMIN.email.toLowerCase() || password !== FALLBACK_ADMIN.password) {
                return res.status(401).json({ status: 'error', message: 'Invalid admin password' });
            }
        }

        const farmResult = await query('SELECT farm_id FROM farms WHERE farm_id = $1', [farmId]);
        if (!farmResult.rows.length) {
            return res.status(404).json({ status: 'error', message: 'Farm not found' });
        }

        const deleted = await query('DELETE FROM farms WHERE farm_id = $1 RETURNING farm_id', [farmId]);

        return res.json({
            status: 'success',
            deleted: { farms: deleted.rowCount },
            farmIds: deleted.rows.map(row => row.farm_id)
        });
    } catch (error) {
        console.error('[Admin API] Error deleting farm:', error);
        return res.status(500).json({ status: 'error', message: error.message || 'Failed to delete farm' });
    }
});

/**
 * GET /api/admin/users
 * List admin users (employees)
 */
router.get('/users', async (req, res) => {
    try {
        if (!(await isDatabaseAvailable())) {
            return res.json({
                success: true,
                users: [],
                message: 'Database not available'
            });
        }

        const result = await query(
            `SELECT id, email, name, role, active, last_login, created_at
             FROM admin_users
             ORDER BY created_at DESC`
        );

        const users = result.rows.map(row => {
            const fullName = row.name || '';
            const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ');

            return {
                user_id: row.id,
                first_name: firstName,
                last_name: lastName,
                email: row.email,
                role: row.role || 'admin',
                status: row.active ? 'active' : 'inactive',
                last_login: row.last_login,
                created_at: row.created_at
            };
        });

        res.json({
            success: true,
            users
        });
    } catch (error) {
        console.error('[Admin API] Error fetching users:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load users',
            message: error.message
        });
    }
});

/**
 * POST /api/admin/users
 * Create admin user (employee)
 * Restricted to: admin role only
 */
router.post('/users', requireAdminRole('admin'), async (req, res) => {
    try {
        if (!(await isDatabaseAvailable())) {
            return res.status(503).json({
                success: false,
                error: 'Database not available'
            });
        }

        const { first_name, last_name, email, role, password } = req.body || {};
        if (!first_name || !last_name || !email) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const normalizedRole = normalizeAdminRole(role);
        const fullName = `${String(first_name).trim()} ${String(last_name).trim()}`.trim();

        const existing = await query('SELECT id FROM admin_users WHERE email = $1', [normalizedEmail]);
        if (existing.rows.length) {
            return res.status(409).json({
                success: false,
                error: 'User already exists'
            });
        }

        const tempPassword = password && String(password).trim()
            ? String(password).trim()
            : generateTempPassword();
        const passwordHash = await bcrypt.hash(tempPassword, ADMIN_SALT_ROUNDS);

        const result = await query(
            `INSERT INTO admin_users (email, password_hash, name, role, active, mfa_enabled)
             VALUES ($1, $2, $3, $4, true, false)
             RETURNING id, email, name, role, active, created_at`,
            [normalizedEmail, passwordHash, fullName, normalizedRole]
        );

        return res.json({
            success: true,
            user: {
                user_id: result.rows[0].id,
                email: result.rows[0].email,
                name: result.rows[0].name,
                role: result.rows[0].role,
                status: result.rows[0].active ? 'active' : 'inactive',
                created_at: result.rows[0].created_at,
                temporary_password: password ? undefined : tempPassword
            },
            temp_password: password ? undefined : tempPassword
        });
    } catch (error) {
        console.error('[Admin API] Error creating admin user:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create user',
            message: error.message
        });
    }
});

/**
 * PUT /api/admin/users/:userId
 * Update admin user
 * Restricted to: admin role only
 */
router.put('/users/:userId', requireAdminRole('admin'), async (req, res) => {
    try {
        if (!(await isDatabaseAvailable())) {
            return res.status(503).json({
                success: false,
                error: 'Database not available'
            });
        }

        const userId = Number(req.params.userId);
        if (!Number.isFinite(userId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user id'
            });
        }

        const { first_name, last_name, email, role, active } = req.body || {};
        if (!first_name || !last_name || !email) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const normalizedRole = normalizeAdminRole(role);
        const fullName = `${String(first_name).trim()} ${String(last_name).trim()}`.trim();

        const duplicate = await query('SELECT id FROM admin_users WHERE email = $1 AND id <> $2', [normalizedEmail, userId]);
        if (duplicate.rows.length) {
            return res.status(409).json({
                success: false,
                error: 'Email already in use'
            });
        }

        const result = await query(
            `UPDATE admin_users
             SET email = $1, name = $2, role = $3, active = $4
             WHERE id = $5
             RETURNING id, email, name, role, active, updated_at`,
            [normalizedEmail, fullName, normalizedRole, active !== false, userId]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        return res.json({
            success: true,
            user: {
                user_id: result.rows[0].id,
                email: result.rows[0].email,
                name: result.rows[0].name,
                role: result.rows[0].role,
                status: result.rows[0].active ? 'active' : 'inactive',
                updated_at: result.rows[0].updated_at
            }
        });
    } catch (error) {
        console.error('[Admin API] Error updating admin user:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update user',
            message: error.message
        });
    }
});

/**
 * DELETE /api/admin/users/:userId
 * Delete admin user
 * Restricted to: admin role only
 */
router.delete('/users/:userId', requireAdminRole('admin'), async (req, res) => {
    try {
        if (!(await isDatabaseAvailable())) {
            return res.status(503).json({
                success: false,
                error: 'Database not available'
            });
        }

        const userId = Number(req.params.userId);
        if (!Number.isFinite(userId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user id'
            });
        }

        const result = await query('DELETE FROM admin_users WHERE id = $1 RETURNING id', [userId]);
        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        return res.json({
            success: true,
            user_id: result.rows[0].id
        });
    } catch (error) {
        console.error('[Admin API] Error deleting admin user:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to delete user',
            message: error.message
        });
    }
});

/**
 * POST /api/admin/users/:userId/reset-password
 * Reset admin user password
 * Restricted to: admin, operations roles
 */
router.post('/users/:userId/reset-password', requireAdminRole('admin', 'operations'), async (req, res) => {
    try {
        if (!(await isDatabaseAvailable())) {
            return res.status(503).json({
                success: false,
                error: 'Database not available'
            });
        }

        const userId = Number(req.params.userId);
        if (!Number.isFinite(userId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user id'
            });
        }

        const tempPassword = generateTempPassword();
        const passwordHash = await bcrypt.hash(tempPassword, ADMIN_SALT_ROUNDS);

        const result = await query(
            `UPDATE admin_users
             SET password_hash = $1
             WHERE id = $2
             RETURNING id, email, name`,
            [passwordHash, userId]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        return res.json({
            success: true,
            temp_password: tempPassword,
            user: {
                user_id: result.rows[0].id,
                email: result.rows[0].email,
                name: result.rows[0].name
            }
        });
    } catch (error) {
        console.error('[Admin API] Error resetting admin password:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to reset password',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/farms
 * Get list of all farms in the network
 */
router.get('/farms', async (req, res) => {
    try {
        const { page = 1, limit = 50, status, region, search } = req.query;
        
        // Query actual farms from database
        let sqlQuery = 'SELECT * FROM farms WHERE 1=1';
        const params = [];
        let paramCount = 0;
        
        // Add filters
        if (status) {
            paramCount++;
            sqlQuery += ` AND status = $${paramCount}`;
            params.push(status);
        }
        
        if (search) {
            paramCount++;
            sqlQuery += ` AND (name ILIKE $${paramCount} OR farm_id ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }
        
        // Add pagination
        sqlQuery += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(parseInt(limit));
        params.push((parseInt(page) - 1) * parseInt(limit));
        
        // Get farms
        const result = await query(sqlQuery, params);
        
        // Get total count
        let countQuery = 'SELECT COUNT(*) FROM farms WHERE 1=1';
        const countParams = [];
        let countParamCount = 0;
        
        if (status) {
            countParamCount++;
            countQuery += ` AND status = $${countParamCount}`;
            countParams.push(status);
        }
        
        if (search) {
            countParamCount++;
            countQuery += ` AND (name ILIKE $${countParamCount} OR farm_id ILIKE $${countParamCount})`;
            countParams.push(`%${search}%`);
        }
        
        const countResult = await query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].count);
        
        // Format farms data
        const farms = result.rows.map(farm => ({
            id: farm.id,
            farmId: farm.farm_id,
            name: farm.name,
            status: farm.status,
            lastUpdate: farm.last_heartbeat,
            metadata: farm.metadata || {},
            createdAt: farm.created_at,
            updatedAt: farm.updated_at
        }));
        
        res.json({
            success: true,
            farms: farms,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('[Admin API] Error fetching farms:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch farms',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/farms/:farmId
 * Get detailed information for a specific farm
 */
router.get('/farms/:farmId', async (req, res) => {
    try {
        const { farmId } = req.params;
        console.log(`[Admin API] Fetching farm details for: ${farmId}`);
        
        // Query farm from database by farm_id
        const result = await query(
            'SELECT * FROM farms WHERE farm_id = $1',
            [farmId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Farm not found',
                message: `No farm found with ID: ${farmId}`
            });
        }
        
        const farmRow = result.rows[0];

        let roomsData = null;
        let groupsData = null;
        let telemetryData = null;

        if (await isDatabaseAvailable()) {
            const roomsResult = await query(
                `SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
                [farmId, 'rooms']
            );
            roomsData = roomsResult.rows[0]?.data || null;

            const groupsResult = await query(
                `SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
                [farmId, 'groups']
            );
            groupsData = groupsResult.rows[0]?.data || null;

            const telemetryResult = await query(
                `SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
                [farmId, 'telemetry']
            );
            telemetryData = telemetryResult.rows[0]?.data || null;
        } else {
            console.warn('[Admin API] Database unavailable for farm detail:', farmId);
        }

        const roomsCount = Array.isArray(roomsData) ? roomsData.length : 0;
        const zonesFromTelemetry = Array.isArray(telemetryData?.zones) ? telemetryData.zones : [];
        const zonesCount = zonesFromTelemetry.length || (Array.isArray(groupsData) ? groupsData.length : 0);
        const groupsCount = Array.isArray(groupsData) ? groupsData.length : 0;
        console.log('[Admin API] Farm data counts:', {
            farmId,
            roomsCount,
            zonesCount,
            telemetryZones: zonesFromTelemetry.length,
            groupsCount
        });

        const envSummary = zonesFromTelemetry.length ? {
            avgTemp: averageNumber(zonesFromTelemetry.map(z => z.sensors?.tempC?.current ?? z.temperature ?? z.tempC ?? null)),
            avgHumidity: averageNumber(zonesFromTelemetry.map(z => z.sensors?.rh?.current ?? z.humidity ?? z.rh ?? null)),
            avgVpd: averageNumber(zonesFromTelemetry.map(z => z.sensors?.vpd?.current ?? z.vpd ?? null))
        } : null;

        // Format farm data - only include fields that exist in DB
        const farm = {
            farmId: farmRow.farm_id,
            name: farmRow.name || 'Unknown Farm',
            status: farmRow.status || 'unknown',
            lastHeartbeat: farmRow.last_heartbeat || null,
            createdAt: farmRow.created_at || null,
            updatedAt: farmRow.updated_at || null,
            rooms: roomsCount,
            zones: zonesCount,
            groups: groupsCount,
            environmental: {
                zones: zonesFromTelemetry,
                summary: envSummary
            },
            // Include all raw data
            ...farmRow
        };

        res.json({
            success: true,
            farm: farm
        });
    } catch (error) {
        console.error(`[Admin API] Error fetching farm ${req.params.farmId}:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch farm details',
            message: error.message
        });
    }
});

function averageNumber(values) {
    const filtered = values.filter(v => typeof v === 'number' && Number.isFinite(v));
    if (!filtered.length) return null;
    return filtered.reduce((sum, v) => sum + v, 0) / filtered.length;
}

/**
 * GET /api/admin/farms/:farmId/rooms
 * Return rooms for a farm from synced data
 */
router.get('/farms/:farmId/rooms', async (req, res) => {
    try {
        const { farmId } = req.params;
        if (!(await isDatabaseAvailable())) {
            return res.json({ success: true, rooms: [], count: 0, farmId, source: 'memory' });
        }

        const result = await query(
            `SELECT data, updated_at FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
            [farmId, 'rooms']
        );
        const rooms = result.rows[0]?.data || [];
        const updatedAt = result.rows[0]?.updated_at || null;

        res.json({
            success: true,
            rooms,
            count: Array.isArray(rooms) ? rooms.length : 0,
            farmId,
            updatedAt
        });
    } catch (error) {
        console.error('[Admin API] Error fetching farm rooms:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch farm rooms', message: error.message });
    }
});

/**
 * GET /api/admin/farms/:farmId/zones
 * Return environmental zones for a farm from telemetry data
 */
router.get('/farms/:farmId/zones', async (req, res) => {
    try {
        const { farmId } = req.params;
        if (!(await isDatabaseAvailable())) {
            return res.json({ success: true, zones: [], count: 0, farmId, source: 'memory' });
        }

        const telemetryResult = await query(
            `SELECT data, updated_at FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
            [farmId, 'telemetry']
        );
        const telemetry = telemetryResult.rows[0]?.data || {};
        const zones = Array.isArray(telemetry.zones) ? telemetry.zones : [];
        const updatedAt = telemetryResult.rows[0]?.updated_at || null;

        res.json({
            success: true,
            zones,
            count: zones.length,
            farmId,
            updatedAt
        });
    } catch (error) {
        console.error('[Admin API] Error fetching farm zones:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch farm zones', message: error.message });
    }
});

/**
 * GET /api/admin/farms/:farmId/groups
 * Get groups data for a specific farm
 */
router.get('/farms/:farmId/groups', async (req, res) => {
    try {
        const { farmId } = req.params;
        if (!(await isDatabaseAvailable())) {
            return res.json({ success: true, groups: [], count: 0, farmId, source: 'memory' });
        }

        const groupsResult = await query(
            `SELECT data, updated_at FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
            [farmId, 'groups']
        );
        const groupsData = groupsResult.rows[0]?.data || [];
        const groups = Array.isArray(groupsData) ? groupsData : [];
        const updatedAt = groupsResult.rows[0]?.updated_at || null;

        res.json({
            success: true,
            groups,
            count: groups.length,
            farmId,
            updatedAt
        });
    } catch (error) {
        console.error('[Admin API] Error fetching farm groups:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch farm groups', message: error.message });
    }
});

/**
 * GET /api/admin/rooms
 * Aggregate rooms across all farms
 */
router.get('/rooms', async (req, res) => {
    try {
        if (!(await isDatabaseAvailable())) {
            return res.json({ success: true, rooms: [], count: 0, source: 'memory' });
        }

        const result = await query(
            `SELECT farm_id, data, updated_at FROM farm_data WHERE data_type = $1`,
            ['rooms']
        );

        const rooms = result.rows.flatMap(row => {
            const list = Array.isArray(row.data) ? row.data : [];
            return list.map(room => ({ ...room, farmId: row.farm_id, updatedAt: row.updated_at }));
        });

        res.json({ success: true, rooms, count: rooms.length });
    } catch (error) {
        console.error('[Admin API] Error fetching rooms:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch rooms', message: error.message });
    }
});

/**
 * GET /api/admin/zones
 * Aggregate environmental zones across all farms from telemetry
 */
router.get('/zones', async (req, res) => {
    try {
        if (!(await isDatabaseAvailable())) {
            return res.json({ success: true, zones: [], count: 0, source: 'memory' });
        }

        const result = await query(
            `SELECT farm_id, data, updated_at FROM farm_data WHERE data_type = $1`,
            ['telemetry']
        );

        const zones = result.rows.flatMap(row => {
            const telemetry = row.data || {};
            const list = Array.isArray(telemetry.zones) ? telemetry.zones : [];
            return list.map(zone => ({ ...zone, farmId: row.farm_id, updatedAt: row.updated_at }));
        });

        res.json({ success: true, zones, count: zones.length });
    } catch (error) {
        console.error('[Admin API] Error fetching zones:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch zones', message: error.message });
    }
});

/**
 * GET /api/admin/kpis
 * Get platform-wide KPIs
 */
router.get('/kpis', async (req, res) => {
    try {
        // Query real data from database - handle missing tables gracefully
        let totalFarms = 0, activeFarms = 0, totalOrders = 0, revenue = 0;
        
        try {
            // Count farms with status 'active' or recently active (heartbeat within 10 minutes)
            const farmsResult = await query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (
                        WHERE status = 'active' 
                        OR (last_heartbeat IS NOT NULL AND last_heartbeat > NOW() - INTERVAL '10 minutes')
                    ) as active 
                FROM farms
            `);
            totalFarms = parseInt(farmsResult.rows[0].total);
            activeFarms = parseInt(farmsResult.rows[0].active);
        } catch (e) {
            console.warn('[Admin API] Farms table query failed:', e.message);
        }
        
        try {
            const ordersResult = await query('SELECT COUNT(*) as total, COALESCE(SUM((order_data->>\'total\')::numeric), 0) as revenue FROM orders WHERE status != $1', ['cancelled']);
            totalOrders = parseInt(ordersResult.rows[0].total);
            revenue = parseFloat(ordersResult.rows[0].revenue);
        } catch (e) {
            console.warn('[Admin API] Orders table query failed:', e.message);
        }
        
        res.json({
            success: true,
            kpis: {
                totalFarms,
                activeFarms,
                totalOrders,
                revenue,
                alerts: 0
            }
        });
    } catch (error) {
        console.error('[Admin API] Error fetching KPIs:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch KPIs',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/analytics/aggregate
 * Get aggregated analytics data
 */
router.get('/analytics/aggregate', async (req, res) => {
    try {
        // Query real data from database - handle missing tables gracefully
        let totalFarms = 0, totalRooms = 0, totalZones = 0, totalDevices = 0, totalTrays = 0, totalPlants = 0;
        
        try {
            const farmsResult = await query('SELECT COUNT(*) as total FROM farms');
            totalFarms = parseInt(farmsResult.rows[0].total);
        } catch (e) {
            console.warn('[Admin API] Farms table query failed:', e.message);
        }
        
        // Aggregate from farm_data table
        try {
            const roomsResult = await query("SELECT data FROM farm_data WHERE data_type = 'rooms'");
            roomsResult.rows.forEach(row => {
                if (Array.isArray(row.data)) totalRooms += row.data.length;
            });
        } catch (e) {
            console.warn('[Admin API] Rooms data query failed:', e.message);
        }
        
        try {
            const groupsResult = await query("SELECT data FROM farm_data WHERE data_type = 'groups'");
            const uniqueZones = new Set();
            groupsResult.rows.forEach(row => {
                if (Array.isArray(row.data)) {
                    row.data.forEach(group => {
                        // Count unique zones, not groups
                        if (group.zone) uniqueZones.add(group.zone);

                        const trayCount = Array.isArray(group.trays)
                            ? group.trays.length
                            : (Number.isFinite(group.trays) ? group.trays : 0);
                        totalTrays += trayCount;

                        const plants = Number.isFinite(group.plants)
                            ? group.plants
                            : (trayCount > 0 ? trayCount * 48 : 0);
                        totalPlants += plants;
                    });
                }
            });
            totalZones = uniqueZones.size;
        } catch (e) {
            console.warn('[Admin API] Groups data query failed:', e.message);
        }
        
        // Return top-level fields (UI expects this structure)
        res.json({
            success: true,
            totalFarms,
            totalRooms,
            totalZones,
            totalDevices,
            totalTrays,
            totalPlants,
            mode: 'live'
        });
    } catch (error) {
        console.error('[Admin API] Error fetching analytics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch analytics',
            message: error.message
        });
    }
});

/**
 * POST /api/admin/farms/sync-all-stats
 * Trigger sync for all farm statistics
 */
router.post('/farms/sync-all-stats', async (req, res) => {
    try {
        console.log('[Admin API] Sync all farm stats requested');
        
        // Get all active farms
        const farmsResult = await query('SELECT farm_id, name FROM farms WHERE status = $1', ['online']);
        const farms = farmsResult.rows;
        
        console.log(`[Admin API] Found ${farms.length} active farms to sync`);
        
        res.json({
            success: true,
            sync: {
                total: farms.length,
                farms: farms.map(f => ({ farm_id: f.farm_id, name: f.name })),
                message: 'Farms are automatically syncing via edge sync service.',
                note: farms.length === 1
                    ? '1 farm was online at the time of query. Edge devices sync rooms, groups, inventory, and telemetry every 30-300 seconds.'
                    : `${farms.length} farms were online at the time of query. Edge devices sync rooms, groups, inventory, and telemetry every 30-300 seconds.`
            }
        });
    } catch (error) {
        console.error('[Admin API] Error syncing farm stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to sync farm stats',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/analytics/farms/:farmId/metrics
 * Returns farm-specific analytics metrics
 */
router.get('/analytics/farms/:farmId/metrics', async (req, res) => {
    try {
        const { farmId } = req.params;
        const days = parseInt(req.query.days) || 7;
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        if (!(await isDatabaseAvailable())) {
            return res.json({
                farmId,
                days,
                summary: {
                    totalProduction: 0,
                    totalRevenue: 0,
                    daysReported: 0,
                    avgYield: 0,
                    topCrop: null
                },
                metrics: [],
                modelPerformance: {
                    temperatureForecast: null,
                    harvestTiming: null,
                    energyPrediction: null
                }
            });
        }

        const farmResult = await query(
            'SELECT id FROM farms WHERE farm_id = $1',
            [farmId]
        );

        if (farmResult.rows.length === 0) {
            return res.status(404).json({ error: 'Farm not found' });
        }

        const farmPk = farmResult.rows[0].id;

        let metricsRows = [];
        try {
            const metricsResult = await query(`
                SELECT 
                    recorded_at,
                    room_count,
                    zone_count,
                    device_count,
                    tray_count,
                    plant_count,
                    energy_24h,
                    alert_count
                FROM farm_metrics
                WHERE farm_id = $1 AND recorded_at >= $2
                ORDER BY recorded_at ASC
            `, [farmPk, cutoffDate]);
            metricsRows = metricsResult.rows || [];
        } catch (e) {
            console.warn('[Admin API] farm_metrics query failed:', e.message);
        }

        let topCrop = null;
        try {
            const inventoryResult = await query(`
                SELECT 
                    COUNT(*) as total_trays,
                    SUM(plant_count) as total_plants,
                    recipe_name
                FROM farm_inventory
                WHERE farm_id = $1 AND status IN ('growing', 'ready', 'harvested')
                GROUP BY recipe_name
                ORDER BY COUNT(*) DESC
                LIMIT 1
            `, [farmPk]);
            if (inventoryResult.rows.length > 0) {
                topCrop = inventoryResult.rows[0].recipe_name;
            }
        } catch (e) {
            console.warn('[Admin API] farm_inventory query failed:', e.message);
        }

        res.json({
            farmId,
            days,
            summary: {
                totalProduction: 0,
                totalRevenue: 0,
                daysReported: metricsRows.length,
                avgYield: 0,
                topCrop
            },
            metrics: metricsRows,
            modelPerformance: {
                temperatureForecast: null,
                harvestTiming: null,
                energyPrediction: null
            }
        });
    } catch (error) {
        console.error('[Admin API] Error fetching farm analytics:', error);
        res.status(500).json({
            error: 'Failed to fetch analytics data',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/anomalies
 * Aggregate ML anomaly detections across farms
 */
router.get('/anomalies', async (req, res) => {
    try {
        if (!(await isDatabaseAvailable())) {
            return res.json({ success: true, anomalies: [], mlEnabled: false });
        }

        const farmsResult = await query('SELECT farm_id, name FROM farms');
        const farmNameById = new Map(farmsResult.rows.map(row => [row.farm_id, row.name || row.farm_id]));

        const dataTypes = ['anomalies', 'ml-anomalies', 'ml_anomalies', 'ml_anomaly', 'anomaly'];
        const anomaliesResult = await query(
            `SELECT farm_id, data, updated_at FROM farm_data WHERE data_type = ANY($1)`,
            [dataTypes]
        );

        const anomalies = anomaliesResult.rows.flatMap(row => {
            const payload = row.data || {};
            
            // Skip error states (ML gated, outdoor sensor validation failed, etc.)
            if (payload.error || payload.ml_gated) {
                console.log(`[Admin API] Skipping error state for farm ${row.farm_id}: ${payload.error || 'ML gated'}`);
                return [];
            }
            
            const list = Array.isArray(payload) ? payload : (Array.isArray(payload.anomalies) ? payload.anomalies : []);
            return list.map(item => ({
                ...item,
                farmId: row.farm_id,
                farmName: farmNameById.get(row.farm_id) || row.farm_id,
                lastUpdated: row.updated_at
            }));
        });

        res.json({
            success: true,
            anomalies,
            mlEnabled: anomalies.length > 0
        });
    } catch (error) {
        console.error('[Admin API] Error fetching anomalies:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch anomalies',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/fleet/monitoring
 * Fleet monitoring summary + deployments table data
 */
router.get('/fleet/monitoring', async (req, res) => {
    try {
        if (!(await isDatabaseAvailable())) {
            return res.json({
                success: true,
                summary: {
                    connectedFarms: 0,
                    monthlyRecurringRevenue: 0,
                    totalZones: 0,
                    connectedSensors: 0,
                    fleetHealthScore: 0,
                    activeAlerts: 0
                },
                deployments: []
            });
        }

        const farmsResult = await query(
            `SELECT farm_id, name, status, metadata, settings, last_heartbeat, updated_at
             FROM farms
             ORDER BY created_at DESC`
        );

        const telemetryResult = await query(
            `SELECT farm_id, data, updated_at
             FROM farm_data
             WHERE data_type = $1`,
            ['telemetry']
        );

        const telemetryByFarm = new Map();
        telemetryResult.rows.forEach(row => {
            telemetryByFarm.set(row.farm_id, { data: row.data || {}, updatedAt: row.updated_at });
        });

        const deployments = farmsResult.rows.map(row => {
            const farmId = row.farm_id;
            const telemetry = telemetryByFarm.get(farmId);
            const telemetryData = telemetry?.data || {};
            const zones = Array.isArray(telemetryData.zones) ? telemetryData.zones : [];

            const sensorCounts = zones.reduce((acc, zone) => {
                const sensors = zone?.sensors && typeof zone.sensors === 'object' ? zone.sensors : null;
                if (!sensors) return acc;
                Object.values(sensors).forEach(sensor => {
                    const current = sensor?.current ?? sensor?.value;
                    if (current !== null && current !== undefined) {
                        acc.current += 1;
                    }
                    acc.total += 1;
                });
                return acc;
            }, { current: 0, total: 0 });

            const status = (row.status || 'unknown').toLowerCase();
            const baseHealth = status === 'online' ? 95
                : status === 'warning' ? 80
                : status === 'critical' ? 50
                : status === 'offline' ? 40
                : 60;

            const lastSeen = telemetry?.updatedAt || row.last_heartbeat || row.updated_at || null;
            const lastSeenAgeMs = lastSeen ? Date.now() - new Date(lastSeen).getTime() : null;
            const healthScore = Number.isFinite(lastSeenAgeMs) && lastSeenAgeMs > 24 * 60 * 60 * 1000
                ? Math.max(10, baseHealth - 20)
                : baseHealth;

            const telemetryBytes = telemetryData ? Buffer.byteLength(JSON.stringify(telemetryData)) : 0;
            const dataStorageMB = telemetryBytes ? Math.round((telemetryBytes / (1024 * 1024)) * 10) / 10 : 0;

            const plan = row.settings?.plan || row.settings?.tier || row.metadata?.plan || 'Starter';

            return {
                farmId,
                farmName: row.name || farmId,
                plan,
                status: status.toUpperCase(),
                sensors: {
                    current: sensorCounts.current,
                    total: sensorCounts.total,
                    limit: Number.isFinite(row.settings?.sensorLimit) ? row.settings.sensorLimit : null
                },
                apiCalls30d: null,
                dataStorageMB,
                healthScore,
                lastSeen
            };
        });

        const connectedFarms = farmsResult.rows.filter(row => (row.status || '').toLowerCase() === 'online').length;
        const totalZones = telemetryResult.rows.reduce((acc, row) => {
            const zones = Array.isArray(row.data?.zones) ? row.data.zones.length : 0;
            return acc + zones;
        }, 0);
        const connectedSensors = deployments.reduce((acc, d) => acc + (d.sensors?.current || 0), 0);
        const fleetHealthScore = deployments.length
            ? Math.round(deployments.reduce((acc, d) => acc + (Number.isFinite(d.healthScore) ? d.healthScore : 0), 0) / deployments.length)
            : 0;

        res.json({
            success: true,
            summary: {
                connectedFarms,
                monthlyRecurringRevenue: 0,
                totalZones,
                connectedSensors,
                fleetHealthScore,
                activeAlerts: 0
            },
            deployments
        });
    } catch (error) {
        console.error('[Admin API] Error fetching fleet monitoring:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load fleet monitoring',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/alerts
 * Get platform-wide alerts from all farms
 * 
 * ALERTS vs ANOMALY DETECTION:
 * 
 * ALERTS:
 * - Rule-based thresholds (e.g., temp > 30°C = alert)
 * - Immediate actionable notifications
 * - Triggered by specific conditions being met
 * - Require human acknowledgment and resolution
 * - Examples: Temperature too high, device offline, harvest deadline missed
 * - Sources: Equipment sensors, system monitors, business logic
 * 
 * ANOMALY DETECTION:
 * - ML-based pattern recognition (Isolation Forest algorithm)
 * - Identifies unusual patterns that may not trigger rule-based alerts
 * - Learns from historical data to detect deviations from normal behavior
 * - May or may not require immediate action (investigative)
 * - Examples: Unusual energy consumption pattern, gradual environmental drift
 * - Sources: ML models analyzing 24h+ rolling windows of data
 * 
 * Both systems complement each other:
 * - Alerts catch known problems (reactive)
 * - Anomaly detection catches unknown/emerging problems (proactive)
 */
router.get('/alerts', async (req, res) => {
    try {
        const { severity, status, farm_id, limit = 50 } = req.query;
        const now = new Date();

        if (!(await isDatabaseAvailable())) {
            return res.json({
                success: true,
                alerts: [],
                summary: {
                    total: 0,
                    active: 0,
                    acknowledged: 0,
                    resolved: 0,
                    critical: 0,
                    warning: 0,
                    info: 0
                },
                timestamp: now.toISOString()
            });
        }

        const conditions = [];
        const params = [];
        let paramIndex = 1;

        if (severity) {
            conditions.push(`fa.severity = $${paramIndex}`);
            params.push(severity);
            paramIndex++;
        }

        if (farm_id) {
            conditions.push(`f.farm_id = $${paramIndex}`);
            params.push(farm_id);
            paramIndex++;
        }

        if (status) {
            if (status === 'active') {
                conditions.push('fa.resolved = false AND fa.acknowledged = false');
            } else if (status === 'acknowledged') {
                conditions.push('fa.acknowledged = true AND fa.resolved = false');
            } else if (status === 'resolved') {
                conditions.push('fa.resolved = true');
            }
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        let summaryResult;
        let alertsResult;
        try {
            summaryResult = await query(
                `SELECT
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE fa.resolved = false AND fa.acknowledged = false) as active,
                    COUNT(*) FILTER (WHERE fa.acknowledged = true AND fa.resolved = false) as acknowledged,
                    COUNT(*) FILTER (WHERE fa.resolved = true) as resolved,
                    COUNT(*) FILTER (WHERE fa.severity = 'critical') as critical,
                    COUNT(*) FILTER (WHERE fa.severity = 'warning') as warning,
                    COUNT(*) FILTER (WHERE fa.severity = 'info') as info
                 FROM farm_alerts fa
                 JOIN farms f ON f.id = fa.farm_id
                 ${whereClause}`,
                params
            );

            alertsResult = await query(
                `SELECT
                    fa.id,
                    fa.alert_type,
                    fa.severity,
                    fa.message,
                    fa.zone_id,
                    fa.device_id,
                    fa.acknowledged,
                    fa.acknowledged_by,
                    fa.acknowledged_at,
                    fa.resolved,
                    fa.resolved_at,
                    fa.created_at,
                    f.farm_id,
                    f.name as farm_name
                 FROM farm_alerts fa
                 JOIN farms f ON f.id = fa.farm_id
                 ${whereClause}
                 ORDER BY fa.created_at DESC
                 LIMIT $${params.length + 1}`,
                [...params, parseInt(limit)]
            );
        } catch (dbError) {
            const message = dbError?.message || '';
            if (message.includes('relation') && message.includes('farm_alerts')) {
                return res.json({
                    success: true,
                    alerts: [],
                    summary: {
                        total: 0,
                        active: 0,
                        acknowledged: 0,
                        resolved: 0,
                        critical: 0,
                        warning: 0,
                        info: 0
                    },
                    timestamp: now.toISOString()
                });
            }
            throw dbError;
        }

        const summaryRow = summaryResult.rows[0] || {};
        const summary = {
            total: parseInt(summaryRow.total || 0),
            active: parseInt(summaryRow.active || 0),
            acknowledged: parseInt(summaryRow.acknowledged || 0),
            resolved: parseInt(summaryRow.resolved || 0),
            critical: parseInt(summaryRow.critical || 0),
            warning: parseInt(summaryRow.warning || 0),
            info: parseInt(summaryRow.info || 0)
        };

        const alerts = alertsResult.rows.map(row => {
            const statusValue = row.resolved
                ? 'resolved'
                : row.acknowledged
                ? 'acknowledged'
                : 'active';

            return {
                id: row.id,
                timestamp: row.created_at,
                farm_id: row.farm_id,
                farm_name: row.farm_name,
                severity: row.severity,
                type: row.alert_type,
                category: row.alert_type,
                message: row.message,
                status: statusValue,
                acknowledged: row.acknowledged,
                acknowledged_by: row.acknowledged_by,
                acknowledged_at: row.acknowledged_at,
                resolved: row.resolved,
                resolved_at: row.resolved_at,
                context: row.zone_id || row.device_id ? {
                    zone_id: row.zone_id,
                    device_id: row.device_id
                } : null
            };
        });

        res.json({
            success: true,
            alerts,
            summary,
            timestamp: now.toISOString()
        });
    } catch (error) {
        console.error('[Admin API] Error fetching alerts:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch alerts',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/farms/:farmId/config
 * Get farm configuration settings
 */
router.get('/farms/:farmId/config', async (req, res) => {
    try {
        const { farmId } = req.params;
        console.log(`[Admin API] Fetching config for farm: ${farmId}`);
        
        // Query farm configuration
        const farmResult = await query(
            'SELECT farm_id, name, email, api_url, metadata, settings, created_at, updated_at FROM farms WHERE farm_id = $1',
            [farmId]
        );
        
        if (farmResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Farm not found'
            });
        }
        
        const farm = farmResult.rows[0];
        
        // Get API keys count (don't expose actual keys)
        let apiKeyCount = 0;
        try {
            const keysResult = await query(
                'SELECT COUNT(*) as count FROM farm_api_keys WHERE farm_id = $1 AND active = true',
                [farmId]
            );
            apiKeyCount = parseInt(keysResult.rows[0]?.count || 0);
        } catch (e) {
            console.warn('[Admin API] farm_api_keys table not available');
        }
        
        // Get device registration count
        let deviceCount = 0;
        try {
            const devicesResult = await query(
                'SELECT COUNT(*) as count FROM devices WHERE farm_id = $1',
                [farmId]
            );
            deviceCount = parseInt(devicesResult.rows[0]?.count || 0);
        } catch (e) {
            console.warn('[Admin API] devices table not available');
        }
        
        const config = {
            farmId: farm.farm_id,
            farmName: farm.name,
            contactEmail: farm.email,
            apiUrl: farm.api_url || null,
            network: {
                localIP: farm.metadata?.network?.local_ip || null,
                publicIP: farm.metadata?.network?.public_ip || null,
                hostname: farm.metadata?.network?.hostname || null
            },
            apiKeys: {
                count: apiKeyCount,
                hasActive: apiKeyCount > 0
            },
            devices: {
                count: deviceCount,
                types: farm.metadata?.devices?.types || []
            },
            integrations: {
                square: farm.settings?.square?.connected || false,
                wholesale: farm.settings?.wholesale?.enabled || false,
                notifications: farm.settings?.notifications || {}
            },
            notifications: {
                email: farm.settings?.notifications?.email || true,
                sms: farm.settings?.notifications?.sms || false,
                slack: farm.settings?.notifications?.slack || false,
                alerts: {
                    system: farm.settings?.notifications?.alerts?.system || true,
                    environmental: farm.settings?.notifications?.alerts?.environmental || true,
                    inventory: farm.settings?.notifications?.alerts?.inventory || false
                }
            },
            settings: farm.settings || {},
            metadata: farm.metadata || {},
            createdAt: farm.created_at,
            updatedAt: farm.updated_at
        };
        
        res.json({
            success: true,
            config
        });
        
    } catch (error) {
        console.error(`[Admin API] Error fetching farm config:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch farm configuration',
            message: error.message
        });
    }
});

/**
 * PATCH /api/admin/farms/:farmId/config
 * Update farm configuration settings
 * Restricted to: admin, operations roles
 */
router.patch('/farms/:farmId/config', requireAdminRole('admin', 'operations'), async (req, res) => {
    try {
        const { farmId } = req.params;
        const { apiUrl, notifications, settings } = req.body;
        
        console.log(`[Admin API] Updating config for farm: ${farmId}`);
        
        // Build update query dynamically
        const updates = [];
        const params = [farmId];
        let paramCount = 1;
        
        if (apiUrl !== undefined) {
            paramCount++;
            updates.push(`api_url = $${paramCount}`);
            params.push(apiUrl);
        }
        
        if (notifications) {
            // Merge with existing settings
            const farmResult = await query('SELECT settings FROM farms WHERE farm_id = $1', [farmId]);
            const currentSettings = farmResult.rows[0]?.settings || {};
            currentSettings.notifications = { ...currentSettings.notifications, ...notifications };
            
            paramCount++;
            updates.push(`settings = $${paramCount}`);
            params.push(JSON.stringify(currentSettings));
        } else if (settings) {
            paramCount++;
            updates.push(`settings = $${paramCount}`);
            params.push(JSON.stringify(settings));
        }
        
        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid updates provided'
            });
        }
        
        // Add updated_at
        paramCount++;
        updates.push(`updated_at = $${paramCount}`);
        params.push(new Date().toISOString());
        
        const updateQuery = `UPDATE farms SET ${updates.join(', ')} WHERE farm_id = $1 RETURNING *`;
        const result = await query(updateQuery, params);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Farm not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Farm configuration updated successfully',
            farm: result.rows[0]
        });
        
    } catch (error) {
        console.error(`[Admin API] Error updating farm config:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to update farm configuration',
            message: error.message
        });
    }
});

/**
 * PATCH /api/admin/farms/:farmId/notes
 * Update farm notes (internal GreenReach Central notes)
 * Restricted to: admin, operations, support roles
 */
router.patch('/farms/:farmId/notes', requireAdminRole('admin', 'operations', 'support'), async (req, res) => {
    try {
        const { farmId } = req.params;
        const { notes } = req.body;
        
        console.log(`[Admin API] Updating notes for farm: ${farmId}`);
        
        if (notes === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Notes field is required'
            });
        }
        
        // Get current settings to merge notes into
        const farmResult = await query('SELECT settings FROM farms WHERE farm_id = $1', [farmId]);
        
        if (farmResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Farm not found'
            });
        }
        
        const currentSettings = farmResult.rows[0]?.settings || {};
        currentSettings.notes = notes;
        
        const result = await query(
            `UPDATE farms SET settings = $1, updated_at = $2 WHERE farm_id = $3 RETURNING *`,
            [JSON.stringify(currentSettings), new Date().toISOString(), farmId]
        );
        
        res.json({
            success: true,
            message: 'Farm notes updated successfully',
            notes: notes
        });
        
    } catch (error) {
        console.error(`[Admin API] Error updating farm notes:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to update farm notes',
            message: error.message
        });
    }
});

/**
 * PATCH /api/admin/farms/:farmId/metadata
 * Update farm contact metadata and sync to edge device
 * Restricted to: admin, operations roles
 */
router.patch('/farms/:farmId/metadata', requireAdminRole('admin', 'operations'), async (req, res) => {
    try {
        const { farmId } = req.params;
        const { contact } = req.body;
        
        console.log(`[Admin API] Updating metadata for farm: ${farmId}`, contact);
        
        if (!contact || typeof contact !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Contact object is required'
            });
        }
        
        // Get current farm data
        const farmResult = await query('SELECT * FROM farms WHERE farm_id = $1', [farmId]);
        
        if (farmResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Farm not found'
            });
        }
        
        const farm = farmResult.rows[0];
        const currentMetadata = farm.metadata || {};
        
        // Update metadata.contact with new information
        const updatedMetadata = {
            ...currentMetadata,
            contact: {
                ...(currentMetadata.contact || {}),
                owner: contact.owner || currentMetadata.contact?.owner,
                name: contact.contactName || contact.name || currentMetadata.contact?.name,
                contactName: contact.contactName || contact.name || currentMetadata.contact?.contactName,
                phone: contact.phone || currentMetadata.contact?.phone,
                email: contact.email || currentMetadata.contact?.email,
                website: contact.website || currentMetadata.contact?.website,
                address: contact.address || currentMetadata.contact?.address
            }
        };
        
        // Update farm metadata in database
        await query(
            `UPDATE farms SET metadata = $1, updated_at = $2 WHERE farm_id = $3`,
            [JSON.stringify(updatedMetadata), new Date().toISOString(), farmId]
        );
        
        // Push update to edge device if farm is online
        let syncStatus = 'not_attempted';
        try {
            const apiUrl = farm.api_url || currentMetadata.url;
            if (apiUrl) {
                console.log(`[Admin API] Attempting to sync metadata to edge device at ${apiUrl}`);
                
                // Build the update payload for edge device
                const edgeUpdatePayload = {
                    contact: {
                        owner: contact.owner,
                        name: contact.contactName || contact.name,
                        phone: contact.phone,
                        email: contact.email,
                        website: contact.website,
                        address: contact.address
                    }
                };
                
                // Call edge device API to update farm.json
                const edgeResponse = await fetch(`${apiUrl}/api/config/farm-metadata`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': process.env.SYNC_API_KEY || 'default-sync-key'
                    },
                    body: JSON.stringify(edgeUpdatePayload),
                    timeout: 5000
                });
                
                if (edgeResponse.ok) {
                    syncStatus = 'synced';
                    console.log(`[Admin API] Successfully synced metadata to edge device`);
                } else {
                    syncStatus = 'sync_failed';
                    console.warn(`[Admin API] Edge device sync failed: ${edgeResponse.status}`);
                }
            } else {
                syncStatus = 'no_api_url';
                console.log(`[Admin API] No API URL available for edge sync`);
            }
        } catch (syncError) {
            syncStatus = 'sync_error';
            console.error(`[Admin API] Error syncing to edge device:`, syncError.message);
        }
        
        res.json({
            success: true,
            message: 'Farm metadata updated successfully',
            syncStatus,
            metadata: updatedMetadata
        });
        
    } catch (error) {
        console.error(`[Admin API] Error updating farm metadata:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to update farm metadata',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/farms/:farmId/logs
 * Get system logs for a specific farm
 */
router.get('/farms/:farmId/logs', async (req, res) => {
    try {
        const { farmId } = req.params;
        const { type, limit = 100, offset = 0 } = req.query;
        
        console.log(`[Admin API] Fetching logs for farm: ${farmId}`);
        
        const logs = [];
        
        // Try to get audit logs from admin_audit_log table
        try {
            let auditQuery = `
                SELECT 
                    id,
                    admin_id,
                    action,
                    resource_type,
                    resource_id,
                    metadata,
                    ip_address,
                    created_at
                FROM admin_audit_log
                WHERE resource_id = $1 OR metadata::text LIKE $2
                ORDER BY created_at DESC
                LIMIT $3 OFFSET $4
            `;
            
            const auditResult = await query(auditQuery, [
                farmId,
                `%${farmId}%`,
                parseInt(limit),
                parseInt(offset)
            ]);
            
            logs.push(...auditResult.rows.map(row => ({
                id: row.id,
                type: 'user_activity',
                level: 'info',
                action: row.action,
                message: `${row.action} on ${row.resource_type || 'farm'}`,
                resourceType: row.resource_type,
                resourceId: row.resource_id,
                userId: row.admin_id,
                ipAddress: row.ip_address,
                metadata: row.metadata,
                timestamp: row.created_at
            })));
        } catch (e) {
            console.warn('[Admin API] admin_audit_log table not available:', e.message);
        }
        
        // Try to get device connection logs
        try {
            const deviceQuery = `
                SELECT 
                    'device_connection' as type,
                    'info' as level,
                    device_id,
                    'Device heartbeat' as action,
                    last_seen,
                    metadata
                FROM devices
                WHERE farm_id = $1
                ORDER BY last_seen DESC
                LIMIT 20
            `;
            
            const deviceResult = await query(deviceQuery, [farmId]);
            
            logs.push(...deviceResult.rows.map(row => ({
                type: 'device_connection',
                level: 'info',
                action: 'heartbeat',
                message: `Device ${row.device_id} check-in`,
                deviceId: row.device_id,
                metadata: row.metadata,
                timestamp: row.last_seen
            })));
        } catch (e) {
            console.warn('[Admin API] devices table query failed:', e.message);
        }
        
        // Try to get farm heartbeat logs
        try {
            const heartbeatQuery = `
                SELECT 
                    'api_call' as type,
                    'info' as level,
                    'heartbeat' as action,
                    last_heartbeat,
                    metadata
                FROM farms
                WHERE farm_id = $1
            `;
            
            const hbResult = await query(heartbeatQuery, [farmId]);
            
            if (hbResult.rows.length > 0) {
                const row = hbResult.rows[0];
                logs.push({
                    type: 'api_call',
                    level: 'info',
                    action: 'farm_heartbeat',
                    message: 'Farm heartbeat received',
                    metadata: row.metadata,
                    timestamp: row.last_heartbeat
                });
            }
        } catch (e) {
            console.warn('[Admin API] heartbeat query failed:', e.message);
        }
        
        // Add mock system events if no real logs available
        if (logs.length === 0) {
            const now = new Date();
            logs.push(
                {
                    id: 1,
                    type: 'system_event',
                    level: 'info',
                    action: 'system_start',
                    message: 'Farm system initialized',
                    timestamp: new Date(now - 3600000).toISOString()
                },
                {
                    id: 2,
                    type: 'api_call',
                    level: 'info',
                    action: 'api_request',
                    message: 'GET /api/admin/farms/' + farmId,
                    timestamp: new Date(now - 1800000).toISOString()
                },
                {
                    id: 3,
                    type: 'warning',
                    level: 'warning',
                    action: 'high_temperature',
                    message: 'Temperature threshold exceeded in Room 1',
                    timestamp: new Date(now - 900000).toISOString()
                },
                {
                    id: 4,
                    type: 'device_connection',
                    level: 'info',
                    action: 'device_online',
                    message: 'Light controller LT-001 connected',
                    timestamp: new Date(now - 600000).toISOString()
                },
                {
                    id: 5,
                    type: 'user_activity',
                    level: 'info',
                    action: 'settings_updated',
                    message: 'Farm configuration updated',
                    timestamp: new Date(now - 300000).toISOString()
                }
            );
        }
        
        // Sort by timestamp desc
        logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Filter by type if specified
        const filteredLogs = type ? logs.filter(log => log.type === type) : logs;
        
        res.json({
            success: true,
            logs: filteredLogs.slice(0, parseInt(limit)),
            total: filteredLogs.length,
            hasMore: filteredLogs.length > parseInt(limit)
        });
        
    } catch (error) {
        console.error(`[Admin API] Error fetching logs:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch farm logs',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/farms/:farmId/devices
 * Get devices registered to a specific farm
 */
router.get('/farms/:farmId/devices', async (req, res) => {
    try {
        const { farmId } = req.params;
        console.log(`[Admin API] Fetching devices for farm: ${farmId}`);
        
        // Try to get devices from farm_data sync table
        let devices = [];
        try {
            const result = await query(
                `SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
                [farmId, 'devices']
            );
            
            if (result.rows.length > 0) {
                devices = result.rows[0].data || [];
            }
        } catch (e) {
            console.warn('[Admin API] farm_data table not available:', e.message);
        }
        
        // If no synced devices, return empty array
        res.json({
            success: true,
            devices: devices,
            count: devices.length,
            farmId: farmId
        });
        
    } catch (error) {
        console.error(`[Admin API] Error fetching devices:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch farm devices',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/farms/:farmId/inventory
 * Get inventory for a specific farm
 */
router.get('/farms/:farmId/inventory', async (req, res) => {
    try {
        const { farmId } = req.params;
        console.log(`[Admin API] Fetching inventory for farm: ${farmId}`);
        
        // Try to get inventory from farm_inventory table
        let inventory = [];
        try {
            const result = await query(
                `SELECT * FROM farm_inventory WHERE farm_id = $1 ORDER BY last_updated DESC`,
                [farmId]
            );
            
            inventory = result.rows.map(row => ({
                productId: row.product_id,
                productName: row.product_name,
                sku: row.sku,
                quantity: row.quantity,
                unit: row.unit,
                price: row.price,
                availableForWholesale: row.available_for_wholesale,
                lastUpdated: row.last_updated
            }));
        } catch (e) {
            console.warn('[Admin API] farm_inventory table not available:', e.message);
        }
        
        res.json({
            success: true,
            inventory: inventory,
            count: inventory.length,
            farmId: farmId
        });
        
    } catch (error) {
        console.error(`[Admin API] Error fetching inventory:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch farm inventory',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/farms/:farmId/recipes
 * Get active recipes for a specific farm (from synced group data)
 */
router.get('/farms/:farmId/recipes', async (req, res) => {
    try {
        const { farmId } = req.params;
        const db = req.app.locals.db;
        
        if (!db) {
            return res.json({
                success: true,
                recipes: [],
                count: 0,
                farmId: farmId,
                message: 'Database not available'
            });
        }
        
        // Get groups from farm_data (synced from edge device)
        const result = await db.query(
            `SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = 'groups'`,
            [farmId]
        );
        
        let activeRecipes = [];
        
        if (result.rows.length > 0) {
            let groups = result.rows[0].data;
            if (typeof groups === 'string') {
                try {
                    groups = JSON.parse(groups);
                } catch (parseError) {
                    console.warn('[Admin API] Failed to parse groups JSON:', parseError.message);
                    groups = [];
                }
            }
            if (!Array.isArray(groups)) {
                groups = [];
            }
            
            // Extract active recipes from groups
            // Each group has an active recipe assigned
            const recipeMap = new Map();
            const recipeNameToGroups = new Map();

            groups.forEach(group => {
                const recipeName = group.active_recipe || group.recipe_name || group.recipeName || group.recipe || group.crop;
                if (!recipeName) return;

                const key = recipeName.trim();
                if (!recipeMap.has(key)) {
                    recipeMap.set(key, {
                        name: recipeName,
                        id: recipeName.toLowerCase().replace(/\s+/g, '-'),
                        groups: 0,
                        trays: 0,
                        category: group.crop_type || getRecipeCategory(recipeName)
                    });
                    recipeNameToGroups.set(key, []);
                }

                const recipe = recipeMap.get(key);
                recipe.groups++;
                recipe.trays += Array.isArray(group.trays) ? group.trays.length : (group.trays || 0);
                recipeNameToGroups.get(key).push(group);
            });

            const recipeFiles = await fs.readdir(RECIPES_DIR).catch(() => []);
            const recipeFileMap = new Map();
            recipeFiles.filter(f => f.endsWith('.csv')).forEach(file => {
                const name = file.replace(/-Table 1\.csv$/, '').replace(/\.csv$/, '');
                recipeFileMap.set(normalizeRecipeName(name), file);
            });

            const today = new Date();
            activeRecipes = await Promise.all(Array.from(recipeMap.values()).map(async recipe => {
                const normalized = normalizeRecipeName(recipe.name);
                const file = recipeFileMap.get(normalized);
                let schedule = [];
                let totalDays = null;
                let avgTemp = null;

                if (file) {
                    try {
                        const parsed = await parseRecipeCSV(path.join(RECIPES_DIR, file));
                        schedule = parsed.phases || [];
                        totalDays = parsed.totalDays || schedule.length || null;
                        avgTemp = getAverageTemperature(schedule);
                    } catch (err) {
                        console.warn(`[Admin API] Failed to parse recipe file ${file}:`, err.message);
                    }
                }

                const groupsForRecipe = recipeNameToGroups.get(recipe.name) || [];
                const seedDates = groupsForRecipe
                    .map(group => group.planConfig?.anchor?.seedDate || group.planSeedDate || group.seedDate)
                    .filter(Boolean)
                    .map(dateStr => new Date(dateStr))
                    .filter(dateObj => !Number.isNaN(dateObj.getTime()));

                let seedDateMin = null;
                let seedDateMax = null;
                let currentDayMin = null;
                let currentDayMax = null;
                let daysRemainingMin = null;
                let daysRemainingMax = null;

                if (seedDates.length > 0) {
                    seedDates.sort((a, b) => a - b);
                    seedDateMin = seedDates[0];
                    seedDateMax = seedDates[seedDates.length - 1];

                    const daysSinceSeed = seedDates.map(d => Math.max(0, Math.floor((today - d) / (1000 * 60 * 60 * 24))));
                    currentDayMin = Math.min(...daysSinceSeed) + 1;
                    currentDayMax = Math.max(...daysSinceSeed) + 1;

                    if (totalDays != null) {
                        const daysRemaining = daysSinceSeed.map(days => Math.max(0, totalDays - (days + 1)));
                        daysRemainingMin = Math.min(...daysRemaining);
                        daysRemainingMax = Math.max(...daysRemaining);
                    }
                }

                return {
                    recipe_id: recipe.id,
                    id: recipe.id,
                    name: recipe.name,
                    category: recipe.category,
                    total_days: totalDays,
                    schedule_length: schedule.length,
                    avg_temp_c: avgTemp,
                    groups_running: recipe.groups,
                    trays_running: recipe.trays,
                    seed_date_min: seedDateMin ? seedDateMin.toISOString().split('T')[0] : null,
                    seed_date_max: seedDateMax ? seedDateMax.toISOString().split('T')[0] : null,
                    current_day_min: currentDayMin,
                    current_day_max: currentDayMax,
                    days_remaining_min: daysRemainingMin,
                    days_remaining_max: daysRemainingMax,
                    description: `Growing recipe for ${recipe.name}`,
                    data: { schedule }
                };
            }));
        }

        if (activeRecipes.length === 0) {
            try {
                const syncResponse = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/sync/${farmId}/groups`);
                if (syncResponse.ok) {
                    const syncData = await syncResponse.json();
                    const groups = Array.isArray(syncData.groups) ? syncData.groups : [];
                    if (groups.length > 0) {
                        const recipeMap = new Map();
                        const recipeNameToGroups = new Map();

                        groups.forEach(group => {
                            const recipeName = group.active_recipe || group.recipe_name || group.recipeName || group.recipe || group.crop;
                            if (!recipeName) return;
                            const key = recipeName.trim();
                            if (!recipeMap.has(key)) {
                                recipeMap.set(key, {
                                    name: recipeName,
                                    id: recipeName.toLowerCase().replace(/\s+/g, '-'),
                                    groups: 0,
                                    trays: 0,
                                    category: group.crop_type || getRecipeCategory(recipeName)
                                });
                                recipeNameToGroups.set(key, []);
                            }
                            const recipe = recipeMap.get(key);
                            recipe.groups++;
                            recipe.trays += Array.isArray(group.trays) ? group.trays.length : (group.trays || 0);
                            recipeNameToGroups.get(key).push(group);
                        });

                        const recipeFiles = await fs.readdir(RECIPES_DIR).catch(() => []);
                        const recipeFileMap = new Map();
                        recipeFiles.filter(f => f.endsWith('.csv')).forEach(file => {
                            const name = file.replace(/-Table 1\.csv$/, '').replace(/\.csv$/, '');
                            recipeFileMap.set(normalizeRecipeName(name), file);
                        });

                        const today = new Date();
                        activeRecipes = await Promise.all(Array.from(recipeMap.values()).map(async recipe => {
                            const normalized = normalizeRecipeName(recipe.name);
                            const file = recipeFileMap.get(normalized);
                            let schedule = [];
                            let totalDays = null;
                            let avgTemp = null;

                            if (file) {
                                try {
                                    const parsed = await parseRecipeCSV(path.join(RECIPES_DIR, file));
                                    schedule = parsed.phases || [];
                                    totalDays = parsed.totalDays || schedule.length || null;
                                    avgTemp = getAverageTemperature(schedule);
                                } catch (err) {
                                    console.warn(`[Admin API] Failed to parse recipe file ${file}:`, err.message);
                                }
                            }

                            const groupsForRecipe = recipeNameToGroups.get(recipe.name) || [];
                            const seedDates = groupsForRecipe
                                .map(group => group.planConfig?.anchor?.seedDate || group.planSeedDate || group.seedDate)
                                .filter(Boolean)
                                .map(dateStr => new Date(dateStr))
                                .filter(dateObj => !Number.isNaN(dateObj.getTime()));

                            let seedDateMin = null;
                            let seedDateMax = null;
                            let currentDayMin = null;
                            let currentDayMax = null;
                            let daysRemainingMin = null;
                            let daysRemainingMax = null;

                            if (seedDates.length > 0) {
                                seedDates.sort((a, b) => a - b);
                                seedDateMin = seedDates[0];
                                seedDateMax = seedDates[seedDates.length - 1];

                                const daysSinceSeed = seedDates.map(d => Math.max(0, Math.floor((today - d) / (1000 * 60 * 60 * 24))));
                                currentDayMin = Math.min(...daysSinceSeed) + 1;
                                currentDayMax = Math.max(...daysSinceSeed) + 1;

                                if (totalDays != null) {
                                    const daysRemaining = daysSinceSeed.map(days => Math.max(0, totalDays - (days + 1)));
                                    daysRemainingMin = Math.min(...daysRemaining);
                                    daysRemainingMax = Math.max(...daysRemaining);
                                }
                            }

                            return {
                                recipe_id: recipe.id,
                                id: recipe.id,
                                name: recipe.name,
                                category: recipe.category,
                                total_days: totalDays,
                                schedule_length: schedule.length,
                                avg_temp_c: avgTemp,
                                groups_running: recipe.groups,
                                trays_running: recipe.trays,
                                seed_date_min: seedDateMin ? seedDateMin.toISOString().split('T')[0] : null,
                                seed_date_max: seedDateMax ? seedDateMax.toISOString().split('T')[0] : null,
                                current_day_min: currentDayMin,
                                current_day_max: currentDayMax,
                                days_remaining_min: daysRemainingMin,
                                days_remaining_max: daysRemainingMax,
                                description: `Growing recipe for ${recipe.name}`,
                                data: { schedule }
                            };
                        }));
                    }
                }
            } catch (error) {
                console.warn('[Admin API] Fallback sync groups failed:', error.message);
            }
        }
        
        res.json({
            success: true,
            recipes: activeRecipes,
            count: activeRecipes.length,
            farmId: farmId
        });
        
    } catch (error) {
        console.error(`[Admin API] Error fetching farm recipes:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch farm recipes',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/energy/dashboard
 * Get energy usage dashboard data
 */
router.get('/energy/dashboard', async (req, res) => {
    try {
        console.log('[Admin API] Fetching energy dashboard data');
        
        // Return mock data structure for now
        // TODO: Implement real energy monitoring when available
        const now = new Date();
        const mockData = {
            summary: {
                totalConsumption: 1250.5, // kWh
                cost: 187.58, // USD
                peakDemand: 45.2, // kW
                avgDemand: 28.3, // kW
                period: '30 days'
            },
            byFarm: [
                {
                    farmId: 'GR-00001',
                    farmName: 'Farm Alpha',
                    consumption: 850.3,
                    cost: 127.54,
                    percentOfTotal: 68
                },
                {
                    farmId: 'GR-00002',
                    farmName: 'Farm Beta',
                    consumption: 400.2,
                    cost: 60.04,
                    percentOfTotal: 32
                }
            ],
            hourly: Array.from({ length: 24 }, (_, i) => ({
                hour: i,
                consumption: 25 + Math.random() * 20,
                timestamp: new Date(now.getTime() - (24 - i) * 3600000).toISOString()
            })),
            alerts: []
        };
        
        res.json({
            success: true,
            data: mockData,
            timestamp: now.toISOString(),
            demo: true
        });
        
    } catch (error) {
        console.error('[Admin API] Error fetching energy dashboard:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch energy dashboard',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/harvest/forecast
 * Get harvest forecast data across all farms
 * Calculates expected harvest dates based on seed dates and recipe cycle times
 */
router.get('/harvest/forecast', async (req, res) => {
    try {
        console.log('[Admin API] Fetching harvest forecast data');

        const dbAvailable = await isDatabaseAvailable();

        // Load lighting recipes to get cycle times
        const recipesPath = path.join(__dirname, '../public/data/lighting-recipes.json');
        let recipesData = {};
        try {
            const recipesContent = await fs.readFile(recipesPath, 'utf8');
            recipesData = JSON.parse(recipesContent);
        } catch (error) {
            console.warn('[Harvest Forecast] Could not load lighting recipes:', error.message);
        }

        // Get cycle time for a recipe (max day in recipe)
        function getRecipeCycleTime(recipeName) {
            const crops = recipesData.crops || {};
            const recipeData = crops[recipeName];
            if (!recipeData || !Array.isArray(recipeData) || recipeData.length === 0) {
                return 30; // Default 30 days if recipe not found
            }
            const maxDay = Math.max(...recipeData.map(stage => stage.day || 0));
            return Math.ceil(maxDay);
        }

        let groupsPayloads = [];
        let dataSource = 'memory';

        if (dbAvailable) {
            const groupsResult = await query(
                `SELECT farm_id, data FROM farm_data WHERE data_type = 'groups'`
            );
            groupsPayloads = groupsResult.rows.map(row => row.data);
            dataSource = 'database';
        } else {
            const groupsMap = getInMemoryGroups();
            groupsPayloads = Array.from(groupsMap.values());
        }

        const now = new Date();
        const forecasts = {
            sevenDay: [],
            fourteenDay: [],
            thirtyDay: [],
            thirtyPlus: []
        };

        let totalTraysThisWeek = 0;
        let totalTraysThisCycle = 0;
        let recipeStats = {};

        function coerceNumber(value) {
            if (value === null || value === undefined) return null;
            const num = typeof value === 'string' ? parseFloat(value) : Number(value);
            return Number.isFinite(num) ? num : null;
        }

        function computeTrayAndPlantCounts(group) {
            let trayCount = 0;
            let plantCount = 0;

            if (Array.isArray(group.trays)) {
                trayCount = group.trays.length;
                const trayPlants = group.trays
                    .map(tray => coerceNumber(tray.plantCount ?? tray.plants ?? tray.plant_count))
                    .filter(value => value && value > 0);
                if (trayPlants.length > 0) {
                    plantCount = trayPlants.reduce((sum, value) => sum + value, 0);
                }
            } else {
                trayCount = coerceNumber(group.trays) || coerceNumber(group.tray_count) || coerceNumber(group.trayCount) || 0;
            }

            if (trayCount <= 0) {
                trayCount = 1;
            }

            if (plantCount <= 0) {
                const perTray = coerceNumber(group.plants_per_tray)
                    || coerceNumber(group.plantsPerTray)
                    || coerceNumber(group.plant_count)
                    || coerceNumber(group.plantCount)
                    || coerceNumber(group.plantsPerTrayCount)
                    || null;
                if (perTray && perTray > 0) {
                    plantCount = perTray * trayCount;
                } else {
                    const totalPlants = coerceNumber(group.plants) || coerceNumber(group.total_plants) || null;
                    if (totalPlants && totalPlants > 0) {
                        plantCount = totalPlants;
                    } else {
                        plantCount = trayCount * 128;
                    }
                }
            }

            return { trayCount, plantCount };
        }

        // Process each farm's groups
        for (const payload of groupsPayloads) {
            let groups = payload;
            if (typeof groups === 'string') {
                try {
                    groups = JSON.parse(groups);
                } catch (e) {
                    continue;
                }
            }
            if (!Array.isArray(groups)) continue;

            // Process each group
            for (const group of groups) {
                const recipeName = group.active_recipe || group.recipe_name || group.recipeName || group.recipe;
                const seedDateStr = group.seed_date || group.seedDate || group.planted_date;
                
                if (!recipeName || !seedDateStr) continue;

                // Parse seed date
                let seedDate;
                try {
                    seedDate = new Date(seedDateStr);
                    if (isNaN(seedDate.getTime())) continue;
                } catch (e) {
                    continue;
                }

                // Get cycle time and calculate harvest date
                const cycleTime = getRecipeCycleTime(recipeName);
                const harvestDate = new Date(seedDate.getTime() + cycleTime * 24 * 60 * 60 * 1000);
                const daysUntilHarvest = Math.ceil((harvestDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

                // Skip if already harvested (negative days)
                if (daysUntilHarvest < 0) continue;

                const { trayCount, plantCount } = computeTrayAndPlantCounts(group);

                // Bucket into time ranges
                if (daysUntilHarvest <= 7) {
                    forecasts.sevenDay.push({ trayCount, plantCount, recipeName, harvestDate });
                    totalTraysThisWeek += trayCount;
                } else if (daysUntilHarvest <= 14) {
                    forecasts.fourteenDay.push({ trayCount, plantCount, recipeName, harvestDate });
                } else if (daysUntilHarvest <= 30) {
                    forecasts.thirtyDay.push({ trayCount, plantCount, recipeName, harvestDate });
                } else {
                    forecasts.thirtyPlus.push({ trayCount, plantCount, recipeName, harvestDate });
                }

                // Count for current cycle (30 days)
                if (daysUntilHarvest <= 30) {
                    totalTraysThisCycle += trayCount;
                }

                // Track recipe statistics
                if (!recipeStats[recipeName]) {
                    recipeStats[recipeName] = {
                        count: 0,
                        trays: 0,
                        totalCycleTime: 0
                    };
                }
                recipeStats[recipeName].count++;
                recipeStats[recipeName].trays += trayCount;
                recipeStats[recipeName].totalCycleTime += cycleTime;
            }
        }

        // Calculate aggregated forecast
        const forecastSummary = {
            sevenDay: {
                trays: forecasts.sevenDay.reduce((sum, f) => sum + f.trayCount, 0),
                plants: forecasts.sevenDay.reduce((sum, f) => sum + f.plantCount, 0)
            },
            fourteenDay: {
                trays: forecasts.fourteenDay.reduce((sum, f) => sum + f.trayCount, 0),
                plants: forecasts.fourteenDay.reduce((sum, f) => sum + f.plantCount, 0)
            },
            thirtyDay: {
                trays: forecasts.thirtyDay.reduce((sum, f) => sum + f.trayCount, 0),
                plants: forecasts.thirtyDay.reduce((sum, f) => sum + f.plantCount, 0)
            },
            thirtyPlus: {
                trays: forecasts.thirtyPlus.reduce((sum, f) => sum + f.trayCount, 0),
                plants: forecasts.thirtyPlus.reduce((sum, f) => sum + f.plantCount, 0)
            }
        };

        // Calculate recipe performance metrics
        let bestPerformer = "N/A";
        let mostPopular = "N/A";
        let fastestCycle = "N/A";
        
        if (Object.keys(recipeStats).length > 0) {
            // Most popular by tray count
            const sortedByTrays = Object.entries(recipeStats).sort((a, b) => b[1].trays - a[1].trays);
            if (sortedByTrays.length > 0) {
                mostPopular = `${sortedByTrays[0][0]} (${sortedByTrays[0][1].trays} trays)`;
            }

            // Fastest cycle (lowest average cycle time)
            const sortedByCycle = Object.entries(recipeStats)
                .map(([name, stats]) => [name, stats.totalCycleTime / stats.count])
                .sort((a, b) => a[1] - b[1]);
            if (sortedByCycle.length > 0) {
                fastestCycle = `${sortedByCycle[0][0]} (${Math.round(sortedByCycle[0][1])} days avg)`;
            }

            // Best performer - for now, same as most popular
            // TODO: Calculate based on actual harvest success rate when available
            bestPerformer = mostPopular.split(' (')[0] + " (N/A success)";
        }

        // Calculate success rate (placeholder - would need harvest history)
        const successRate = "N/A";

        const response = {
            thisWeek: String(totalTraysThisWeek),
            thisCycle: String(totalTraysThisCycle),
            successRate: successRate,
            upcomingTrays: String(forecastSummary.sevenDay.trays),
            forecast: forecastSummary,
            recipePerformance: {
                bestPerformer,
                mostPopular,
                fastestCycle
            },
            dataSource,
            groupsCount: groupsPayloads.length,
            timestamp: now.toISOString()
        };

        console.log('[Harvest Forecast] Generated forecast:', response);
        res.json(response);

    } catch (error) {
        console.error('[Admin API] Error fetching harvest forecast:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch harvest forecast',
            message: error.message
        });
    }
});

export default router;
