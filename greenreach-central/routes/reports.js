/**
 * GreenReach Central - Reports API
 * 
 * Export endpoints for QuickBooks and financial reporting
 */

import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  listAllOrders,
  listPayments
} from '../services/wholesaleMemoryStore.js';

const router = express.Router();

/**
 * Helper: Escape CSV field
 */
function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * GET /api/reports/quickbooks-daily-summary
 * 
 * Export daily wholesale order summary in QuickBooks-compatible format
 * 
 * Query parameters:
 * - date: YYYY-MM-DD (required) - Date to export
 * - mode: 'database' or 'memory' (default: auto-detect based on database availability)
 */
router.get('/quickbooks-daily-summary', authMiddleware, async (req, res, next) => {
  try {
    const { date, mode } = req.query;
    
    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date parameter is required (YYYY-MM-DD format)'
      });
    }
    
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Use YYYY-MM-DD'
      });
    }
    
    const useDatabase = mode === 'database' || (mode !== 'memory' && req.app?.locals?.databaseReady);
    
    let orders = [];
    let payments = [];
    
    if (useDatabase) {
      // Query database
      const startDate = `${date}T00:00:00Z`;
      const endDate = `${date}T23:59:59Z`;
      
      const ordersResult = await query(`
        SELECT 
          order_id,
          buyer_id,
          buyer_name,
          order_items,
          subtotal,
          tax_total,
          total_amount,
          payment_status,
          payment_method,
          created_at
        FROM wholesale_orders
        WHERE created_at >= $1 AND created_at <= $2
        ORDER BY created_at ASC
      `, [startDate, endDate]);
      
      orders = ordersResult.rows;
      
      const paymentsResult = await query(`
        SELECT 
          payment_id,
          order_id,
          amount,
          payment_method,
          provider,
          status,
          processing_fee,
          created_at
        FROM wholesale_payments
        WHERE created_at >= $1 AND created_at <= $2
        ORDER BY created_at ASC
      `, [startDate, endDate]);
      
      payments = paymentsResult.rows;
      
    } else {
      // Use in-memory store
      const allOrders = listAllOrders();
      orders = allOrders.filter(order => {
        const orderDate = new Date(order.created_at || order.timestamp);
        const orderDateStr = orderDate.toISOString().split('T')[0];
        return orderDateStr === date;
      });
      
      const allPayments = listPayments();
      payments = allPayments.filter(payment => {
        const paymentDate = new Date(payment.timestamp);
        const paymentDateStr = paymentDate.toISOString().split('T')[0];
        return paymentDateStr === date;
      });
    }
    
    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No orders found for ${date}`
      });
    }
    
    // Calculate totals
    let totalRevenue = 0;
    let totalTax = 0;
    let totalFees = 0;
    let cashTotal = 0;
    let cardTotal = 0;
    let squareTotal = 0;
    let otherPaymentTotal = 0;
    
    const ordersByPaymentMethod = {};
    
    orders.forEach(order => {
      const subtotal = Number(order.subtotal || 0);
      const tax = Number(order.tax_total || 0);
      const total = Number(order.total_amount || 0);
      
      totalRevenue += subtotal;
      totalTax += tax;
      
      const method = order.payment_method || 'other';
      if (!ordersByPaymentMethod[method]) {
        ordersByPaymentMethod[method] = { count: 0, total: 0 };
      }
      ordersByPaymentMethod[method].count += 1;
      ordersByPaymentMethod[method].total += total;
      
      if (method === 'cash') {
        cashTotal += total;
      } else if (method === 'card' || method === 'credit_card' || method === 'debit_card') {
        cardTotal += total;
      } else if (method === 'square') {
        squareTotal += total;
      } else {
        otherPaymentTotal += total;
      }
    });
    
    // Calculate processing fees from payments or estimate
    payments.forEach(payment => {
      if (payment.processing_fee) {
        totalFees += Number(payment.processing_fee);
      }
    });
    
    // If no processing fees recorded, estimate Square fees (2.9% + $0.30 per transaction)
    if (totalFees === 0 && (cardTotal > 0 || squareTotal > 0)) {
      const cardTransactions = (ordersByPaymentMethod.card?.count || 0) + 
                              (ordersByPaymentMethod.credit_card?.count || 0) +
                              (ordersByPaymentMethod.debit_card?.count || 0) +
                              (ordersByPaymentMethod.square?.count || 0);
      const cardAmount = cardTotal + squareTotal;
      totalFees = (cardAmount * 0.029) + (cardTransactions * 0.30);
    }
    
    // Build QuickBooks CSV
    const rows = [];
    rows.push(['Date', 'Account', 'Debit', 'Credit', 'Memo', 'Customer']);
    
    // Revenue entries (Credits)
    if (totalRevenue > 0) {
      rows.push([
        date,
        'Wholesale Revenue',
        '',
        totalRevenue.toFixed(2),
        `Daily wholesale sales - ${orders.length} orders`,
        'Multiple Buyers'
      ]);
    }
    
    // Tax liability (Credit)
    if (totalTax > 0) {
      rows.push([
        date,
        'Sales Tax Payable',
        '',
        totalTax.toFixed(2),
        'Sales tax collected',
        ''
      ]);
    }
    
    // Asset entries - Money received (Debits)
    if (cashTotal > 0) {
      rows.push([
        date,
        'Cash',
        cashTotal.toFixed(2),
        '',
        `Cash payments received - ${ordersByPaymentMethod.cash?.count || 0} transactions`,
        ''
      ]);
    }
    
    if (cardTotal + squareTotal > 0) {
      rows.push([
        date,
        'Square Account',
        (cardTotal + squareTotal).toFixed(2),
        '',
        `Card payments - ${(ordersByPaymentMethod.card?.count || 0) + (ordersByPaymentMethod.square?.count || 0)} transactions`,
        ''
      ]);
    }
    
    if (otherPaymentTotal > 0) {
      rows.push([
        date,
        'Accounts Receivable',
        otherPaymentTotal.toFixed(2),
        '',
        'Other payment methods',
        ''
      ]);
    }
    
    // Expense entries - Processing fees (Debit)
    if (totalFees > 0) {
      rows.push([
        date,
        'Merchant Processing Fees',
        totalFees.toFixed(2),
        '',
        'Square payment processing fees',
        'Square Inc.'
      ]);
    }
    
    // Generate CSV
    const csv = rows.map(row => row.map(escapeCSV).join(',')).join('\n');
    
    // Set response headers for download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="greenreach-quickbooks-${date}.csv"`);
    
    return res.send(csv);
    
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/reports/wholesale-orders-export
 * 
 * Export wholesale orders for a date range
 * 
 * Query parameters:
 * - start_date: YYYY-MM-DD (required)
 * - end_date: YYYY-MM-DD (required)
 * - level: 'summary' or 'detail' (default: 'summary')
 * - mode: 'database' or 'memory' (default: auto-detect)
 */
router.get('/wholesale-orders-export', authMiddleware, async (req, res, next) => {
  try {
    const { start_date, end_date, level = 'summary', mode } = req.query;
    
    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: 'start_date and end_date parameters are required (YYYY-MM-DD format)'
      });
    }
    
    const useDatabase = mode === 'database' || (mode !== 'memory' && req.app?.locals?.databaseReady);
    
    let orders = [];
    
    if (useDatabase) {
      const startDateTime = `${start_date}T00:00:00Z`;
      const endDateTime = `${end_date}T23:59:59Z`;
      
      const ordersResult = await query(`
        SELECT 
          order_id,
          buyer_id,
          buyer_name,
          buyer_email,
          buyer_company,
          order_items,
          subtotal,
          tax_total,
          total_amount,
          payment_status,
          payment_method,
          status,
          delivery_type,
          delivery_address,
          assigned_farms,
          created_at
        FROM wholesale_orders
        WHERE created_at >= $1 AND created_at <= $2
        ORDER BY created_at ASC
      `, [startDateTime, endDateTime]);
      
      orders = ordersResult.rows;
      
    } else {
      const allOrders = listAllOrders();
      orders = allOrders.filter(order => {
        const orderDate = new Date(order.created_at || order.timestamp);
        const orderDateStr = orderDate.toISOString().split('T')[0];
        return orderDateStr >= start_date && orderDateStr <= end_date;
      });
    }
    
    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No orders found between ${start_date} and ${end_date}`
      });
    }
    
    const rows = [];
    
    if (level === 'detail') {
      // Detail level - one row per line item
      rows.push([
        'Order ID',
        'Date',
        'Time',
        'Buyer Name',
        'Buyer Email',
        'Buyer Company',
        'Line #',
        'SKU',
        'Product Name',
        'Quantity',
        'Unit',
        'Unit Price',
        'Line Total',
        'Order Subtotal',
        'Tax',
        'Order Total',
        'Payment Method',
        'Payment Status',
        'Delivery Type',
        'Status'
      ]);
      
      orders.forEach(order => {
        const orderDate = new Date(order.created_at || order.timestamp);
        const date = orderDate.toISOString().split('T')[0];
        const time = orderDate.toISOString().split('T')[1].split('.')[0];
        
        const items = order.order_items || [];
        items.forEach((item, index) => {
          rows.push([
            order.order_id,
            date,
            time,
            order.buyer_name || '',
            order.buyer_email || '',
            order.buyer_company || '',
            index + 1,
            item.sku_id || '',
            item.product_name || '',
            item.quantity || 0,
            item.unit || '',
            item.price_per_unit || 0,
            item.line_total || (item.quantity * item.price_per_unit),
            order.subtotal || 0,
            order.tax_total || 0,
            order.total_amount || 0,
            order.payment_method || '',
            order.payment_status || '',
            order.delivery_type || '',
            order.status || ''
          ]);
        });
      });
      
    } else {
      // Summary level - one row per order
      rows.push([
        'Order ID',
        'Date',
        'Time',
        'Buyer Name',
        'Buyer Email',
        'Buyer Company',
        'Items Count',
        'Subtotal',
        'Tax',
        'Total',
        'Payment Method',
        'Payment Status',
        'Delivery Type',
        'Status'
      ]);
      
      orders.forEach(order => {
        const orderDate = new Date(order.created_at || order.timestamp);
        const date = orderDate.toISOString().split('T')[0];
        const time = orderDate.toISOString().split('T')[1].split('.')[0];
        
        rows.push([
          order.order_id,
          date,
          time,
          order.buyer_name || '',
          order.buyer_email || '',
          order.buyer_company || '',
          (order.order_items || []).length,
          order.subtotal || 0,
          order.tax_total || 0,
          order.total_amount || 0,
          order.payment_method || '',
          order.payment_status || '',
          order.delivery_type || '',
          order.status || ''
        ]);
      });
    }
    
    // Add totals row
    const totalSubtotal = orders.reduce((sum, o) => sum + Number(o.subtotal || 0), 0);
    const totalTax = orders.reduce((sum, o) => sum + Number(o.tax_total || 0), 0);
    const totalAmount = orders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
    
    if (level === 'detail') {
      rows.push([
        'TOTALS',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        totalSubtotal.toFixed(2),
        totalTax.toFixed(2),
        totalAmount.toFixed(2),
        '',
        '',
        '',
        ''
      ]);
    } else {
      rows.push([
        'TOTALS',
        '',
        '',
        '',
        '',
        '',
        orders.length,
        totalSubtotal.toFixed(2),
        totalTax.toFixed(2),
        totalAmount.toFixed(2),
        '',
        '',
        '',
        ''
      ]);
    }
    
    // Generate CSV
    const csv = rows.map(row => row.map(escapeCSV).join(',')).join('\n');
    
    // Set response headers
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="greenreach-orders-${level}-${start_date}-to-${end_date}.csv"`
    );
    
    return res.send(csv);
    
  } catch (error) {
    next(error);
  }
});

export default router;
