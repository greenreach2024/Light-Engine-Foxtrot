/**
 * Farm Sales - Reports & Analytics
 * Sales metrics, inventory analysis, customer insights (MULTI-TENANT)
 */

import express from 'express';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';
import { farmStores } from '../../lib/farm-store.js';

const router = express.Router();

// Apply authentication to all routes
router.use(farmAuthMiddleware);

/**
 * GET /api/farm-sales/reports/sales-summary
 * Sales overview with key metrics
 * 
 * Query params:
 * - start_date: Start date (YYYY-MM-DD, default: 30 days ago)
 * - end_date: End date (YYYY-MM-DD, default: today)
 * - channel: Filter by channel (pos, delivery, b2b, etc.)
 */
router.get('/sales-summary', (req, res) => {
  try {
    const { start_date, end_date, channel } = req.query;
    const farmId = req.farm_id;

    // Default date range: last 30 days
    const endDate = end_date ? new Date(end_date) : new Date();
    const startDate = start_date ? new Date(start_date) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Get orders in date range
    let orders = farmStores.orders.getAllForFarm(farmId)
      .filter(o => {
        const orderDate = new Date(o.timestamps.created_at);
        return orderDate >= startDate && orderDate <= endDate;
      });

    // Filter by channel if specified
    if (channel) {
      orders = orders.filter(o => o.channel === channel);
    }

    // Calculate metrics
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + (o.payment?.amount || 0), 0);
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Orders by channel
    const byChannel = {};
    orders.forEach(o => {
      if (!byChannel[o.channel]) {
        byChannel[o.channel] = { count: 0, revenue: 0 };
      }
      byChannel[o.channel].count++;
      byChannel[o.channel].revenue += o.payment?.amount || 0;
    });

    // Orders by status
    const byStatus = {};
    orders.forEach(o => {
      if (!byStatus[o.status]) {
        byStatus[o.status] = 0;
      }
      byStatus[o.status]++;
    });

    // Daily breakdown
    const dailySales = {};
    orders.forEach(o => {
      const date = new Date(o.timestamps.created_at).toISOString().split('T')[0];
      if (!dailySales[date]) {
        dailySales[date] = { orders: 0, revenue: 0 };
      }
      dailySales[date].orders++;
      dailySales[date].revenue += o.payment?.amount || 0;
    });

    res.json({
      ok: true,
      farm_id: farmId,
      period: {
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        days: Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
      },
      summary: {
        total_orders: totalOrders,
        total_revenue: Math.round(totalRevenue * 100) / 100,
        average_order_value: Math.round(averageOrderValue * 100) / 100,
        by_channel: byChannel,
        by_status: byStatus
      },
      daily_breakdown: Object.entries(dailySales)
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date))
    });

  } catch (error) {
    console.error('[farm-sales] Sales summary failed:', error);
    res.status(500).json({
      ok: false,
      error: 'report_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/reports/inventory-turnover
 * Inventory performance and turnover analysis
 */
router.get('/inventory-turnover', (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const farmId = req.farm_id;

    // Default date range: last 30 days
    const endDate = end_date ? new Date(end_date) : new Date();
    const startDate = start_date ? new Date(start_date) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Get current inventory
    const inventory = farmStores.inventory.getAllForFarm(farmId);

    // Get orders in date range
    const orders = farmStores.orders.getAllForFarm(farmId)
      .filter(o => {
        const orderDate = new Date(o.timestamps.created_at);
        return orderDate >= startDate && orderDate <= endDate;
      });

    // Aggregate sales by SKU
    const salesBySku = {};
    orders.forEach(order => {
      order.items.forEach(item => {
        if (!salesBySku[item.sku_id]) {
          salesBySku[item.sku_id] = {
            sku_id: item.sku_id,
            name: item.name,
            category: item.category,
            units_sold: 0,
            revenue: 0
          };
        }
        salesBySku[item.sku_id].units_sold += item.quantity;
        salesBySku[item.sku_id].revenue += item.line_total || (item.quantity * item.unit_price);
      });
    });

    // Combine with inventory data
    const turnoverReport = inventory.map(item => {
      const sales = salesBySku[item.sku_id] || { units_sold: 0, revenue: 0 };
      const totalStock = item.quantity; // Current + sold
      const turnoverRate = totalStock > 0 ? (sales.units_sold / totalStock) * 100 : 0;
      
      return {
        sku_id: item.sku_id,
        name: item.name,
        category: item.category,
        current_stock: item.available,
        units_sold: sales.units_sold,
        revenue: Math.round(sales.revenue * 100) / 100,
        turnover_rate: Math.round(turnoverRate * 100) / 100,
        stock_value: Math.round(item.available * item.retail_price * 100) / 100
      };
    });

    // Sort by revenue descending
    turnoverReport.sort((a, b) => b.revenue - a.revenue);

    // Calculate summary stats
    const summary = {
      total_skus: turnoverReport.length,
      total_stock_value: Math.round(turnoverReport.reduce((sum, i) => sum + i.stock_value, 0) * 100) / 100,
      total_revenue: Math.round(turnoverReport.reduce((sum, i) => sum + i.revenue, 0) * 100) / 100,
      average_turnover_rate: Math.round((turnoverReport.reduce((sum, i) => sum + i.turnover_rate, 0) / turnoverReport.length) * 100) / 100,
      top_performers: turnoverReport.slice(0, 5).map(i => ({ sku_id: i.sku_id, name: i.name, revenue: i.revenue })),
      slow_movers: turnoverReport.filter(i => i.turnover_rate < 10 && i.current_stock > 0).slice(0, 5)
    };

    res.json({
      ok: true,
      farm_id: farmId,
      period: {
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0]
      },
      summary,
      inventory: turnoverReport
    });

  } catch (error) {
    console.error('[farm-sales] Inventory turnover report failed:', error);
    res.status(500).json({
      ok: false,
      error: 'report_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/reports/customer-analytics
 * Customer insights: lifetime value, retention, top customers
 */
router.get('/customer-analytics', (req, res) => {
  try {
    const farmId = req.farm_id;

    // Get all customers
    const customers = farmStores.customers?.getAllForFarm(farmId) || [];

    // Get all orders
    const orders = farmStores.orders.getAllForFarm(farmId);

    // Calculate customer metrics
    const customerMetrics = customers.map(customer => {
      const customerOrders = orders.filter(o => 
        o.customer?.email === customer.email || o.customer?.customer_id === customer.customer_id
      );

      const totalSpent = customerOrders.reduce((sum, o) => sum + (o.payment?.amount || 0), 0);
      const orderCount = customerOrders.length;
      const averageOrderValue = orderCount > 0 ? totalSpent / orderCount : 0;

      // Calculate days since last order
      const lastOrderDate = customerOrders.length > 0 
        ? new Date(Math.max(...customerOrders.map(o => new Date(o.timestamps.created_at))))
        : null;
      const daysSinceLastOrder = lastOrderDate 
        ? Math.floor((new Date() - lastOrderDate) / (1000 * 60 * 60 * 24))
        : null;

      return {
        customer_id: customer.customer_id,
        name: customer.name,
        email: customer.email,
        order_count: orderCount,
        lifetime_value: Math.round(totalSpent * 100) / 100,
        average_order_value: Math.round(averageOrderValue * 100) / 100,
        credit_balance: customer.credit_balance || 0,
        days_since_last_order: daysSinceLastOrder,
        status: daysSinceLastOrder === null ? 'new' : daysSinceLastOrder > 90 ? 'at-risk' : daysSinceLastOrder > 30 ? 'inactive' : 'active'
      };
    });

    // Sort by lifetime value
    customerMetrics.sort((a, b) => b.lifetime_value - a.lifetime_value);

    // Calculate summary stats
    const summary = {
      total_customers: customerMetrics.length,
      total_lifetime_value: Math.round(customerMetrics.reduce((sum, c) => sum + c.lifetime_value, 0) * 100) / 100,
      average_lifetime_value: customerMetrics.length > 0 
        ? Math.round((customerMetrics.reduce((sum, c) => sum + c.lifetime_value, 0) / customerMetrics.length) * 100) / 100
        : 0,
      by_status: {
        active: customerMetrics.filter(c => c.status === 'active').length,
        inactive: customerMetrics.filter(c => c.status === 'inactive').length,
        'at-risk': customerMetrics.filter(c => c.status === 'at-risk').length,
        new: customerMetrics.filter(c => c.status === 'new').length
      },
      top_customers: customerMetrics.slice(0, 10)
    };

    res.json({
      ok: true,
      farm_id: farmId,
      summary,
      customers: customerMetrics
    });

  } catch (error) {
    console.error('[farm-sales] Customer analytics failed:', error);
    res.status(500).json({
      ok: false,
      error: 'report_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/reports/product-performance
 * Product performance analysis
 */
router.get('/product-performance', (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const farmId = req.farm_id;

    // Default date range: last 30 days
    const endDate = end_date ? new Date(end_date) : new Date();
    const startDate = start_date ? new Date(start_date) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Get orders in date range
    const orders = farmStores.orders.getAllForFarm(farmId)
      .filter(o => {
        const orderDate = new Date(o.timestamps.created_at);
        return orderDate >= startDate && orderDate <= endDate;
      });

    // Aggregate by product
    const productStats = {};
    orders.forEach(order => {
      order.items.forEach(item => {
        if (!productStats[item.sku_id]) {
          productStats[item.sku_id] = {
            sku_id: item.sku_id,
            name: item.name,
            category: item.category,
            units_sold: 0,
            revenue: 0,
            orders_count: 0,
            average_quantity_per_order: 0
          };
        }
        productStats[item.sku_id].units_sold += item.quantity;
        productStats[item.sku_id].revenue += item.line_total || (item.quantity * item.unit_price);
        productStats[item.sku_id].orders_count++;
      });
    });

    // Calculate averages
    Object.values(productStats).forEach(product => {
      product.average_quantity_per_order = product.orders_count > 0 
        ? Math.round((product.units_sold / product.orders_count) * 100) / 100
        : 0;
      product.revenue = Math.round(product.revenue * 100) / 100;
    });

    // Convert to array and sort by revenue
    const performance = Object.values(productStats).sort((a, b) => b.revenue - a.revenue);

    // Group by category
    const byCategory = {};
    performance.forEach(product => {
      if (!byCategory[product.category]) {
        byCategory[product.category] = {
          products: 0,
          units_sold: 0,
          revenue: 0
        };
      }
      byCategory[product.category].products++;
      byCategory[product.category].units_sold += product.units_sold;
      byCategory[product.category].revenue += product.revenue;
    });

    const summary = {
      total_products: performance.length,
      total_revenue: Math.round(performance.reduce((sum, p) => sum + p.revenue, 0) * 100) / 100,
      total_units_sold: performance.reduce((sum, p) => sum + p.units_sold, 0),
      by_category: byCategory,
      top_performers: performance.slice(0, 10),
      bottom_performers: performance.slice(-5)
    };

    res.json({
      ok: true,
      farm_id: farmId,
      period: {
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0]
      },
      summary,
      products: performance
    });

  } catch (error) {
    console.error('[farm-sales] Product performance report failed:', error);
    res.status(500).json({
      ok: false,
      error: 'report_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/reports/dashboard
 * Combined dashboard with key metrics
 */
router.get('/dashboard', async (req, res) => {
  try {
    const farmId = req.farm_id;

    // Get data for last 30 days
    const endDate = new Date();
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const orders = farmStores.orders.getAllForFarm(farmId)
      .filter(o => {
        const orderDate = new Date(o.timestamps.created_at);
        return orderDate >= startDate && orderDate <= endDate;
      });

    const inventory = farmStores.inventory.getAllForFarm(farmId);
    const customers = farmStores.customers?.getAllForFarm(farmId) || [];

    // Calculate key metrics
    const totalRevenue = orders.reduce((sum, o) => sum + (o.payment?.amount || 0), 0);
    const totalOrders = orders.length;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const totalInventoryValue = inventory.reduce((sum, i) => 
      sum + (i.available * i.retail_price), 0
    );

    const activeCustomers = customers.filter(c => {
      const customerOrders = orders.filter(o => 
        o.customer?.email === c.email || o.customer?.customer_id === c.customer_id
      );
      return customerOrders.length > 0;
    }).length;

    // Growth metrics (compare to previous 30 days)
    const previousStart = new Date(startDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const previousOrders = farmStores.orders.getAllForFarm(farmId)
      .filter(o => {
        const orderDate = new Date(o.timestamps.created_at);
        return orderDate >= previousStart && orderDate < startDate;
      });

    const previousRevenue = previousOrders.reduce((sum, o) => sum + (o.payment?.amount || 0), 0);
    const revenueGrowth = previousRevenue > 0 
      ? ((totalRevenue - previousRevenue) / previousRevenue) * 100
      : 0;

    res.json({
      ok: true,
      farm_id: farmId,
      period: {
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0]
      },
      metrics: {
        revenue: {
          current: Math.round(totalRevenue * 100) / 100,
          previous: Math.round(previousRevenue * 100) / 100,
          growth_percent: Math.round(revenueGrowth * 100) / 100
        },
        orders: {
          current: totalOrders,
          previous: previousOrders.length,
          growth_percent: previousOrders.length > 0 
            ? Math.round(((totalOrders - previousOrders.length) / previousOrders.length) * 100 * 100) / 100
            : 0
        },
        average_order_value: Math.round(averageOrderValue * 100) / 100,
        inventory_value: Math.round(totalInventoryValue * 100) / 100,
        active_customers: activeCustomers,
        total_customers: customers.length,
        low_stock_items: inventory.filter(i => i.available < 20).length
      }
    });

  } catch (error) {
    console.error('[farm-sales] Dashboard report failed:', error);
    res.status(500).json({
      ok: false,
      error: 'report_failed',
      message: error.message
    });
  }
});

export default router;
