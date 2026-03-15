/**
 * Public Delivery Driver Applications API
 * Unauthenticated endpoint for prospective drivers to submit applications
 *
 * Endpoints:
 *   POST /api/delivery/driver-applications  - Submit a new driver application
 *   GET  /api/delivery/driver-applications/:id - Check application status (by applicationId)
 */

import express from 'express';
import { randomUUID } from 'crypto';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = express.Router();

// Rate limit: max 5 applications per IP per hour (simple in-memory)
const appRateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5;

function checkRateLimit(ip) {
  const now = Date.now();
  const key = ip || 'unknown';
  const entry = appRateLimit.get(key);
  if (!entry || (now - entry.windowStart) > RATE_LIMIT_WINDOW) {
    appRateLimit.set(key, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// Clean up rate limit map periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of appRateLimit) {
    if ((now - entry.windowStart) > RATE_LIMIT_WINDOW) appRateLimit.delete(key);
  }
}, 15 * 60 * 1000);

/**
 * POST / - Submit a driver application
 * Body: { firstName, lastName, name, email, phone, address, city, postalCode,
 *         vehicleType, vehicleYear, vehicleMakeModel, licenceClass, insuranceInfo,
 *         availability, preferredZones, foodCertStatus, experience, agreements }
 */
router.post('/', async (req, res) => {
  try {
    // Rate limit check
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ success: false, error: 'Too many applications submitted. Please try again later.' });
    }

    const {
      firstName, lastName, name, email, phone,
      address, city, postalCode,
      vehicleType, vehicleYear, vehicleMakeModel, licenceClass, insuranceInfo,
      availability, preferredZones, foodCertStatus, experience,
      agreements
    } = req.body;

    // Validate required fields
    const fullName = name || `${firstName || ''} ${lastName || ''}`.trim();
    if (!fullName || fullName.length < 2) {
      return res.status(400).json({ success: false, error: 'Full name is required (first and last name).' });
    }
    if (!phone || phone.replace(/\D/g, '').length < 10) {
      return res.status(400).json({ success: false, error: 'A valid phone number is required.' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'A valid email address is required.' });
    }
    if (!vehicleType) {
      return res.status(400).json({ success: false, error: 'Vehicle type is required.' });
    }
    if (!agreements || !agreements.backgroundCheck || !agreements.foodSafety || !agreements.insurance || !agreements.independentContractor || !agreements.termsAndPrivacy) {
      return res.status(400).json({ success: false, error: 'All agreements must be acknowledged.' });
    }

    const applicationId = `APP-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;

    const applicationData = {
      applicationId,
      firstName: firstName || fullName.split(' ')[0],
      lastName: lastName || fullName.split(' ').slice(1).join(' '),
      name: fullName,
      email,
      phone,
      address: address || '',
      city: city || 'Kingston',
      postalCode: postalCode || '',
      vehicleType,
      vehicleYear: vehicleYear || null,
      vehicleMakeModel: vehicleMakeModel || '',
      licenceClass: licenceClass || '',
      insuranceInfo: insuranceInfo || '',
      availability: Array.isArray(availability) ? availability : [],
      preferredZones: preferredZones || '',
      foodCertStatus: foodCertStatus || '',
      experience: experience || '',
      agreements,
      status: 'pending',
      submittedAt: new Date().toISOString(),
      ip: clientIp
    };

    if (isDatabaseAvailable()) {
      try {
        await query(
          `INSERT INTO driver_applications (
            application_id, name, email, phone,
            address, city, postal_code,
            vehicle_type, vehicle_year, vehicle_make_model,
            licence_class, insurance_info,
            availability, preferred_zones,
            food_cert_status, experience,
            agreements,
            status, submitted_at, ip_address
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10,
            $11, $12,
            $13::jsonb, $14,
            $15, $16,
            $17::jsonb,
            $18, $19, $20
          )`,
          [
            applicationData.applicationId,
            applicationData.name,
            applicationData.email,
            applicationData.phone,
            applicationData.address,
            applicationData.city,
            applicationData.postalCode,
            applicationData.vehicleType,
            applicationData.vehicleYear,
            applicationData.vehicleMakeModel,
            applicationData.licenceClass,
            applicationData.insuranceInfo,
            JSON.stringify(applicationData.availability),
            applicationData.preferredZones,
            applicationData.foodCertStatus,
            applicationData.experience,
            JSON.stringify(applicationData.agreements),
            applicationData.status,
            applicationData.submittedAt,
            applicationData.ip
          ]
        );
        console.log('[Driver Applications] Application stored in DB:', applicationId, fullName);
      } catch (dbErr) {
        // If DB insert fails (e.g., table doesn't exist yet), log and continue with in-memory
        console.warn('[Driver Applications] DB insert failed, storing in-memory:', dbErr.message);
        if (!global._driverApplications) global._driverApplications = [];
        global._driverApplications.push(applicationData);
      }
    } else {
      // In-memory fallback
      if (!global._driverApplications) global._driverApplications = [];
      global._driverApplications.push(applicationData);
      console.log('[Driver Applications] Application stored in-memory:', applicationId, fullName);
    }

    console.log('[Driver Applications] New application submitted:', applicationId, fullName, email);

    res.status(201).json({
      success: true,
      applicationId,
      message: `Application received. We'll review your application and contact you at ${email} within 3–5 business days.`
    });
  } catch (error) {
    console.error('[Driver Applications] Submission error:', error);
    res.status(500).json({ success: false, error: 'An error occurred processing your application. Please try again.' });
  }
});

/**
 * GET /:id - Check application status by applicationId
 */
router.get('/:id', async (req, res) => {
  try {
    const applicationId = req.params.id;
    if (!applicationId || !/^APP-[A-Z0-9]{10,20}$/.test(applicationId)) {
      return res.status(400).json({ success: false, error: 'Invalid application ID format.' });
    }

    if (isDatabaseAvailable()) {
      try {
        const result = await query(
          `SELECT application_id, name, email, status, submitted_at, reviewed_at, reviewer_notes
           FROM driver_applications WHERE application_id = $1`,
          [applicationId]
        );
        if (result.rows.length > 0) {
          const row = result.rows[0];
          return res.json({
            success: true,
            application: {
              applicationId: row.application_id,
              name: row.name,
              email: row.email,
              status: row.status,
              submittedAt: row.submitted_at,
              reviewedAt: row.reviewed_at
            }
          });
        }
      } catch (dbErr) {
        console.warn('[Driver Applications] DB query failed:', dbErr.message);
      }
    }

    // Fallback: check in-memory
    const memApp = (global._driverApplications || []).find(a => a.applicationId === applicationId);
    if (memApp) {
      return res.json({
        success: true,
        application: {
          applicationId: memApp.applicationId,
          name: memApp.name,
          email: memApp.email,
          status: memApp.status,
          submittedAt: memApp.submittedAt
        }
      });
    }

    res.status(404).json({ success: false, error: 'Application not found.' });
  } catch (error) {
    console.error('[Driver Applications] Lookup error:', error);
    res.status(500).json({ success: false, error: 'An error occurred.' });
  }
});

export default router;
