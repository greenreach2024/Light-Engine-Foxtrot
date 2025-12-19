/**
 * AWS Secrets Manager Integration
 * 
 * Provides secure retrieval of secrets from AWS Secrets Manager.
 * Falls back to environment variables for local development.
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// Create Secrets Manager client (region auto-detected from environment)
const client = new SecretsManagerClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// Cache for secrets to avoid repeated API calls
const secretsCache = new Map();
const CACHE_TTL = 3600000; // 1 hour in milliseconds

/**
 * Get a secret from AWS Secrets Manager
 * @param {string} secretId - Secret name or ARN
 * @returns {Promise<string>} Secret value
 */
export async function getSecret(secretId) {
  // Check cache first
  const cached = secretsCache.get(secretId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.value;
  }

  try {
    const command = new GetSecretValueCommand({
      SecretId: secretId,
    });

    const response = await client.send(command);
    
    let secretValue;
    if (response.SecretString) {
      secretValue = response.SecretString;
    } else {
      // Binary secrets (decode base64)
      const buff = Buffer.from(response.SecretBinary, 'base64');
      secretValue = buff.toString('ascii');
    }

    // Cache the secret
    secretsCache.set(secretId, {
      value: secretValue,
      timestamp: Date.now(),
    });

    return secretValue;
  } catch (error) {
    console.error(`[SecretsManager] Failed to retrieve secret ${secretId}:`, error.message);
    throw error;
  }
}

/**
 * Get JWT secret with fallback to environment variable
 * @returns {Promise<string>} JWT secret
 */
export async function getJwtSecret() {
  const secretArn = process.env.JWT_SECRET_ARN;
  
  if (secretArn) {
    try {
      console.log('[SecretsManager] Loading JWT secret from AWS Secrets Manager...');
      const secret = await getSecret(secretArn);
      console.log('[SecretsManager] ✅ JWT secret loaded from Secrets Manager');
      return secret;
    } catch (error) {
      console.error('[SecretsManager] ❌ Failed to load from Secrets Manager, falling back to env var');
      console.error('[SecretsManager] Error:', error.message);
    }
  }

  // Fallback to environment variable
  const envSecret = process.env.JWT_SECRET;
  
  if (!envSecret) {
    throw new Error(
      'JWT_SECRET not configured. Set JWT_SECRET env var or JWT_SECRET_ARN for AWS Secrets Manager'
    );
  }

  if (envSecret === 'your-secret-key-here-change-in-production') {
    console.warn('[Security] ⚠️  WARNING: Using default JWT_SECRET - CHANGE THIS IN PRODUCTION!');
  }

  return envSecret;
}

/**
 * Clear secrets cache (useful for testing or manual refresh)
 */
export function clearSecretsCache() {
  secretsCache.clear();
  console.log('[SecretsManager] Cache cleared');
}

export default {
  getSecret,
  getJwtSecret,
  clearSecretsCache,
};
