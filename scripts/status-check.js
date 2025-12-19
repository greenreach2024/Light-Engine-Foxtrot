#!/usr/bin/env node
/**
 * Production Status Dashboard
 * 
 * Quick view of all security features and their status
 * 
 * Usage: node scripts/status-check.js
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// Colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function checkCommand(command) {
  try {
    await execAsync(`which ${command}`);
    return true;
  } catch {
    return false;
  }
}

async function checkFile(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getGitStatus() {
  try {
    const { stdout } = await execAsync('git status --porcelain');
    return stdout.trim() === '' ? 'clean' : 'uncommitted changes';
  } catch {
    return 'error';
  }
}

async function getGitCommit() {
  try {
    const { stdout } = await execAsync('git rev-parse --short HEAD');
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

async function checkEBEnvironment() {
  try {
    const { stdout } = await execAsync('eb status 2>/dev/null');
    if (stdout.includes('light-engine-foxtrot-prod')) {
      const healthMatch = stdout.match(/Health:\s+(\w+)/);
      return healthMatch ? healthMatch[1] : 'Unknown';
    }
    return 'Not configured';
  } catch {
    return 'EB CLI not available';
  }
}

async function checkAWSCredentials() {
  try {
    const { stdout } = await execAsync('aws sts get-caller-identity 2>/dev/null');
    const identity = JSON.parse(stdout);
    return identity.Account ? `Account: ${identity.Account}` : 'Not configured';
  } catch {
    return 'Not configured';
  }
}

async function main() {
  console.clear();
  log('═══════════════════════════════════════════════════════════════', 'blue');
  log('  Light Engine Foxtrot - Production Status Dashboard', 'blue');
  log('═══════════════════════════════════════════════════════════════', 'blue');
  console.log();

  // Git Status
  log('📦 Code Status', 'blue');
  log('─'.repeat(63), 'gray');
  const gitStatus = await getGitStatus();
  const gitCommit = await getGitCommit();
  log(`  Git Status: ${gitStatus === 'clean' ? '✅' : '⚠️ '} ${gitStatus}`, 
      gitStatus === 'clean' ? 'green' : 'yellow');
  log(`  Current Commit: ${gitCommit}`, 'gray');
  console.log();

  // Prerequisites
  log('🔧 Prerequisites', 'blue');
  log('─'.repeat(63), 'gray');
  
  const tools = {
    'Node.js': await checkCommand('node'),
    'AWS CLI': await checkCommand('aws'),
    'EB CLI': await checkCommand('eb'),
    'Git': await checkCommand('git')
  };
  
  for (const [tool, installed] of Object.entries(tools)) {
    log(`  ${tool}: ${installed ? '✅ Installed' : '❌ Missing'}`, 
        installed ? 'green' : 'red');
  }
  console.log();

  // AWS Configuration
  log('☁️  AWS Configuration', 'blue');
  log('─'.repeat(63), 'gray');
  const awsAccount = await checkAWSCredentials();
  log(`  AWS Credentials: ${awsAccount.includes('Account') ? '✅' : '⚠️ '} ${awsAccount}`,
      awsAccount.includes('Account') ? 'green' : 'yellow');
  
  const ebStatus = await checkEBEnvironment();
  const ebHealthy = ebStatus === 'Green' || ebStatus === 'Ok';
  log(`  EB Environment: ${ebHealthy ? '✅' : '⚠️ '} ${ebStatus}`,
      ebHealthy ? 'green' : 'yellow');
  console.log();

  // Security Features Code Status
  log('🔒 Security Features (Code)', 'blue');
  log('─'.repeat(63), 'gray');
  
  const securityFiles = {
    'CORS Middleware': 'server/middleware/cors.js',
    'Rate Limiter': 'server/middleware/rate-limiter.js',
    'Audit Logger': 'server/middleware/audit-logger.js',
    'Secrets Manager (JS)': 'server/utils/secrets-manager.js',
    'Secrets Manager (Python)': 'backend/secrets_manager.py',
    'Auth Integration': 'backend/auth.py'
  };
  
  for (const [feature, file] of Object.entries(securityFiles)) {
    const exists = await checkFile(file);
    log(`  ${feature}: ${exists ? '✅ Implemented' : '❌ Missing'}`,
        exists ? 'green' : 'red');
  }
  console.log();

  // Automation Scripts
  log('🤖 Automation Scripts', 'blue');
  log('─'.repeat(63), 'gray');
  
  const scripts = {
    'JWT Setup': 'scripts/setup-jwt-secret.js',
    'EB Configuration': 'scripts/configure-eb-environment.sh',
    'WAF Setup': 'scripts/setup-waf.sh',
    'CloudWatch Alarms': 'scripts/setup-cloudwatch-alarms.sh'
  };
  
  for (const [name, script] of Object.entries(scripts)) {
    const exists = await checkFile(script);
    log(`  ${name}: ${exists ? '✅ Ready' : '❌ Missing'}`,
        exists ? 'green' : 'red');
  }
  console.log();

  // Documentation
  log('📚 Documentation', 'blue');
  log('─'.repeat(63), 'gray');
  
  const docs = {
    'AWS Infrastructure Guide': 'AWS_INFRASTRUCTURE_SETUP.md',
    'Security Hardening': 'SECURITY_HARDENING.md',
    'Test Report': 'SECURITY_TEST_REPORT.md',
    'Deployment Checklist': 'DEPLOYMENT_CHECKLIST.md',
    'Quick Start': 'QUICKSTART_DEPLOYMENT.md',
    'Production Config': 'PRODUCTION_SECURITY_CONFIG.md'
  };
  
  for (const [name, doc] of Object.entries(docs)) {
    const exists = await checkFile(doc);
    log(`  ${name}: ${exists ? '✅ Complete' : '❌ Missing'}`,
        exists ? 'green' : 'red');
  }
  console.log();

  // EB Configuration
  log('⚙️  Elastic Beanstalk Configuration', 'blue');
  log('─'.repeat(63), 'gray');
  
  const ebConfig = {
    'HTTPS Redirect Config': '.ebextensions/https-redirect.config'
  };
  
  for (const [name, file] of Object.entries(ebConfig)) {
    const exists = await checkFile(file);
    log(`  ${name}: ${exists ? '✅ Ready' : '❌ Missing'}`,
        exists ? 'green' : 'red');
  }
  console.log();

  // Next Steps
  log('🚀 Next Steps', 'blue');
  log('─'.repeat(63), 'gray');
  
  const steps = [
    { done: true, step: 'Implement security features', color: 'green' },
    { done: true, step: 'Create automation scripts', color: 'green' },
    { done: true, step: 'Write documentation', color: 'green' },
    { done: false, step: 'Run: node scripts/setup-jwt-secret.js', color: 'yellow' },
    { done: false, step: 'Run: ./scripts/configure-eb-environment.sh', color: 'yellow' },
    { done: false, step: 'Deploy: eb deploy', color: 'yellow' },
    { done: false, step: 'Run: ./scripts/setup-waf.sh', color: 'yellow' },
    { done: false, step: 'Run: ./scripts/setup-cloudwatch-alarms.sh', color: 'yellow' },
    { done: false, step: 'Enable: AUTH_ENABLED=true', color: 'yellow' },
    { done: false, step: 'Validate deployment (see QUICKSTART_DEPLOYMENT.md)', color: 'yellow' }
  ];
  
  for (const { done, step, color } of steps) {
    log(`  ${done ? '✅' : '⏳'} ${step}`, color);
  }
  
  console.log();
  log('═══════════════════════════════════════════════════════════════', 'blue');
  log(`  Run with --help for detailed guide`, 'gray');
  log('═══════════════════════════════════════════════════════════════', 'blue');
  console.log();
}

// Check for help flag
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Light Engine Foxtrot - Production Status Dashboard

Usage:
  node scripts/status-check.js              Show status dashboard
  node scripts/status-check.js --help       Show this help

Documentation:
  AWS Infrastructure:  AWS_INFRASTRUCTURE_SETUP.md
  Quick Start:         QUICKSTART_DEPLOYMENT.md
  Deployment Checklist: DEPLOYMENT_CHECKLIST.md
  Security Config:     PRODUCTION_SECURITY_CONFIG.md

Key Commands:
  node scripts/setup-jwt-secret.js          Generate JWT secret
  ./scripts/configure-eb-environment.sh     Configure EB environment
  eb deploy                                  Deploy application
  ./scripts/setup-waf.sh                    Setup AWS WAF
  ./scripts/setup-cloudwatch-alarms.sh      Setup monitoring
`);
  process.exit(0);
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
