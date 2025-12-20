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

    async init() {
      this.setupEventListeners();
      await this.loadOverview();
    },

    setupEventListeners() {
      document.querySelectorAll('.nav-tab').forEach((tab) => {
        tab.addEventListener('click', (e) => {
          const view = e.target?.dataset?.view;
          if (view) this.navigateTo(view);
        });
      });

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
        case 'payments':
          this.loadPayments();
          break;
        case 'orders':
          this.loadOrders();
          break;
        case 'reconciliation':
          this.loadRefunds();
          break;
      }
    },

    async loadNetwork() {
      try {
        const [farmsRes, snapshotsRes, aggregateRes, eventsRes, recsRes] = await Promise.all([
          fetch('/api/wholesale/network/farms'),
          fetch('/api/wholesale/network/snapshots'),
          fetch('/api/wholesale/network/aggregate'),
          fetch('/api/wholesale/network/market-events'),
          fetch('/api/wholesale/network/recommendations')
        ]);

        const farmsJson = await farmsRes.json().catch(() => null);
        const snapshotsJson = await snapshotsRes.json().catch(() => null);
        const aggregateJson = await aggregateRes.json().catch(() => null);
        const eventsJson = await eventsRes.json().catch(() => null);
        const recsJson = await recsRes.json().catch(() => null);

        if (farmsRes.ok && farmsJson?.status === 'ok') {
          this.network.farms = farmsJson.data?.farms || [];
          this.network.lastSync = farmsJson.data?.lastSync || null;
        } else {
          this.network.farms = [];
          this.network.lastSync = null;
        }

        if (snapshotsRes.ok && snapshotsJson?.status === 'ok') {
          this.network.snapshots = snapshotsJson.data?.snapshots || [];
        } else {
          this.network.snapshots = [];
        }

        if (aggregateRes.ok && aggregateJson?.status === 'ok') {
          this.network.aggregate = aggregateJson.data?.catalog || null;
        } else {
          this.network.aggregate = null;
        }

        if (eventsRes.ok && eventsJson?.status === 'ok') {
          this.network.events = eventsJson.data?.events || [];
        } else {
          this.network.events = [];
        }

        if (recsRes.ok && recsJson?.status === 'ok') {
          this.network.recommendations = recsJson.data?.recommendations || [];
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

      const healthy = (this.network.snapshots || []).filter((s) => Boolean(s.ok)).length;
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

      const snaps = this.network.snapshots || [];
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
        const farmsRes = await fetch('/api/wholesale/oauth/square/farms');
        const farmsData = await farmsRes.json();
        this.farms = farmsData.data?.farms || [];

        const paymentsRes = await fetch('/api/wholesale/webhooks/payments');
        const paymentsData = await paymentsRes.json();
        this.payments = paymentsData.data?.payments || [];

        const totalGMV = this.payments
          .filter((p) => p.status === 'completed')
          .reduce((sum, p) => sum + p.amount, 0);

        const totalFees = this.payments
          .filter((p) => p.status === 'completed')
          .reduce((sum, p) => sum + p.broker_fee_amount, 0);

        const activeFarms = this.farms.filter((f) => f.status === 'active').length;

        document.getElementById('stat-gmv').textContent = `$${totalGMV.toFixed(2)}`;
        document.getElementById('stat-fees').textContent = `$${totalFees.toFixed(2)}`;
        document.getElementById('stat-farms').textContent = activeFarms.toString();
        document.getElementById('stat-orders').textContent = this.payments.length.toString();

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
              <div class="chart-label">${farm_id.substring(0, 12)}...</div>
            </div>
          `;
        })
        .join('');
    },

    renderRecentActivity() {
      const container = document.getElementById('recent-activity');

      const recentPayments = [...this.payments]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 5);

      if (recentPayments.length === 0) {
        container.innerHTML = '<div class="empty-state">No recent activity</div>';
        return;
      }

      container.innerHTML = `
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>Farm</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${recentPayments
                .map(
                  (p) => `
                <tr>
                  <td>${new Date(p.created_at).toLocaleString()}</td>
                  <td>Payment</td>
                  <td>${p.farm_id}</td>
                  <td>$${p.amount.toFixed(2)}</td>
                  <td><span class="badge ${p.status}">${p.status}</span></td>
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
        const response = await fetch('/api/wholesale/oauth/square/farms');
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
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No farms onboarded yet</td></tr>';
        return;
      }

      tbody.innerHTML = this.farms
        .map((farm) => {
          const refreshBtn = farm.needs_refresh
            ? `<button class="btn btn-secondary btn-sm" data-action="refresh-token" data-farmid="${farm.farm_id}">Refresh Token</button>`
            : '';

          return `
          <tr>
            <td>${farm.farm_id}</td>
            <td>${farm.merchant_id}</td>
            <td>${farm.location_name}</td>
            <td><span class="badge ${farm.status}">${farm.status}</span></td>
            <td>
              ${new Date(farm.expires_at).toLocaleDateString()}
              ${farm.needs_refresh ? '<span style="color: var(--warning);">(needs refresh)</span>' : ''}
            </td>
            <td>${new Date(farm.onboarded_at).toLocaleDateString()}</td>
            <td>
              ${refreshBtn}
              <button class="btn btn-danger btn-sm" data-action="disconnect-farm" data-farmid="${farm.farm_id}">Disconnect</button>
            </td>
          </tr>
        `;
        })
        .join('');
    },

    async loadPayments() {
      try {
        const response = await fetch('/api/wholesale/webhooks/payments');
        const data = await response.json();

        if (data.status === 'ok') {
          this.payments = data.data.payments || [];
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
            <td>${p.farm_id || ''}</td>
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

      const farmSummary = {};
      this.payments.forEach((p) => {
        if (p.status === 'completed') {
          if (!farmSummary[p.farm_id]) farmSummary[p.farm_id] = { gross: 0, fees: 0, count: 0 };
          farmSummary[p.farm_id].gross += p.amount;
          farmSummary[p.farm_id].fees += p.broker_fee_amount;
          farmSummary[p.farm_id].count += 1;
        }
      });

      if (Object.keys(farmSummary).length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No completed payments</td></tr>';
        return;
      }

      tbody.innerHTML = Object.entries(farmSummary)
        .map(
          ([farm_id, summary]) => `
          <tr>
            <td>${farm_id}</td>
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
        const response = await fetch('/api/wholesale/admin/orders');
        if (!response.ok) {
          document.getElementById('orders-list').innerHTML =
            '<div class="empty-state">Order history endpoint not yet implemented. Orders are currently stored in-memory.</div>';
          return;
        }
        
        const data = await response.json();
        const orders = data.orders || [];
        
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
      try {
        const response = await fetch('/api/wholesale/refunds');
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

    async reconcilePayments() {
      try {
        this.showToast('Running reconciliation...', 'info');

        const response = await fetch('/api/wholesale/webhooks/reconcile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (data.status === 'ok') {
          this.showToast(`Reconciliation complete: ${data.data.updated_count} payments updated`, 'success');
          this.loadPayments();
        } else {
          this.showToast(`Reconciliation failed: ${data.message}`, 'error');
        }
      } catch (error) {
        console.error('Reconciliation error:', error);
        this.showToast('Network error during reconciliation', 'error');
      }
    },

    async runReconciliation() {
      const log = document.getElementById('reconciliation-log');
      log.innerHTML = '<div class="loading">Running reconciliation...</div>';

      try {
        const response = await fetch('/api/wholesale/webhooks/reconcile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (data.status === 'ok') {
          log.innerHTML = `
              <div style="padding: 1rem; background: var(--bg); border-radius: 6px;">
                <h4 style="color: var(--success); margin-bottom: 0.5rem;">Reconciliation Complete</h4>
                <p>Total Payments: ${data.data.total_payments}</p>
                <p>Updated: ${data.data.updated_count}</p>
                <p>Failed: ${data.data.failed_count}</p>
                <p>Completed at: ${new Date().toLocaleString()}</p>
                ${data.data.errors.length > 0
                  ? `
                  <details style="margin-top: 1rem;">
                    <summary>Errors (${data.data.errors.length})</summary>
                    <ul style="margin-top: 0.5rem;">
                      ${data.data.errors.map((e) => `<li>${e.payment_id}: ${e.error}</li>`).join('')}
                    </ul>
                  </details>
                `
                  : ''}
              </div>
            `;
          this.loadPayments();
        } else {
          log.innerHTML = `<div class="empty-state" style="color: var(--error);">Reconciliation failed: ${data.message}</div>`;
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
      this.showToast('Filtering not yet implemented', 'info');
    },

    filterOrders() {
      this.showToast('Filtering not yet implemented', 'info');
    },

    async openPaymentModal(orderId) {
      try {
        const response = await fetch('/api/wholesale/admin/orders');
        const data = await response.json();
        const order = (data.orders || []).find(o => o.master_order_id === orderId);
        
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
        const response = await fetch('/api/wholesale/admin/orders');
        const data = await response.json();
        const order = (data.orders || []).find(o => o.master_order_id === orderId);
        
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
        const response = await fetch(`/api/wholesale/admin/orders/${encodeURIComponent(orderId)}/payment`, {
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

    showToast(message, type = 'info') {
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.textContent = message;
      document.body.appendChild(toast);

      setTimeout(() => {
        toast.remove();
      }, 3000);
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    admin.init();
  });
})();
