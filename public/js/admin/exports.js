// CSV exports — inventory, sales, QuickBooks daily summary.
// Extracted from public/LE-farm-admin.html. Mirrored to greenreach-central.
// Globals: exportInventory(), exportSales(), exportQuickBooks().
/**
 * Export inventory as CSV
 */
async function exportInventory() {
  try {
    const category = document.getElementById('inventoryExportCategory').value;
    const availableOnly = document.getElementById('inventoryAvailableOnly').checked;
    const includeValuation = document.getElementById('inventoryIncludeValuation').checked;
    
    // Build query params
    const params = new URLSearchParams();
    if (category) params.append('category', category);
    if (availableOnly) params.append('available_only', 'true');
    params.append('include_valuation', includeValuation ? 'true' : 'false');
    
    // Fetch and download
    const url = `/api/farm-sales/inventory/export?${params.toString()}`;
    window.location.href = url;
    
    showToast('Inventory export started...', 'success');
  } catch (error) {
    console.error('Inventory export error:', error);
    showToast('Export failed: ' + error.message, 'error');
  }
}

/**
 * Export sales transactions as CSV
 */
async function exportSales() {
  try {
    const startDate = document.getElementById('salesExportStartDate').value;
    const endDate = document.getElementById('salesExportEndDate').value;
    const channel = document.getElementById('salesExportChannel').value;
    const level = document.getElementById('salesExportLevel').value;
    
    if (!startDate || !endDate) {
      showToast('Please select start and end dates', 'error');
      return;
    }
    
    // Build query params
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      channel: channel,
      level: level
    });
    
    // Fetch and download
    const url = `/api/farm-sales/reports/sales-export?${params.toString()}`;
    window.location.href = url;
    
    showToast('Sales export started...', 'success');
  } catch (error) {
    console.error('Sales export error:', error);
    showToast('Export failed: ' + error.message, 'error');
  }
}

/**
 * Export QuickBooks daily summary as CSV
 */
async function exportQuickBooks() {
  try {
    const date = document.getElementById('quickbooksExportDate').value;
    
    if (!date) {
      showToast('Please select a date', 'error');
      return;
    }
    
    // Fetch and download
    const url = `/api/farm-sales/reports/quickbooks-daily-summary?date=${date}`;
    window.location.href = url;
    
    showToast('QuickBooks export started...', 'success');
  } catch (error) {
    console.error('QuickBooks export error:', error);
    showToast('Export failed: ' + error.message, 'error');
  }
}

// Set default dates when exports section is opened
document.addEventListener('DOMContentLoaded', () => {
  // Set default dates to today
  const today = new Date().toISOString().split('T')[0];
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  
  if (document.getElementById('salesExportStartDate')) {
    document.getElementById('salesExportStartDate').value = firstOfMonth;
    document.getElementById('salesExportEndDate').value = today;
  }
  
  if (document.getElementById('quickbooksExportDate')) {
    document.getElementById('quickbooksExportDate').value = today;
  }
});
