#!/usr/bin/env node
/**
 * Standalone Deadline Monitor Runner
 * Run this script as a cron job (every 5 minutes):
 * crontab entry: * /5 * * * * node scripts/run-deadline-monitor.js
 * Checks every 5 minutes for expired order verification deadlines
 */

import dotenv from 'dotenv';
import deadlineMonitor from '../services/deadline-monitor.js';

// Load environment variables
dotenv.config();

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Deadline Monitor - Cron Job Execution');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log('');

async function runChecks() {
  try {
    // Check for expired deadlines
    await deadlineMonitor.checkExpiredDeadlines();
    
    // Send reminders for upcoming deadlines
    await deadlineMonitor.sendDeadlineReminders();
    
    console.log('');
    console.log('✅ Deadline monitor checks completed successfully');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Deadline monitor failed:', error);
    process.exit(1);
  }
}

// Run the checks
runChecks();
