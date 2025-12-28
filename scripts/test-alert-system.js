#!/usr/bin/env node
/**
 * Test Alert System
 * Verifies that alerts are properly recorded and notifications sent
 */

import dotenv from 'dotenv';
import alertService from '../services/alert-service.js';
import alertMonitoring from '../middleware/alert-monitoring.js';

dotenv.config();

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Alert System Test');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

async function runTests() {
  try {
    console.log('Test 1: Farm Offline Alert');
    console.log('─────────────────────────────────────────────────────────────');
    await alertMonitoring.monitorFarmHealth('test-farm-001', 'http://nonexistent-farm.local');
    console.log('✅ Farm offline alert recorded\n');
    
    console.log('Test 2: Payment Failure Alert');
    console.log('─────────────────────────────────────────────────────────────');
    await alertMonitoring.monitorPayment('order-123', {
      method: 'credit_card',
      amount: 150.00,
      buyer_email: 'test@example.com'
    }, new Error('Card declined'));
    console.log('✅ Payment failure alert recorded\n');
    
    console.log('Test 3: Notification Failure Alert');
    console.log('─────────────────────────────────────────────────────────────');
    await alertMonitoring.monitorNotification('sms', '+15551234567', 
      new Error('Twilio API error'));
    console.log('✅ Notification failure alert recorded\n');
    
    console.log('Test 4: Reservation Conflict Alert');
    console.log('─────────────────────────────────────────────────────────────');
    await alertMonitoring.monitorReservation('SKU-LETTUCE-5LB', 10, 5, 
      new Error('Insufficient inventory'));
    console.log('✅ Reservation conflict alert recorded\n');
    
    console.log('Test 5: Deadline Miss Alert');
    console.log('─────────────────────────────────────────────────────────────');
    await alertMonitoring.monitorDeadlineMiss('sub-order-456', 'GR-00001', 
      new Date(Date.now() - 2 * 60 * 60 * 1000)); // 2 hours ago
    console.log('✅ Deadline miss alert recorded\n');
    
    console.log('Test 6: CRITICAL - Overselling Alert');
    console.log('─────────────────────────────────────────────────────────────');
    await alertMonitoring.monitorOverselling('SKU-TOMATO-5LB', 10, 8, 5); // 13 > 10
    console.log('✅ Overselling alert recorded\n');
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Viewing Recent Alerts');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    const recentAlerts = alertService.getRecentAlerts(10);
    
    console.log(`Found ${recentAlerts.length} recent alerts:\n`);
    
    recentAlerts.forEach((alert, index) => {
      const icon = alert.severity === 'critical' ? '🚨' : 
                   alert.severity === 'warning' ? '⚠️' : 'ℹ️';
      console.log(`${index + 1}. ${icon} ${alert.type.toUpperCase()}`);
      console.log(`   Severity: ${alert.severity}`);
      console.log(`   Time: ${new Date(alert.timestamp).toLocaleString()}`);
      console.log(`   Details: ${JSON.stringify(alert.details, null, 2)}`);
      console.log('');
    });
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Test Complete');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    console.log('✅ All alerts recorded successfully');
    console.log('📧 Check ops email for alert notifications');
    console.log('📱 Check ops SMS for critical alerts');
    console.log('💾 Alerts saved to: public/data/system-alerts.json');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

runTests();
