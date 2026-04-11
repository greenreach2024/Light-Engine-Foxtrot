(() => {
  'use strict';

  const admin = {
    currentView: 'overview',
    farms: [],
    payments: [],
    orders: [],
    refunds: [],
    network: {
      farms: [],
      snapshots: [],
      aggregate: null,
      events: [],
      recommendations: []
    },

    // Get authentication headers for admin API calls
    getAuthHeaders() {
      const token =
        localStorage.getItem('admin_token') ||
        localStorage.getItem('auth_token') ||
        sessionStorage.getItem('token') ||
        localStorage.getItem('token');
      const headers = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      return headers;
    },

    async init() {
      // Check for admin token
      const token = localStorage.getItem('admin_token');
      if (!token) {
        console.warn('[Wholesale Admin] No admin token found. Some features may be limited.');
      }
      
      this.setupEventListeners();
      await this.loadOverview();
      
      // Check for overselling issues
      await this.checkOverselling();
      
      // Re-check every 5 minutes
      setInterval(() => this.checkOverselling(), 5 * 60 * 1000);
    },

    setupEventListeners() {
      document.querySelectorAll('.nav-tab').forEach((tab) => {
        tab.addEventListener('click', (e) => {
          const view = e.target?.dataset?.view;
          if (view) this.navigateTo(view);
        });
      });

      // Buyers search on Enter
      const buyersSearch = document.getElementById('buyers-search');
      if (buyersSearch) {
        buyersSearch.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') this.loadBuyers();
        });
      }

      document.addEventListener('click', (event) => {
        const target = event.target;

        if (target.closest('#onboard-open-btn')) return this.openOnboardModal();
        if (target.closest('[data-action="close-onboard"]')) return this.closeOnboardModal();
        if (target.closest('#copy-oauth-url-btn')) return this.copyOAuthUrl();
        if (target.closest('#generate-oauth-url-btn')) return this.generateOAuthUrl();

        if (target.closest('#payment-apply-filters-btn')) return this.filterPayments();
        if (target.closest('#reconcile-all-btn')) return this.reconcilePayments();

        if (target.closest('#orders-apply-filters-btn')) return this.filterOrders();
        if (target.closest('#run-reconciliation-btn')) return this.runReconciliation();
        if (target.closest('#reset-rejected-btn')) return this.resetRejectedOrders();
        if (target.closest('#buyers-refresh-btn')) return this.loadBuyers();

        if (target.closest('#network-refresh-btn')) return this.loadNetwork();

        const actionBtn = target.closest('button[data-action]');
        if (actionBtn) {
          const action = actionBtn.dataset.action;
          if (action === 'refresh-token') return this.refreshToken(actionBtn.dataset.farmid);
          if (action === 'disconnect-farm') return this.disconnectFarm(actionBtn.dataset.farmid);
          if (action === 'payment-details') return this.viewPaymentDetails(actionBtn.dataset.paymentid);
          if (action === 'network-add-farm') return this.addOrUpdateNetworkFarm();
          if (action === 'network-remove-farm') return this.removeNetworkFarm(actionBtn.dataset.farmid);
          if (action === 'network-add-event') return this.addMarketEvent();
        }
      });
    },

    navigateTo(view) {
      this.currentView = view;

      document.querySelectorAll('.nav-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.view === view);
      });

      document.querySelectorAll('.view').forEach((v) => {
        v.classList.toggle('active', v.id === `${view}-view`);
      });

      switch (view) {
        case 'overview':
          this.loadOverview();
          break;
        case 'farms':
          this.loadFarms();
          break;
        case 'network':
          this.loadNetwork();
          break;
        case 'payment-setup':
          this.loadPaymentSetup();
          break;
        case 'payments':
          this.loadPayments();
          break;
        case 'buyers':
          this.loadBuyers();
          break;
        case 'orders':
          this.loadOrders();
          break;
        case 'reconciliation':
          this.loadRefunds();
          break;
        case 'compliance':
          this.loadComplianceView();
          break;
        case 'product-requests':
          this.loadProductRequests();
          break;
        case 'donations':
          this.loadDonationsDashboard();
          break;
      }
    },

    async loadProductRequests() {
      const container = document.getElementById('admin-requests-list');
      if (!container) return;
      container.innerHTML = '<p style="color: var(--text-secondary);">Loading requests...</p>';

      try {
        const headers = this.getAuthHeaders();
        const filterEl = document.getElementById('admin-request-status-filter');
        const statusFilter = filterEl ? filterEl.value : '';
        const url = '/api/wholesale/product-requests' + (statusFilter ? '?status=' + statusFilter : '');
        const res = await fetch(url, { headers });
        const json = await res.json();

        if (!json.ok || !json.requests || !json.requests.length) {
          container.innerHTML = '<p style="color: var(--text-secondary);">No product requests found.</p>';
          return;
        }

        const statusColors = {
          open: '#fef3c7',
          matched: '#dbeafe',
          fulfilled: '#d1fae5',
          expired: '#f3f4f6',
          cancelled: '#fee2e2'
        };
        const statusTextColors = {
          open: '#92400e',
          matched: '#1e40af',
          fulfilled: '#065f46',
          expired: '#6b7280',
          cancelled: '#991b1b'
        };

        container.innerHTML = json.requests.map(req => {
          const bg = statusColors[req.status] || '#f3f4f6';
          const fg = statusTextColors[req.status] || '#374151';
          const neededBy = req.needed_by_date
            ? new Date(req.needed_by_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '--';
          const created = new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const buyerName = this.escHtml(req.business_name || req.contact_name || ('Buyer #' + req.buyer_id));
          const SQ = "'";

          let card = '<div style="background: var(--card-bg, #fff); border: 1px solid var(--border-color, #e5e7eb); border-radius: 8px; padding: 1.25rem;">'
            + '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">'
            + '  <strong style="font-size: 1.05rem;">' + this.escHtml(req.product_name) + '</strong>'
            + '  <span style="background:' + bg + '; color:' + fg + '; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 600;">' + this.escHtml(req.status) + '</span>'
            + '</div>'
            + '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.5rem; font-size: 0.9rem; color: var(--text-secondary, #6b7280);">'
            + '  <div><div style="font-weight:600; color: var(--text-primary, #111);">Buyer</div>' + buyerName + '</div>'
            + '  <div><div style="font-weight:600; color: var(--text-primary, #111);">Quantity</div>' + this.escHtml(String(req.quantity)) + ' ' + this.escHtml(req.unit || 'units') + '</div>'
            + '  <div><div style="font-weight:600; color: var(--text-primary, #111);">Needed By</div>' + neededBy + '</div>'
            + '  <div><div style="font-weight:600; color: var(--text-primary, #111);">Submitted</div>' + created + '</div>';
          if (req.max_price_per_unit) {
            card += '  <div><div style="font-weight:600; color: var(--text-primary, #111);">Max Price</div>$' + Number(req.max_price_per_unit).toFixed(2) + '/' + this.escHtml(req.unit || 'unit') + '</div>';
          }
          card += '</div>';
          if (req.description) {
            card += '<p style="margin: 0.75rem 0 0; font-size: 0.9rem; color: var(--text-secondary, #6b7280);">' + this.escHtml(req.description) + '</p>';
          }
          if (req.status === 'open') {
            card += '<div style="margin-top: 0.75rem; display: flex; gap: 0.5rem;">'
              + '<button onclick="admin.updateRequestStatus(' + req.id + ', ' + SQ + 'matched' + SQ + ')" style="padding: 0.4rem 0.8rem; background: #dbeafe; color: #1e40af; border: none; border-radius: 6px; cursor: pointer; font-size: 0.8rem;">Mark Matched</button>'
              + '<button onclick="admin.updateRequestStatus(' + req.id + ', ' + SQ + 'fulfilled' + SQ + ')" style="padding: 0.4rem 0.8rem; background: #d1fae5; color: #065f46; border: none; border-radius: 6px; cursor: pointer; font-size: 0.8rem;">Mark Fulfilled</button>'
              + '<button onclick="admin.updateRequestStatus(' + req.id + ', ' + SQ + 'expired' + SQ + ')" style="padding: 0.4rem 0.8rem; background: #f3f4f6; color: #6b7280; border: none; border-radius: 6px; cursor: pointer; font-size: 0.8rem;">Mark Expired</button>'
              + '</div>';
          }
          card += '</div>';
          return card;
        }).join('');
      } catch (err) {
        console.error('[Wholesale Admin] Failed to load product requests:', err);
        container.innerHTML = '<p style="color: #dc2626;">Failed to load product requests.</p>';
      }
    },

    async updateRequestStatus(requestId, status) {
      try {
        const headers = this.getAuthHeaders();
        const res = await fetch('/api/wholesale/product-requests/' + requestId + '/status', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ status })
        });
        const json = await res.json();
        if (json.ok) {
          this.loadProductRequests();
        } else {
          alert(json.message || 'Failed to update status');
        }
      } catch (err) {
        console.error('[Wholesale Admin] Status update error:', err);
        alert('Failed to update request status');
      }
    },

    escHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    async loadNetwork() {
      try {
        const headers = this.getAuthHeaders();
        const toArray = (value) => {
          if (Array.isArray(value)) return value;
          if (Array.isArray(value?.items)) return value.items;
          return [];
        };
        const [farmsRes, snapshotsRes, aggregateRes, eventsRes, recsRes] = await Promise.all([
          fetch('/api/wholesale/network/farms', { headers }),
          fetch('/api/wholesale/network/snapshots', { headers }),
          fetch('/api/wholesale/network/aggregate', { headers }),
          fetch('/api/wholesale/network/market-events', { headers }),
          fetch('/api/wholesale/network/recommendations', { headers })
        ]);

        const farmsJson = await farmsRes.json().catch(() => null);
        const snapshotsJson = await snapshotsRes.json().catch(() => null);
        const aggregateJson = await aggregateRes.json().catch(() => null);
        const eventsJson = await eventsRes.json().catch(() => null);
        const recsJson = await recsRes.json().catch(() => null);

        if (farmsRes.ok && farmsJson?.status === 'ok') {
          this.network.farms = toArray(farmsJson.data?.farms);
          this.network.lastSync = farmsJson.data?.lastSync || null;
        } else {
          this.network.farms = [];
          this.network.lastSync = null;
        }

        if (snapshotsRes.ok && snapshotsJson?.status === 'ok') {
          this.network.snapshots = toArray(snapshotsJson.data?.snapshots);
        } else {
          this.network.snapshots = [];
        }

        if (aggregateRes.ok && aggregateJson?.status === 'ok') {
          this.network.aggregate = aggregateJson.data?.catalog || null;
        } else {
          this.network.aggregate = null;
        }

        if (eventsRes.ok && eventsJson?.status === 'ok') {
          this.network.events = toArray(eventsJson.data?.events);
        } else {
          this.network.events = [];
        }

        if (recsRes.ok && recsJson?.status === 'ok') {
          this.network.recommendations = toArray(recsJson.data?.recommendations || recsJson.data);
        } else {
          this.network.recommendations = [];
        }

        this.renderNetworkStats();
        this.renderNetworkFarmsTable();
        this.renderNetworkSnapshotsTable();
        this.renderNetworkEvents();
        this.renderNetworkRecommendations();
      } catch (error) {
        console.error('Load network error:', error);
        this.showToast('Failed to load network dashboard', 'error');
      }
    },

    renderNetworkStats() {
      const lastSyncEl = document.getElementById('network-last-sync');
      const farmsCountEl = document.getElementById('network-farms-count');
      const healthyCountEl = document.getElementById('network-healthy-count');
      const skuCountEl = document.getElementById('network-sku-count');

      if (lastSyncEl) {
        lastSyncEl.textContent = this.network.lastSync ? new Date(this.network.lastSync).toLocaleString() : '—';
      }

      if (farmsCountEl) farmsCountEl.textContent = String((this.network.farms || []).length);

      const snapshots = Array.isArray(this.network.snapshots) ? this.network.snapshots : [];
      const healthy = snapshots.filter((s) => Boolean(s?.ok)).length;
      if (healthyCountEl) healthyCountEl.textContent = String(healthy);

      const skuCount = Array.isArray(this.network.aggregate?.items) ? this.network.aggregate.items.length : 0;
      if (skuCountEl) skuCountEl.textContent = String(skuCount);
    },

    renderNetworkFarmsTable() {
      const tbody = document.getElementById('network-farms-table');
      if (!tbody) return;

      const farms = this.network.farms || [];
      if (!farms.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No network farms registered</td></tr>';
        return;
      }

      tbody.innerHTML = farms
        .map((f) => {
          const updated = f.updated_at || f.created_at || null;
          return `
          <tr>
            <td>${String(f.farm_id || '')}</td>
            <td>${String(f.farm_name || '')}</td>
            <td style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 0.85rem;">
              ${String(f.base_url || '')}
            </td>
            <td><span class="badge ${String(f.status || 'active')}">${String(f.status || 'active')}</span></td>
            <td>${updated ? new Date(updated).toLocaleString() : '—'}</td>
            <td>
              <button class="btn btn-danger btn-sm" data-action="network-remove-farm" data-farmid="${String(f.farm_id)}">Remove</button>
            </td>
          </tr>
        `;
        })
        .join('');
    },

    renderNetworkSnapshotsTable() {
      const tbody = document.getElementById('network-snapshots-table');
      if (!tbody) return;

      const snaps = Array.isArray(this.network.snapshots) ? this.network.snapshots : [];
      if (!snaps.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No snapshots yet. Sync runs automatically.</td></tr>';
        return;
      }

      tbody.innerHTML = snaps
        .map((s) => {
          const okBadge = s.ok ? '<span class="badge completed">ok</span>' : '<span class="badge failed">failed</span>';
          const http = s.status ? String(s.status) : '—';
          const total = Number(s.total_available || 0);
          const fetchedAt = s.fetched_at ? new Date(s.fetched_at).toLocaleString() : '—';
          const farmName = s.farm?.farm_name || s.farm?.farm_id || '—';
          return `
          <tr>
            <td>${farmName}</td>
            <td>${okBadge}</td>
            <td>${http}</td>
            <td>${total.toFixed(0)}</td>
            <td>${fetchedAt}</td>
          </tr>
        `;
        })
        .join('');
    },

    renderNetworkEvents() {
      const container = document.getElementById('network-events-list');
      if (!container) return;

      const events = this.network.events || [];
      if (!events.length) {
        container.innerHTML = '<div class="empty-state">No market events recorded</div>';
        return;
      }

      container.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Title</th>
              <th>Impact</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${events
              .slice()
              .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
              .map(
                (e) => `
              <tr>
                <td>${e.date ? new Date(e.date).toLocaleDateString() : '—'}</td>
                <td>${String(e.title || '')}</td>
                <td>${String(e.impact || 'neutral')}</td>
                <td>${String(e.notes || '')}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      `;
    },

    renderNetworkRecommendations() {
      const container = document.getElementById('network-recommendations');
      if (!container) return;

      const recs = this.network.recommendations || [];
      if (!recs.length) {
        container.innerHTML = '<div class="empty-state">No recommendations yet</div>';
        return;
      }

      container.innerHTML = recs
        .map(
          (r) => `
        <div style="padding: 1rem; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 0.75rem;">
          <div style="display:flex; justify-content: space-between; align-items: center; gap: 1rem;">
            <div style="font-weight: 600; color: var(--primary);">${String(r.title || 'Recommendation')}</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary);">${r.created_at ? new Date(r.created_at).toLocaleString() : ''}</div>
          </div>
          ${r.summary ? `<div style="margin-top: 0.5rem; color: var(--text-secondary);">${String(r.summary)}</div>` : ''}
          ${Array.isArray(r.actions) && r.actions.length
            ? `<ul style="margin-top: 0.5rem; padding-left: 1.25rem;">${r.actions.map((a) => `<li>${String(a)}</li>`).join('')}</ul>`
            : ''}
        </div>
      `
        )
        .join('');
    },

    async addOrUpdateNetworkFarm() {
      const farmId = document.getElementById('network-farm-id')?.value?.trim();
      const farmName = document.getElementById('network-farm-name')?.value?.trim();
      const baseUrl = document.getElementById('network-farm-base-url')?.value?.trim();

      if (!farmId || !baseUrl) {
        this.showToast('Farm ID and Base URL are required', 'error');
        return;
      }

      try {
        const response = await fetch('/api/wholesale/network/farms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ farm_id: farmId, farm_name: farmName || farmId, base_url: baseUrl, status: 'active' })
        });
        const data = await response.json().catch(() => null);

        if (!response.ok || data?.status !== 'ok') {
          this.showToast(data?.message || 'Failed to save network farm', 'error');
          return;
        }

        this.showToast('Network farm saved', 'success');
        await this.loadNetwork();
      } catch (error) {
        console.error('Add network farm error:', error);
        this.showToast('Network error saving farm', 'error');
      }
    },

    async removeNetworkFarm(farmId) {
      if (!farmId) return;
      if (!confirm(`Remove ${farmId} from the hyperlocal network?`)) return;

      try {
        const response = await fetch(`/api/wholesale/network/farms/${encodeURIComponent(farmId)}`, { method: 'DELETE' });
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.status !== 'ok') {
          this.showToast(data?.message || 'Failed to remove farm', 'error');
          return;
        }

        this.showToast('Farm removed', 'success');
        await this.loadNetwork();
      } catch (error) {
        console.error('Remove network farm error:', error);
        this.showToast('Network error removing farm', 'error');
      }
    },

    async addMarketEvent() {
      const date = document.getElementById('network-event-date')?.value || '';
      const title = document.getElementById('network-event-title')?.value?.trim() || '';
      const impact = document.getElementById('network-event-impact')?.value || 'neutral';
      const notes = document.getElementById('network-event-notes')?.value?.trim() || '';

      if (!title) {
        this.showToast('Event title is required', 'error');
        return;
      }

      try {
        const response = await fetch('/api/wholesale/network/market-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: date || null, title, impact, notes })
        });
        const data = await response.json().catch(() => null);

        if (!response.ok || data?.status !== 'ok') {
          this.showToast(data?.message || 'Failed to add market event', 'error');
          return;
        }

        document.getElementById('network-event-title').value = '';
        document.getElementById('network-event-notes').value = '';
        this.showToast('Market event added', 'success');
        await this.loadNetwork();
      } catch (error) {
        console.error('Add market event error:', error);
        this.showToast('Network error adding event', 'error');
      }
    },

    async loadOverview() {
      try {
        const headers = this.getAuthHeaders();
        
        // Load network farms for operations dashboard
        const farmsRes = await fetch('/api/wholesale/network/farms', { headers });
        const farmsData = await farmsRes.json();
        this.farms = farmsData.data?.farms || [];
        
        // Load wholesale orders from admin endpoint
        const ordersRes = await fetch('/api/admin/wholesale/orders', { headers });
        const ordersData = await ordersRes.json();
        this.orders = ordersData.data?.orders || ordersData.orders || [];

        const paymentsRes = await fetch('/api/wholesale/webhooks/payments', { headers });
        const paymentsData = await paymentsRes.json();
        this.payments = paymentsData.data?.payments || paymentsData.payments || [];

        const totalGMV = this.payments
          .filter((p) => p.status === 'completed')
          .reduce((sum, p) => sum + p.amount, 0);

        const totalFees = this.payments
          .filter((p) => p.status === 'completed')
          .reduce((sum, p) => sum + p.broker_fee_amount, 0);

        const activeFarms = this.farms.filter((f) => f.status === 'active').length;
        
        // Order statistics
        const pendingOrders = this.orders.filter(o => {
          const s = (o.status || '').toLowerCase();
          return ['pending', 'pending_verification', 'pending_farm_verification', 'new'].includes(s);
        }).length;
        
        const activeOrders = this.orders.filter(o => {
          const s = (o.status || '').toLowerCase();
          return !['cancelled', 'canceled', 'rejected', 'expired', 'delivered'].includes(s);
        }).length;

        document.getElementById('stat-gmv').textContent = `$${totalGMV.toFixed(2)}`;
        document.getElementById('stat-fees').textContent = `$${totalFees.toFixed(2)}`;
        document.getElementById('stat-farms').textContent = activeFarms.toString();
        document.getElementById('stat-orders').textContent = this.orders.length.toString();
        
        // Add pending verification count if element exists
        const pendingEl = document.getElementById('stat-pending-verification');
        if (pendingEl) {
          pendingEl.textContent = pendingOrders.toString();
        }

        this.renderGMVChart();
        this.renderRecentActivity();
      } catch (error) {
        console.error('Load overview error:', error);
        this.showToast('Failed to load overview data', 'error');
      }
    },

    renderGMVChart() {
      const chartContainer = document.getElementById('gmv-chart');

      const farmGMV = {};
      this.payments.forEach((payment) => {
        if (payment.status === 'completed') {
          if (!farmGMV[payment.farm_id]) farmGMV[payment.farm_id] = 0;
          farmGMV[payment.farm_id] += payment.amount;
        }
      });

      if (Object.keys(farmGMV).length === 0) {
        chartContainer.innerHTML = '<div class="empty-state">No payment data available</div>';
        return;
      }

      const maxGMV = Math.max(...Object.values(farmGMV));

      chartContainer.innerHTML = Object.entries(farmGMV)
        .map(([farm_id, gmv]) => {
          const height = maxGMV > 0 ? (gmv / maxGMV) * 200 : 0;
          return `
            <div class="chart-bar">
              <div class="chart-value">$${gmv.toFixed(0)}</div>
              <div class="chart-bar-fill" style="height: ${height}px;"></div>
              <div class="chart-label">${(() => { const f = this.farms.find(fm => fm.farm_id === farm_id); return f ? (f.farm_name || f.name || farm_id).substring(0, 16) : (farm_id || 'Unknown').substring(0, 12); })()}</div>
            </div>
          `;
        })
        .join('');
    },

    renderRecentActivity() {
      const container = document.getElementById('recent-activity');

      // Show recent orders instead of payments
      const recentOrders = [...this.orders]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 10);

      if (recentOrders.length === 0) {
        container.innerHTML = '<div class="empty-state">No recent orders</div>';
        return;
      }

      container.innerHTML = `
          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Buyer</th>
                <th>Farm(s)</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Verification</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              ${recentOrders
                .map(
                  (order) => `
                <tr>
                  <td>${order.master_order_id ? order.master_order_id.substring(0, 12) + '...' : 'N/A'}</td>
                  <td>${order.buyer_account?.businessName || order.buyer_id}</td>
                  <td>${order.farm_sub_orders ? order.farm_sub_orders.map(s => { const f = this.farms.find(fm => fm.farm_id === s.farm_id); return f ? (f.farm_name || f.name || s.farm_id) : s.farm_id; }).join(', ') : 'N/A'}</td>
                  <td>$${(order.grand_total || 0).toFixed(2)}</td>
                  <td><span class="badge ${order.status || 'pending'}">${order.status || 'pending'}</span></td>
                  <td><span class="badge ${(order.farm_sub_orders || []).map(s => s.status).filter(Boolean)[0] || order.status || 'pending'}">${(order.farm_sub_orders || []).map(s => s.status).filter(Boolean)[0] || order.status || 'pending'}</span></td>
                  <td>${new Date(order.created_at).toLocaleString()}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        `;
    },

    async loadFarms() {
      try {
        const headers = this.getAuthHeaders();
        const response = await fetch('/api/wholesale/network/farms', { headers });
        const data = await response.json();

        if (data.status === 'ok') {
          this.farms = data.data.farms || [];
          this.renderFarmsTable();
        } else {
          this.showToast('Failed to load farms', 'error');
        }
      } catch (error) {
        console.error('Load farms error:', error);
        this.showToast('Network error loading farms', 'error');
      }
    },

    renderFarmsTable() {
      const tbody = document.getElementById('farms-table');

      if (this.farms.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No farms registered yet</td></tr>';
        return;
      }

      tbody.innerHTML = this.farms
        .map((farm) => {
          const farmName = farm.farm_name || farm.name || 'N/A';
          const locationText = this.formatFarmLocation(farm.location);
          const farmStatus = farm.status || 'active';
          const lastSyncAt = farm.last_sync || farm.updated_at || farm.created_at || null;

          const certBadges = (farm.certifications || []).map(c => 
            `<span class="badge badge-info">${c}</span>`
          ).join(' ');
          
          const practiceBadges = (farm.practices || []).map(p => 
            `<span class="badge badge-secondary">${p}</span>`
          ).join(' ');

          return `
          <tr>
            <td>${farm.farm_id}</td>
            <td>${farmName}</td>
            <td>${locationText}</td>
            <td><span class="badge ${farmStatus}">${farmStatus}</span></td>
            <td>
              ${lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'Never'}
            </td>
            <td>
              ${certBadges || 'None'}
            </td>
            <td>
              ${practiceBadges || 'None'}
            </td>
          </tr>
        `;
        })
        .join('');
    },

    formatFarmLocation(location) {
      if (!location) return 'N/A';
      if (typeof location === 'string') return location;

      const city = location.city || location.town || location.locality || '';
      const region = location.province || location.state || location.region || '';
      if (city && region) return `${city}, ${region}`;
      if (city) return city;
      if (region) return region;

      return 'N/A';
    },

    async loadPayments() {
      const headers = this.getAuthHeaders();
      try {
        // Fetch payments, orders, and farms in parallel for cross-referencing
        const [payRes, ordRes, farmRes] = await Promise.all([
          fetch('/api/wholesale/webhooks/payments', { headers }),
          fetch('/api/admin/wholesale/orders', { headers }),
          fetch('/api/wholesale/network/farms', { headers })
        ]);
        const payData = await payRes.json();
        const ordData = await ordRes.json();
        const farmData = await farmRes.json();

        if (payData.status === 'ok') {
          this.payments = payData.data?.payments || payData.payments || [];
          this.orders = ordData.data?.orders || ordData.orders || [];
          this.farms = farmData.data?.farms || [];
          this.renderPaymentsTable();
          this.renderPayoutSummary();
        } else {
          this.showToast('Failed to load payments', 'error');
        }
      } catch (error) {
        console.error('Load payments error:', error);
        this.showToast('Network error loading payments', 'error');
      }
    },

    // Resolve farm name for a payment by looking up the related order
    resolveFarmForPayment(payment) {
      // Try split data first (has per-farm breakdown)
      if (payment.split && Array.isArray(payment.split)) {
        const names = payment.split.map(s => {
          const f = this.farms.find(fm => fm.farm_id === s.farm_id);
          return f ? (f.farm_name || f.name || s.farm_id) : s.farm_id;
        }).filter(Boolean);
        if (names.length) return names.join(', ');
      }
      // Fall back to order's farm_sub_orders
      const order = (this.orders || []).find(o => o.master_order_id === payment.order_id);
      if (order && order.farm_sub_orders && order.farm_sub_orders.length > 0) {
        const names = order.farm_sub_orders.map(s => {
          const f = this.farms.find(fm => fm.farm_id === s.farm_id);
          return f ? (f.farm_name || f.name || s.farm_id) : s.farm_id;
        }).filter(Boolean);
        if (names.length) return names.join(', ');
      }
      // Last resort: use farm_id directly
      if (payment.farm_id) {
        const f = this.farms.find(fm => fm.farm_id === payment.farm_id);
        return f ? (f.farm_name || f.name || payment.farm_id) : payment.farm_id;
      }
      return 'Unassigned';
    },

    renderPaymentsTable() {
      const tbody = document.getElementById('payments-table');

      if (this.payments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No payments yet</td></tr>';
        return;
      }

      tbody.innerHTML = this.payments
        .map(
          (p) => `
          <tr>
            <td>${p.payment_id.substring(0, 12)}...</td>
            <td>${this.escHtml(this.resolveFarmForPayment(p))}</td>
            <td>$${p.amount.toFixed(2)}</td>
            <td>$${p.broker_fee_amount.toFixed(2)}</td>
            <td><span class="badge ${p.status}">${p.status}</span></td>
            <td>${new Date(p.created_at).toLocaleString()}</td>
            <td>
              <button class="btn btn-secondary btn-sm" data-action="payment-details" data-paymentid="${p.payment_id}">Details</button>
            </td>
          </tr>
        `
        )
        .join('');
    },

    renderPayoutSummary() {
      const tbody = document.getElementById('payout-summary-table');

      // Build farm summary by resolving farm names from orders/split data
      const farmSummary = {};
      this.payments.forEach((p) => {
        if (p.status === 'completed') {
          const farmName = this.resolveFarmForPayment(p);
          if (!farmSummary[farmName]) farmSummary[farmName] = { gross: 0, fees: 0, count: 0 };
          farmSummary[farmName].gross += p.amount;
          farmSummary[farmName].fees += p.broker_fee_amount;
          farmSummary[farmName].count += 1;
        }
      });

      if (Object.keys(farmSummary).length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No completed payments</td></tr>';
        return;
      }

      tbody.innerHTML = Object.entries(farmSummary)
        .map(
          ([farmName, summary]) => `
          <tr>
            <td>${this.escHtml(farmName)}</td>
            <td>$${summary.gross.toFixed(2)}</td>
            <td>$${summary.fees.toFixed(2)}</td>
            <td><strong>$${(summary.gross - summary.fees).toFixed(2)}</strong></td>
            <td>${summary.count}</td>
          </tr>
        `
        )
        .join('');
    },

    async loadOrders() {
      try {
        const headers = this.getAuthHeaders();
        const response = await fetch('/api/admin/wholesale/orders', { headers });
        if (!response.ok) {
          document.getElementById('orders-list').innerHTML =
            '<div class="empty-state">Failed to load orders. Check admin authentication.</div>';
          return;
        }
        
        const data = await response.json();
        const orders = data.data?.orders || data.orders || [];
        
        if (orders.length === 0) {
          document.getElementById('orders-list').innerHTML =
            '<div class="empty-state">No orders yet</div>';
          return;
        }
        
        // Render orders table
        const html = `
          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Buyer</th>
                <th>Created</th>
                <th>Total</th>
                <th>Broker Fee</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${orders.map(order => `
                <tr>
                  <td>${order.master_order_id.substring(0, 12)}...</td>
                  <td>${order.buyer_account?.businessName || order.buyer_id}</td>
                  <td>${new Date(order.created_at).toLocaleString()}</td>
                  <td>$${(order.grand_total || 0).toFixed(2)}</td>
                  <td>$${(order.broker_fee_total || 0).toFixed(2)}</td>
                  <td><span class="badge ${order.status}">${order.status}</span></td>
                  <td><span class="badge ${order.payment_status || 'pending'}">${order.payment_status || 'pending'}</span></td>
                  <td>
                    <button class="btn btn-sm" onclick="admin.openPaymentModal('${order.master_order_id}')">Manage Payment</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
        
        document.getElementById('orders-list').innerHTML = html;
      } catch (error) {
        console.error('Load orders error:', error);
        document.getElementById('orders-list').innerHTML =
          '<div class="empty-state">Failed to load orders</div>';
      }
    },

    async loadRefunds() {
      const headers = this.getAuthHeaders();
      try {
        const response = await fetch('/api/wholesale/refunds', { headers });
        const data = await response.json();

        if (data.status === 'ok') {
          this.refunds = data.data.refunds || [];
          this.renderRefundsTable();
        } else {
          this.showToast('Failed to load refunds', 'error');
        }
      } catch (error) {
        console.error('Load refunds error:', error);
        this.showToast('Network error loading refunds', 'error');
      }
    },

    renderRefundsTable() {
      const tbody = document.getElementById('refunds-table');

      if (this.refunds.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No refunds</td></tr>';
        return;
      }

      tbody.innerHTML = this.refunds
        .map(
          (r) => `
          <tr>
            <td>${r.id.substring(0, 12)}...</td>
            <td>${r.payment_record_id.substring(0, 12)}...</td>
            <td>$${r.refund_amount.toFixed(2)}</td>
            <td>$${r.broker_fee_refunded.toFixed(2)}</td>
            <td>${r.reason}</td>
            <td><span class="badge ${r.status}">${r.status}</span></td>
            <td>${new Date(r.created_at).toLocaleString()}</td>
          </tr>
        `
        )
        .join('');
    },

    normalizeReconciliationData(payload) {
      const source = payload && payload.data ? payload.data : {};
      const mismatches = Array.isArray(source.mismatches) ? source.mismatches : [];
      const legacyErrors = Array.isArray(source.errors) ? source.errors : [];
      const errors = legacyErrors.length
        ? legacyErrors
        : mismatches.map((entry) => ({
            payment_id: entry.payment_id || entry.order_id || 'unknown',
            error: entry.error || entry.issue || 'mismatch'
          }));

      const matched = Number(source.matched || 0);
      const unmatched = Number(source.unmatched || 0);
      const updatedCount = source.updated_count != null ? Number(source.updated_count) : matched;
      const failedCount = source.failed_count != null ? Number(source.failed_count) : unmatched + errors.length;

      // Square cross-check results
      const squareChecked = Number(source.square_checked || 0);
      const squareDiscrepancies = Array.isArray(source.square_discrepancies) ? source.square_discrepancies : [];
      const squareAvailable = source.square_available === true;

      return {
        reconciledAt: source.reconciled_at || source.reconciledAt || null,
        totalPayments: Number(source.total_payments || source.totalPayments || 0),
        matched,
        unmatched,
        updatedCount,
        failedCount,
        errors,
        squareChecked,
        squareDiscrepancies,
        squareAvailable
      };
    },

    async reconcilePayments() {
      try {
        this.showToast('Running reconciliation...', 'info');

        const response = await fetch('/api/wholesale/webhooks/reconcile', {
          method: 'POST',
          headers: this.getAuthHeaders()
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok && data.status === 'ok') {
          const summary = this.normalizeReconciliationData(data);
          const issueCount = summary.unmatched + summary.errors.length + summary.squareDiscrepancies.length;
          let msg = `Reconciliation complete: ${summary.totalPayments} checked, ${issueCount} issues detected`;
          if (summary.squareChecked > 0) {
            msg += ` | Square: ${summary.squareChecked} verified, ${summary.squareDiscrepancies.length} discrepancies`;
          } else if (!summary.squareAvailable) {
            msg += ' | Square API not configured';
          }
          this.showToast(msg, issueCount > 0 ? 'info' : 'success');
          this.loadPayments();
        } else {
          this.showToast(`Reconciliation failed: ${data.message || `HTTP ${response.status}`}`, 'error');
        }
      } catch (error) {
        console.error('Reconciliation error:', error);
        this.showToast('Network error during reconciliation', 'error');
      }
    },

    async resetRejectedOrders() {
      if (!confirm('Reset all rejected orders to confirmed? This cannot be undone.')) return;
      try {
        this.showToast('Resetting rejected orders...', 'info');
        const response = await fetch('/api/admin/wholesale/orders/reset-rejected', {
          method: 'POST',
          headers: this.getAuthHeaders()
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.status === 'ok') {
          this.showToast(`Reset ${data.data?.updated || 0} rejected orders to confirmed`, 'success');
          this.loadOrders();
        } else {
          this.showToast(`Reset failed: ${data.message || `HTTP ${response.status}`}`, 'error');
        }
      } catch (error) {
        console.error('Reset rejected error:', error);
        this.showToast('Network error during reset', 'error');
      }
    },

    async runReconciliation() {
      const log = document.getElementById('reconciliation-log');
      log.innerHTML = '<div class="loading">Running reconciliation...</div>';

      try {
        const response = await fetch('/api/wholesale/webhooks/reconcile', {
          method: 'POST',
          headers: this.getAuthHeaders()
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok && data.status === 'ok') {
          const summary = this.normalizeReconciliationData(data);
          const completedAt = summary.reconciledAt ? new Date(summary.reconciledAt) : new Date();
          log.innerHTML = `
              <div style="padding: 1rem; background: var(--bg); border-radius: 6px;">
                <h4 style="color: var(--success); margin-bottom: 0.5rem;">Reconciliation Complete</h4>
                <p>Total Payments: ${summary.totalPayments}</p>
                <p>Matched: ${summary.matched}</p>
                <p>Unmatched: ${summary.unmatched}</p>
                <p>Updated: ${summary.updatedCount}</p>
                <p>Failed: ${summary.failedCount}</p>
                ${summary.squareAvailable
                  ? `<p style="margin-top: 0.5rem; font-weight: 600;">Square Cross-Check: ${summary.squareChecked} verified, ${summary.squareDiscrepancies.length} discrepancies</p>`
                  : '<p style="margin-top: 0.5rem; color: var(--text-secondary);">Square API not configured — internal check only</p>'
                }
                <p>Completed at: ${completedAt.toLocaleString()}</p>
                ${summary.errors.length > 0
                  ? `
                  <details style="margin-top: 1rem;">
                    <summary>Internal Errors (${summary.errors.length})</summary>
                    <ul style="margin-top: 0.5rem;">
                      ${summary.errors
                        .map((e) => `<li>${this.escHtml(e.payment_id || e.order_id || 'unknown')}: ${this.escHtml(e.error || e.issue || 'unknown')}</li>`)
                        .join('')}
                    </ul>
                  </details>
                `
                  : ''}
                ${summary.squareDiscrepancies.length > 0
                  ? `
                  <details style="margin-top: 0.75rem;" open>
                    <summary style="color: var(--error); font-weight: 600;">Square Discrepancies (${summary.squareDiscrepancies.length})</summary>
                    <ul style="margin-top: 0.5rem;">
                      ${summary.squareDiscrepancies
                        .map((d) => {
                          const id = this.escHtml(d.square_payment_id || d.payment_id || 'unknown');
                          if (d.issue === 'square_status_mismatch') {
                            return `<li>${id}: Status mismatch — local: ${this.escHtml(d.local_status)}, Square: ${this.escHtml(d.square_status)}</li>`;
                          }
                          if (d.issue === 'square_amount_mismatch') {
                            return `<li>${id}: Amount mismatch — local: $${Number(d.local_amount).toFixed(2)}, Square: $${Number(d.square_amount).toFixed(2)} (diff: $${Number(d.difference).toFixed(2)})</li>`;
                          }
                          if (d.issue === 'square_lookup_failed') {
                            return `<li>${id}: Square lookup failed — ${this.escHtml(d.error || 'unknown')}</li>`;
                          }
                          return `<li>${id}: ${this.escHtml(d.issue || 'unknown')}</li>`;
                        })
                        .join('')}
                    </ul>
                  </details>
                `
                  : ''}
              </div>
            `;
          this.loadPayments();
        } else {
          log.innerHTML = `<div class="empty-state" style="color: var(--error);">Reconciliation failed: ${this.escHtml(data.message || `HTTP ${response.status}`)}</div>`;
        }
      } catch (error) {
        console.error('Reconciliation error:', error);
        log.innerHTML = `<div class="empty-state" style="color: var(--error);">Network error: ${error.message}</div>`;
      }
    },

    openOnboardModal() {
      document.getElementById('onboard-modal').classList.add('open');
      document.getElementById('oauth-url-display').style.display = 'none';
    },

    closeOnboardModal() {
      document.getElementById('onboard-modal').classList.remove('open');
      document.getElementById('onboard-form').reset();
      document.getElementById('oauth-url-display').style.display = 'none';
    },

    async generateOAuthUrl() {
      const farmId = document.getElementById('farm-id').value;
      const farmName = document.getElementById('farm-name').value;

      if (!farmId || !farmName) {
        this.showToast('Farm ID and Name are required', 'error');
        return;
      }

      try {
        const response = await fetch(
          `/api/wholesale/oauth/square/authorize?farm_id=${encodeURIComponent(farmId)}&farm_name=${encodeURIComponent(farmName)}`
        );
        const data = await response.json();

        if (data.status === 'ok') {
          document.getElementById('oauth-url').value = data.data.authorization_url;
          document.getElementById('oauth-url-display').style.display = 'block';
          this.showToast('OAuth URL generated successfully', 'success');
        } else {
          this.showToast(`Failed to generate OAuth URL: ${data.message}`, 'error');
        }
      } catch (error) {
        console.error('Generate OAuth URL error:', error);
        this.showToast('Network error generating OAuth URL', 'error');
      }
    },

    copyOAuthUrl() {
      const urlField = document.getElementById('oauth-url');
      urlField.select();
      document.execCommand('copy');
      this.showToast('OAuth URL copied to clipboard', 'success');
    },

    async refreshToken(farmId) {
      try {
        const response = await fetch('/api/wholesale/oauth/square/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ farm_id: farmId })
        });

        const data = await response.json();

        if (data.status === 'ok') {
          this.showToast('Token refreshed successfully', 'success');
          this.loadFarms();
        } else {
          this.showToast(`Token refresh failed: ${data.message}`, 'error');
        }
      } catch (error) {
        console.error('Token refresh error:', error);
        this.showToast('Network error refreshing token', 'error');
      }
    },

    async disconnectFarm(farmId) {
      if (!confirm(`Are you sure you want to disconnect ${farmId}? This will revoke their Square tokens.`)) {
        return;
      }

      try {
        const response = await fetch(`/api/wholesale/oauth/square/disconnect/${farmId}`, {
          method: 'DELETE'
        });

        const data = await response.json();

        if (data.status === 'ok') {
          this.showToast('Farm disconnected successfully', 'success');
          this.loadFarms();
        } else {
          this.showToast(`Disconnect failed: ${data.message}`, 'error');
        }
      } catch (error) {
        console.error('Disconnect error:', error);
        this.showToast('Network error disconnecting farm', 'error');
      }
    },

    filterPayments() {
      const statusFilter = document.getElementById("payment-status-filter")?.value || "all";
      const fromDate = document.getElementById("payment-date-from")?.value;
      const toDate = document.getElementById("payment-date-to")?.value;

      let filtered = [...this.payments];

      if (statusFilter !== "all") {
        filtered = filtered.filter(p => (p.status || "").toLowerCase() === statusFilter);
      }
      if (fromDate) {
        const from = new Date(fromDate);
        filtered = filtered.filter(p => new Date(p.created_at) >= from);
      }
      if (toDate) {
        const to = new Date(toDate + "T23:59:59");
        filtered = filtered.filter(p => new Date(p.created_at) <= to);
      }

      this.renderFilteredPayments(filtered);
    },

    renderFilteredPayments(payments) {
      const tbody = document.getElementById("payments-table");

      if (payments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No payments match the selected filters</td></tr>';
        return;
      }

      tbody.innerHTML = payments.map(p => `
        <tr>
          <td>${p.payment_id.substring(0, 12)}...</td>
          <td>${this.escHtml(this.resolveFarmForPayment(p))}</td>
          <td>$${p.amount.toFixed(2)}</td>
          <td>$${p.broker_fee_amount.toFixed(2)}</td>
          <td><span class="badge ${p.status}">${p.status}</span></td>
          <td>${new Date(p.created_at).toLocaleString()}</td>
          <td>
            <button class="btn btn-secondary btn-sm" data-action="payment-details" data-paymentid="${p.payment_id}">Details</button>
          </td>
        </tr>
      `).join("");
    },

    filterOrders() {
      const statusFilter = document.getElementById("order-status-filter")?.value || "all";
      const fromDate = document.getElementById("order-date-from")?.value;
      const toDate = document.getElementById("order-date-to")?.value;

      let filtered = [...this.orders];

      if (statusFilter !== "all") {
        filtered = filtered.filter(o => (o.status || "").toLowerCase() === statusFilter);
      }
      if (fromDate) {
        const from = new Date(fromDate);
        filtered = filtered.filter(o => new Date(o.created_at) >= from);
      }
      if (toDate) {
        const to = new Date(toDate + "T23:59:59");
        filtered = filtered.filter(o => new Date(o.created_at) <= to);
      }

      this.renderFilteredOrders(filtered);
    },

    renderFilteredOrders(orders) {
      const container = document.getElementById("orders-list");
      if (orders.length === 0) {
        container.innerHTML = '<div class="empty-state">No orders match the selected filters</div>';
        return;
      }

      container.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Buyer</th>
              <th>Created</th>
              <th>Total</th>
              <th>Broker Fee</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${orders.map(order => `
              <tr>
                <td>${order.master_order_id.substring(0, 12)}...</td>
                <td>${order.buyer_account?.businessName || order.buyer_id}</td>
                <td>${new Date(order.created_at).toLocaleString()}</td>
                <td>$${(order.grand_total || 0).toFixed(2)}</td>
                <td>$${(order.broker_fee_total || 0).toFixed(2)}</td>
                <td><span class="badge ${order.status}">${order.status}</span></td>
                <td><span class="badge ${order.payment_status || 'pending'}">${order.payment_status || 'pending'}</span></td>
                <td>
                  <button class="btn btn-sm" onclick="admin.openPaymentModal('${order.master_order_id}')">Manage Payment</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    },

    async openPaymentModal(orderId) {
      try {
        const headers = this.getAuthHeaders();
        const response = await fetch('/api/admin/wholesale/orders', { headers });
        const data = await response.json();
        const order = (data.data?.orders || data.orders || []).find(o => o.master_order_id === orderId);
        
        if (!order) {
          this.showToast('Order not found', 'error');
          return;
        }
        
        // Show payment management modal
        const modal = document.getElementById('payment-modal');
        if (!modal) {
          this.showToast('Payment modal not found', 'error');
          return;
        }
        
        // Populate modal with order details
        document.getElementById('payment-order-id').textContent = order.master_order_id;
        document.getElementById('payment-order-total').textContent = `$${(order.grand_total || 0).toFixed(2)}`;
        document.getElementById('payment-current-status').textContent = order.payment_status || 'pending';
        document.getElementById('payment-buyer-name').textContent = order.buyer_account?.businessName || order.buyer_id;
        
        // Store order ID for later actions
        modal.dataset.orderId = orderId;
        
        // Show modal
        modal.classList.add('open');
      } catch (error) {
        console.error('Open payment modal error:', error);
        this.showToast('Failed to load order details', 'error');
      }
    },
    
    closePaymentModal() {
      const modal = document.getElementById('payment-modal');
      if (modal) modal.classList.remove('open');
    },
    
    async generateSquareInvoice() {
      const modal = document.getElementById('payment-modal');
      const orderId = modal?.dataset.orderId;
      
      if (!orderId) {
        this.showToast('No order selected', 'error');
        return;
      }
      
      try {
        const headers = this.getAuthHeaders();
        const response = await fetch('/api/admin/wholesale/orders', { headers });
        const data = await response.json();
        const order = (data.data?.orders || data.orders || []).find(o => o.master_order_id === orderId);
        
        if (!order) {
          this.showToast('Order not found', 'error');
          return;
        }
        
        // Generate Square invoice URL (simplified - would need Square API integration)
        const invoiceUrl = `https://squareup.com/dashboard/invoices/create?` +
          `customer_email=${encodeURIComponent(order.buyer_account?.email || '')}` +
          `&amount=${Math.round((order.grand_total || 0) * 100)}` +
          `&reference=${encodeURIComponent(order.master_order_id)}`;
        
        // Copy to clipboard and open in new tab
        navigator.clipboard.writeText(invoiceUrl).then(() => {
          this.showToast('Invoice URL copied to clipboard', 'success');
        }).catch(() => {
          this.showToast('Invoice URL ready', 'info');
        });
        
        window.open(invoiceUrl, '_blank');
      } catch (error) {
        console.error('Generate invoice error:', error);
        this.showToast('Failed to generate invoice', 'error');
      }
    },
    
    async markOrderPaid() {
      const modal = document.getElementById('payment-modal');
      const orderId = modal?.dataset.orderId;
      const paymentRef = document.getElementById('payment-reference')?.value?.trim();
      
      if (!orderId) {
        this.showToast('No order selected', 'error');
        return;
      }
      
      if (!paymentRef) {
        this.showToast('Payment reference is required', 'error');
        return;
      }
      
      if (!confirm('Mark this order as paid? This cannot be undone easily.')) {
        return;
      }
      
      try {
        const response = await fetch(`/api/admin/wholesale/orders/${encodeURIComponent(orderId)}/payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'paid',
            payment_reference: paymentRef,
            payment_method: 'manual',
            marked_at: new Date().toISOString()
          })
        });
        
        const result = await response.json();
        
        if (response.ok && result.status === 'ok') {
          this.showToast('Order marked as paid', 'success');
          this.closePaymentModal();
          await this.loadOrders();
        } else {
          this.showToast(result.message || 'Failed to update payment status', 'error');
        }
      } catch (error) {
        console.error('Mark paid error:', error);
        this.showToast('Failed to update payment status', 'error');
      }
    },
    
    viewPaymentDetails(_paymentId) {
      this.showToast('Payment details modal not yet implemented', 'info');
    },

    // ========================================================================
    // PAYMENT SETUP - Square & Stripe OAuth Integration
    // ========================================================================

    async loadPaymentSetup() {
      try {
        const headers = this.getAuthHeaders();

        // Get network farms
        const farmsResponse = await fetch('/api/wholesale/network/farms', { headers });
        if (!farmsResponse.ok) {
          if (farmsResponse.status === 401) {
            this.showToast('Admin session expired. Please sign in again.', 'warning');
          }
          throw new Error(`Failed to load farms: ${farmsResponse.status}`);
        }
        const farmsData = await farmsResponse.json();
        const farms = Array.isArray(farmsData?.data?.farms) ? farmsData.data.farms : [];
        
        // Check Square and Stripe status for each farm
        const statusPromises = farms.map(async (farm) => {
          let squareStatus = { connected: false };
          let stripeStatus = { connected: false };
          
          // Check Square
          try {
            const statusResponse = await fetch('/api/farm/square/status', {
              headers: {
                ...headers,
                'X-Farm-ID': farm.farm_id
              }
            });
            const statusData = await statusResponse.json();
            squareStatus = {
              connected: statusData.connected === true || statusData.status === 'connected' || statusData.status === 'ok',
              merchant_id: statusData.data?.merchant_id || statusData.data?.applicationId || null,
              location_name: statusData.data?.location_name || statusData.data?.locationId || null
            };
          } catch (error) { /* Square not available */ }
          
          // Check Stripe
          try {
            const stripeResponse = await fetch(`/api/farm/stripe/status`, {
              headers: {
                ...headers,
                'X-Farm-ID': farm.farm_id
              }
            });
            const stripeData = await stripeResponse.json();
            stripeStatus = {
              connected: stripeData.connected === true,
              accountId: stripeData.data?.accountId || null,
              businessName: stripeData.data?.businessName || null
            };
          } catch (error) { /* Stripe not available */ }
          
          return {
            farm_id: farm.farm_id,
            farm_name: farm.farm_name,
            square: squareStatus,
            stripe: stripeStatus
          };
        });
        
        const statuses = await Promise.all(statusPromises);
        
        // Update summary stats (count farms with either provider connected)
        const connectedCount = statuses.filter(s => s.square.connected || s.stripe.connected).length;
        const pendingCount = statuses.filter(s => !s.square.connected && !s.stripe.connected).length;
        const commissionRate = '12%';
        
        document.getElementById('square-connected-count').textContent = connectedCount;
        document.getElementById('square-pending-count').textContent = pendingCount;
        document.getElementById('square-commission-rate').textContent = commissionRate;
        
        // Render table
        const table = document.getElementById('square-status-table');
        if (statuses.length === 0) {
          table.innerHTML = '<tr><td colspan="7" class="empty-state">No farms in network. Add farms in Farm Management tab.</td></tr>';
          return;
        }
        
        table.innerHTML = statuses.map(farm => {
          const squareBadge = farm.square.connected
            ? '<span class="badge badge-success">Connected</span>'
            : '<span class="badge badge-warning">Not Connected</span>';
          
          const stripeBadge = farm.stripe.connected
            ? '<span class="badge badge-success">Connected</span>'
            : '<span class="badge badge-warning">Not Connected</span>';
          
          const merchantId = farm.square.merchant_id || farm.stripe.accountId || '—';
          
          let actions = '';
          if (!farm.square.connected) {
            actions += `<button class="btn btn-sm btn-primary" onclick="admin.connectSquare('${farm.farm_id}', '${farm.farm_name}')" style="margin-right: 4px;">Connect Square</button>`;
          } else {
            actions += `<button class="btn btn-sm btn-secondary" onclick="admin.disconnectSquare('${farm.farm_id}')" style="margin-right: 4px;">Disconnect Square</button>`;
          }
          if (!farm.stripe.connected) {
            actions += `<button class="btn btn-sm" onclick="admin.connectStripe('${farm.farm_id}', '${farm.farm_name}')" style="background: #635bff; color: #fff;">Connect Stripe</button>`;
          } else {
            actions += `<button class="btn btn-sm btn-secondary" onclick="admin.disconnectStripe('${farm.farm_id}')">Disconnect Stripe</button>`;
          }
          
          return `
            <tr>
              <td>${farm.farm_id}</td>
              <td>${farm.farm_name}</td>
              <td>${squareBadge}</td>
              <td>${stripeBadge}</td>
              <td>${merchantId}</td>
              <td>${actions}</td>
            </tr>
          `;
        }).join('');
        
      } catch (error) {
        console.error('Load payment setup error:', error);
        document.getElementById('square-status-table').innerHTML = 
          '<tr><td colspan="7" class="error">Failed to load payment setup. Check console for details.</td></tr>';
      }
    },

    async connectSquare(farmId, farmName) {
      try {
        const response = await fetch('/api/square-proxy/authorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ farm_id: farmId, farm_name: farmName })
        });
        
        const result = await response.json();
        
        if (!response.ok || result.status !== 'ok') {
          this.showToast(result.message || 'Failed to generate OAuth URL', 'error');
          return;
        }
        
        const authUrl = result.data?.authorization_url;
        if (!authUrl) {
          this.showToast('No authorization URL returned', 'error');
          return;
        }
        
        // Open Square OAuth in new window
        const width = 600;
        const height = 700;
        const left = (screen.width / 2) - (width / 2);
        const top = (screen.height / 2) - (height / 2);
        
        const popup = window.open(
          authUrl,
          'SquareOAuth',
          `width=${width},height=${height},left=${left},top=${top}`
        );
        
        if (!popup) {
          this.showToast('Please allow popups to complete Square authorization', 'warning');
          return;
        }
        
        // Poll for completion
        const pollInterval = setInterval(() => {
          if (popup.closed) {
            clearInterval(pollInterval);
            this.showToast('Square authorization window closed. Refreshing status...', 'info');
            setTimeout(() => this.loadPaymentSetup(), 1000);
          }
        }, 500);
        
      } catch (error) {
        console.error('Connect Square error:', error);
        this.showToast('Failed to initiate Square OAuth', 'error');
      }
    },

    async disconnectSquare(farmId) {
      if (!confirm(`Disconnect Square for farm ${farmId}? This will disable automated payments.`)) {
        return;
      }
      
      try {
        const response = await fetch(`/api/square-proxy/disconnect/${farmId}`, {
          method: 'POST'
        });
        
        const result = await response.json();
        
        if (!response.ok || result.status !== 'ok') {
          this.showToast(result.message || 'Failed to disconnect Square', 'error');
          return;
        }
        
        this.showToast('Square disconnected successfully', 'success');
        await this.loadPaymentSetup();
        
      } catch (error) {
        console.error('Disconnect Square error:', error);
        this.showToast('Failed to disconnect Square', 'error');
      }
    },

    async connectStripe(farmId, farmName) {
      try {
        const response = await fetch('/api/farm/stripe/authorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ farm_id: farmId, farmName: farmName })
        });
        
        const result = await response.json();
        
        if (!result.ok || !result.data?.authorizationUrl) {
          this.showToast(result.message || 'Failed to generate Stripe OAuth URL', 'error');
          return;
        }
        
        const popup = window.open(
          result.data.authorizationUrl,
          'StripeOAuth',
          'width=600,height=700,scrollbars=yes'
        );
        
        if (!popup) {
          this.showToast('Please allow popups to complete Stripe authorization', 'warning');
          return;
        }
        
        // Listen for Stripe connect completion message
        const self = this;
        window.addEventListener('message', function handleStripeCallback(event) {
          if (event.data && event.data.type === 'stripe-connected') {
            window.removeEventListener('message', handleStripeCallback);
            self.showToast('Stripe account connected successfully!', 'success');
            self.loadPaymentSetup();
          }
        });
        
        // Also poll for popup close
        const pollInterval = setInterval(() => {
          if (popup.closed) {
            clearInterval(pollInterval);
            setTimeout(() => this.loadPaymentSetup(), 1000);
          }
        }, 500);
        
      } catch (error) {
        console.error('Connect Stripe error:', error);
        this.showToast('Failed to initiate Stripe OAuth', 'error');
      }
    },

    async disconnectStripe(farmId) {
      if (!confirm(`Disconnect Stripe for farm ${farmId}? This will disable Stripe payments.`)) {
        return;
      }
      
      try {
        const response = await fetch('/api/farm/stripe/disconnect', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-Farm-ID': farmId
          }
        });
        
        const result = await response.json();
        
        if (!result.ok) {
          this.showToast(result.message || 'Failed to disconnect Stripe', 'error');
          return;
        }
        
        this.showToast('Stripe disconnected successfully', 'success');
        await this.loadPaymentSetup();
        
      } catch (error) {
        console.error('Disconnect Stripe error:', error);
        this.showToast('Failed to disconnect Stripe', 'error');
      }
    },

    async checkOverselling() {
      try {
        const response = await fetch('/api/wholesale/inventory/check-overselling');
        if (!response.ok) return;
        
        const data = await response.json();
        const alertBanner = document.getElementById('overselling-alert');
        const detailsSpan = document.getElementById('overselling-details');
        
        if (data.overselling && data.items && data.items.length > 0) {
          const count = data.items.length;
          const skus = data.items.map(item => item.sku_id).slice(0, 3).join(', ');
          const more = count > 3 ? ` and ${count - 3} more` : '';
          
          detailsSpan.textContent = `${count} SKU(s) have insufficient inventory: ${skus}${more}`;
          alertBanner.style.display = 'block';
          
          console.warn('⚠️ Overselling detected:', data.items);
        } else {
          alertBanner.style.display = 'none';
        }
      } catch (error) {
        console.error('Failed to check overselling:', error);
      }
    },

    showToast(message, type = 'info') {
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.textContent = message;
      document.body.appendChild(toast);

      setTimeout(() => {
        toast.remove();
      }, 3000);
    },

    // ========================================================================
    // COMPLIANCE EXPORT FUNCTIONS
    // ========================================================================

    loadComplianceView() {
      // Set default date range (last 30 days)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      document.getElementById('export-start-date').value = startDate.toISOString().split('T')[0];
      document.getElementById('export-end-date').value = endDate.toISOString().split('T')[0];
    },

    async exportComplianceData() {
      const startDate = document.getElementById('export-start-date').value;
      const endDate = document.getElementById('export-end-date').value;
      const format = document.getElementById('export-format').value;
      
      const includeOrders = document.getElementById('include-orders').checked;
      const includeFarms = document.getElementById('include-farms').checked;
      const includeProducts = document.getElementById('include-products').checked;
      const includeTraceability = document.getElementById('include-traceability').checked;

      if (!startDate || !endDate) {
        this.showToast('Please select date range', 'error');
        return;
      }

      try {
        this.showToast('Generating compliance export...', 'info');

        // Fetch orders
        const ordersRes = await fetch('/api/admin/wholesale/orders', { headers: this.getAuthHeaders() });
        const ordersData = await ordersRes.json();
        let orders = ordersData.data?.orders || ordersData.orders || [];

        // Filter by date range
        orders = orders.filter((o) => {
          const orderDate = new Date(o.created_at);
          return orderDate >= new Date(startDate) && orderDate <= new Date(endDate);
        });

        // Fetch network farms
        const farmsRes = await fetch('/api/wholesale/network/farms');
        const farmsData = await farmsRes.json();
        const farms = farmsData.data?.farms || [];

        // Build compliance dataset
        const complianceData = [];

        orders.forEach((order) => {
          (order.farm_sub_orders || []).forEach((subOrder) => {
            const farm = farms.find((f) => f.farm_id === subOrder.farm_id);
            
            (subOrder.items || []).forEach((item) => {
              const record = {
                // Order Information
                ...(includeOrders && {
                  order_id: order.master_order_id,
                  order_date: order.created_at,
                  delivery_date: order.delivery_date,
                  order_status: order.status,
                  buyer_id: order.buyer_id,
                  buyer_business: order.buyer_account?.business_name || 'N/A',
                  buyer_email: order.buyer_account?.email || 'N/A'
                }),

                // Farm Information
                ...(includeFarms && {
                  farm_id: subOrder.farm_id,
                  farm_name: subOrder.farm_name || farm?.farm_name || 'Unknown',
                  farm_location: farm?.location_name || 'N/A',
                  farm_latitude: farm?.latitude || null,
                  farm_longitude: farm?.longitude || null,
                  farm_certifications: farm?.certifications?.join(', ') || 'N/A',
                  farm_practices: farm?.practices?.join(', ') || 'N/A'
                }),

                // Product Information
                ...(includeProducts && {
                  product_id: item.sku_id,
                  product_name: item.product_name,
                  product_variety: item.variety || 'N/A',
                  product_category: item.category || 'N/A',
                  quantity: item.quantity,
                  unit: item.unit,
                  price_per_unit: item.price_per_unit,
                  line_total: Number(item.quantity) * Number(item.price_per_unit)
                }),

                // Traceability
                ...(includeTraceability && {
                  sub_order_status: subOrder.status || 'pending',
                  tracking_number: subOrder.tracking_number || 'N/A',
                  tracking_carrier: subOrder.tracking_carrier || 'N/A',
                  fulfillment_timestamp: subOrder.tracking_updated_at || 'N/A',
                  traceability_id: `${order.master_order_id}-${subOrder.farm_id}-${item.sku_id}`
                })
              };

              complianceData.push(record);
            });
          });
        });

        if (complianceData.length === 0) {
          this.showToast('No data found for selected criteria', 'info');
          return;
        }

        // Generate file
        let fileContent, filename, mimeType;

        if (format === 'csv') {
          fileContent = this.generateCSV(complianceData);
          filename = `compliance-export-${startDate}-to-${endDate}.csv`;
          mimeType = 'text/csv';
        } else {
          fileContent = JSON.stringify(complianceData, null, 2);
          filename = `compliance-export-${startDate}-to-${endDate}.json`;
          mimeType = 'application/json';
        }

        // Download file
        const blob = new Blob([fileContent], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showToast(`Export complete: ${complianceData.length} records`, 'success');

        // Add to export history
        this.addExportHistory({
          timestamp: new Date().toISOString(),
          filename,
          recordCount: complianceData.length,
          format,
          dateRange: `${startDate} to ${endDate}`
        });

      } catch (error) {
        console.error('Export compliance data error:', error);
        this.showToast('Export failed', 'error');
      }
    },

    generateCSV(data) {
      if (data.length === 0) return '';

      // Get all unique keys
      const keys = [...new Set(data.flatMap((obj) => Object.keys(obj)))];

      // Create CSV header
      const header = keys.map((k) => `"${k}"`).join(',');

      // Create CSV rows
      const rows = data.map((obj) => {
        return keys
          .map((key) => {
            let value = obj[key];
            if (value === null || value === undefined) value = '';
            if (typeof value === 'string' && value.includes(',')) {
              value = `"${value.replace(/"/g, '""')}"`;
            }
            return value;
          })
          .join(',');
      });

      return [header, ...rows].join('\n');
    },

    addExportHistory(exportRecord) {
      const container = document.getElementById('export-history');
      if (!container) return;

      // Clear "no exports" message
      if (container.querySelector('p')) {
        container.innerHTML = '';
      }

      const historyItem = document.createElement('div');
      historyItem.className = 'card';
      historyItem.style.marginBottom = '1rem';
      historyItem.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 600; color: var(--primary);">${exportRecord.filename}</div>
            <div style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 0.25rem;">
              ${exportRecord.recordCount} records • ${exportRecord.format.toUpperCase()} • ${exportRecord.dateRange}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">
              Generated: ${new Date(exportRecord.timestamp).toLocaleString()}
            </div>
          </div>
          <div>
            <span style="padding: 0.375rem 0.75rem; background: var(--success); color: white; border-radius: 4px; font-size: 0.875rem; font-weight: 600;">
              ✓ Complete
            </span>
          </div>
        </div>
      `;

      container.insertBefore(historyItem, container.firstChild);
    },

    // ── Buyer Management ─────────────────────────────────────────

    async loadBuyers() {
      const headers = this.getAuthHeaders();
      const search = document.getElementById('buyers-search')?.value || '';
      try {
        const url = search
          ? `/api/admin/wholesale/buyers?search=${encodeURIComponent(search)}`
          : '/api/admin/wholesale/buyers';
        const res = await fetch(url, { headers });
        if (!res.ok) {
          console.error('[Buyers] Server returned', res.status);
          const tbody = document.getElementById('buyers-table');
          if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="color: var(--error);">Server error (' + res.status + '). Retry in a moment.</td></tr>';
          return;
        }
        const json = await res.json();
        const buyers = (json.data?.buyers || []).map((buyer) => this.normalizeBuyer(buyer));
        this.buyers = buyers;

        // Stats
        const totalEl = document.getElementById('buyers-total');
        const activeEl = document.getElementById('buyers-active');
        if (totalEl) totalEl.textContent = buyers.length;
        if (activeEl) activeEl.textContent = buyers.filter(b => b.status !== 'deactivated').length;

        // Load aggregate order/payment stats — use completed payments for revenue (consistent with Overview)
        let orderCount = 0;
        let revenue = 0;
        try {
          const [ordRes, payRes] = await Promise.all([
            fetch('/api/admin/wholesale/orders', { headers }),
            fetch('/api/wholesale/webhooks/payments', { headers })
          ]);
          const ordJson = await ordRes.json();
          const payJson = await payRes.json();
          const orders = ordJson.data?.orders || ordJson.orders || [];
          const payments = payJson.data?.payments || payJson.payments || [];
          orderCount = orders.length;
          // Revenue = completed payments only (matches Overview GMV calculation)
          revenue = payments
            .filter(p => p.status === 'completed')
            .reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
        } catch (_) {}
        const ordTotalEl = document.getElementById('buyers-orders-total');
        const revEl = document.getElementById('buyers-revenue');
        if (ordTotalEl) ordTotalEl.textContent = orderCount;
        if (revEl) revEl.textContent = '$' + revenue.toFixed(2);

        // Table
        const tbody = document.getElementById('buyers-table');
        if (!tbody) return;
        if (buyers.length === 0) {
          tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: var(--text-secondary);">No buyers found</td></tr>';
          return;
        }
        tbody.innerHTML = buyers.map(b => {
          const status = b.status || 'active';
          const statusColor = status === 'active' ? 'var(--success)' : 'var(--error)';
          const created = b.createdAt ? new Date(b.createdAt).toLocaleDateString() : '—';
          return `<tr>
            <td><a href="#" onclick="admin.viewBuyerDetail('${b.id}'); return false;" style="color: var(--primary); font-weight: 600;">${this.esc(b.businessName || '—')}</a></td>
            <td>${this.esc(b.contactName || '—')}</td>
            <td>${this.esc(b.email || '—')}</td>
            <td>${this.esc(b.buyerType || '—')}</td>
            <td><span style="padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600; background: ${statusColor}20; color: ${statusColor};">${status}</span></td>
            <td>—</td>
            <td>${created}</td>
            <td style="white-space: nowrap;">
              <button class="btn btn-secondary" style="font-size: 0.75rem; padding: 0.25rem 0.5rem; margin-right: 0.25rem;" onclick="admin.openResetPassword('${this.esc(b.email || '')}')">Reset PW</button>
              ${status === 'active'
                ? `<button class="btn btn-secondary" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;" onclick="admin.deactivateBuyer('${b.id}')">Deactivate</button>`
                : `<button class="btn btn-primary" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;" onclick="admin.reactivateBuyer('${b.id}')">Reactivate</button>`
              }
            </td>
          </tr>`;
        }).join('');
      } catch (err) {
        console.error('[Buyers] Load error:', err);
        const tbody = document.getElementById('buyers-table');
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="color: var(--error);">Failed to load buyers</td></tr>';
      }
    },

    async viewBuyerDetail(buyerId) {
      const headers = this.getAuthHeaders();
      try {
        const res = await fetch(`/api/admin/wholesale/buyers/${encodeURIComponent(buyerId)}`, { headers });
        const json = await res.json();
        if (json.status !== 'ok') throw new Error(json.message || 'Failed to load buyer');

        const buyer = json.data.buyer;
        const orders = json.data.orders || [];
        const payments = json.data.payments || [];
        const summary = json.data.summary || {};

        const panel = document.getElementById('buyer-detail-panel');
        const title = document.getElementById('buyer-detail-title');
        const content = document.getElementById('buyer-detail-content');
        if (!panel || !content) return;

        title.textContent = buyer.businessName || buyer.email;
        panel.style.display = 'block';

        content.innerHTML = `
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; padding: 1rem; background: var(--bg-main); border-radius: 8px;">
            <div><strong>Contact:</strong> ${this.esc(buyer.contactName || '—')}</div>
            <div><strong>Email:</strong> ${this.esc(buyer.email || '—')}</div>
            <div><strong>Phone:</strong> ${this.esc(buyer.phone || '—')}</div>
            <div><strong>Type:</strong> ${this.esc(buyer.buyerType || '—')}</div>
            <div><strong>Status:</strong> <span style="font-weight:600; color: ${buyer.status === 'active' ? 'var(--success)' : 'var(--error)'}">${buyer.status || 'active'}</span></div>
            <div><strong>Registered:</strong> ${buyer.createdAt ? new Date(buyer.createdAt).toLocaleDateString() : '—'}</div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
            <div class="stat-card"><div class="stat-label">Total Orders</div><div class="stat-value">${summary.order_count || 0}</div></div>
            <div class="stat-card"><div class="stat-label">Total Spent</div><div class="stat-value">$${(summary.total_spent || 0).toFixed(2)}</div></div>
            <div class="stat-card"><div class="stat-label">First Order</div><div class="stat-value" style="font-size:0.9rem;">${summary.first_order ? new Date(summary.first_order).toLocaleDateString() : '—'}</div></div>
            <div class="stat-card"><div class="stat-label">Last Order</div><div class="stat-value" style="font-size:0.9rem;">${summary.last_order ? new Date(summary.last_order).toLocaleDateString() : '—'}</div></div>
          </div>

          <h3 style="margin-bottom: 0.75rem;">Orders (${orders.length})</h3>
          ${orders.length === 0 ? '<p style="color: var(--text-secondary);">No orders yet</p>' : `
          <table style="margin-bottom: 1.5rem;">
            <thead><tr><th>Order ID</th><th>Date</th><th>Status</th><th>Total</th><th>Actions</th></tr></thead>
            <tbody>
              ${orders.map(o => `<tr>
                <td style="font-family: monospace; font-size: 0.8rem;">${this.esc((o.id || o.master_order_id || '').slice(0, 16))}...</td>
                <td>${o.created_at ? new Date(o.created_at).toLocaleDateString() : '—'}</td>
                <td>${this.esc(o.status || '—')}</td>
                <td>$${(parseFloat(o.grand_total || o.total) || 0).toFixed(2)}</td>
                <td>
                  <button class="btn btn-secondary" style="font-size:0.7rem; padding:0.2rem 0.4rem;" onclick="admin.viewOrderAudit('${o.id || o.master_order_id}')">Audit</button>
                  <button class="btn btn-secondary" style="font-size:0.7rem; padding:0.2rem 0.4rem;" onclick="admin.issueRefund('${o.id || o.master_order_id}', ${parseFloat(o.grand_total || o.total) || 0})">Refund</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>`}

          <h3 style="margin-bottom: 0.75rem;">Payments (${payments.length})</h3>
          ${payments.length === 0 ? '<p style="color: var(--text-secondary);">No payments recorded</p>' : `
          <table>
            <thead><tr><th>Payment ID</th><th>Order</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              ${payments.map(p => `<tr>
                <td style="font-family: monospace; font-size: 0.8rem;">${this.esc((p.id || '').slice(0, 16))}</td>
                <td style="font-family: monospace; font-size: 0.8rem;">${this.esc((p.orderId || '').slice(0, 16))}</td>
                <td>$${(parseFloat(p.amount) || 0).toFixed(2)}</td>
                <td>${this.esc(p.status || '—')}</td>
                <td>${p.created_at ? new Date(p.created_at).toLocaleDateString() : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>`}
        `;

        panel.scrollIntoView({ behavior: 'smooth' });
      } catch (err) {
        console.error('[Buyers] Detail error:', err);
        this.showToast('Failed to load buyer detail: ' + err.message, 'error');
      }
    },

    closeBuyerDetail() {
      const panel = document.getElementById('buyer-detail-panel');
      if (panel) panel.style.display = 'none';
    },

    async deactivateBuyer(buyerId) {
      if (!confirm('Deactivate this buyer account? They will lose API access immediately.')) return;
      const headers = this.getAuthHeaders();
      try {
        const res = await fetch(`/api/admin/wholesale/buyers/${encodeURIComponent(buyerId)}/deactivate`, {
          method: 'POST', headers
        });
        const json = await res.json().catch(() => ({}));
        if (json.status === 'ok') {
          this.showToast('Buyer deactivated', 'success');
          await this.loadBuyers();
        } else {
          this.showToast(json.message || 'Deactivation failed', 'error');
        }
      } catch (err) {
        this.showToast('Error: ' + err.message, 'error');
      }
    },

    async reactivateBuyer(buyerId) {
      const headers = this.getAuthHeaders();
      try {
        const res = await fetch(`/api/admin/wholesale/buyers/${encodeURIComponent(buyerId)}/reactivate`, {
          method: 'POST', headers
        });
        const json = await res.json();
        if (json.status === 'ok') {
          this.showToast('Buyer reactivated', 'success');
          this.loadBuyers();
        } else {
          this.showToast(json.message || 'Reactivation failed', 'error');
        }
      } catch (err) {
        this.showToast('Error: ' + err.message, 'error');
      }
    },

    async viewOrderAudit(orderId) {
      const headers = this.getAuthHeaders();
      try {
        const res = await fetch(`/api/admin/wholesale/audit-log?orderId=${encodeURIComponent(orderId)}`, { headers });
        const json = await res.json();
        const events = json.data?.events || [];

        const panel = document.getElementById('audit-log-panel');
        const content = document.getElementById('audit-log-content');
        if (!panel || !content) return;
        panel.style.display = 'block';

        content.innerHTML = events.length === 0
          ? '<p style="color: var(--text-secondary);">No audit events for this order</p>'
          : `<table>
              <thead><tr><th>Time</th><th>Event</th><th>Actor</th><th>Details</th></tr></thead>
              <tbody>
                ${events.map(e => `<tr>
                  <td style="font-size: 0.8rem;">${new Date(e.timestamp).toLocaleString()}</td>
                  <td><strong>${this.esc(e.event)}</strong></td>
                  <td>${this.esc(e.actor || '—')}</td>
                  <td style="font-size: 0.8rem; max-width: 300px; overflow: hidden; text-overflow: ellipsis;">${this.esc(JSON.stringify(e.details || {}))}</td>
                </tr>`).join('')}
              </tbody>
            </table>`;

        panel.scrollIntoView({ behavior: 'smooth' });
      } catch (err) {
        this.showToast('Failed to load audit log: ' + err.message, 'error');
      }
    },

    closeAuditLog() {
      const panel = document.getElementById('audit-log-panel');
      if (panel) panel.style.display = 'none';
    },

    async issueRefund(orderId, maxAmount) {
      const amount = prompt(`Enter refund amount (max $${maxAmount.toFixed(2)}):`);
      if (!amount) return;
      const parsedAmt = parseFloat(amount);
      if (isNaN(parsedAmt) || parsedAmt <= 0 || parsedAmt > maxAmount) {
        return this.showToast('Invalid refund amount', 'error');
      }
      const reason = prompt('Reason for refund:') || 'Admin-initiated refund';
      const headers = this.getAuthHeaders();
      try {
        const res = await fetch('/api/admin/wholesale/refunds', {
          method: 'POST', headers,
          body: JSON.stringify({ orderId, amount: parsedAmt, reason })
        });
        const json = await res.json();
        if (json.status === 'ok') {
          this.showToast(`Refund of $${parsedAmt.toFixed(2)} processed`, 'success');
        } else {
          this.showToast(json.message || 'Refund failed', 'error');
        }
      } catch (err) {
        this.showToast('Error: ' + err.message, 'error');
      }
    },

    exportBuyers() {
      if (!this.buyers || this.buyers.length === 0) {
        return this.showToast('No buyers to export', 'error');
      }
      const csv = [
        ['Business Name', 'Contact', 'Email', 'Type', 'Status', 'Registered'],
        ...this.buyers.map(b => [
          (b.businessName || b.business_name || '').replace(/,/g, ' '),
          (b.contactName || b.contact_name || '').replace(/,/g, ' '),
          b.email || '',
          b.buyerType || b.buyer_type || '',
          b.status || 'active',
          b.createdAt || b.created_at ? new Date(b.createdAt || b.created_at).toLocaleDateString() : ''
        ])
      ].map(row => row.join(',')).join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wholesale-buyers-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      this.showToast('Buyers exported to CSV', 'success');
    },

    openResetPassword(email) {
      const modal = document.getElementById('resetPasswordModal');
      document.getElementById('resetEmail').value = email;
      document.getElementById('resetNewPassword').value = '';
      if (modal) modal.style.display = 'flex';
    },

    closeResetModal() {
      const modal = document.getElementById('resetPasswordModal');
      if (modal) modal.style.display = 'none';
    },

    async submitPasswordReset() {
      const email = document.getElementById('resetEmail').value;
      const newPassword = document.getElementById('resetNewPassword').value;
      if (!newPassword || newPassword.length < 8) {
        return this.showToast('Password must be at least 8 characters', 'error');
      }
      try {
        const headers = this.getAuthHeaders();
        const res = await fetch('/api/admin/wholesale/buyers/reset-password', {
          method: 'POST', headers,
          body: JSON.stringify({ email, newPassword })
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || (json && json.status === 'error')) {
          return this.showToast(json?.message || json?.error || 'Password reset failed', 'error');
        }
        this.showToast('Password reset successfully', 'success');
        this.closeResetModal();
      } catch (err) {
        this.showToast('Error: ' + err.message, 'error');
      }
    },

    normalizeBuyer(buyer) {
      const status = buyer?.status || (buyer?.active === false ? 'deactivated' : 'active');
      return {
        ...buyer,
        id: buyer?.id || buyer?.buyerId,
        businessName: buyer?.businessName || buyer?.business_name || '',
        contactName: buyer?.contactName || buyer?.contact_name || '',
        email: buyer?.email || '',
        buyerType: buyer?.buyerType || buyer?.buyer_type || '',
        status,
        createdAt: buyer?.createdAt || buyer?.created_at || null
      };
    },

    esc(str) {
      const d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    },

    // ── Donations Admin Methods ──────────────────────────────────────

    async loadDonationsDashboard() {
      const headers = this.getHeaders();
      try {
        const [summaryRes, offersRes] = await Promise.all([
          fetch('/api/wholesale/donations/summary', { headers }),
          fetch('/api/wholesale/donations/offers', { headers })
        ]);

        if (summaryRes.ok) {
          const summaryData = await summaryRes.json();
          const s = summaryData.data || {};
          const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
          el('stat-total-qty', s.total_quantity != null ? Number(s.total_quantity).toLocaleString() : '0');
          el('stat-total-fmv', s.total_fmv != null ? '$' + Number(s.total_fmv).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '$0.00');
          el('stat-total-claims', s.total_claims != null ? String(s.total_claims) : '0');
          el('stat-unique-recipients', s.unique_recipients != null ? String(s.unique_recipients) : '0');
        }

        const offersContainer = document.getElementById('admin-donation-offers');
        const claimsContainer = document.getElementById('admin-donation-claims');

        if (offersRes.ok) {
          const offersData = await offersRes.json();
          const offers = offersData.data || [];
          if (offers.length === 0) {
            offersContainer.innerHTML = '<p style="color: #888;">No donation offers yet. Click "New Donation Offer" to create one.</p>';
          } else {
            offersContainer.innerHTML = offers.map(o => this.renderAdminOfferCard(o)).join('');
          }

          // Render claims from offers that have them
          const allClaims = [];
          for (const o of offers) {
            if (o.claims && o.claims.length) {
              for (const c of o.claims) {
                allClaims.push({ ...c, offer: o });
              }
            }
          }
          if (allClaims.length === 0) {
            claimsContainer.innerHTML = '<p style="color: #888;">No claims yet.</p>';
          } else {
            claimsContainer.innerHTML = allClaims.map(c => this.renderAdminClaimCard(c)).join('');
          }
        } else {
          offersContainer.innerHTML = '<p style="color: #c62828;">Failed to load offers.</p>';
        }
      } catch (err) {
        console.error('[Donations] Dashboard load error:', err);
      }
    },

    renderAdminOfferCard(offer) {
      const statusColors = { available: '#2d5016', claimed: '#1565c0', fulfilled: '#2e7d32', cancelled: '#c62828', expired: '#888' };
      const statusColor = statusColors[offer.status] || '#888';
      const items = offer.items || [];
      const totalQty = items.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
      const totalFmv = items.reduce((sum, i) => sum + Number(i.fair_market_value || 0), 0);
      const created = offer.created_at ? new Date(offer.created_at).toLocaleDateString() : '--';
      const expires = offer.expires_at ? new Date(offer.expires_at).toLocaleDateString() : 'None';

      let itemsHtml = items.map(i =>
        `<tr><td>${this.esc(i.product_name)}</td><td>${Number(i.quantity).toFixed(1)} ${this.esc(i.unit || 'lbs')}</td><td>$${Number(i.retail_price || 0).toFixed(2)}</td><td>$${Number(i.fair_market_value || 0).toFixed(2)}</td></tr>`
      ).join('');

      return `
        <div style="background: var(--bg-card, #1e1e1e); border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; border-left: 3px solid ${statusColor};">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.75rem;">
            <div>
              <strong style="font-size: 1rem;">${this.esc(offer.id)}</strong>
              <span style="background:${statusColor}; color:#fff; padding:2px 8px; border-radius:4px; font-size:0.75rem; margin-left:0.5rem;">${this.esc(offer.status)}</span>
            </div>
            <div style="text-align: right; font-size: 0.8rem; color: #888;">
              <div>Created: ${created}</div>
              <div>Expires: ${expires}</div>
            </div>
          </div>
          <div style="font-size: 0.85rem; color: #aaa; margin-bottom: 0.5rem;">
            Farm: ${this.esc(offer.farm_id)} | Reason: ${this.esc(offer.reason || 'surplus')} | Pickup: ${this.esc(offer.pickup_window || 'TBD')}
          </div>
          ${offer.notes ? `<div style="font-size: 0.85rem; color: #aaa; margin-bottom: 0.5rem;">Notes: ${this.esc(offer.notes)}</div>` : ''}
          <table style="width:100%; font-size:0.85rem; border-collapse:collapse; margin-bottom:0.5rem;">
            <thead><tr style="border-bottom:1px solid #333;"><th style="text-align:left;padding:4px;">Product</th><th style="text-align:left;padding:4px;">Qty</th><th style="text-align:left;padding:4px;">Retail</th><th style="text-align:left;padding:4px;">FMV</th></tr></thead>
            <tbody>${itemsHtml}</tbody>
            <tfoot><tr style="border-top:1px solid #333; font-weight:600;"><td style="padding:4px;">Total</td><td style="padding:4px;">${totalQty.toFixed(1)} lbs</td><td></td><td style="padding:4px;">$${totalFmv.toFixed(2)}</td></tr></tfoot>
          </table>
          <div style="font-size: 0.8rem; color: #888;">${offer.claim_count || 0} claim(s)</div>
          ${offer.status === 'available' ? `<button onclick="admin.cancelDonationOffer('${offer.id}')" style="margin-top:0.5rem; background:none; border:1px solid #c62828; color:#c62828; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:0.8rem;">Cancel Offer</button>` : ''}
        </div>`;
    },

    renderAdminClaimCard(claim) {
      const buyer = claim.buyer || {};
      const items = claim.items || [];
      const totalFmv = items.reduce((sum, i) => sum + Number(i.fair_market_value || 0), 0);
      const claimedAt = claim.claimed_at ? new Date(claim.claimed_at).toLocaleDateString() : '--';
      const statusColors = { claimed: '#1565c0', fulfilled: '#2e7d32', cancelled: '#c62828' };
      const statusColor = statusColors[claim.status] || '#888';

      return `
        <div style="background: var(--bg-card, #1e1e1e); border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; border-left: 3px solid ${statusColor};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <div>
              <strong>${this.esc(claim.id)}</strong>
              <span style="background:${statusColor}; color:#fff; padding:2px 6px; border-radius:4px; font-size:0.7rem; margin-left:0.5rem;">${this.esc(claim.status)}</span>
            </div>
            <span style="font-size:0.8rem; color:#888;">${claimedAt}</span>
          </div>
          <div style="font-size: 0.85rem;">
            <div>Organization: <strong>${this.esc(buyer.businessName || buyer.business_name || claim.buyer_id || '--')}</strong></div>
            <div>Offer: ${this.esc(claim.offer_id || (claim.offer && claim.offer.id) || '--')}</div>
            <div>Items: ${items.length} | FMV: $${totalFmv.toFixed(2)}</div>
            ${claim.order_id ? `<div>Order: ${this.esc(claim.order_id)}</div>` : ''}
          </div>
          ${claim.status === 'claimed' ? `<button onclick="admin.viewDonationReceipt('${claim.id}')" style="margin-top:0.5rem; background:none; border:1px solid #2d5016; color:#2d5016; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:0.8rem;">View Receipt</button>` : ''}
        </div>`;
    },

    async cancelDonationOffer(offerId) {
      if (!confirm('Cancel this donation offer? This cannot be undone.')) return;
      try {
        const res = await fetch(`/api/wholesale/donations/offers/${encodeURIComponent(offerId)}/status`, {
          method: 'PATCH',
          headers: this.getHeaders(),
          body: JSON.stringify({ status: 'cancelled' })
        });
        if (res.ok) {
          this.loadDonationsDashboard();
        } else {
          const err = await res.json().catch(() => ({}));
          alert(err.message || 'Failed to cancel offer');
        }
      } catch (err) {
        console.error('[Donations] Cancel offer error:', err);
      }
    },

    async viewDonationReceipt(claimId) {
      try {
        const res = await fetch(`/api/wholesale/donations/receipt/${encodeURIComponent(claimId)}`, {
          headers: this.getHeaders()
        });
        if (!res.ok) {
          alert('Failed to load receipt');
          return;
        }
        const data = await res.json();
        const r = data.data || {};
        const itemsHtml = (r.items || []).map(i =>
          `<tr><td>${this.esc(i.product_name)}</td><td>${Number(i.quantity).toFixed(1)} ${this.esc(i.unit)}</td><td>$${Number(i.fair_market_value).toFixed(2)}</td></tr>`
        ).join('');
        const html = `
          <div style="font-family:sans-serif; max-width:600px; margin:auto; padding:2rem;">
            <h2>Charitable Donation Receipt</h2>
            <p><strong>Claim ID:</strong> ${this.esc(r.claim_id || claimId)}</p>
            <p><strong>Donor:</strong> ${this.esc(r.donor?.farm_name || '--')} (${this.esc(r.donor?.farm_id || '--')})</p>
            <p><strong>Recipient:</strong> ${this.esc(r.recipient?.organization || '--')}</p>
            <p><strong>Date:</strong> ${r.claimed_at ? new Date(r.claimed_at).toLocaleDateString() : '--'}</p>
            <table style="width:100%; border-collapse:collapse; margin:1rem 0;">
              <thead><tr style="border-bottom:2px solid #333;"><th style="text-align:left;padding:4px;">Product</th><th style="text-align:left;padding:4px;">Quantity</th><th style="text-align:left;padding:4px;">FMV</th></tr></thead>
              <tbody>${itemsHtml}</tbody>
            </table>
            <p><strong>Total Fair Market Value:</strong> $${Number(r.total_fmv || 0).toFixed(2)} CAD</p>
            <p><strong>Valuation Method:</strong> ${this.esc(r.valuation_method || 'retail market price')}</p>
            <p style="color:#888; font-size:0.85rem;">This receipt is for record-keeping purposes. Consult CRA guidelines for charitable donation deductions.</p>
          </div>`;
        const w = window.open('', '_blank', 'width=700,height=600');
        if (w) { w.document.write(html); w.document.close(); }
      } catch (err) {
        console.error('[Donations] Receipt error:', err);
      }
    },

    async submitDonationOffer(event) {
      event.preventDefault();
      const form = document.getElementById('donation-offer-form');
      const farmId = document.getElementById('don-farm-id')?.value?.trim();
      const reason = document.getElementById('don-reason')?.value;
      const pickup = document.getElementById('don-pickup')?.value?.trim();
      const expires = document.getElementById('don-expires')?.value;
      const notes = document.getElementById('don-notes')?.value?.trim();

      const rows = document.querySelectorAll('#don-items-container .don-item-row');
      const items = [];
      for (const row of rows) {
        const productName = row.querySelector('[name="product_name"]')?.value?.trim();
        const quantity = parseFloat(row.querySelector('[name="quantity"]')?.value);
        const unit = row.querySelector('[name="unit"]')?.value || 'lbs';
        const retailPrice = parseFloat(row.querySelector('[name="retail_price"]')?.value) || 0;
        if (!productName || !quantity || quantity <= 0) continue;
        items.push({ product_name: productName, quantity, unit, retail_price: retailPrice });
      }

      if (!farmId || items.length === 0) {
        alert('Farm ID and at least one item are required.');
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating...'; }

      try {
        const res = await fetch('/api/wholesale/donations/offers', {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({ farm_id: farmId, reason, pickup_window: pickup, expires_at: expires || null, notes, items })
        });
        if (res.ok) {
          this.closeCreateDonationModal();
          this.loadDonationsDashboard();
        } else {
          const err = await res.json().catch(() => ({}));
          alert(err.message || 'Failed to create donation offer');
        }
      } catch (err) {
        console.error('[Donations] Submit offer error:', err);
        alert('Network error creating donation offer');
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Offer'; }
      }
    },

    openCreateDonationModal() {
      const modal = document.getElementById('create-donation-modal');
      if (modal) {
        modal.style.display = 'flex';
        const form = document.getElementById('donation-offer-form');
        if (form) form.reset();
        // Reset item rows to just one
        const container = document.getElementById('don-items-container');
        const rows = container?.querySelectorAll('.don-item-row');
        if (rows && rows.length > 1) {
          for (let i = rows.length - 1; i > 0; i--) rows[i].remove();
        }
      }
    },

    closeCreateDonationModal() {
      const modal = document.getElementById('create-donation-modal');
      if (modal) modal.style.display = 'none';
    },

    addDonationItemRow() {
      const container = document.getElementById('don-items-container');
      if (!container) return;
      const firstRow = container.querySelector('.don-item-row');
      if (!firstRow) return;
      const newRow = firstRow.cloneNode(true);
      newRow.querySelectorAll('input').forEach(inp => { inp.value = ''; });
      container.appendChild(newRow);
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    admin.init();
  });

  // Expose admin globally for onclick handlers
  window.admin = admin;

  // Global functions for donations modal
  window.openCreateDonationModal = function() { admin.openCreateDonationModal(); };
  window.closeCreateDonationModal = function() { admin.closeCreateDonationModal(); };
  window.addDonationItemRow = function() { admin.addDonationItemRow(); };
  window.submitDonationOffer = function(event) { admin.submitDonationOffer(event); };

  // Global functions for alert banner
  window.resolveOverselling = function() {
    // Navigate to Network tab to see inventory details
    admin.navigateTo('network');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  window.dismissAlert = function() {
    document.getElementById('overselling-alert').style.display = 'none';
  };
})();
