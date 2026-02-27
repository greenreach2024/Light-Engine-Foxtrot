/**
 * Secrets Manager Utility
 * Manages application secrets and credentials
 */

export function getJwtSecret() {
  if (!process.env.JWT_SECRET && (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud')) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex');
}

export function getDbPassword() {
  return process.env.DB_PASSWORD || '';
}
