/**
 * Marketing Settings Service — GreenReach Central
 * DB-first settings reader with environment variable fallback.
 * Adapted from Real-Estate-Ready-MVP settings/reader.ts pattern.
 */

import { query } from '../config/database.js';

// Map setting keys to environment variable fallbacks
const ENV_FALLBACK = {
  // AI provider (Gemini via Vertex AI -- uses ADC, no env key needed)
  // Twitter / X
  twitter_api_key:            'TWITTER_API_KEY',
  twitter_api_secret:         'TWITTER_API_SECRET',
  twitter_access_token:       'TWITTER_ACCESS_TOKEN',
  twitter_access_secret:      'TWITTER_ACCESS_SECRET',
  // LinkedIn
  linkedin_access_token:      'LINKEDIN_ACCESS_TOKEN',
  linkedin_person_urn:        'LINKEDIN_PERSON_URN',
  // Instagram
  instagram_access_token:     'INSTAGRAM_ACCESS_TOKEN',
  instagram_business_account: 'INSTAGRAM_BUSINESS_ACCOUNT_ID',
  // Facebook
  facebook_page_access_token: 'FACEBOOK_PAGE_ACCESS_TOKEN',
  facebook_page_id:           'FACEBOOK_PAGE_ID',
  // Notifications
  marketing_notify_email:     'MARKETING_NOTIFY_EMAIL',
};

/**
 * Get a single setting value. Checks DB first, falls back to env var.
 * @param {string} key
 * @returns {Promise<string|null>}
 */
export async function getSetting(key) {
  try {
    const result = await query(
      'SELECT value FROM site_settings WHERE key = $1',
      [key]
    );
    if (result.rows.length > 0 && result.rows[0].value) {
      return result.rows[0].value;
    }
  } catch (err) {
    // DB not available — fall through to env
  }

  const envKey = ENV_FALLBACK[key];
  return envKey ? (process.env[envKey] || null) : null;
}

/**
 * Get multiple settings at once. Returns { key: value } map.
 * @param {string[]} keys
 * @returns {Promise<Record<string, string|null>>}
 */
export async function getSettings(keys) {
  const result = {};
  try {
    const dbResult = await query(
      'SELECT key, value FROM site_settings WHERE key = ANY($1)',
      [keys]
    );
    for (const row of dbResult.rows) {
      result[row.key] = row.value;
    }
  } catch (err) {
    // DB not available
  }

  // Fill missing from env
  for (const key of keys) {
    if (!result[key]) {
      const envKey = ENV_FALLBACK[key];
      result[key] = envKey ? (process.env[envKey] || null) : null;
    }
  }
  return result;
}

/**
 * Set a setting value in the database.
 * Upserts (INSERT ... ON CONFLICT UPDATE).
 * @param {string} key
 * @param {string} value
 */
export async function setSetting(key, value) {
  await query(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value]
  );
}

/**
 * Delete a setting from the database.
 * @param {string} key
 */
export async function deleteSetting(key) {
  await query('DELETE FROM site_settings WHERE key = $1', [key]);
}

/**
 * Check if a platform has credentials configured (DB or env).
 * @param {string} platform - twitter, linkedin, instagram, facebook
 * @returns {Promise<{configured: boolean, source: string}>}
 */
export async function checkPlatformCredentials(platform) {
  const keyMap = {
    twitter:   ['twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_secret'],
    linkedin:  ['linkedin_access_token'],
    instagram: ['instagram_access_token', 'instagram_business_account'],
    facebook:  ['facebook_page_access_token', 'facebook_page_id'],
  };

  const keys = keyMap[platform];
  if (!keys) return { configured: false, source: 'unknown' };

  const settings = await getSettings(keys);
  const allPresent = keys.every(k => !!settings[k]);

  // Determine source
  let source = 'none';
  if (allPresent) {
    try {
      const dbCheck = await query(
        'SELECT key FROM site_settings WHERE key = ANY($1) AND value IS NOT NULL',
        [keys]
      );
      source = dbCheck.rows.length === keys.length ? 'database' : 'environment';
    } catch {
      source = 'environment';
    }
  }

  return { configured: allPresent, source };
}
