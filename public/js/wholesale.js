(() => {
  'use strict';

  const STORAGE_TOKEN = 'greenreach_wholesale_token';
  const STORAGE_BUYER = 'greenreach_wholesale_buyer';

  const app = {
    catalog: [],
    cart: [],
    orders: [],
    currentView: 'catalog',
    deliveryDate: null,
    demoMode: false, // Default to live mode - use ?demo=1 for demo data
    demoData: null,
    farmDirectory: {},
    networkFarms: [],
    currentBuyer: null,
    authTab: 'sign-in',

    get token() {
      return localStorage.getItem(STORAGE_TOKEN) || '';
    },

    set token(value) {
      if (!value) localStorage.removeItem(STORAGE_TOKEN);
      else localStorage.setItem(STORAGE_TOKEN, value);
    },

    async init() {
      const params = new URLSearchParams(window.location.search);
      // Prefer live/network mode by default; demo mode is opt-in.
      if (params.get('demo') === '1') this.demoMode = true;
      else if (params.get('demo') === '0') this.demoMode = false;
      else this.demoMode = false;

      this.loadAuthState();
      
      // Auto-login with demo profile if not already logged in
      if (!this.currentBuyer) {
        this.createDemoProfile();
      }
      
      this.setupEventListeners();
      this.setDefaultDeliveryDate();

      this.setupSourcingControls();
      await this.loadNetworkFarms();

      await this.loadCatalog();
      await this.loadOrders();
      this.renderCart();
      this.updateDemoBanner();
      
      // Load insights after all data is ready
      await this.loadBuyerInsights();
    },

    createDemoProfile() {
      const demoBuyer = {
        id: 'demo-buyer-001',
        businessName: 'GreenLeaf Restaurant Group',
        contactName: 'Demo User',
        email: 'demo@greenleaf.ca',
        phone: '(604) 555-0100',
        buyerType: 'restaurant',
        location: {
          street: '123 Princess Street',
          city: 'Kingston',
          province: 'ON',
          postalCode: 'K7L 1A1',
          country: 'Canada',
          latitude: 44.2312,
          longitude: -76.4860
        },
        preferences: {
          sustainabilityPriority: 'high',
          localPreference: true,
          maxDeliveryDistance: 500
        }
      };
      
      // Generate a demo token
      const demoToken = 'demo-token-' + Date.now();
      
      this.setActiveBuyer({ buyer: demoBuyer, token: demoToken });
      console.log('Demo profile auto-logged in:', demoBuyer.businessName);
      
      // Don't load insights here - will be loaded after init completes
    },

    setupEventListeners() {
      document.querySelectorAll('.nav-tab').forEach((tab) => {
        tab.addEventListener('click', (event) => {
          this.navigateTo(event.target.dataset.view);
        });
      });

      document.getElementById('delivery-date')?.addEventListener('change', (event) => {
        this.deliveryDate = event.target.value;
        this.loadCatalog();
      });

      document.getElementById('sourcing-mode')?.addEventListener('change', () => {
        this.setupSourcingControls();
        this.loadCatalog();
        if (this.currentView === 'checkout') this.previewAllocation();
      });

      document.getElementById('single-farm-id')?.addEventListener('change', () => {
        this.loadCatalog();
        if (this.currentView === 'checkout') this.previewAllocation();
      });

      document.getElementById('sort-by')?.addEventListener('change', () => {
        this.renderCatalog();
      });

      document.getElementById('sign-in-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        this.handleSignIn();
      });

      document.getElementById('register-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        this.handleRegister();
      });

      const authModal = document.getElementById('auth-modal');
      authModal?.addEventListener('click', (event) => {
        if (event.target && event.target.id === 'auth-modal') {
          this.hideAuthModal();
        }
      });

      document.addEventListener('click', (event) => {
        const target = event.target;

        if (target.closest('#sign-in-btn')) return this.showAuthModal('sign-in');
        if (target.closest('#sign-out-btn')) return this.signOut();
        if (target.closest('#apply-filters-btn')) return this.applyFilters();
        if (target.closest('#clear-filters-btn')) return this.clearFilters();
        if (target.closest('#back-to-catalog-btn')) return this.navigateTo('catalog');
        if (target.closest('#place-order-btn')) return this.placeOrder();
        if (target.closest('[data-action="toggle-cart"]')) return this.toggleCart();
        if (target.closest('[data-action="go-checkout"]')) return this.navigateTo('checkout');
        if (target.closest('[data-action="auth-cancel"]')) return this.hideAuthModal();

        const authTab = target.closest('.auth-tab');
        if (authTab && authTab.dataset.tab) {
          return this.switchAuthTab(authTab.dataset.tab);
        }

        const addBtn = target.closest('[data-action="add-to-cart"]');
        if (addBtn) return this.addToCart(addBtn.dataset.skuid);

        const removeBtn = target.closest('[data-action="remove-from-cart"]');
        if (removeBtn) return this.removeFromCart(removeBtn.dataset.skuid);

        const qtyBtn = target.closest('[data-action="cart-qty"]');
        if (qtyBtn) {
          const delta = Number(qtyBtn.dataset.delta || 0);
          return this.updateCartQty(qtyBtn.dataset.skuid, delta);
        }

        // Order history actions
        const viewInvoiceBtn = target.closest('[data-action="view-invoice"]');
        if (viewInvoiceBtn) return this.downloadInvoice(viewInvoiceBtn.dataset.orderid);

        const reorderBtn = target.closest('[data-action="reorder"]');
        if (reorderBtn) return this.reorder(reorderBtn.dataset.orderid);

        const contactBtn = target.closest('[data-action="contact-farm"]');
        if (contactBtn) return this.showToast('Contact feature coming soon', 'info');
      });
    },

    setDefaultDeliveryDate() {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];
      const el = document.getElementById('delivery-date');
      if (el) el.value = dateStr;
      this.deliveryDate = dateStr;
    },

    loadAuthState() {
      try {
        const buyerRaw = localStorage.getItem(STORAGE_BUYER);
        this.currentBuyer = buyerRaw ? JSON.parse(buyerRaw) : null;
      } catch {
        this.currentBuyer = null;
      }

      this.updateBuyerProfile();
      this.populateCheckoutForm();
    },

    setActiveBuyer({ buyer, token }) {
      this.currentBuyer = buyer;
      localStorage.setItem(STORAGE_BUYER, JSON.stringify(buyer));
      this.token = token;
      this.updateBuyerProfile();
      this.populateCheckoutForm();
      this.loadOrders();
    },

    updateBuyerProfile() {
      const profile = document.getElementById('buyer-profile');
      const signInBtn = document.getElementById('sign-in-btn');
      const buyerLabel = document.getElementById('buyer-name-display');

      if (!profile || !signInBtn || !buyerLabel) return;

      if (this.currentBuyer) {
        buyerLabel.textContent = this.currentBuyer.businessName;
        profile.style.display = 'flex';
        signInBtn.style.display = 'none';
      } else {
        profile.style.display = 'none';
        signInBtn.style.display = 'inline-flex';
      }
    },

    populateCheckoutForm() {
      const nameField = document.getElementById('buyer-name');
      const emailField = document.getElementById('buyer-email');
      if (!nameField || !emailField) return;

      if (!this.currentBuyer) {
        nameField.value = '';
        emailField.value = '';
        return;
      }

      nameField.value = this.currentBuyer.businessName || '';
      emailField.value = this.currentBuyer.email || '';
    },

    showAuthModal(tab = 'sign-in') {
      this.switchAuthTab(tab);
      document.getElementById('auth-modal')?.classList.add('open');
    },

    hideAuthModal() {
      document.getElementById('auth-modal')?.classList.remove('open');
    },

    switchAuthTab(tab) {
      this.authTab = tab;
      document.querySelectorAll('.auth-tab').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
      });
      document.querySelectorAll('.auth-form').forEach((form) => {
        form.classList.toggle('active', form.id.includes(tab));
      });
    },

    async apiFetch(path, options = {}) {
      const headers = new Headers(options.headers || {});
      if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');
      if (this.token) headers.set('Authorization', `Bearer ${this.token}`);

      const response = await fetch(path, { ...options, headers });
      const json = await response.json().catch(() => null);
      return { response, json };
    },

    async handleRegister() {
      const businessName = document.getElementById('register-business-name').value.trim();
      const contactName = document.getElementById('register-contact-name').value.trim();
      const email = document.getElementById('register-email').value.trim().toLowerCase();
      const password = document.getElementById('register-password').value;
      const buyerType = document.getElementById('register-buyer-type').value;
      const postalCode = document.getElementById('register-postal')?.value?.trim() || '';
      const province = document.getElementById('register-province')?.value?.trim() || '';
      const latitudeRaw = document.getElementById('register-lat')?.value;
      const longitudeRaw = document.getElementById('register-lng')?.value;
      const latitude = latitudeRaw !== undefined && latitudeRaw !== '' ? Number(latitudeRaw) : null;
      const longitude = longitudeRaw !== undefined && longitudeRaw !== '' ? Number(longitudeRaw) : null;

      const location = {
        postalCode,
        province,
        latitude: Number.isFinite(latitude) ? latitude : null,
        longitude: Number.isFinite(longitude) ? longitude : null,
        country: 'Canada'
      };

      try {
        const { response, json } = await this.apiFetch('/api/wholesale/buyers/register', {
          method: 'POST',
          body: JSON.stringify({ businessName, contactName, email, password, buyerType, location })
        });

        if (!response.ok || json?.status !== 'ok') {
          this.showToast(json?.message || 'Registration failed', 'error');
          return;
        }

        this.setActiveBuyer({ buyer: json.data.buyer, token: json.data.token });
        this.hideAuthModal();
        this.showToast('Account created. Welcome to GreenReach!', 'success');
      } catch (error) {
        console.error('Register error:', error);
        this.showToast('Network error registering', 'error');
      }
    },

    async handleSignIn() {
      const email = document.getElementById('sign-in-email').value.trim().toLowerCase();
      const password = document.getElementById('sign-in-password').value;

      try {
        const { response, json } = await this.apiFetch('/api/wholesale/buyers/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });

        if (!response.ok || json?.status !== 'ok') {
          this.showToast(json?.message || 'Invalid email or password', 'error');
          return;
        }

        this.setActiveBuyer({ buyer: json.data.buyer, token: json.data.token });
        this.hideAuthModal();
        this.showToast('Signed in successfully', 'success');
      } catch (error) {
        console.error('Login error:', error);
        this.showToast('Network error signing in', 'error');
      }
    },

    signOut() {
      this.currentBuyer = null;
      this.token = '';
      localStorage.removeItem(STORAGE_BUYER);

      this.updateBuyerProfile();
      this.populateCheckoutForm();
      this.orders = [];
      this.renderOrders();
      this.showToast('Signed out', 'info');
      this.navigateTo('catalog');
    },

    getFilterState() {
      return {
        certifications: Array.from(document.querySelectorAll('input[name="cert"]:checked')).map((cb) => cb.value),
        practices: Array.from(document.querySelectorAll('input[name="practice"]:checked')).map((cb) => cb.value),
        attributes: Array.from(document.querySelectorAll('input[name="attribute"]:checked')).map((cb) => cb.value)
      };
    },

    navigateTo(view) {
      if ((view === 'checkout' || view === 'orders') && !this.currentBuyer) {
        this.showToast('Please sign in to access buyer-only tools', 'info');
        this.showAuthModal('sign-in');
        return;
      }

      this.currentView = view;

      document.querySelectorAll('.nav-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.view === view);
      });

      document.querySelectorAll('.view').forEach((section) => {
        section.classList.toggle('active', section.id === `${view}-view`);
      });

      if (view === 'checkout') this.previewAllocation();
      if (view === 'orders') this.loadOrders();
    },

    async loadCatalog() {
      const filters = this.getFilterState();

      if (!this.demoMode) {
        try {
          const params = new URLSearchParams();
          if (this.deliveryDate) params.append('delivery_date', this.deliveryDate);
          filters.certifications.forEach((cert) => params.append('certifications', cert));
          filters.practices.forEach((practice) => params.append('practices', practice));
          filters.attributes.forEach((attr) => params.append('attributes', attr));

          const sourcing = this.getSourcingSelection();
          if (sourcing.mode === 'single_farm' && sourcing.farm_id) {
            params.append('farmId', sourcing.farm_id);
          }

          const buyerLoc = this.getBuyerLatLng();
          if (buyerLoc) {
            params.append('nearLat', String(buyerLoc.latitude));
            params.append('nearLng', String(buyerLoc.longitude));
          }

          const response = await fetch(`/api/wholesale/catalog?${params.toString()}`);
          const data = await response.json();

          if (data.status === 'ok' && data.data?.skus) {
            this.catalog = data.data.skus;
            this.renderCatalog();
            this.updateDemoBanner();
            return;
          }

          await this.enableDemoMode('Live catalog unavailable. Showing demo farms.');
          return;
        } catch (error) {
          console.error('Live catalog error:', error);
          await this.enableDemoMode('Network issue detected. Showing demo farms.');
          return;
        }
      }

      await this.loadDemoCatalog(filters);
    },

    async loadDemoCatalog(filters) {
      if (!this.demoData) {
        const response = await fetch('/data/wholesale-demo-catalog.json');
        this.demoData = await response.json();
        this.farmDirectory = (this.demoData.farms || []).reduce((acc, farm) => {
          acc[farm.farm_id] = farm;
          return acc;
        }, {});
      }

      const items = this.applyDemoFilters(filters);
      this.catalog = items.map((item) => this.mapDemoSku(item));
      this.renderCatalog();
      this.updateDemoBanner();
    },

    applyDemoFilters(filters) {
      if (!this.demoData) return [];

      const hasFilters = filters.certifications.length || filters.practices.length || filters.attributes.length;
      if (!hasFilters) return this.demoData.items || [];

      const farmMatches = (farmId) => {
        const meta = this.farmDirectory[farmId] || {};

        if (filters.certifications.length && !filters.certifications.some((cert) => meta.certifications?.includes(cert))) return false;
        if (filters.practices.length && !filters.practices.some((practice) => meta.practices?.includes(practice))) return false;
        if (filters.attributes.length && !filters.attributes.some((attr) => meta.attributes?.includes(attr))) return false;
        return true;
      };

      return (this.demoData.items || []).filter((item) => (item.farms || []).some((farm) => farmMatches(farm.farm_id)));
    },

    mapDemoSku(item) {
      const farms = (item.farms || []).map((farm) => {
        const meta = this.farmDirectory[farm.farm_id] || {};
        return {
          farm_id: farm.farm_id,
          farm_name: farm.farm_name,
          qty_available: Number(farm.quantity_available || 0),
          unit: item.unit,
          price_per_unit: Number(farm.price_per_unit || 0),
          organic: Boolean(farm.organic),
          certifications: meta.certifications || [],
          practices: meta.practices || [],
          attributes: meta.attributes || [],
          location: meta.location || ''
        };
      });

      const totalQty = farms.reduce((sum, farm) => sum + Number(farm.qty_available || 0), 0);
      const bestPrice = farms.length ? Math.min(...farms.map((f) => Number(f.price_per_unit || 0))) : 0;

      return {
        sku_id: item.sku_id,
        product_name: item.product_name,
        size: item.size || 'Bulk Case',
        unit: item.unit,
        price_per_unit: bestPrice,
        total_qty_available: totalQty,
        farms,
        organic: farms.some((f) => f.organic)
      };
    },

    async enableDemoMode(message) {
      this.demoMode = true;
      if (message) this.showToast(message, 'info');
      await this.loadDemoCatalog(this.getFilterState());
    },

    updateDemoBanner() {
      const banner = document.getElementById('demo-banner');
      if (banner) banner.style.display = this.demoMode ? 'block' : 'none';
    },

    applyFilters() {
      this.loadCatalog();
    },

    clearFilters() {
      document.querySelectorAll('input[name="cert"]').forEach((cb) => (cb.checked = false));
      document.querySelectorAll('input[name="practice"]').forEach((cb) => (cb.checked = false));
      document.querySelectorAll('input[name="attribute"]').forEach((cb) => (cb.checked = false));
      this.loadCatalog();
    },

    renderCatalog() {
      const sortBy = document.getElementById('sort-by')?.value || 'name';
      const sorted = [...this.catalog].sort((a, b) => {
        switch (sortBy) {
          case 'price-low':
            return a.price_per_unit - b.price_per_unit;
          case 'price-high':
            return b.price_per_unit - a.price_per_unit;
          case 'availability':
            return b.total_qty_available - a.total_qty_available;
          default:
            return a.product_name.localeCompare(b.product_name);
        }
      });

      const grid = document.getElementById('catalog-grid');
      if (!grid) return;

      grid.innerHTML = sorted
        .map(
          (sku) => `
          <div class="sku-card">
            <div class="sku-header">
              <div class="sku-name">${sku.product_name}</div>
              ${sku.organic ? '<span class="sku-badge">Organic</span>' : ''}
            </div>
            <div class="sku-meta">
              <div class="sku-meta-row">
                <span class="sku-meta-label">Size:</span>
                <span>${sku.size || 'N/A'}</span>
              </div>
              <div class="sku-meta-row">
                <span class="sku-meta-label">Unit:</span>
                <span>${sku.unit}</span>
              </div>
              <div class="sku-meta-row">
                <span class="sku-meta-label">Price:</span>
                <span>$${Number(sku.price_per_unit).toFixed(2)}/${sku.unit}</span>
              </div>
              <div class="sku-meta-row">
                <span class="sku-meta-label">Available:</span>
                <span>${sku.total_qty_available} ${sku.unit}${sku.total_qty_available !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <div class="sku-farms">
              ${(sku.farms || []).map((f) => `<span class="farm-tag">${f.farm_name} (${f.qty_available} ${sku.unit})</span>`).join('')}
            </div>
            <div class="sku-actions">
              <input type="number" id="qty-${sku.sku_id}" min="0.1" step="0.1" max="${sku.total_qty_available}" value="1" />
              <button data-action="add-to-cart" data-skuid="${sku.sku_id}">Add to Cart</button>
            </div>
          </div>
        `
        )
        .join('');
    },

    addToCart(skuId) {
      const sku = this.catalog.find((s) => s.sku_id === skuId);
      if (!sku) return;

      const qtyInput = document.getElementById(`qty-${skuId}`);
      const qty = Number.parseFloat(qtyInput?.value || '1') || 1;
      if (qty <= 0) return;

      const existingItem = this.cart.find((item) => item.sku_id === skuId);
      if (existingItem) {
        existingItem.quantity = Math.min(existingItem.quantity + qty, sku.total_qty_available);
        if (existingItem.quantity === sku.total_qty_available) {
          this.showToast('Reached available inventory for this SKU', 'info');
        }
      } else {
        const safeQty = Math.min(qty, sku.total_qty_available);
        this.cart.push({ ...sku, quantity: safeQty });
        if (qty > safeQty) {
          this.showToast('Reduced quantity to match availability', 'info');
        }
      }

      this.renderCart();
      this.showToast(`Added ${sku.product_name} to cart`, 'success');
      if (qtyInput) qtyInput.value = '1';
    },

    removeFromCart(skuId) {
      this.cart = this.cart.filter((item) => item.sku_id !== skuId);
      this.renderCart();
      this.showToast('Removed from cart', 'info');
    },

    updateCartQty(skuId, delta) {
      const item = this.cart.find((i) => i.sku_id === skuId);
      if (!item) return;

      item.quantity = Number((Number(item.quantity) + Number(delta)).toFixed(2));
      if (item.quantity <= 0) {
        this.removeFromCart(skuId);
      } else if (item.quantity > item.total_qty_available) {
        item.quantity = item.total_qty_available;
        this.showToast('Maximum quantity reached', 'info');
      } else {
        this.renderCart();
      }
    },

    renderCart() {
      const itemsContainer = document.getElementById('cart-items');
      if (!itemsContainer) return;

      if (this.cart.length === 0) {
        itemsContainer.innerHTML = '<div class="cart-empty">Your cart is empty</div>';
        document.getElementById('cart-total').textContent = '$0.00';
        document.getElementById('cart-count').textContent = '0';
        return;
      }

      itemsContainer.innerHTML = this.cart
        .map(
          (item) => `
          <div class="cart-item">
            <div class="cart-item-header">
              <div class="cart-item-name">${item.product_name}</div>
              <button class="cart-item-remove" data-action="remove-from-cart" data-skuid="${item.sku_id}">&times;</button>
            </div>
            <div class="cart-item-meta">${item.size || ''} ${item.unit}</div>
            <div class="cart-item-meta">$${Number(item.price_per_unit).toFixed(2)} per ${item.unit}</div>
            <div class="cart-item-actions">
              <div class="cart-item-qty">
                <button data-action="cart-qty" data-skuid="${item.sku_id}" data-delta="-0.5">-</button>
                <span>${item.quantity}</span>
                <button data-action="cart-qty" data-skuid="${item.sku_id}" data-delta="0.5">+</button>
              </div>
              <div class="cart-item-price">$${(Number(item.price_per_unit) * Number(item.quantity)).toFixed(2)}</div>
            </div>
          </div>
        `
        )
        .join('');

      const total = this.cart.reduce((sum, item) => sum + Number(item.price_per_unit) * Number(item.quantity), 0);
      document.getElementById('cart-total').textContent = `$${total.toFixed(2)}`;
      document.getElementById('cart-count').textContent = this.cart.length.toString();
    },

    toggleCart() {
      document.getElementById('cart-panel')?.classList.toggle('open');
    },

    getRecurrence() {
      const cadence = document.getElementById('fulfillment-cadence')?.value || 'one_time';
      return {
        cadence,
        start_date: this.deliveryDate || this.getDefaultDeliveryDate()
      };
    },

    async previewAllocation() {
      if (this.cart.length === 0) {
        document.getElementById('allocation-preview').innerHTML = '<p>Your cart is empty</p>';
        return;
      }

      const previewContainer = document.getElementById('allocation-preview');
      previewContainer.innerHTML = '<p>Calculating optimal allocation...</p>';

      try {
        const sourcing = this.getSourcingSelection();
        const { response, json } = await this.apiFetch('/api/wholesale/checkout/preview', {
          method: 'POST',
          body: JSON.stringify({
            buyer_id: this.currentBuyer?.id,
            delivery_date: this.deliveryDate || this.getDefaultDeliveryDate(),
            delivery_address: {
              street: document.getElementById('delivery-address')?.value || 'TBD',
              city: document.getElementById('delivery-city')?.value || 'TBD',
              province: document.getElementById('delivery-province')?.value || 'ON',
              postalCode: document.getElementById('delivery-postal')?.value || 'TBD',
              country: 'Canada',
              instructions: document.getElementById('delivery-instructions')?.value || ''
            },
            recurrence: this.getRecurrence(),
            cart: this.cart.map((item) => ({ sku_id: item.sku_id, quantity: item.quantity })),
            allocation_strategy: 'cheapest',
            sourcing
          })
        });

        if (response.ok && json?.status === 'ok') {
          this.renderAllocationPreview(json.data);
          return;
        }

        previewContainer.innerHTML = `<p>Error: ${json?.message || 'Unable to allocate order'}</p>`;
      } catch (error) {
        console.error('Allocation preview error:', error);
        previewContainer.innerHTML = '<p>Failed to load allocation preview</p>';
      }
    },

    renderAllocationPreview(allocation) {
      const container = document.getElementById('allocation-preview');
      const cadence = allocation.recurrence?.cadence || this.getRecurrence().cadence;

      container.innerHTML = `
        <p style="margin-bottom: 0.75rem; color: var(--text-secondary);">Fulfillment cadence: <strong>${cadence.replace('_', ' ')}</strong></p>
        ${(allocation.farm_sub_orders || [])
          .map(
            (subOrder) => `
          <div class="allocation-farm">
            <div class="allocation-farm-header">
              <div class="allocation-farm-name">${subOrder.farm_name}</div>
              <div class="allocation-farm-total">$${Number(subOrder.subtotal).toFixed(2)}</div>
            </div>
            <div class="allocation-items">
              ${(subOrder.items || [])
                .map(
                  (item) => `
                <div class="allocation-item">
                  ${item.quantity} ${item.unit} × ${item.product_name} @ $${Number(item.price_per_unit).toFixed(2)}/${item.unit}
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        `
          )
          .join('')}
        <div class="cart-summary">
          <div class="cart-summary-row">
            <span>Broker fee (GreenReach):</span>
            <span>$${Number(allocation.broker_fee_total || 0).toFixed(2)}</span>
          </div>
          <div class="cart-summary-row total">
            <span>Total:</span>
            <span>$${Number(allocation.grand_total).toFixed(2)}</span>
          </div>
        </div>
      `;
    },

    async placeOrder() {
      if (this.cart.length === 0) {
        this.showToast('Cart is empty', 'error');
        return;
      }

      if (!this.currentBuyer) {
        this.showAuthModal('sign-in');
        this.showToast('Sign in before placing an order', 'info');
        return;
      }

      const form = document.getElementById('checkout-form');
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      this.showLoading('Processing your order...');

      try {
        const sourcing = this.getSourcingSelection();
        const { response, json } = await this.apiFetch('/api/wholesale/checkout/execute', {
          method: 'POST',
          body: JSON.stringify({
            buyer_id: this.currentBuyer?.id,
            buyer_account: {
              name: document.getElementById('buyer-name').value,
              email: document.getElementById('buyer-email').value
            },
            delivery_date: this.deliveryDate || this.getDefaultDeliveryDate(),
            delivery_address: {
              street: document.getElementById('delivery-address').value,
              city: document.getElementById('delivery-city').value,
              province: document.getElementById('delivery-province')?.value || 'ON',
              postalCode: document.getElementById('delivery-postal').value,
              country: 'Canada',
              instructions: document.getElementById('delivery-instructions').value
            },
            recurrence: this.getRecurrence(),
            cart: this.cart.map((item) => ({ sku_id: item.sku_id, quantity: item.quantity })),
            allocation_strategy: 'cheapest',
            payment_provider: 'square',
            payment_source: { type: 'demo', nonce: `demo-${Date.now()}` },
            sourcing
          })
        });

        this.hideLoading();

        if (!response.ok || json?.status !== 'ok') {
          this.showToast(`Order failed: ${json?.message || 'Unknown error'}`, 'error');
          return;
        }

        this.orders = [json.data, ...this.orders];
        this.cart = [];
        this.renderCart();
        this.navigateTo('orders');
        this.showToast('Order placed successfully!', 'success');
      } catch (error) {
        this.hideLoading();
        console.error('Place order error:', error);
        this.showToast('Network error placing order', 'error');
      }
    },

    async loadOrders() {
      if (!this.currentBuyer) {
        this.renderOrders();
        return;
      }

      try {
        const { response, json } = await this.apiFetch('/api/wholesale/orders');
        if (response.ok && json?.status === 'ok') {
          this.orders = json.data.orders || [];
          this.renderOrders();
          return;
        }
      } catch (error) {
        console.error('Load orders error:', error);
      }

      this.renderOrders();
    },

    renderOrders() {
      const container = document.getElementById('orders-list');
      if (!container) return;

      if (!this.currentBuyer) {
        container.innerHTML = `
          <div class="order-empty">
            <div class="order-empty-icon">🔒</div>
            <p>Please sign in to view your order history.</p>
          </div>
        `;
        return;
      }

      if (!this.orders.length) {
        container.innerHTML = `
          <div class="order-empty">
            <div class="order-empty-icon">📦</div>
            <p>No orders yet. Start shopping to place your first wholesale order!</p>
          </div>
        `;
        return;
      }

      container.innerHTML = this.orders
        .map((order) => {
          const allItems = (order.farm_sub_orders || []).flatMap((sub) => sub.items || []);
          const trackingAvailable = (order.farm_sub_orders || []).some((sub) => sub.tracking_number);
          
          return `
          <div class="order-card">
            <div class="order-header">
              <div class="order-id">Order #${order.master_order_id.substring(0, 8)}</div>
              <div class="order-status ${order.status}">${order.status}</div>
            </div>
            
            <div class="order-meta">
              <div class="order-meta-item">
                <div class="order-meta-label">Order Date</div>
                <div class="order-meta-value">${new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
              </div>
              <div class="order-meta-item">
                <div class="order-meta-label">Delivery Date</div>
                <div class="order-meta-value">${new Date(order.delivery_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
              </div>
              <div class="order-meta-item">
                <div class="order-meta-label">Order Total</div>
                <div class="order-meta-value">$${Number(order.grand_total).toFixed(2)}</div>
              </div>
              <div class="order-meta-item">
                <div class="order-meta-label">Fulfillment</div>
                <div class="order-meta-value">${(order.recurrence?.cadence || 'one_time').replace('_', ' ')}</div>
              </div>
              ${order.delivery_address ? `
              <div class="order-meta-item">
                <div class="order-meta-label">Delivery Address</div>
                <div class="order-meta-value">${order.delivery_address.street}, ${order.delivery_address.city} ${order.delivery_address.province || ''} ${order.delivery_address.postalCode || order.delivery_address.zip || ''}</div>
              </div>
              ` : ''}
            </div>

            ${allItems.length > 0 ? `
            <div class="order-items">
              <div class="order-items-title">Order Items (${allItems.length})</div>
              ${allItems.map((item) => `
                <div class="order-item">
                  <div>
                    <div class="order-item-name">${item.product_name}</div>
                    <div class="order-item-details">
                      ${item.quantity} ${item.unit} × $${Number(item.price_per_unit).toFixed(2)}
                      ${item.size ? ` • ${item.size}` : ''}
                    </div>
                  </div>
                  <div class="order-item-price">$${(Number(item.quantity) * Number(item.price_per_unit)).toFixed(2)}</div>
                </div>
              `).join('')}
            </div>
            ` : ''}

            <div class="order-farms">
              <div class="order-farms-title">Fulfillment by Farm ${trackingAvailable ? '• Tracking Available' : ''}</div>
              ${(order.farm_sub_orders || [])
                .map((subOrder) => `
                <div class="order-farm-item">
                  <div style="flex: 1;">
                    <div class="order-farm-name">${subOrder.farm_name || 'Farm'}</div>
                    <div class="order-farm-status">
                      ${(subOrder.items || []).length} item(s) • Status: ${subOrder.status || 'pending'}
                    </div>
                    ${subOrder.tracking_number ? `
                    <div class="order-farm-tracking">
                      <div class="order-farm-tracking-label">📦 Tracking Number</div>
                      <div class="order-farm-tracking-number">
                        ${subOrder.tracking_number}
                        ${subOrder.tracking_carrier ? `
                        <a href="${this.getTrackingUrl(subOrder.tracking_carrier, subOrder.tracking_number)}" 
                           target="_blank" 
                           class="order-farm-tracking-link">
                          Track Package →
                        </a>
                        ` : ''}
                      </div>
                    </div>
                    ` : ''}
                  </div>
                  <div class="order-farm-total">$${Number(subOrder.subtotal).toFixed(2)}</div>
                </div>
              `).join('')}
            </div>

            <div class="order-actions">
              <button class="order-action-btn" data-action="view-invoice" data-orderid="${order.master_order_id}">
                📄 Download Invoice
              </button>
              <button class="order-action-btn" data-action="reorder" data-orderid="${order.master_order_id}">
                🔄 Reorder
              </button>
              ${order.status === 'pending' || order.status === 'confirmed' ? `
              <button class="order-action-btn" data-action="contact-farm" data-orderid="${order.master_order_id}">
                💬 Contact Farms
              </button>
              ` : ''}
            </div>
          </div>
        `;
        })
        .join('');
    },

    getTrackingUrl(carrier, trackingNumber) {
      const carriers = {
        usps: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`,
        ups: `https://www.ups.com/track?tracknum=${trackingNumber}`,
        fedex: `https://www.fedex.com/fedextrack/?tracknumbers=${trackingNumber}`,
        dhl: `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`
      };
      return carriers[carrier.toLowerCase()] || '#';
    },

    async downloadInvoice(orderId) {
      try {
        this.showLoading('Generating invoice...');
        
        const { response, json } = await this.apiFetch(`/api/wholesale/orders/${orderId}/invoice`);
        
        if (response.ok && json?.status === 'ok') {
          // Create downloadable file from invoice data
          const invoiceData = json.data;
          const blob = new Blob([JSON.stringify(invoiceData, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `invoice-${orderId.substring(0, 8)}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          
          this.hideLoading();
          this.showToast('Invoice downloaded', 'success');
        } else {
          this.hideLoading();
          this.showToast('Invoice not available', 'error');
        }
      } catch (error) {
        this.hideLoading();
        console.error('Download invoice error:', error);
        this.showToast('Failed to download invoice', 'error');
      }
    },

    async reorder(orderId) {
      try {
        const order = this.orders.find((o) => o.master_order_id === orderId);
        if (!order) {
          this.showToast('Order not found', 'error');
          return;
        }

        // Extract all items from farm sub-orders
        const allItems = (order.farm_sub_orders || []).flatMap((sub) => sub.items || []);
        
        if (allItems.length === 0) {
          this.showToast('No items to reorder', 'error');
          return;
        }

        // Add items to cart
        let addedCount = 0;
        for (const item of allItems) {
          // Check if item is still available in catalog
          const catalogItem = this.catalog.find((c) => c.sku_id === item.sku_id);
          if (catalogItem) {
            this.addToCart(item.sku_id, item.quantity);
            addedCount++;
          }
        }

        if (addedCount > 0) {
          this.showToast(`${addedCount} item(s) added to cart`, 'success');
          this.navigateTo('catalog');
          this.toggleCart();
        } else {
          this.showToast('Items no longer available', 'info');
        }
      } catch (error) {
        console.error('Reorder error:', error);
        this.showToast('Failed to reorder', 'error');
      }
    },

    getDefaultDeliveryDate() {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().split('T')[0];
    },

    showLoading(message = 'Loading...') {
      const overlay = document.createElement('div');
      overlay.className = 'loading-overlay';
      overlay.id = 'loading-overlay';
      overlay.innerHTML = `
        <div class="loading-content">
          <div class="loading-spinner"></div>
          <p>${message}</p>
        </div>
      `;
      document.body.appendChild(overlay);
    },

    hideLoading() {
      document.getElementById('loading-overlay')?.remove();
    },

    showToast(message, type = 'info') {
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }
    ,

    setupSourcingControls() {
      const mode = document.getElementById('sourcing-mode')?.value || 'auto_network';
      const filter = document.getElementById('single-farm-filter');
      if (filter) filter.style.display = mode === 'single_farm' ? 'block' : 'none';
    },

    getSourcingSelection() {
      const mode = document.getElementById('sourcing-mode')?.value || 'auto_network';
      const farmId = document.getElementById('single-farm-id')?.value || '';

      if (mode === 'single_farm' && farmId) {
        return { mode: 'single_farm', farm_id: farmId };
      }

      return { mode: 'auto_network' };
    },

    getBuyerLatLng() {
      const loc = this.currentBuyer?.location || null;
      if (!loc) return null;
      const latitude = Number(loc.latitude);
      const longitude = Number(loc.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) return { latitude, longitude };
      return null;
    },

    async loadNetworkFarms() {
      const select = document.getElementById('single-farm-id');
      if (!select) return;

      try {
        const response = await fetch('/api/wholesale/network/farms');
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.status !== 'ok') throw new Error('network/farms unavailable');

        this.networkFarms = data.data?.farms || [];

        const opts = ['<option value="">Select a farm...</option>']
          .concat(
            this.networkFarms
              .filter((f) => f?.status !== 'inactive')
              .map((f) => `<option value="${String(f.farm_id)}">${String(f.farm_name || f.farm_id)}</option>`)
          )
          .join('');

        select.innerHTML = opts;
      } catch (error) {
        console.warn('Failed to load network farms:', error);
        select.innerHTML = '<option value="">Farms unavailable</option>';
      }
    },

    /**
     * Load buyer insights dashboard
     */
    async loadBuyerInsights() {
      if (!this.currentBuyer) return;
      
      await Promise.all([
        this.loadDemandTrends(),
        this.loadPriceAlerts(),
        this.loadEnvironmentalImpact()
      ]);
    },

    /**
     * Load demand trends (4-week rolling)
     */
    async loadDemandTrends() {
      const demandContent = document.getElementById('demand-content');
      
      // Generate demo trend data based on current catalog
      const trends = [
        {
          rank: 1,
          productName: 'Butterhead Lettuce',
          orders: 47,
          trend: 'up',
          trendPercent: 23,
          avgWeekly: 12
        },
        {
          rank: 2,
          productName: 'Sweet Basil',
          orders: 38,
          trend: 'up',
          trendPercent: 15,
          avgWeekly: 9
        },
        {
          rank: 3,
          productName: 'Curly Kale',
          orders: 35,
          trend: 'stable',
          trendPercent: 2,
          avgWeekly: 9
        },
        {
          rank: 4,
          productName: 'Cherry Tomatoes',
          orders: 29,
          trend: 'down',
          trendPercent: -8,
          avgWeekly: 7
        },
        {
          rank: 5,
          productName: 'Arugula',
          orders: 24,
          trend: 'up',
          trendPercent: 12,
          avgWeekly: 6
        }
      ];

      const html = trends.map(item => {
        const trendIcon = item.trend === 'up' ? '↑' : item.trend === 'down' ? '↓' : '→';
        const trendClass = `trending-${item.trend}`;
        const trendText = item.trend === 'up' 
          ? `+${item.trendPercent}%` 
          : item.trend === 'down'
          ? `${item.trendPercent}%`
          : 'Stable';

        return `
          <div class="demand-item">
            <div class="demand-rank">${item.rank}</div>
            <div class="demand-info">
              <div class="demand-name">${item.productName}</div>
              <div class="demand-stats">${item.orders} orders • ${item.avgWeekly} per week avg</div>
            </div>
            <div class="demand-trend ${trendClass}">
              ${trendIcon} ${trendText}
            </div>
          </div>
        `;
      }).join('');

      demandContent.innerHTML = html || '<div class="loading-state">No trend data available</div>';
    },

    /**
     * Load price anomaly alerts with news summaries
     */
    async loadPriceAlerts() {
      const priceContent = document.getElementById('price-content');
      
      // Generate demo price alerts with AI-style news summaries
      const alerts = [
        {
          product: 'Tomatoes',
          change: '+18%',
          type: 'increase',
          currentPrice: 3.95,
          previousPrice: 3.35,
          summary: 'Unseasonable frost in California\'s Central Valley has reduced tomato yields by 30%. Supply chain disruptions from recent storms continue to impact distribution. Prices expected to normalize in 2-3 weeks as alternative sources come online.'
        },
        {
          product: 'Lettuce (Iceberg)',
          change: '-12%',
          type: 'decrease',
          currentPrice: 2.20,
          previousPrice: 2.50,
          summary: 'Increased local greenhouse production from Ontario farms has improved availability. Consistent growing conditions have extended production season. Competitive pricing as regional farms increase capacity.'
        }
      ];

      const html = alerts.map(alert => {
        const alertClass = `anomaly-${alert.type}`;
        const changeColor = alert.type === 'increase' ? 'color: var(--warning)' : 'color: var(--info)';
        
        return `
          <div class="price-alert ${alertClass}">
            <div class="price-alert-header">
              <span class="price-alert-product">${alert.product}</span>
              <span class="price-change" style="${changeColor}">${alert.change}</span>
            </div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.5rem;">
              $${alert.previousPrice.toFixed(2)} → $${alert.currentPrice.toFixed(2)} per unit
            </div>
            <div class="price-alert-summary">
              ${alert.summary}
            </div>
          </div>
        `;
      }).join('');

      priceContent.innerHTML = html || '<div class="loading-state">All prices stable</div>';
    },

    /**
     * Calculate environmental impact based on buyer and farm locations
     */
    async loadEnvironmentalImpact() {
      const impactContent = document.getElementById('impact-content');
      const impactScore = document.getElementById('impact-score');
      
      if (!this.currentBuyer?.location) {
        impactContent.innerHTML = '<div class="loading-state">Buyer location required</div>';
        return;
      }

      // Get farms with coordinates
      let farmsInCatalog = [];
      
      // Try demo farm data first if in demo mode
      if (this.demoMode && this.demoData?.farms) {
        farmsInCatalog = this.demoData.farms
          .filter(f => f.latitude && f.longitude)
          .map(f => ({
            farm_id: f.farm_id,
            farm_name: f.name,
            city: f.location || '',
            state: '',
            latitude: f.latitude,
            longitude: f.longitude
          }));
      }
      
      // If no demo farms, try admin API
      if (farmsInCatalog.length === 0) {
        try {
          const response = await fetch('/api/admin/farms?status=active');
          const data = await response.json();
          
          if (data.farms && data.farms.length > 0) {
            farmsInCatalog = data.farms
              .filter(f => f.location && f.location.lat && f.location.lng)
              .map(f => ({
                farm_id: f.farmId,
                farm_name: f.name,
                city: f.address?.city || '',
                state: f.address?.state || '',
                latitude: f.location.lat,
                longitude: f.location.lng
              }));
          }
        } catch (error) {
          console.warn('Failed to load farms from admin API:', error);
        }
      }
      
      // Fallback to Kingston-based demo farm if no farms found
      if (farmsInCatalog.length === 0) {
        farmsInCatalog = [
          { 
            farm_id: 'GR-00001', 
            farm_name: 'Demo Farm - Light Engine Showcase', 
            city: 'Kingston', 
            state: 'ON', 
            latitude: 44.2312, 
            longitude: -76.4860
          }
        ];
      }

      // Calculate distances from buyer to each farm
      const buyerLat = this.currentBuyer.location.latitude;
      const buyerLng = this.currentBuyer.location.longitude;

      const farmDistances = farmsInCatalog.map(farm => {
        const distance = this.calculateDistance(
          buyerLat,
          buyerLng,
          farm.latitude || 44.2312,
          farm.longitude || -76.4860
        );
        
        return {
          ...farm,
          distance: distance
        };
      });

      // Calculate weighted average distance for multi-farm orders
      const avgDistance = farmDistances.reduce((sum, f) => sum + f.distance, 0) / farmDistances.length;
      
      // California baseline (from California Central Valley to buyer)
      const californiaDistance = this.calculateDistance(
        buyerLat,
        buyerLng,
        36.7783, // California Central Valley
        -119.4179
      );

      // Calculate carbon savings
      // Assume 0.161 kg CO2 per km per delivery (light truck)
      const carbonPerKm = 0.161;
      const yourCarbon = avgDistance * carbonPerKm;
      const californiaCarbon = californiaDistance * carbonPerKm;
      const carbonSavings = californiaCarbon - yourCarbon;
      const savingsPercent = ((carbonSavings / californiaCarbon) * 100).toFixed(0);

      // Calculate grade
      let grade = 'C';
      let gradeClass = 'grade-c';
      if (avgDistance < 100) {
        grade = 'A+';
        gradeClass = 'grade-a';
      } else if (avgDistance < 250) {
        grade = 'B';
        gradeClass = 'grade-b';
      } else if (avgDistance < 500) {
        grade = 'C';
        gradeClass = 'grade-c';
      } else {
        grade = 'D';
        gradeClass = 'grade-d';
      }

      // Update score badge
      impactScore.textContent = grade;
      impactScore.className = `impact-score ${gradeClass}`;

      const html = `
        <div class="impact-metric">
          <span class="impact-label">Average Farm Distance</span>
          <span class="impact-value">${avgDistance.toFixed(0)} km</span>
        </div>
        <div class="impact-metric">
          <span class="impact-label">Est. Carbon per Delivery</span>
          <span class="impact-value">${yourCarbon.toFixed(1)} kg CO₂</span>
        </div>
        <div class="impact-metric">
          <span class="impact-label">Farms Supplying Your Orders</span>
          <span class="impact-value">${farmDistances.length} ${farmDistances.length === 1 ? 'farm' : 'farms'}</span>
        </div>
        <div class="impact-comparison">
          <div class="comparison-text">
            ${carbonSavings > 0 
              ? `You're saving <span class="comparison-highlight">${carbonSavings.toFixed(1)} kg CO₂ (${savingsPercent}%)</span> per delivery vs. California produce!` 
              : `California produce would save ${Math.abs(carbonSavings).toFixed(1)} kg CO₂ per delivery.`
            }
          </div>
          <div class="comparison-text" style="margin-top: 0.5rem; font-size: 0.8rem;">
            California baseline: ${californiaDistance.toFixed(0)} km • ${californiaCarbon.toFixed(1)} kg CO₂
          </div>
          ${farmDistances.length > 1 ? `
            <div class="comparison-text" style="margin-top: 0.75rem; font-size: 0.8rem; padding-top: 0.75rem; border-top: 1px solid var(--border);">
              <strong>Multi-farm fulfillment:</strong> Your orders may be split across multiple farms to optimize freshness and availability. Combined carbon footprint is calculated from weighted average distances.
            </div>
          ` : ''}
        </div>
      `;

      impactContent.innerHTML = html;
    },

    /**
     * Calculate distance between two coordinates (Haversine formula)
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
      const R = 6371; // Earth's radius in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    app.init();
  });
})();
