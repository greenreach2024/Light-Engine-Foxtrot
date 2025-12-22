#!/usr/bin/env node
/**
 * Weekly Performance Report Generator
 * Sends farm performance summaries every Monday morning
 */

import notificationService from '../services/wholesale-notification-service.js';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Weekly Farm Performance Reports');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');
console.log(`Report Date: ${new Date().toISOString()}`);
console.log('');

/**
 * Get farm performance metrics for the past week
 * TODO: Replace with actual database queries
 */
async function getFarmPerformanceMetrics(farmId) {
  // TODO: Query database for actual metrics
  // SELECT COUNT(*) as total_orders,
  //        AVG(response_time_hours) as avg_response_time,
  //        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as acceptance_rate,
  //        quality_score
  // FROM farm_sub_orders
  // WHERE farm_id = ? AND created_at >= NOW() - INTERVAL '7 days'
  
  return {
    farm_id: farmId,
    farm_name: 'Demo Farm',
    email: 'farm@example.com',
    week_start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    week_end: new Date().toISOString(),
    total_orders: 12,
    orders_accepted: 11,
    orders_declined: 1,
    orders_expired: 0,
    acceptance_rate: 91.7,
    avg_response_time_hours: 4.2,
    quality_score: 87,
    quality_score_change: +2,
    revenue_gross: 1500.00,
    broker_fee: 180.00,
    revenue_net: 1320.00,
    top_products: [
      { name: 'Arugula, 5lb case', quantity: 45 },
      { name: 'Kale, 5lb case', quantity: 30 },
      { name: 'Mixed Greens, 5lb case', quantity: 25 }
    ],
    recommendations: [
      'Great response time! You\'re in the top 25% of the network.',
      'Consider responding within 12 hours to maximize quality score.'
    ]
  };
}

/**
 * Send performance report to a single farm
 */
async function sendFarmReport(farmId) {
  try {
    const metrics = await getFarmPerformanceMetrics(farmId);
    
    console.log(`Generating report for: ${metrics.farm_name} (${metrics.farm_id})`);
    console.log(`  Orders: ${metrics.total_orders}`);
    console.log(`  Acceptance Rate: ${metrics.acceptance_rate.toFixed(1)}%`);
    console.log(`  Avg Response: ${metrics.avg_response_time_hours.toFixed(1)} hours`);
    console.log(`  Quality Score: ${metrics.quality_score}/100 (${metrics.quality_score_change > 0 ? '+' : ''}${metrics.quality_score_change})`);
    console.log(`  Revenue: $${metrics.revenue_net.toFixed(2)} (after fees)`);
    
    // Generate email content
    const subject = `Your GreenReach Performance Report (${new Date(metrics.week_start).toLocaleDateString()} - ${new Date(metrics.week_end).toLocaleDateString()})`;
    
    const htmlBody = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #2d5016 0%, #3d6b1f 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { padding: 30px 20px; background: #f9faf8; }
          .metric-box { background: white; padding: 20px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #82c341; }
          .metric-label { font-size: 0.9rem; color: #666; text-transform: uppercase; letter-spacing: 1px; }
          .metric-value { font-size: 2rem; font-weight: bold; color: #2d5016; margin: 5px 0; }
          .metric-change { font-size: 0.9rem; color: ${metrics.quality_score_change >= 0 ? '#10b981' : '#ef4444'}; }
          .products-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          .products-table th { background: #e8f4e8; padding: 10px; text-align: left; font-weight: 600; }
          .products-table td { padding: 10px; border-bottom: 1px solid #e5e7eb; }
          .recommendations { background: #fff3cd; padding: 15px; margin: 20px 0; border-radius: 4px; border-left: 4px solid #ffc107; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 0.9rem; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🌱 Weekly Performance Report</h1>
          <p>${new Date(metrics.week_start).toLocaleDateString()} - ${new Date(metrics.week_end).toLocaleDateString()}</p>
        </div>
        
        <div class="content">
          <h2>Hello ${metrics.farm_name}! 👋</h2>
          <p>Here's your wholesale performance summary for the past week:</p>
          
          <div class="metric-box">
            <div class="metric-label">Orders Fulfilled</div>
            <div class="metric-value">${metrics.total_orders}</div>
            <div>${metrics.orders_accepted} accepted • ${metrics.orders_declined} declined • ${metrics.orders_expired} expired</div>
          </div>
          
          <div class="metric-box">
            <div class="metric-label">Acceptance Rate</div>
            <div class="metric-value">${metrics.acceptance_rate.toFixed(1)}%</div>
            <div>Target: 90%+ for optimal allocation</div>
          </div>
          
          <div class="metric-box">
            <div class="metric-label">Avg Response Time</div>
            <div class="metric-value">${metrics.avg_response_time_hours.toFixed(1)} hrs</div>
            <div>Target: < 12 hours for quality bonus</div>
          </div>
          
          <div class="metric-box">
            <div class="metric-label">Quality Score</div>
            <div class="metric-value">${metrics.quality_score}/100</div>
            <div class="metric-change">${metrics.quality_score_change > 0 ? '↑' : metrics.quality_score_change < 0 ? '↓' : '→'} ${Math.abs(metrics.quality_score_change)} points from last week</div>
          </div>
          
          <div class="metric-box">
            <div class="metric-label">Revenue (Net)</div>
            <div class="metric-value">$${metrics.revenue_net.toFixed(2)}</div>
            <div>Gross: $${metrics.revenue_gross.toFixed(2)} • Fees: $${metrics.broker_fee.toFixed(2)}</div>
          </div>
          
          <h3>🥬 Top Products This Week</h3>
          <table class="products-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Cases Sold</th>
              </tr>
            </thead>
            <tbody>
              ${metrics.top_products.map(p => `
                <tr>
                  <td>${p.name}</td>
                  <td>${p.quantity}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          <div class="recommendations">
            <h3>💡 Recommendations</h3>
            <ul>
              ${metrics.recommendations.map(r => `<li>${r}</li>`).join('')}
            </ul>
          </div>
          
          <p style="margin-top: 30px;">Keep up the great work! Your contributions help local buyers access fresh, sustainable produce.</p>
          
          <p>Questions? Reply to this email or contact support at support@greenreach.ca</p>
        </div>
        
        <div class="footer">
          <p>GreenReach Wholesale Network</p>
          <p>Connecting Local Farms with Local Buyers</p>
        </div>
      </body>
      </html>
    `;
    
    // Send email using notification service
    await notificationService.emailTransporter.sendMail({
      from: notificationService.fromEmail,
      to: metrics.email,
      subject: subject,
      html: htmlBody
    });
    
    console.log(`✅ Report sent to ${metrics.email}`);
    return true;
    
  } catch (error) {
    console.error(`❌ Failed to send report to farm ${farmId}:`, error);
    return false;
  }
}

/**
 * Get all active farms
 * TODO: Replace with actual database query
 */
async function getActiveFarms() {
  // TODO: Query database for farms with orders in last 30 days
  // SELECT DISTINCT farm_id FROM farm_sub_orders 
  // WHERE created_at >= NOW() - INTERVAL '30 days'
  
  return [
    'light-engine-demo',
    // Add more farm IDs as they onboard
  ];
}

/**
 * Main execution
 */
async function main() {
  try {
    const farms = await getActiveFarms();
    
    console.log(`Found ${farms.length} active farm(s)`);
    console.log('');
    
    let successCount = 0;
    let failureCount = 0;
    
    for (const farmId of farms) {
      const success = await sendFarmReport(farmId);
      if (success) {
        successCount++;
      } else {
        failureCount++;
      }
      console.log('');
    }
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Summary');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`✅ Success: ${successCount}`);
    console.log(`❌ Failed: ${failureCount}`);
    console.log('');
    
    if (failureCount === 0) {
      console.log('All reports sent successfully! 🎉');
      process.exit(0);
    } else {
      console.log('Some reports failed to send. Check logs above.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
main();
