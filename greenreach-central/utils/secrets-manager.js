/**
 * Secrets Manager Utility
 * Manages application secrets and credentials
 */

export function getJwtSecret() {
  return process.env.JWT_SECRET || 'greenreach-jwt-secret-2025';
}

export function getDbPassword() {
  return process.env.DB_PASSWORD || '';
}
