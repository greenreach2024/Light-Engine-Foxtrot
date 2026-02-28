/**
 * Secrets Manager Utility
 * Manages application secrets and credentials
 */

import { randomBytes } from 'crypto';

export function getJwtSecret() {
  if (!process.env.JWT_SECRET && (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud')) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return process.env.JWT_SECRET || randomBytes(32).toString('hex');
}

export function getDbPassword() {
  return process.env.DB_PASSWORD || '';
}
