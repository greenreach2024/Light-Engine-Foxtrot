/**
 * QuickBooks Sync Service
 * 
 * Syncs customers, products, invoices, and payments to QuickBooks Online
 * Includes sync status tracking, error handling, and conflict resolution
 */

import axios from 'axios';
import { isTokenExpired, refreshAccessToken } from './quickbooks-oauth.js';

const QB_API_BASE = {
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
  production: 'https://quickbooks.api.intuit.com'
};

const getApiBase = () => {
  const env = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
  return QB_API_BASE[env];
};

/**
 * Make authenticated API request to QuickBooks
 * @param {string} method - HTTP method
 * @param {string} endpoint - API endpoint
 * @param {object} tokenData - Token data with access_token and realm_id
 * @param {object} data - Request body
 * @returns {Promise<object>} API response
 */
async function makeQBRequest(method, endpoint, tokenData, data = null) {
  const apiBase = getApiBase();
  const url = `${apiBase}/v3/company/${tokenData.realm_id}${endpoint}`;
  
  try {
    const response = await axios({
      method,
      url,
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      data
    });
    
    return response.data;
    
  } catch (error) {
    console.error('[QuickBooks Sync] API request failed:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Sync customer to QuickBooks
 * @param {object} customer - Customer data from farm sales
 * @param {object} tokenData - QuickBooks token data
 * @returns {Promise<object>} Sync result
 */
export async function syncCustomer(customer, tokenData) {
  try {
    // Check if customer exists by display name
    const queryResponse = await makeQBRequest(
      'GET',
      `/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${customer.name}'`)}`,
      tokenData
    );
    
    const existingCustomer = queryResponse.QueryResponse?.Customer?.[0];
    
    const customerData = {
      DisplayName: customer.name || 'Unknown Customer',
      PrimaryEmailAddr: customer.email ? { Address: customer.email } : undefined,
      PrimaryPhone: customer.phone ? { FreeFormNumber: customer.phone } : undefined,
      CompanyName: customer.company || undefined,
      BillAddr: customer.address ? {
        Line1: customer.address.street || '',
        City: customer.address.city || '',
        CountrySubDivisionCode: customer.address.state || '',
        PostalCode: customer.address.zip || '',
        Country: customer.address.country || 'US'
      } : undefined
    };
    
    if (existingCustomer) {
      // Update existing customer
      customerData.Id = existingCustomer.Id;
      customerData.SyncToken = existingCustomer.SyncToken;
      
      const response = await makeQBRequest(
        'POST',
        '/customer',
        tokenData,
        customerData
      );
      
      return {
        success: true,
        action: 'updated',
        qb_id: response.Customer.Id,
        qb_sync_token: response.Customer.SyncToken
      };
      
    } else {
      // Create new customer
      const response = await makeQBRequest(
        'POST',
        '/customer',
        tokenData,
        customerData
      );
      
      return {
        success: true,
        action: 'created',
        qb_id: response.Customer.Id,
        qb_sync_token: response.Customer.SyncToken
      };
    }
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      details: error.response?.data
    };
  }
}

/**
 * Sync product/item to QuickBooks
 * @param {object} product - Product data from farm inventory
 * @param {object} tokenData - QuickBooks token data
 * @returns {Promise<object>} Sync result
 */
export async function syncProduct(product, tokenData) {
  try {
    // Check if item exists by name
    const queryResponse = await makeQBRequest(
      'GET',
      `/query?query=${encodeURIComponent(`SELECT * FROM Item WHERE Name = '${product.product_name}'`)}`,
      tokenData
    );
    
    const existingItem = queryResponse.QueryResponse?.Item?.[0];
    
    // Get income account (default to Sales)
    const accountsResponse = await makeQBRequest(
      'GET',
      `/query?query=${encodeURIComponent("SELECT * FROM Account WHERE AccountType = 'Income' AND Name = 'Sales' MAXRESULTS 1")}`,
      tokenData
    );
    
    const incomeAccount = accountsResponse.QueryResponse?.Account?.[0];
    
    if (!incomeAccount) {
      throw new Error('Income account not found in QuickBooks');
    }
    
    const itemData = {
      Name: product.product_name || 'Unknown Product',
      Type: 'Inventory',
      Description: product.description || '',
      UnitPrice: product.price_per_unit || 0,
      QtyOnHand: product.quantity_total || 0,
      InvStartDate: new Date().toISOString().split('T')[0],
      IncomeAccountRef: {
        value: incomeAccount.Id
      },
      AssetAccountRef: {
        value: incomeAccount.Id // Simplified - should use inventory asset account
      },
      TrackQtyOnHand: true
    };
    
    if (existingItem) {
      // Update existing item
      itemData.Id = existingItem.Id;
      itemData.SyncToken = existingItem.SyncToken;
      
      const response = await makeQBRequest(
        'POST',
        '/item',
        tokenData,
        itemData
      );
      
      return {
        success: true,
        action: 'updated',
        qb_id: response.Item.Id,
        qb_sync_token: response.Item.SyncToken
      };
      
    } else {
      // Create new item
      const response = await makeQBRequest(
        'POST',
        '/item',
        tokenData,
        itemData
      );
      
      return {
        success: true,
        action: 'created',
        qb_id: response.Item.Id,
        qb_sync_token: response.Item.SyncToken
      };
    }
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      details: error.response?.data
    };
  }
}

/**
 * Sync invoice to QuickBooks
 * @param {object} order - Order data from farm sales
 * @param {object} tokenData - QuickBooks token data
 * @param {string} customerQbId - QuickBooks customer ID
 * @returns {Promise<object>} Sync result
 */
export async function syncInvoice(order, tokenData, customerQbId) {
  try {
    // Check if invoice exists by order ID
    const queryResponse = await makeQBRequest(
      'GET',
      `/query?query=${encodeURIComponent(`SELECT * FROM Invoice WHERE DocNumber = '${order.order_id}'`)}`,
      tokenData
    );
    
    const existingInvoice = queryResponse.QueryResponse?.Invoice?.[0];
    
    if (existingInvoice) {
      return {
        success: true,
        action: 'exists',
        qb_id: existingInvoice.Id,
        message: 'Invoice already exists'
      };
    }
    
    // Create invoice line items
    const lineItems = (order.items || []).map((item, index) => ({
      DetailType: 'SalesItemLineDetail',
      Amount: item.line_total || (item.quantity * item.price_per_unit),
      Description: item.product_name || '',
      SalesItemLineDetail: {
        Qty: item.quantity || 0,
        UnitPrice: item.price_per_unit || 0,
        ItemRef: {
          value: item.qb_item_id || '1' // Requires pre-synced items
        }
      }
    }));
    
    // Add tax line if applicable
    if (order.tax_amount && order.tax_amount > 0) {
      lineItems.push({
        DetailType: 'SalesItemLineDetail',
        Amount: order.tax_amount,
        Description: 'Sales Tax',
        SalesItemLineDetail: {
          TaxCodeRef: {
            value: 'TAX'
          }
        }
      });
    }
    
    const invoiceData = {
      DocNumber: order.order_id,
      TxnDate: new Date(order.created_at || order.timestamp).toISOString().split('T')[0],
      CustomerRef: {
        value: customerQbId
      },
      Line: lineItems,
      TotalAmt: order.total_amount || 0
    };
    
    const response = await makeQBRequest(
      'POST',
      '/invoice',
      tokenData,
      invoiceData
    );
    
    return {
      success: true,
      action: 'created',
      qb_id: response.Invoice.Id,
      qb_sync_token: response.Invoice.SyncToken
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      details: error.response?.data
    };
  }
}

/**
 * Sync payment to QuickBooks
 * @param {object} payment - Payment data from farm sales
 * @param {object} tokenData - QuickBooks token data
 * @param {string} customerQbId - QuickBooks customer ID
 * @param {string} invoiceQbId - QuickBooks invoice ID
 * @returns {Promise<object>} Sync result
 */
export async function syncPayment(payment, tokenData, customerQbId, invoiceQbId) {
  try {
    // Get deposit account
    const accountsResponse = await makeQBRequest(
      'GET',
      `/query?query=${encodeURIComponent("SELECT * FROM Account WHERE AccountType = 'Bank' MAXRESULTS 1")}`,
      tokenData
    );
    
    const depositAccount = accountsResponse.QueryResponse?.Account?.[0];
    
    if (!depositAccount) {
      throw new Error('Deposit account not found in QuickBooks');
    }
    
    const paymentData = {
      TotalAmt: payment.amount || 0,
      CustomerRef: {
        value: customerQbId
      },
      DepositToAccountRef: {
        value: depositAccount.Id
      },
      TxnDate: new Date(payment.timestamp || payment.created_at).toISOString().split('T')[0],
      PaymentMethodRef: {
        value: payment.payment_method === 'card' ? '2' : '1' // Cash or Card
      },
      Line: [{
        Amount: payment.amount || 0,
        LinkedTxn: [{
          TxnId: invoiceQbId,
          TxnType: 'Invoice'
        }]
      }]
    };
    
    const response = await makeQBRequest(
      'POST',
      '/payment',
      tokenData,
      paymentData
    );
    
    return {
      success: true,
      action: 'created',
      qb_id: response.Payment.Id,
      qb_sync_token: response.Payment.SyncToken
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      details: error.response?.data
    };
  }
}

/**
 * Batch sync orders with full transaction flow
 * @param {array} orders - Array of orders to sync
 * @param {object} tokenData - QuickBooks token data
 * @returns {Promise<object>} Batch sync results
 */
export async function batchSyncOrders(orders, tokenData) {
  const results = {
    total: orders.length,
    successful: 0,
    failed: 0,
    details: []
  };
  
  for (const order of orders) {
    try {
      // 1. Sync customer
      const customerResult = await syncCustomer({
        name: order.customer_name,
        email: order.customer_email,
        phone: order.customer_phone
      }, tokenData);
      
      if (!customerResult.success) {
        results.failed++;
        results.details.push({
          order_id: order.order_id,
          success: false,
          stage: 'customer',
          error: customerResult.error
        });
        continue;
      }
      
      // 2. Sync invoice
      const invoiceResult = await syncInvoice(
        order,
        tokenData,
        customerResult.qb_id
      );
      
      if (!invoiceResult.success) {
        results.failed++;
        results.details.push({
          order_id: order.order_id,
          success: false,
          stage: 'invoice',
          error: invoiceResult.error
        });
        continue;
      }
      
      // 3. Sync payment if order is paid
      if (order.payment_status === 'completed' || order.status === 'completed') {
        const paymentResult = await syncPayment(
          {
            amount: order.total_amount,
            payment_method: order.payment_method,
            timestamp: order.created_at
          },
          tokenData,
          customerResult.qb_id,
          invoiceResult.qb_id
        );
        
        if (!paymentResult.success) {
          results.failed++;
          results.details.push({
            order_id: order.order_id,
            success: false,
            stage: 'payment',
            error: paymentResult.error
          });
          continue;
        }
      }
      
      results.successful++;
      results.details.push({
        order_id: order.order_id,
        success: true,
        customer_qb_id: customerResult.qb_id,
        invoice_qb_id: invoiceResult.qb_id
      });
      
    } catch (error) {
      results.failed++;
      results.details.push({
        order_id: order.order_id,
        success: false,
        stage: 'unknown',
        error: error.message
      });
    }
  }
  
  return results;
}

export default {
  syncCustomer,
  syncProduct,
  syncInvoice,
  syncPayment,
  batchSyncOrders,
  makeQBRequest
};
