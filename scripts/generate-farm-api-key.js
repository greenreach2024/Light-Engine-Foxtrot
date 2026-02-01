#!/usr/bin/env node

/**
 * Farm API Key Generator
 * ======================
 * Generates production-grade API keys for Edge device ↔ Central authentication
 * 
 * Usage:
 *   node scripts/generate-farm-api-key.js FARM-MKLOMAT3-A9D8
 * 
 * Output:
 *   - Plaintext API key (for edge-config.json)
 *   - SHA-256 hashed key (for Central database)
 *   - SQL INSERT statement
 *   - Saves to config/FARM-{FARM_ID}.apikey (mode 0600)
 * 
 * Security:
 *   - 32-byte cryptographically random key
 *   - Format: FARM-{FARM_ID}-{64-char-hex}
 *   - One-way hash stored in database (bcrypt-style)
 *   - Plaintext only shown once (copy immediately)
 * 
 * @requires crypto (Node.js built-in)
 * @requires fs (Node.js built-in)
 * @requires path (Node.js built-in)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

/**
 * Generate production API key
 * @param {string} farmId - Farm ID (e.g., FARM-MKLOMAT3-A9D8)
 * @returns {Object} - { apiKey, apiKeyHash, sqlStatement }
 */
function generateApiKey(farmId) {
  // Validate farm ID format
  if (!farmId || !farmId.startsWith('FARM-')) {
    throw new Error('Invalid farm ID format. Expected: FARM-{identifier}');
  }
  
  // Generate 32 random bytes (256 bits)
  const randomBytes = crypto.randomBytes(32);
  const hexKey = randomBytes.toString('hex'); // 64 characters
  
  // Construct API key: FARM-{FARM_ID}-{64-char-hex}
  const apiKey = `FARM-${farmId}-${hexKey}`;
  
  // Hash the API key using SHA-256 (for database storage)
  const apiKeyHash = crypto
    .createHash('sha256')
    .update(apiKey)
    .digest('hex');
  
  // Generate SQL INSERT statement for Central database
  const sqlStatement = `
-- Insert farm API key into GreenReach Central database
-- Farm ID: ${farmId}
-- Generated: ${new Date().toISOString()}

INSERT INTO farm_api_keys (farm_id, api_key_hash, created_at, last_used_at, active)
VALUES (
  '${farmId}',
  '${apiKeyHash}',
  NOW(),
  NULL,
  true
)
ON CONFLICT (farm_id) DO UPDATE
SET api_key_hash = EXCLUDED.api_key_hash,
    created_at = NOW(),
    active = true;
`.trim();
  
  return {
    apiKey,
    apiKeyHash,
    sqlStatement
  };
}

/**
 * Save API key to secure file
 * @param {string} farmId - Farm ID
 * @param {string} apiKey - Plaintext API key
 * @param {string} apiKeyHash - Hashed API key
 */
function saveApiKey(farmId, apiKey, apiKeyHash) {
  const configDir = path.join(__dirname, '..', 'config');
  const apiKeyFile = path.join(configDir, `${farmId}.apikey`);
  
  // Ensure config directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  // Create API key file content
  const content = {
    farmId: farmId,
    apiKey: apiKey,
    apiKeyHash: apiKeyHash,
    generated: new Date().toISOString(),
    warning: 'DO NOT COMMIT THIS FILE. Add to .gitignore immediately.',
    instructions: [
      '1. Copy the API key to your edge-config.json',
      '2. Run the SQL INSERT statement on GreenReach Central database',
      '3. Delete this file after confirming sync works',
      '4. Never share the plaintext API key'
    ]
  };
  
  // Write file with restrictive permissions (owner read/write only)
  fs.writeFileSync(apiKeyFile, JSON.stringify(content, null, 2), {
    mode: 0o600 // rw------- (owner only)
  });
  
  return apiKeyFile;
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);
  
  // Check for help flag
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${colors.bright}Farm API Key Generator${colors.reset}
${colors.cyan}=======================${colors.reset}

${colors.bright}Usage:${colors.reset}
  node scripts/generate-farm-api-key.js <FARM_ID>

${colors.bright}Example:${colors.reset}
  node scripts/generate-farm-api-key.js FARM-MKLOMAT3-A9D8

${colors.bright}Output:${colors.reset}
  - Plaintext API key (copy to edge-config.json)
  - SHA-256 hash (store in Central database)
  - SQL INSERT statement
  - Secure file: config/{FARM_ID}.apikey (mode 0600)

${colors.bright}Security:${colors.reset}
  - 32-byte cryptographically random key (256 bits)
  - One-way hash for database storage
  - Plaintext shown only once (copy immediately!)
  - Secure file permissions (owner read/write only)
    `);
    process.exit(0);
  }
  
  // Get farm ID from command line
  const farmId = args[0];
  
  if (!farmId) {
    console.error(`${colors.red}${colors.bright}Error:${colors.reset} Farm ID required`);
    console.error(`${colors.yellow}Usage:${colors.reset} node scripts/generate-farm-api-key.js <FARM_ID>`);
    console.error(`${colors.yellow}Example:${colors.reset} node scripts/generate-farm-api-key.js FARM-MKLOMAT3-A9D8`);
    process.exit(1);
  }
  
  try {
    console.log(`\n${colors.bright}${colors.cyan}Generating API key for: ${farmId}${colors.reset}\n`);
    
    // Generate API key
    const { apiKey, apiKeyHash, sqlStatement } = generateApiKey(farmId);
    
    // Save to secure file
    const apiKeyFile = saveApiKey(farmId, apiKey, apiKeyHash);
    
    // Display results
    console.log(`${colors.bright}${colors.green}✓ API Key Generated Successfully${colors.reset}\n`);
    
    console.log(`${colors.bright}Farm ID:${colors.reset}`);
    console.log(`  ${farmId}\n`);
    
    console.log(`${colors.bright}${colors.red}Plaintext API Key (COPY NOW - shown only once):${colors.reset}`);
    console.log(`  ${colors.yellow}${apiKey}${colors.reset}\n`);
    
    console.log(`${colors.bright}SHA-256 Hash (for database):${colors.reset}`);
    console.log(`  ${apiKeyHash}\n`);
    
    console.log(`${colors.bright}Saved to:${colors.reset}`);
    console.log(`  ${apiKeyFile}`);
    console.log(`  ${colors.green}Permissions: 0600 (owner read/write only)${colors.reset}\n`);
    
    console.log(`${colors.bright}${colors.cyan}SQL INSERT Statement:${colors.reset}`);
    console.log(`${colors.blue}${sqlStatement}${colors.reset}\n`);
    
    console.log(`${colors.bright}${colors.yellow}⚠ IMPORTANT NEXT STEPS:${colors.reset}`);
    console.log(`  1. Copy the ${colors.bright}plaintext API key${colors.reset} to your edge-config.json`);
    console.log(`  2. Run the ${colors.bright}SQL INSERT statement${colors.reset} on GreenReach Central database`);
    console.log(`  3. Verify sync works: ${colors.cyan}curl http://<edge-ip>:8091/api/edge/status${colors.reset}`);
    console.log(`  4. Delete the .apikey file: ${colors.cyan}rm ${apiKeyFile}${colors.reset}`);
    console.log(`  5. Add *.apikey to .gitignore if not already present\n`);
    
    console.log(`${colors.bright}${colors.red}⚠ SECURITY WARNING:${colors.reset}`);
    console.log(`  - The plaintext API key is shown ${colors.bright}only once${colors.reset}`);
    console.log(`  - Copy it ${colors.bright}immediately${colors.reset} to edge-config.json`);
    console.log(`  - ${colors.bright}Never commit${colors.reset} the .apikey file or plaintext key`);
    console.log(`  - Delete the .apikey file after confirming sync works\n`);
    
    process.exit(0);
  } catch (error) {
    console.error(`\n${colors.red}${colors.bright}Error:${colors.reset} ${error.message}\n`);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { generateApiKey, saveApiKey };
