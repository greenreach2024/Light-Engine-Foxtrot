#!/usr/bin/env node
/**
 * Production Monitoring Verification Script
 * 
 * Verifies that all monitoring systems are properly configured:
 * - CloudWatch metrics publishing
 * - CloudWatch alarms exist
 * - SNS notifications configured
 * - Sentry error tracking (if configured)
 * - Health endpoint responding
 * 
 * Usage:
 *   node scripts/verify-monitoring-setup.js
 *   node scripts/verify-monitoring-setup.js --production
 */

import https from 'https';
import http from 'http';
import { execSync } from 'child_process';

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  bold: '\x1b[1m'
};

const isProduction = process.argv.includes('--production');
const appUrl = isProduction 
  ? 'https://light-engine-foxtrot-prod.us-east-1.elasticbeanstalk.com'
  : 'http://localhost:8091';

let checksPass = 0;
let checksFail = 0;
let checksWarn = 0;

/**
 * Print section header
 */
function printHeader(title) {
  console.log(`\n${COLORS.blue}${COLORS.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
  console.log(`${COLORS.blue}${COLORS.bold}  ${title}${COLORS.reset}`);
  console.log(`${COLORS.blue}${COLORS.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}\n`);
}

/**
 * Print check result
 */
function printResult(name, status, message = '') {
  const symbols = {
    pass: `${COLORS.green}✓${COLORS.reset}`,
    fail: `${COLORS.red}✗${COLORS.reset}`,
    warn: `${COLORS.yellow}⚠${COLORS.reset}`
  };
  
  const statusText = {
    pass: `${COLORS.green}PASS${COLORS.reset}`,
    fail: `${COLORS.red}FAIL${COLORS.reset}`,
    warn: `${COLORS.yellow}WARN${COLORS.reset}`
  };
  
  console.log(`${symbols[status]} ${name.padEnd(45)} ${statusText[status]}`);
  
  if (message) {
    console.log(`  ${COLORS.reset}${message}${COLORS.reset}`);
  }
  
  if (status === 'pass') checksPass++;
  else if (status === 'fail') checksFail++;
  else if (status === 'warn') checksWarn++;
}

/**
 * Execute AWS CLI command
 */
function awsCommand(command) {
  try {
    const output = execSync(command, { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { success: true, output: output.trim() };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * HTTP request helper
 */
function httpRequest(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const startTime = Date.now();
    
    const req = client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const responseTime = Date.now() - startTime;
        resolve({
          success: res.statusCode >= 200 && res.statusCode < 400,
          statusCode: res.statusCode,
          data,
          responseTime
        });
      });
    });
    
    req.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ success: false, error: 'Timeout' });
    });
  });
}

/**
 * Check if AWS CLI is installed
 */
function checkAwsCli() {
  printHeader('AWS CLI Configuration');
  
  try {
    execSync('which aws', { stdio: 'ignore' });
    printResult('AWS CLI installed', 'pass');
    
    const identity = awsCommand('aws sts get-caller-identity 2>/dev/null');
    if (identity.success) {
      const account = JSON.parse(identity.output);
      printResult('AWS credentials configured', 'pass', `Account: ${account.Account}`);
    } else {
      printResult('AWS credentials configured', 'warn', 'Not authenticated or no credentials');
    }
  } catch {
    printResult('AWS CLI installed', 'fail', 'Install: brew install awscli');
  }
}

/**
 * Check environment variables
 */
async function checkEnvironment() {
  printHeader('Environment Configuration');
  
  if (isProduction) {
    // Check production environment via Elastic Beanstalk
    const envVars = awsCommand('eb printenv 2>/dev/null | grep -E "(CLOUDWATCH|SENTRY)"');
    
    if (envVars.success && envVars.output.includes('CLOUDWATCH_ENABLED')) {
      const enabled = envVars.output.includes('CLOUDWATCH_ENABLED = true');
      printResult('CLOUDWATCH_ENABLED', enabled ? 'pass' : 'warn', 
        enabled ? 'Enabled in production' : 'Set to false - metrics disabled');
    } else {
      printResult('CLOUDWATCH_ENABLED', 'fail', 'Not configured in production');
    }
    
    if (envVars.success && envVars.output.includes('SENTRY_DSN')) {
      printResult('SENTRY_DSN', 'pass', 'Configured in production');
    } else {
      printResult('SENTRY_DSN', 'warn', 'Not configured - error tracking disabled');
    }
  } else {
    // Check local environment
    const cloudWatchEnabled = process.env.CLOUDWATCH_ENABLED === 'true';
    printResult('CLOUDWATCH_ENABLED', cloudWatchEnabled ? 'pass' : 'warn',
      cloudWatchEnabled ? 'Enabled locally' : 'Disabled (expected for local dev)');
    
    const sentryDsn = !!process.env.SENTRY_DSN;
    printResult('SENTRY_DSN', sentryDsn ? 'pass' : 'warn',
      sentryDsn ? 'Configured' : 'Not configured (optional for local dev)');
  }
}

/**
 * Check health endpoint
 */
async function checkHealthEndpoint() {
  printHeader('Health Endpoint');
  
  const response = await httpRequest(`${appUrl}/health`);
  
  if (response.success) {
    printResult('Health endpoint responding', 'pass', 
      `HTTP ${response.statusCode} in ${response.responseTime}ms`);
    
    try {
      const health = JSON.parse(response.data);
      
      if (health.status === 'ok') {
        printResult('Application status', 'pass', 'Status: OK');
      } else {
        printResult('Application status', 'warn', `Status: ${health.status}`);
      }
      
      if (health.database?.connected) {
        printResult('Database connected', 'pass', `Mode: ${health.database.mode}`);
      } else {
        printResult('Database connected', 'fail', 'Database not connected');
      }
      
      const memPercent = health.memory?.percent || 0;
      if (memPercent < 80) {
        printResult('Memory usage', 'pass', `${memPercent.toFixed(1)}%`);
      } else {
        printResult('Memory usage', 'warn', `${memPercent.toFixed(1)}% - High memory usage`);
      }
      
    } catch (error) {
      printResult('Health endpoint parse', 'fail', 'Invalid JSON response');
    }
  } else {
    printResult('Health endpoint responding', 'fail', 
      response.error || `HTTP ${response.statusCode}`);
  }
}

/**
 * Check CloudWatch metrics
 */
async function checkCloudWatchMetrics() {
  printHeader('CloudWatch Metrics');
  
  if (!isProduction) {
    printResult('CloudWatch metrics', 'warn', 'Skipped (use --production flag)');
    return;
  }
  
  const metrics = awsCommand(`
    aws cloudwatch list-metrics \\
      --namespace LightEngine/Foxtrot \\
      --region us-east-1 \\
      --output json 2>/dev/null
  `);
  
  if (metrics.success) {
    const metricList = JSON.parse(metrics.output);
    const count = metricList.Metrics?.length || 0;
    
    if (count > 0) {
      printResult('Custom metrics published', 'pass', `${count} metrics found`);
      
      // Check for expected metrics
      const expectedMetrics = [
        'APIResponseTime',
        'APIRequests',
        'APIErrors',
        'DatabaseConnected',
        'DatabaseLatency'
      ];
      
      const publishedMetrics = metricList.Metrics.map(m => m.MetricName);
      
      expectedMetrics.forEach(expected => {
        if (publishedMetrics.includes(expected)) {
          printResult(`Metric: ${expected}`, 'pass');
        } else {
          printResult(`Metric: ${expected}`, 'warn', 'Not yet published');
        }
      });
    } else {
      printResult('Custom metrics published', 'warn', 
        'No metrics found - may take 5-10 minutes after enabling');
    }
  } else {
    printResult('Custom metrics published', 'fail', 
      'Cannot list metrics - check AWS credentials');
  }
}

/**
 * Check CloudWatch alarms
 */
async function checkCloudWatchAlarms() {
  printHeader('CloudWatch Alarms');
  
  if (!isProduction) {
    printResult('CloudWatch alarms', 'warn', 'Skipped (use --production flag)');
    return;
  }
  
  const alarms = awsCommand(`
    aws cloudwatch describe-alarms \\
      --alarm-name-prefix foxtrot- \\
      --region us-east-1 \\
      --output json 2>/dev/null
  `);
  
  if (alarms.success) {
    const alarmList = JSON.parse(alarms.output);
    const count = alarmList.MetricAlarms?.length || 0;
    
    if (count >= 5) {
      printResult('Critical alarms configured', 'pass', `${count} alarms found`);
    } else if (count > 0) {
      printResult('Critical alarms configured', 'warn', 
        `Only ${count} alarms found - recommend 5 minimum`);
    } else {
      printResult('Critical alarms configured', 'fail', 
        'No alarms configured - run scripts/setup-cloudwatch-alarms.sh');
    }
    
    // Check alarm states
    if (count > 0) {
      const alarmStates = alarmList.MetricAlarms.reduce((acc, alarm) => {
        acc[alarm.StateValue] = (acc[alarm.StateValue] || 0) + 1;
        return acc;
      }, {});
      
      if (alarmStates.ALARM) {
        printResult('Alarm state', 'warn', 
          `${alarmStates.ALARM} alarms in ALARM state - investigate!`);
      } else {
        printResult('Alarm state', 'pass', 'All alarms OK');
      }
    }
  } else {
    printResult('Critical alarms configured', 'fail', 
      'Cannot list alarms - check AWS credentials');
  }
}

/**
 * Check SNS topic
 */
async function checkSNSTopic() {
  printHeader('SNS Notifications');
  
  if (!isProduction) {
    printResult('SNS topic', 'warn', 'Skipped (use --production flag)');
    return;
  }
  
  const topics = awsCommand(`
    aws sns list-topics \\
      --region us-east-1 \\
      --output json 2>/dev/null
  `);
  
  if (topics.success) {
    const topicList = JSON.parse(topics.output);
    const foxtrotTopic = topicList.Topics?.find(t => 
      t.TopicArn.includes('foxtrot') && t.TopicArn.includes('alert')
    );
    
    if (foxtrotTopic) {
      printResult('SNS topic exists', 'pass', foxtrotTopic.TopicArn);
      
      // Check subscriptions
      const subs = awsCommand(`
        aws sns list-subscriptions-by-topic \\
          --topic-arn "${foxtrotTopic.TopicArn}" \\
          --region us-east-1 \\
          --output json 2>/dev/null
      `);
      
      if (subs.success) {
        const subList = JSON.parse(subs.output);
        const confirmedSubs = subList.Subscriptions?.filter(s => 
          s.SubscriptionArn !== 'PendingConfirmation'
        ) || [];
        
        if (confirmedSubs.length > 0) {
          printResult('SNS subscriptions confirmed', 'pass', 
            `${confirmedSubs.length} confirmed`);
        } else {
          printResult('SNS subscriptions confirmed', 'warn', 
            'No confirmed subscriptions - check email');
        }
      }
    } else {
      printResult('SNS topic exists', 'fail', 
        'No foxtrot-alerts topic found - create one');
    }
  } else {
    printResult('SNS topic exists', 'fail', 
      'Cannot list topics - check AWS credentials');
  }
}

/**
 * Check Sentry configuration
 */
async function checkSentry() {
  printHeader('Sentry Error Tracking');
  
  if (isProduction) {
    const envVars = awsCommand('eb printenv 2>/dev/null | grep SENTRY_DSN');
    
    if (envVars.success && envVars.output) {
      printResult('Sentry DSN configured', 'pass', 'Configured in production');
      printResult('Sentry integration', 'warn', 
        'Test by triggering an error: curl /api/test-error');
    } else {
      printResult('Sentry DSN configured', 'warn', 
        'Not configured - error tracking disabled');
    }
  } else {
    const hasDsn = !!process.env.SENTRY_DSN;
    printResult('Sentry DSN configured', hasDsn ? 'pass' : 'warn',
      hasDsn ? 'Configured locally' : 'Not configured (optional for local dev)');
  }
}

/**
 * Print summary
 */
function printSummary() {
  printHeader('Monitoring Setup Summary');
  
  const total = checksPass + checksFail + checksWarn;
  
  console.log(`${COLORS.green}✓ ${checksPass} checks passed${COLORS.reset}`);
  console.log(`${COLORS.yellow}⚠ ${checksWarn} warnings${COLORS.reset}`);
  console.log(`${COLORS.red}✗ ${checksFail} checks failed${COLORS.reset}`);
  console.log(`\nTotal: ${total} checks\n`);
  
  if (checksFail === 0 && checksWarn === 0) {
    console.log(`${COLORS.green}${COLORS.bold}✅ Monitoring is fully configured and operational!${COLORS.reset}\n`);
  } else if (checksFail === 0) {
    console.log(`${COLORS.yellow}${COLORS.bold}⚠️  Monitoring is working but has warnings${COLORS.reset}`);
    console.log(`Review warnings above and address as needed.\n`);
  } else {
    console.log(`${COLORS.red}${COLORS.bold}❌ Monitoring setup incomplete${COLORS.reset}`);
    console.log(`Fix failed checks above before proceeding.\n`);
  }
  
  // Recommendations
  if (checksFail > 0 || checksWarn > 0) {
    console.log(`${COLORS.blue}${COLORS.bold}Next Steps:${COLORS.reset}\n`);
    
    if (!isProduction) {
      console.log(`1. Enable CloudWatch in production:`);
      console.log(`   eb setenv CLOUDWATCH_ENABLED=true\n`);
    }
    
    console.log(`2. Create CloudWatch alarms:`);
    console.log(`   ./scripts/setup-cloudwatch-alarms.sh <SNS_TOPIC_ARN>\n`);
    
    console.log(`3. Configure Sentry (optional but recommended):`);
    console.log(`   eb setenv SENTRY_DSN="https://xxxxx@xxxxx.ingest.sentry.io/xxxxx"\n`);
    
    console.log(`4. Set up uptime monitoring:`);
    console.log(`   Sign up at uptimerobot.com (free)\n`);
    
    console.log(`See PRODUCTION_MONITORING_SETUP.md for detailed instructions.\n`);
  }
}

/**
 * Main execution
 */
async function main() {
  console.log(`\n${COLORS.bold}Production Monitoring Verification${COLORS.reset}`);
  console.log(`Target: ${isProduction ? 'Production' : 'Local Development'}\n`);
  
  checkAwsCli();
  await checkEnvironment();
  await checkHealthEndpoint();
  
  if (isProduction) {
    await checkCloudWatchMetrics();
    await checkCloudWatchAlarms();
    await checkSNSTopic();
  }
  
  await checkSentry();
  printSummary();
  
  process.exit(checksFail > 0 ? 1 : 0);
}

main().catch(error => {
  console.error(`\n${COLORS.red}Fatal error:${COLORS.reset}`, error.message);
  process.exit(1);
});
