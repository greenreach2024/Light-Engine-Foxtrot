/**
 * Secrets Manager Utility
 * Manages application secrets and credentials
 */

export function getJwtSecret() {
  return process.env.JWT_SECRET || 'dev-secret-key-change-in-production';
}

export function getDbPassword() {
  return process.env.DB_PASSWORD || '';
}
