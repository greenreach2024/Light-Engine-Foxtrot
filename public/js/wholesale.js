(() => {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function safeUrl(value) {
    if (!value) return '#';
    try {
      const parsed = new URL(String(value), window.location.origin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.href;
      }
    } catch {
      return '#';
    }
    return '#';
  }

  function safeClassToken(value) {
    return String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'unknown';
  }

  const STORAGE_TOKEN = 'greenreach_wholesale_token';
  const STORAGE_BUYER = 'greenreach_wholesale_buyer';
  const STORAGE_CART_PREFIX = 'greenreach_wholesale_cart';
  const STORAGE_CART_LEGACY = 'greenreach_wholesale_cart';

  function cartStorageKey(buyerId) {
    const scope = buyerId ? String(buyerId) : 'anon';
    return `${STORAGE_CART_PREFIX}:${scope}`;
  }

  const app = window.app = {
    catalog: [],
    cart: [],
    orders: [],
    currentView: 'catalog',
    deliveryDate: null,
    demoMode: false, // Default to live mode - use ?demo=1 for demo data
    demoData: null,
    farmDirectory: {},
    networkFarms: [],
    farmPerformance: {},
    currentBuyer: null,
    authTab: 'sign-in',
    productRequests: [],
    deliveryQuote: null,
    selectedFulfillment: 'delivery',
    priceWatchState: {
      alerts: [],
      result: null,
    },

    normalizeBuyer(buyer) {
      if (!buyer) return null;
      let location = buyer.location || buyer.location_json || {};
      if (typeof location === 'string') {
        try {
          location = JSON.parse(location);
        } catch {
          location = {};
        }
      }
      if (!location || typeof location !== 'object') location = {};

      const coords = this.extractCoordinates(location);
      if (coords) {
        location = {
          ...location,
          latitude: coords.latitude,
          longitude: coords.longitude
        };
      }

      return {
        id: buyer.id,
        businessName: buyer.businessName || buyer.business_name,
        contactName: buyer.contactName || buyer.contact_name,
        email: buyer.email,
        buyerType: buyer.buyerType || buyer.buyer_type,
        phone: buyer.phone || location.phone || buyer.contact_phone,
        keyContact: buyer.keyContact || buyer.key_contact || null,
        backupContact: buyer.backupContact || buyer.backup_contact || null,
        backupPhone: buyer.backupPhone || buyer.backup_phone || null,
        squareCustomerId: buyer.squareCustomerId || buyer.square_customer_id || null,
        squareCardId: buyer.squareCardId || buyer.square_card_id || null,
        location,
        createdAt: buyer.createdAt || buyer.created_at
      };
    },

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

      await this.loadAuthState();

      // Migrate any legacy un-scoped cart into the anonymous bucket so it
      // never leaks into a freshly registered buyer's session.
      this.migrateLegacyCart();

      // Load the cart scoped to the current buyer (or anonymous).
      this.loadCart();
      
      // No auto-login - require real authentication
      
      this.setupEventListeners();
      this.setDefaultDeliveryDate();

      this.setupSourcingControls();
      await this.loadNetworkFarms();
      await this.loadFarmPerformance();

      await this.loadCatalog();
      await this.loadOrders();
      this.renderCart();
      this.updateDemoBanner();
      
      // Load insights after all data is ready
      await this.loadBuyerInsights();

      // Initialize Square payment form (non-blocking)
      this.initializeSquare();
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

      // Fulfillment method radio toggle (pickup vs delivery)
      document.querySelectorAll('input[name="fulfillment"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
          this.selectedFulfillment = e.target.value;
          const deliveryFields = document.getElementById('delivery-fields');
          const pickupInfo = document.getElementById('pickup-info');
          if (e.target.value === 'pickup') {
            if (deliveryFields) deliveryFields.classList.add('hidden');
            if (pickupInfo) pickupInfo.classList.remove('hidden');
            this.deliveryQuote = null;
            const feeEl = document.getElementById('delivery-fee-display');
            if (feeEl) feeEl.textContent = '—';
            if (this.currentView === 'checkout') this.previewAllocation();
          } else {
            if (deliveryFields) deliveryFields.classList.remove('hidden');
            if (pickupInfo) pickupInfo.classList.add('hidden');
            this.refreshDeliveryQuote();
          }
        });
      });

      // Refresh quote when postal code changes
      document.getElementById('delivery-postal')?.addEventListener('change', () => {
        if (this.selectedFulfillment === 'delivery') this.refreshDeliveryQuote();
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

      document.getElementById('register-postal')?.addEventListener('blur', () => {
        this.populateRegistrationCoordinates().catch(() => {});
      });

      document.getElementById('register-province')?.addEventListener('change', () => {
        this.populateRegistrationCoordinates().catch(() => {});
      });

      document.getElementById('account-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        this.saveAccountSettings();
      });

      document.getElementById('password-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        this.updatePassword();
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
        if (contactBtn) return this.contactFarms(contactBtn.dataset.orderid);

        if (target.closest('[data-action="open-price-watch-modal"]')) return this.openPriceWatchModal();
        if (target.closest('[data-action="close-price-watch-modal"]')) return this.closePriceWatchModal();
        if (target.id === 'price-watch-modal') return this.closePriceWatchModal();
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

    async loadAuthState() {
      const token = localStorage.getItem(STORAGE_TOKEN);
      if (!token) {
        this.currentBuyer = null;
        return;
      }
      
      try {
        const response = await fetch('/api/wholesale/buyers/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
          const result = await response.json();
          const buyer = result.data?.buyer;
          if (buyer) {
            this.token = token;
            this.currentBuyer = this.normalizeBuyer(buyer);
            this.updateBuyerProfile();
            this.populateCheckoutForm();
          }
        } else {
          // Token invalid, clear it
          localStorage.removeItem(STORAGE_TOKEN);
          this.currentBuyer = null;
        }
      } catch (error) {
        console.error('Error loading auth state:', error);
        this.currentBuyer = null;
      }
    },

    setActiveBuyer({ buyer, token }) {
      const normalized = this.normalizeBuyer(buyer);
      const previousBuyerId = this.currentBuyer?.id || null;
      const nextBuyerId = normalized?.id || null;
      const buyerChanged = previousBuyerId !== nextBuyerId;

      // Persist the current cart under the previous scope so the outgoing
      // buyer (or anonymous session) doesn't lose their work, then hand off
      // to the incoming buyer's scoped cart.
      if (buyerChanged) {
        this.saveCart();
        this.cart = [];
      }

      this.currentBuyer = normalized;
      localStorage.setItem(STORAGE_BUYER, JSON.stringify(normalized));
      this.token = token;
      this.updateBuyerProfile();
      this.populateCheckoutForm();
      this.loadOrders();
      this.loadBuyerInsights();
      this.updateDonationsTabVisibility();

      if (buyerChanged) {
        this.loadCart();
        this.renderCart();
      }
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
      let lat = latitudeRaw !== undefined && latitudeRaw !== '' ? Number(latitudeRaw) : null;
      let lng = longitudeRaw !== undefined && longitudeRaw !== '' ? Number(longitudeRaw) : null;

      const registrationLocation = {
        postalCode,
        province,
        state: province,
        country: 'Canada'
      };

      let coords = this.extractCoordinates({ latitude: lat, longitude: lng });
      if (!coords) {
        coords = await this.populateRegistrationCoordinates();
      }
      if (!coords) {
        coords = await this.geocodeCoordinates(registrationLocation);
      }
      if (coords) {
        lat = coords.latitude;
        lng = coords.longitude;
      }

      registrationLocation.latitude = Number.isFinite(lat) ? lat : null;
      registrationLocation.longitude = Number.isFinite(lng) ? lng : null;

      try {
        const response = await fetch('/api/wholesale/buyers/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessName,
            contactName,
            email,
            password,
            buyerType,
            location: registrationLocation
          })
        });

        const json = await response.json();

        if (!response.ok || json?.status !== 'ok') {
          this.showToast(json?.message || 'Registration failed', 'error');
          return;
        }

        // Registration successful - set buyer and token
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
        const response = await fetch('/api/wholesale/buyers/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const json = await response.json();

        if (!response.ok || json?.status !== 'ok') {
          this.showToast(json?.message || 'Invalid email or password', 'error');
          return;
        }

        // Login successful - set buyer and token
        this.setActiveBuyer({ buyer: json.data.buyer, token: json.data.token });
        this.hideAuthModal();
        this.showToast('Signed in successfully', 'success');
      } catch (error) {
        console.error('Login error:', error);
        this.showToast('Network error signing in', 'error');
      }
    },

    async signOut() {
      try {
        const token = localStorage.getItem(STORAGE_TOKEN);
        if (token) {
          await fetch('/api/wholesale/auth/logout', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
          });
        }
      } catch (error) {
        console.error('Logout error:', error);
      }
      
      this.currentBuyer = null;
      localStorage.removeItem(STORAGE_TOKEN);
      localStorage.removeItem(STORAGE_BUYER);

      // Drop the in-memory cart so the next visitor on this device (e.g.
      // a fresh registration) doesn't inherit the signed-out buyer's items.
      // Each buyer's cart is still persisted under its own namespaced key
      // and will be restored on next sign-in.
      this.cart = [];
      this.renderCart();

      this.updateBuyerProfile();
      this.populateCheckoutForm();
      this.orders = [];
      this.renderOrders();
      this.showToast('Signed out', 'info');
      this.loadBuyerInsights();
      this.updateDonationsTabVisibility();
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
      if ((view === 'checkout' || view === 'orders' || view === 'requests' || view === 'account' || view === 'donations') && !this.currentBuyer) {
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

      if (view === 'checkout') {
        this.updateCheckoutCardDisplay();
        this.previewAllocation();
        if (this.selectedFulfillment === 'delivery') this.refreshDeliveryQuote();
      }
      if (view === 'orders') this.loadOrders();
      if (view === 'requests') this.loadProductRequests();
      if (view === 'account') this.loadAccountSettings();
      if (view === 'donations') this.loadDonations();
    },

    async loadAccountSettings() {
      if (!this.currentBuyer) return;
      try {
        const { response, json } = await this.apiFetch('/api/wholesale/buyers/me');
        if (response.ok && json?.status === 'ok') {
          const buyer = this.normalizeBuyer(json.data.buyer);
          this.currentBuyer = buyer;
          localStorage.setItem(STORAGE_BUYER, JSON.stringify(buyer));
        }
      } catch (error) {
        console.error('Load account settings error:', error);
      }

      const b = this.currentBuyer;
      document.getElementById('account-business-name').value = b?.businessName || '';
      document.getElementById('account-contact-name').value = b?.contactName || '';
      document.getElementById('account-email').value = b?.email || '';
      document.getElementById('account-phone').value = b?.phone || '';
      document.getElementById('account-key-contact').value = b?.keyContact || '';
      document.getElementById('account-backup-contact').value = b?.backupContact || '';
      document.getElementById('account-backup-phone').value = b?.backupPhone || '';
      document.getElementById('account-address').value = b?.location?.address1 || b?.location?.street || '';
      document.getElementById('account-city').value = b?.location?.city || '';
      document.getElementById('account-province').value = b?.location?.state || b?.location?.province || '';
      document.getElementById('account-postal').value = b?.location?.postalCode || '';
      document.getElementById('account-buyer-type').value = b?.buyerType || 'restaurant';

      this.loadCardOnFile();
      this.loadSubscriptions();
    },

    async saveAccountSettings() {
      if (!this.currentBuyer) return this.showAuthModal('sign-in');

      const accountAddress = document.getElementById('account-address').value;
      const accountCity = document.getElementById('account-city').value;
      const accountProvince = document.getElementById('account-province').value;
      const accountPostalCode = document.getElementById('account-postal').value;
      const locationPayload = {
        address1: accountAddress,
        city: accountCity,
        state: accountProvince,
        province: accountProvince,
        postalCode: accountPostalCode,
        country: 'Canada'
      };

      let coords = this.getBuyerLatLng();
      if (!coords) {
        coords = await this.geocodeCoordinates(locationPayload);
      }

      const payload = {
        businessName: document.getElementById('account-business-name').value,
        contactName: document.getElementById('account-contact-name').value,
        email: document.getElementById('account-email').value,
        phone: document.getElementById('account-phone').value,
        keyContact: document.getElementById('account-key-contact').value,
        backupContact: document.getElementById('account-backup-contact').value,
        backupPhone: document.getElementById('account-backup-phone').value,
        address: accountAddress,
        city: accountCity,
        province: accountProvince,
        postalCode: accountPostalCode,
        buyerType: document.getElementById('account-buyer-type').value,
        country: 'Canada',
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        location: {
          ...locationPayload,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null
        }
      };

      try {
        const { response, json } = await this.apiFetch('/api/wholesale/buyers/me', {
          method: 'PUT',
          body: JSON.stringify(payload)
        });

        if (response.ok && json?.status === 'ok') {
          const buyer = this.normalizeBuyer(json.data.buyer);
          this.currentBuyer = buyer;
          localStorage.setItem(STORAGE_BUYER, JSON.stringify(buyer));
          this.updateBuyerProfile();
          this.populateCheckoutForm();
          this.showToast('Profile Updated Successfully', 'success', { prominent: true, detail: 'Your business information and contact details have been saved.', duration: 5000 });
        } else {
          this.showToast(json?.message || 'Failed to update account', 'error');
        }
      } catch (error) {
        console.error('Save account error:', error);
        this.showToast('Network error updating account', 'error');
      }
    },

    async updatePassword() {
      if (!this.currentBuyer) return this.showAuthModal('sign-in');

      const currentPassword = document.getElementById('current-password').value;
      const newPassword = document.getElementById('new-password').value;
      const confirmPassword = document.getElementById('confirm-password').value;

      if (newPassword !== confirmPassword) {
        this.showToast('New passwords do not match', 'error');
        return;
      }

      try {
        const { response, json } = await this.apiFetch('/api/wholesale/buyers/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newPassword })
        });

        if (response.ok && json?.status === 'ok') {
          this.showToast('Password updated', 'success');
          document.getElementById('current-password').value = '';
          document.getElementById('new-password').value = '';
          document.getElementById('confirm-password').value = '';
        } else {
          this.showToast(json?.message || 'Failed to update password', 'error');
        }
      } catch (error) {
        console.error('Update password error:', error);
        this.showToast('Network error updating password', 'error');
      }
    },

    // ── Card on file ───────────────────────────────────────────────────

    _accountSquareCard: null,

    async loadCardOnFile() {
      const noneEl = document.getElementById('card-on-file-none');
      const infoEl = document.getElementById('card-on-file-info');
      const addEl = document.getElementById('card-on-file-add');

      try {
        const { response, json } = await this.apiFetch('/api/wholesale/buyers/me/card');
        if (response.ok && json?.status === 'ok') {
          const cards = json.data.cards || [];
          if (cards.length > 0) {
            const c = cards[0];
            document.getElementById('card-brand').textContent = c.brand || 'Card';
            document.getElementById('card-last4').textContent = c.last4 || '****';
            document.getElementById('card-exp').textContent = (c.expMonth || '??') + '/' + (c.expYear || '????');
            if (noneEl) noneEl.style.display = 'none';
            if (infoEl) infoEl.style.display = '';
            if (addEl) addEl.style.display = 'none';
            const subBtn = document.getElementById('create-subscription-btn');
            if (subBtn) subBtn.style.display = '';
            return;
          }
        }
      } catch (error) {
        console.error('Load card on file error:', error);
      }

      // No card on file -- show the add-card form
      if (noneEl) noneEl.style.display = '';
      if (infoEl) infoEl.style.display = 'none';
      if (addEl) addEl.style.display = '';

      // Render the Square card input inside #sq-card-container
      this._initAccountCardForm();
    },

    async _initAccountCardForm() {
      const container = document.getElementById('sq-card-container');
      if (!container || this._accountSquareCard) return;

      if (!window.Square) {
        container.innerHTML = '<p style="color:var(--warm-text-muted,#888);">Payment form unavailable. Refresh to retry.</p>';
        return;
      }

      try {
        // Fetch Square credentials from server (same as checkout flow)
        const cfgRes = await fetch('/api/wholesale/payment/config');
        const cfgJson = await cfgRes.json();
        const appId = cfgJson?.data?.appId;
        const locationId = cfgJson?.data?.locationId;

        if (!appId || !locationId) {
          container.innerHTML = '<p style="color:var(--warm-text-muted,#888);">Square payments not configured for this farm.</p>';
          return;
        }

        const payments = window.Square.payments(appId, locationId);
        this._accountSquareCard = await payments.card();
        await this._accountSquareCard.attach('#sq-card-container');
      } catch (err) {
        console.error('Account card form init error:', err);
        container.innerHTML = '<p style="color:var(--warm-text-muted,#888);">Could not load card form. Refresh to retry.</p>';
      }
    },

    async saveCardOnFile() {
      if (!this.currentBuyer) return this.showAuthModal('sign-in');
      if (!this._accountSquareCard) {
        this.showToast('Card form not ready. Please wait and try again.', 'error');
        return;
      }

      const btn = document.getElementById('save-card-btn');
      if (btn) btn.disabled = true;

      try {
        const tokenResult = await this._accountSquareCard.tokenize();
        if (tokenResult.status !== 'OK') {
          this.showToast('Card verification failed: ' + (tokenResult.errors?.[0]?.message || 'Please check your card details'), 'error');
          return;
        }

        const { response, json } = await this.apiFetch('/api/wholesale/buyers/me/card', {
          method: 'POST',
          body: JSON.stringify({ cardNonce: tokenResult.token })
        });

        if (response.ok && json?.status === 'ok') {
          // Refresh buyer state so checkout detects the saved card
          if (json.data?.squareCustomerId) this.currentBuyer.squareCustomerId = json.data.squareCustomerId;
          if (json.data?.squareCardId) this.currentBuyer.squareCardId = json.data.squareCardId;
          localStorage.setItem(STORAGE_BUYER, JSON.stringify(this.currentBuyer));

          this.showToast('Payment Card Saved', 'success', { prominent: true, detail: 'Your card has been securely stored by Square for future orders.', duration: 5000 });
          // Destroy the form card instance and reload
          try { this._accountSquareCard.destroy(); } catch (_) {}
          this._accountSquareCard = null;
          this.loadCardOnFile();
        } else {
          this.showToast(json?.message || 'Failed to save card', 'error');
        }
      } catch (error) {
        console.error('Save card on file error:', error);
        this.showToast('Error saving card', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    },

    async removeCardOnFile() {
      if (!this.currentBuyer) return;
      if (!confirm('Remove your saved card?')) return;

      try {
        const { response, json } = await this.apiFetch('/api/wholesale/buyers/me/card', {
          method: 'DELETE'
        });

        if (response.ok && json?.status === 'ok') {
          // Clear card from buyer state so checkout falls back to card form
          this.currentBuyer.squareCardId = null;
          localStorage.setItem(STORAGE_BUYER, JSON.stringify(this.currentBuyer));

          this.showToast('Card Removed', 'success', { prominent: true, detail: 'Your saved payment card has been removed from file.', duration: 4000 });
          this.loadCardOnFile();
        } else {
          this.showToast(json?.message || 'Failed to remove card', 'error');
        }
      } catch (error) {
        console.error('Remove card error:', error);
        this.showToast('Error removing card', 'error');
      }
    },

    // ── Subscriptions / standing orders ────────────────────────────────

    async loadSubscriptions() {
      try {
        const { response, json } = await this.apiFetch('/api/wholesale/buyers/me/subscriptions');
        if (response.ok && json?.status === 'ok') {
          const subs = json.data.subscriptions || [];
          const noneEl = document.getElementById('subscriptions-none');
          const listEl = document.getElementById('subscriptions-items');
          if (subs.length > 0) {
            if (noneEl) noneEl.style.display = 'none';
            if (listEl) {
              listEl.innerHTML = subs.map(s => {
                const statusBadge = s.status === 'active'
                  ? '<span style="color:var(--warm-success,green);">Active</span>'
                  : '<span style="color:var(--warm-text-muted,#888);">' + (s.status || 'Unknown') + '</span>';
                const itemCount = (s.cart || []).length;
                return '<div style="border:1px solid var(--warm-border,#ddd);border-radius:8px;padding:1rem;margin-bottom:0.75rem;">'
                  + '<div style="display:flex;justify-content:space-between;align-items:center;">'
                  + '<div><strong>' + (s.cadence || 'Weekly') + ' order</strong> - ' + itemCount + ' items - ' + statusBadge + '</div>'
                  + '<div>'
                  + (s.status === 'active'
                    ? '<button class="btn btn-secondary" style="font-size:0.85rem;padding:0.25rem 0.75rem;" onclick="app.pauseSubscription(\'' + s.id + '\')">Pause</button>'
                    : '<button class="btn btn-primary" style="font-size:0.85rem;padding:0.25rem 0.75rem;" onclick="app.resumeSubscription(\'' + s.id + '\')">Resume</button>')
                  + ' <button class="btn btn-secondary" style="font-size:0.85rem;padding:0.25rem 0.75rem;color:#c44;" onclick="app.cancelSubscription(\'' + s.id + '\')">Cancel</button>'
                  + '</div></div>'
                  + '<div style="font-size:0.85rem;color:var(--warm-text-muted,#888);margin-top:0.5rem;">Next order: ' + (s.next_order_date || 'N/A') + '</div>'
                  + '</div>';
              }).join('');
            }
          } else {
            if (noneEl) noneEl.style.display = '';
            if (listEl) listEl.innerHTML = '';
          }
        }
      } catch (error) {
        console.error('Load subscriptions error:', error);
      }
    },

    async pauseSubscription(subId) {
      try {
        const { response, json } = await this.apiFetch('/api/wholesale/buyers/me/subscriptions/' + subId, {
          method: 'PUT',
          body: JSON.stringify({ status: 'paused' })
        });
        if (response.ok) {
          this.showToast('Standing order paused', 'success');
          this.loadSubscriptions();
        } else {
          this.showToast(json?.message || 'Failed to pause', 'error');
        }
      } catch (error) {
        this.showToast('Error pausing subscription', 'error');
      }
    },

    async resumeSubscription(subId) {
      try {
        const { response, json } = await this.apiFetch('/api/wholesale/buyers/me/subscriptions/' + subId, {
          method: 'PUT',
          body: JSON.stringify({ status: 'active' })
        });
        if (response.ok) {
          this.showToast('Standing order resumed', 'success');
          this.loadSubscriptions();
        } else {
          this.showToast(json?.message || 'Failed to resume', 'error');
        }
      } catch (error) {
        this.showToast('Error resuming subscription', 'error');
      }
    },

    async cancelSubscription(subId) {
      if (!confirm('Cancel this standing order? This cannot be undone.')) return;
      try {
        const { response, json } = await this.apiFetch('/api/wholesale/buyers/me/subscriptions/' + subId, {
          method: 'PUT',
          body: JSON.stringify({ status: 'cancelled' })
        });
        if (response.ok) {
          this.showToast('Standing order cancelled', 'success');
          this.loadSubscriptions();
        } else {
          this.showToast(json?.message || 'Failed to cancel', 'error');
        }
      } catch (error) {
        this.showToast('Error cancelling subscription', 'error');
      }
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

          const { response, json: data } = await this.apiFetch(`/api/wholesale/catalog?${params.toString()}`);
          const payload = data?.data || {};

          // Support both envelopes:
          // - legacy: { ok: true, items: [], farms: [] }
          // - current: { status: 'ok', data: { skus: [], farms: [] }, items: [], farms: [] }
          const isSuccess = response.ok && (data?.ok === true || data?.status === 'ok');
          if (isSuccess) {
            const skus = Array.isArray(payload.skus)
              ? payload.skus
              : Array.isArray(payload.items)
                ? payload.items
                : Array.isArray(data?.items)
                  ? data.items
                  : [];

            const farms = Array.isArray(payload.farms)
              ? payload.farms
              : Array.isArray(data?.farms)
                ? data.farms
                : [];

            this.catalog = skus;
            this.farms = farms;
            this.catalogMeta = data?.meta || {};
            this.renderCatalog();
            this.renderDiscountSummary();
            this.renderFarmList(); // Show farms even if no inventory
            this.updateDemoBanner();
            return;
          }

          // If API returns error, show empty catalog with error message
          console.error('Catalog API error:', data);
          this.catalog = [];
          this.farms = [];
          this.renderCatalog();
          this.showToast('Unable to load catalog. Please try again later.', 'error');
          return;
        } catch (error) {
          console.error('Live catalog error:', error);
          // Show empty catalog instead of switching to demo mode
          this.catalog = [];
          this.renderCatalog();
          this.showToast('Network error loading catalog. Please check your connection.', 'error');
          return;
        }
      }

      await this.loadDemoCatalog(filters);
    },

    async loadDemoCatalog(filters) {
      try {
        if (!this.demoData) {
          const response = await fetch('/data/wholesale-demo-catalog.json');
          if (!response.ok) {
            console.warn('Demo catalog not available');
            // Fall back to live mode when demo assets are missing
            this.demoMode = false;
            this.updateDemoBanner();
            await this.loadCatalog();
            return;
          }
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
      } catch (error) {
        console.warn('Demo catalog unavailable:', error.message);
        // Fallback to live catalog if demo assets are missing
        this.demoMode = false;
        this.updateDemoBanner();
        await this.loadCatalog();
      }
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
            <div class="sku-thumbnail"><img src="${sku.thumbnail_url ? escapeAttr(sku.thumbnail_url) : '/product-images/crops/' + encodeURIComponent(sku.product_name.toLowerCase().replace(/\s+/g, '-')) + '.webp'}" alt="${escapeAttr(sku.product_name)}" loading="lazy" onerror="this.onerror=null;this.src=&quot;/images/default-product.svg&quot;" /></div>
            <div class="sku-header">
              <div class="sku-name-row">
                <span class="sku-name">${escapeHtml(sku.product_name)}</span>
                ${this.getSkuGrowingBadges(sku)}
              </div>
              <div class="sku-badges">
                ${sku.is_custom ? '<span class="sku-badge sku-badge-custom">Custom</span>' : ''}
                ${sku.organic ? '<span class="sku-badge">Organic</span>' : ''}
              </div>
            </div>
            <div class="sku-description">${sku.description ? escapeHtml(sku.description) : '<span style="font-style:italic;opacity:0.6;">No description available</span>'}</div>
            <div class="sku-meta">
              <div class="sku-meta-row">
                <span class="sku-meta-label">Size:</span>
                <span>${escapeHtml(sku.size || 'N/A')}</span>
              </div>
              <div class="sku-meta-row">
                <span class="sku-meta-label">Unit:</span>
                <span>${escapeHtml(sku.unit)}</span>
              </div>
              <div class="sku-meta-row">
                <span class="sku-meta-label">Price:</span>
                <span>$${Number(sku.price_per_unit).toFixed(2)}/${escapeHtml(sku.unit)}</span>
              </div>
              ${Number(sku.base_wholesale_price || 0) > 0 ? `
              <div class="sku-meta-row">
                <span class="sku-meta-label">Base:</span>
                <span>$${Number(sku.base_wholesale_price).toFixed(2)}</span>
              </div>` : ''}
              ${Number(sku.buyer_discount_rate || 0) > 0 ? `
              <div class="sku-meta-row">
                <span class="sku-meta-label">Discount:</span>
                <span>${(Number(sku.buyer_discount_rate) * 100).toFixed(1)}%</span>
              </div>` : ''}
              <div class="sku-meta-row">
                <span class="sku-meta-label">Available:</span>
                <span>${sku.total_qty_available} ${escapeHtml(sku.qty_unit || sku.unit)}${sku.total_qty_available !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <div class="sku-farms">
              ${(sku.farms || []).map((f) => `
                <div class="farm-tag-container">
                  <span class="farm-tag">${escapeHtml(f.farm_name)}</span>
                  <span class="farm-qty">${f.qty_available} ${escapeHtml(sku.qty_unit || sku.unit)}</span>
                  ${Number(f.distance_km) > 0 ? `<span class="sku-distance">${Number(f.distance_km).toFixed(1)} km</span>` : ''}
                  <div class="farm-badges">
                    ${this.getFarmCertificationBadges(f.farm_id)}
                    ${this.getFarmQualityBadge(f.farm_id)}
                    ${this.getFarmResponseTime(f.farm_id)}
                    ${this.getFarmReliability(f.farm_id)}
                  </div>
                </div>
              `).join('')}
            </div>
            <div class="sku-actions">
              <input type="number" id="qty-${escapeAttr(sku.sku_id)}" min="0.1" step="0.1" max="${Number(sku.total_qty_available) || 0}" value="1" />
              <button data-action="add-to-cart" data-skuid="${escapeAttr(sku.sku_id)}">Add to Cart</button>
            </div>
          </div>
        `
        )
        .join('');
      
      // If no products, show availability messaging
      if (this.catalog.length === 0) {
        grid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; background: var(--surface); border-radius: 8px; border: 1px solid var(--border);">
            <h3 style="color: var(--primary); margin-bottom: 1rem;">Not Yet Available in Your Area</h3>
            <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
              The GreenReach Wholesale and Delivery is not live in your area. Access to the portal is free and we encourage you to create a profile. As more geographies go live, you will be notified. Thank you for supporting your local growers!
            </p>
          </div>
        `;
      }
    },

    renderDiscountSummary() {
      let container = document.getElementById('discount-summary');
      if (!container) {
        const header = document.querySelector('.catalog-header');
        if (!header) return;
        container = document.createElement('div');
        container.id = 'discount-summary';
        container.className = 'discount-summary';
        // Insert after the h2 and before the filters
        const filters = header.querySelector('.catalog-filters');
        if (filters) {
          header.insertBefore(container, filters);
        } else {
          header.appendChild(container);
        }
      }

      const meta = this.catalogMeta || {};
      const skuFactor = Number(meta.sku_factor || 0.75);
      const buyerDiscount = Number(meta.buyer_discount_rate || 0);
      const rollingAvg = Number(meta.buyer_rolling_average || 0);
      const windowDays = Number(meta.window_days || 90);
      const wholesaleDiscountPct = Math.round((1 - skuFactor) * 100);
      const tiers = meta.volume_tiers || [
        { min_avg: 750, rate: 0.02 },
        { min_avg: 1500, rate: 0.04 },
        { min_avg: 3000, rate: 0.06 },
        { min_avg: 5000, rate: 0.08 }
      ];

      let html = '<div class="discount-tags">';
      // Wholesale discount from retail
      html += '<span class="discount-tag discount-tag--wholesale">'
            + '<strong>' + wholesaleDiscountPct + '% off retail</strong>'
            + '<span class="discount-tag__label">Wholesale discount</span>'
            + '</span>';

      // Volume tier ladder
      for (var i = 0; i < tiers.length; i++) {
        var tier = tiers[i];
        var pct = (tier.rate * 100).toFixed(0);
        var isActive = buyerDiscount >= tier.rate && buyerDiscount > 0;
        var isNext = !isActive && (i === 0 ? buyerDiscount === 0 : buyerDiscount >= tiers[i - 1].rate);
        var cls = isActive ? 'discount-tag--volume-active' : (isNext ? 'discount-tag--volume-next' : 'discount-tag--volume-locked');
        var label = '$' + tier.min_avg.toLocaleString() + '+ avg/' + windowDays + 'd';
        html += '<span class="discount-tag ' + cls + '">'
              + '<strong>' + pct + '% volume discount</strong>'
              + '<span class="discount-tag__label">' + label + (isActive ? ' [OK] Active' : '') + '</span>'
              + '</span>';
      }
      html += '</div>';

      if (rollingAvg > 0) {
        html += '<div class="discount-rolling-avg">Your ' + windowDays + '-day rolling avg: <strong>$' + rollingAvg.toFixed(2) + '</strong></div>';
      }

      container.innerHTML = html;
    },

    renderFarmList() {
      // Additional function for displaying farm info in sidebar or header
      if (!this.farms || this.farms.length === 0) return;
      
      console.log(`[Wholesale] ${this.farms.length} active farms:`, this.farms.map(f => f.farm_name).join(', '));
    },

    saveCart() {
      try {
        const key = cartStorageKey(this.currentBuyer?.id);
        if (!Array.isArray(this.cart) || this.cart.length === 0) {
          localStorage.removeItem(key);
          return;
        }
        localStorage.setItem(key, JSON.stringify(this.cart));
      } catch (e) { /* localStorage full or unavailable */ }
    },

    loadCart() {
      try {
        const key = cartStorageKey(this.currentBuyer?.id);
        const saved = localStorage.getItem(key);
        if (saved) {
          const parsed = JSON.parse(saved);
          this.cart = Array.isArray(parsed) ? parsed : [];
        } else {
          this.cart = [];
        }
        this.renderCart();
      } catch (e) {
        // corrupt data, start fresh
        this.cart = [];
        this.renderCart();
      }
    },

    migrateLegacyCart() {
      try {
        const legacy = localStorage.getItem(STORAGE_CART_LEGACY);
        if (!legacy) return;
        // Move the legacy un-scoped cart to the current buyer's bucket when
        // they're already signed in so a returning logged-in buyer doesn't
        // silently lose their cart on upgrade. When no buyer is active,
        // fall back to the anonymous bucket.
        const targetKey = cartStorageKey(this.currentBuyer?.id);
        // The prefix and the legacy key collide on the anon key, so skip
        // migration if the target would point back at the legacy key.
        if (targetKey === STORAGE_CART_LEGACY) return;
        if (localStorage.getItem(targetKey) === null) {
          localStorage.setItem(targetKey, legacy);
        }
        localStorage.removeItem(STORAGE_CART_LEGACY);
      } catch (e) { /* best-effort migration */ }
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
      this.saveCart();
      this.showToast(`Added ${sku.product_name} to cart`, 'success');
      if (qtyInput) qtyInput.value = '1';
      
      // Pulse animation on cart badge
      const badge = document.querySelector('.cart-badge');
      if (badge) {
        badge.classList.remove('pulse');
        void badge.offsetWidth; // Force reflow
        badge.classList.add('pulse');
      }
      
      // Auto-open cart panel briefly (3 seconds)
      const cartPanel = document.getElementById('cart-panel');
      if (cartPanel && !cartPanel.classList.contains('open')) {
        cartPanel.classList.add('open');
        setTimeout(() => {
          if (cartPanel.classList.contains('open')) {
            cartPanel.classList.remove('open');
          }
        }, 3000);
      }
    },

    removeFromCart(skuId) {
      this.cart = this.cart.filter((item) => item.sku_id !== skuId);
      this.renderCart();
      this.saveCart();
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
        this.saveCart();
      }
    },

    renderCart() {
      const itemsContainer = document.getElementById('cart-items');
      if (!itemsContainer) return;

      const headerCart = document.getElementById('header-cart');
      const headerCartItems = document.getElementById('header-cart-items');
      const headerCartTotal = document.getElementById('header-cart-total');

      if (this.cart.length === 0) {
        itemsContainer.innerHTML = '<div class="cart-empty">Your cart is empty</div>';
        document.getElementById('cart-total').textContent = '$0.00';
        document.getElementById('cart-count').textContent = '0';
        
        // Hide header cart when empty
        if (headerCart) headerCart.style.display = 'none';
        return;
      }

      // Show header cart when items present
      if (headerCart) headerCart.style.display = 'flex';

      itemsContainer.innerHTML = this.cart
        .map(
          (item) => `
          <div class="cart-item">
            <div class="cart-item-header">
              <div class="cart-item-name">${escapeHtml(item.product_name)}</div>
              <button class="cart-item-remove" data-action="remove-from-cart" data-skuid="${escapeAttr(item.sku_id)}">&times;</button>
            </div>
            <div class="cart-item-meta">${escapeHtml(item.size || '')} ${escapeHtml(item.unit)}</div>
            <div class="cart-item-meta">$${Number(item.price_per_unit).toFixed(2)} per ${escapeHtml(item.unit)}</div>
            <div class="cart-item-actions">
              <div class="cart-item-qty">
                <button data-action="cart-qty" data-skuid="${escapeAttr(item.sku_id)}" data-delta="-0.5">-</button>
                <span>${item.quantity}</span>
                <button data-action="cart-qty" data-skuid="${escapeAttr(item.sku_id)}" data-delta="0.5">+</button>
              </div>
              <div class="cart-item-price">$${(Number(item.price_per_unit) * Number(item.quantity)).toFixed(2)}</div>
            </div>
          </div>
        `
        )
        .join('');

      const total = this.cart.reduce((sum, item) => sum + Number(item.price_per_unit) * Number(item.quantity), 0);
      const totalStr = `$${total.toFixed(2)}`;
      const itemCount = this.cart.length;
      const itemsText = itemCount === 1 ? '1 item' : `${itemCount} items`;
      
      // Update all cart displays
      document.getElementById('cart-total').textContent = totalStr;
      document.getElementById('cart-count').textContent = itemCount.toString();
      
      if (headerCartItems) headerCartItems.textContent = itemsText;
      if (headerCartTotal) headerCartTotal.textContent = totalStr;
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

    async refreshDeliveryQuote() {
      const postalCode = document.getElementById('delivery-postal')?.value?.trim() || '';
      const statusEl = document.getElementById('delivery-quote-status');
      const zoneResultEl = document.getElementById('zone-result');
      const feeDisplayEl = document.getElementById('delivery-fee-display');
      if (statusEl) statusEl.textContent = 'Fetching delivery quote…';

      // Determine zone from postal code prefix
      let zone = 'ZONE_A';
      if (postalCode.length >= 3) {
        const fsa = postalCode.substring(0, 3).toUpperCase();
        if (['K7L','K7K','K7M','K7N','K7P'].includes(fsa)) zone = 'ZONE_A';
        else if (fsa.startsWith('K')) zone = 'ZONE_B';
        else zone = 'ZONE_C';
      }

      const subtotal = this.cart.reduce((sum, item) => sum + item.quantity * Number(item.price_per_unit), 0);
      try {
        const { response, json } = await this.apiFetch('/api/wholesale/delivery/quote', {
          method: 'POST',
          body: JSON.stringify({ zone, subtotal })
        });
        const quote = json?.data || json;
        if (response.ok && quote?.ok) {
          this.deliveryQuote = quote;
          if (feeDisplayEl) feeDisplayEl.textContent = `$${Number(quote.fee).toFixed(2)}`;
          if (zoneResultEl) {
            zoneResultEl.className = 'zone-result zone-success';
            zoneResultEl.textContent = `${quote.zone_name || zone} — $${Number(quote.fee).toFixed(2)} delivery fee`;
            if (quote.minimum_order && subtotal < quote.minimum_order) {
              zoneResultEl.textContent += ` (min order $${quote.minimum_order})`;
              zoneResultEl.className = 'zone-result zone-error';
            }
          }
          if (statusEl) statusEl.textContent = '';
        } else {
          this.deliveryQuote = null;
          if (feeDisplayEl) feeDisplayEl.textContent = '—';
          if (statusEl) statusEl.textContent = json?.message || 'Unable to get delivery quote';
          if (zoneResultEl) { zoneResultEl.className = 'zone-result hidden'; }
        }
      } catch (err) {
        console.error('[Wholesale] Delivery quote error:', err);
        this.deliveryQuote = null;
        if (feeDisplayEl) feeDisplayEl.textContent = '—';
        if (statusEl) statusEl.textContent = 'Could not fetch delivery quote';
      }
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

        previewContainer.innerHTML = `<p>Error: ${escapeHtml(json?.message || 'Unable to allocate order')}</p>`;
      } catch (error) {
        console.error('Allocation preview error:', error);
        previewContainer.innerHTML = '<p>Failed to load allocation preview</p>';
      }
    },

    renderAllocationPreview(allocation) {
      const container = document.getElementById('allocation-preview');
      const cadence = allocation.recurrence?.cadence || this.getRecurrence().cadence;

      container.innerHTML = `
        <p style="margin-bottom: 0.75rem; color: var(--text-secondary);">Fulfillment cadence: <strong>${escapeHtml(cadence.replace('_', ' '))}</strong></p>
        ${(allocation.farm_sub_orders || [])
          .map(
            (subOrder) => `
          <div class="allocation-farm">
            <div class="allocation-farm-header">
              <div class="allocation-farm-name">${escapeHtml(subOrder.farm_name)}</div>
              <div class="allocation-farm-total">$${Number(subOrder.subtotal).toFixed(2)}</div>
            </div>
            <div class="allocation-items">
              ${(subOrder.items || [])
                .map(
                  (item) => `
                <div class="allocation-item">
                  ${item.quantity} ${escapeHtml(item.unit)} × ${escapeHtml(item.product_name)} @ $${Number(item.price_per_unit).toFixed(2)}/${escapeHtml(item.unit)}
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
          ${this.selectedFulfillment === 'delivery' && this.deliveryQuote ? `
          <div class="cart-summary-row">
            <span>Delivery fee:</span>
            <span>$${Number(this.deliveryQuote.fee || 0).toFixed(2)}</span>
          </div>` : ''}
          <div class="cart-summary-row total">
            <span>Total:</span>
            <span>$${Number((allocation.grand_total || 0) + (this.selectedFulfillment === 'delivery' && this.deliveryQuote ? Number(this.deliveryQuote.fee || 0) : 0)).toFixed(2)}</span>
          </div>
        </div>
      `;
    },

    async placeOrder() {
      if (this._placingOrder) return;
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

      this._placingOrder = true;
      const placeBtn = document.getElementById('place-order-btn');
      if (placeBtn) placeBtn.disabled = true;
      this.showLoading('Processing your order...');

      try {
        // Use saved card on file or tokenize new card
        let paymentProvider = 'manual';
        let paymentSource = { type: 'manual' };
        const _savedCardEl = document.getElementById('checkout-saved-card');
        if (this.currentBuyer?.squareCardId && _savedCardEl && _savedCardEl.style.display !== 'none') {
          paymentSource = { source_id: this.currentBuyer.squareCardId };
          paymentProvider = 'square';
        } else if (this.squarePayments && this.squareCard) {
          const token = await this.createPaymentToken();
          paymentSource = { source_id: token };
          paymentProvider = 'square';
        }

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
              zip: document.getElementById('delivery-postal').value,
              country: 'Canada',
              instructions: document.getElementById('delivery-instructions').value
            },
            recurrence: this.getRecurrence(),
            cart: this.cart.map((item) => ({ sku_id: item.sku_id, quantity: item.quantity })),
            allocation_strategy: 'cheapest',
            payment_provider: paymentProvider,
            payment_source: paymentSource,
            po_number: document.getElementById('po-number')?.value?.trim() || '',
            fulfillment_method: this.selectedFulfillment,
            delivery_fee: this.selectedFulfillment === 'delivery' && this.deliveryQuote ? Number(this.deliveryQuote.fee || 0) : 0,
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
        // Persist the now-empty cart under the buyer's scoped key so a
        // page refresh (or later sign-in on this device) doesn't restore
        // the items the buyer already ordered.
        this.saveCart();
        this.renderCart();
        this.navigateTo('orders');
        this.showToast('Order placed successfully!', 'success');
      } catch (error) {
        this.hideLoading();
        console.error('Place order error:', error);
        this.showToast('Network error placing order', 'error');
      } finally {
        this._placingOrder = false;
        const placeBtn = document.getElementById('place-order-btn');
        if (placeBtn) placeBtn.disabled = false;
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
          this.updatePayAllButton();
          return;
        }
      } catch (error) {
        console.error('Load orders error:', error);
      }

      this.renderOrders();
      this.updatePayAllButton();
    },

    renderOrders() {
      const container = document.getElementById('orders-list');
      if (!container) return;

      if (!this.currentBuyer) {
        container.innerHTML = `
          <div class="order-empty">
            <div class="order-empty-icon">Locked</div>
            <p>Please sign in to view your order history.</p>
          </div>
        `;
        return;
      }

      if (!this.orders.length) {
        container.innerHTML = `
          <div class="order-empty">
            <div class="order-empty-icon">No Orders</div>
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
              <div class="order-id">Order #${escapeHtml(String(order.master_order_id || '').substring(0, 8))}</div>
              <div class="order-status ${safeClassToken(order.status)}">${escapeHtml(order.status)}</div>
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
                <div class="order-meta-value">${escapeHtml((order.recurrence?.cadence || 'one_time').replace('_', ' '))}</div>
              </div>
              ${order.delivery_address ? `
              <div class="order-meta-item">
                <div class="order-meta-label">Delivery Address</div>
                <div class="order-meta-value">${escapeHtml(order.delivery_address.street)}, ${escapeHtml(order.delivery_address.city)} ${escapeHtml(order.delivery_address.province || '')} ${escapeHtml(order.delivery_address.postalCode || order.delivery_address.zip || '')}</div>
              </div>
              ` : ''}
            </div>

            ${allItems.length > 0 ? `
            <div class="order-items">
              <div class="order-items-title">Order Items (${allItems.length})</div>
              ${allItems.map((item) => `
                <div class="order-item">
                  <div>
                    <div class="order-item-name">${escapeHtml(item.product_name)}</div>
                    <div class="order-item-details">
                      ${item.quantity} ${escapeHtml(item.unit)} × $${Number(item.price_per_unit).toFixed(2)}
                      ${item.size ? ` • ${escapeHtml(item.size)}` : ''}
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
                    <div class="order-farm-name">${escapeHtml(subOrder.farm_name || 'Farm')}</div>
                    <div class="order-farm-status">
                      ${(subOrder.items || []).length} item(s) • Status: ${escapeHtml(subOrder.status || 'pending')}
                    </div>
                    ${subOrder.tracking_number ? `
                    <div class="order-farm-tracking">
                      <div class="order-farm-tracking-label">Tracking Number</div>
                      <div class="order-farm-tracking-number">
                        ${escapeHtml(subOrder.tracking_number)}
                        ${subOrder.tracking_carrier ? `
                        <a href="${safeUrl(this.getTrackingUrl(subOrder.tracking_carrier, subOrder.tracking_number))}" 
                           target="_blank" 
                           rel="noopener noreferrer"
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
              <button class="order-action-btn" data-action="view-invoice" data-orderid="${escapeAttr(order.master_order_id)}">
                 Download Invoice
              </button>
              <button class="order-action-btn" data-action="reorder" data-orderid="${escapeAttr(order.master_order_id)}">
                Reorder
              </button>
              ${order.status === 'pending' || order.status === 'confirmed' ? `
              <button class="order-action-btn" data-action="contact-farm" data-orderid="${escapeAttr(order.master_order_id)}">
                 Contact Farms
              </button>
              ` : ''}
            </div>
          </div>
        `;
        })
        .join('');
    },

    getTrackingUrl(carrier, trackingNumber) {
      const encodedTrackingNumber = encodeURIComponent(String(trackingNumber || ''));
      const carriers = {
        usps: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodedTrackingNumber}`,
        ups: `https://www.ups.com/track?tracknum=${encodedTrackingNumber}`,
        fedex: `https://www.fedex.com/fedextrack/?tracknumbers=${encodedTrackingNumber}`,
        dhl: `https://www.dhl.com/en/express/tracking.html?AWB=${encodedTrackingNumber}`
      };
      return carriers[String(carrier || '').toLowerCase()] || '#';
    },

    async downloadInvoice(orderId) {
      try {
        this.showLoading('Generating invoice...');

        const headers = {};
        if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

        // Fetch HTML invoice from server
        const response = await fetch(`/api/wholesale/orders/${orderId}/invoice`, { headers });

        if (response.ok) {
          const html = await response.text();
          const blob = new Blob([html], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `invoice-${orderId.substring(0, 12)}.html`;
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
          this.loadBuyerInsights();
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

    async contactFarms(orderId) {
      const order = this.orders.find((o) => o.master_order_id === orderId);
      if (!order) {
        this.showToast('Order not found', 'error');
        return;
      }

      const farmIds = new Set((order.farm_sub_orders || []).map((sub) => String(sub.farm_id || '').trim()).filter(Boolean));
      const farmCount = farmIds.size;
      if (!farmCount) {
        this.showToast('No fulfillment farms found for this order', 'error');
        return;
      }

      const shortOrderId = String(order.master_order_id || orderId).substring(0, 8);
      const defaultMessage = `Hello, this is ${this.currentBuyer?.businessName || 'your wholesale buyer'}. Please share an update on order #${shortOrderId}.`;
      const message = window.prompt(
        `Send a note to ${farmCount} farm E.V.I.E. inbox${farmCount === 1 ? '' : 'es'}.`,
        defaultMessage
      );

      if (message == null) return;

      try {
        this.showLoading('Sending to farm E.V.I.E. inbox...');

        const { response, json } = await this.apiFetch(`/api/wholesale/orders/${encodeURIComponent(orderId)}/contact-farms`, {
          method: 'POST',
          body: JSON.stringify({ message: String(message || '').trim().slice(0, 500) })
        });

        this.hideLoading();

        if (response.ok && json?.status === 'ok') {
          const sentCount = Number(json?.data?.requested_farms || 0);
          const failedCount = Array.isArray(json?.data?.failed_farms) ? json.data.failed_farms.length : 0;

          if (failedCount > 0) {
            this.showToast(`Sent to ${sentCount} farm E.V.I.E. inbox${sentCount === 1 ? '' : 'es'} (${failedCount} unavailable)`, 'info');
          } else {
            this.showToast(`Sent to ${sentCount} farm E.V.I.E. inbox${sentCount === 1 ? '' : 'es'}`, 'success');
          }

          if (window.EVIE && typeof window.EVIE.notice === 'function') {
            window.EVIE.notice('Farm E.V.I.E. inbox notified');
          }
          return;
        }

        this.showToast(json?.message || 'Unable to reach farm E.V.I.E. inbox', 'error');
      } catch (error) {
        this.hideLoading();
        console.error('Contact farms error:', error);
        this.showToast('Unable to reach farm E.V.I.E. inbox', 'error');
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

    showToast(message, type = 'info', options = {}) {
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      if (options.prominent) {
        toast.style.padding = '1.25rem 1.5rem';
        toast.style.fontSize = '1.05rem';
        toast.style.fontWeight = '600';
        toast.style.borderLeftWidth = '6px';
        toast.style.maxWidth = '480px';
        if (options.detail) {
          const detail = document.createElement('div');
          detail.style.fontWeight = '400';
          detail.style.fontSize = '0.875rem';
          detail.style.marginTop = '0.5rem';
          detail.style.opacity = '0.85';
          detail.textContent = options.detail;
          toast.textContent = message;
          toast.appendChild(detail);
        } else {
          toast.textContent = message;
        }
      } else {
        toast.textContent = message;
      }
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), options.duration || 3000);
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

    extractCoordinates(rawLocation) {
      if (!rawLocation) return null;

      let location = rawLocation;
      if (typeof location === 'string') {
        try {
          location = JSON.parse(location);
        } catch {
          return null;
        }
      }

      if (!location || typeof location !== 'object') return null;

      const latitude = Number(
        location.latitude
          ?? location.lat
          ?? location.location?.latitude
          ?? location.location?.lat
      );
      const longitude = Number(
        location.longitude
          ?? location.lng
          ?? location.lon
          ?? location.location?.longitude
          ?? location.location?.lng
          ?? location.location?.lon
      );

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return { latitude, longitude };
    },

    normalizePostalCode(postalCode) {
      const normalized = String(postalCode || '')
        .toUpperCase()
        .replace(/\s+/g, '')
        .replace(/[^A-Z0-9]/g, '');
      if (normalized.length !== 6) return '';
      return `${normalized.slice(0, 3)} ${normalized.slice(3)}`;
    },

    buildGeocodeQueries(location = {}) {
      const address = String(location.address1 || location.address || location.street || '').trim();
      const city = String(location.city || '').trim();
      const state = String(location.state || location.province || '').trim();
      const postalCode = this.normalizePostalCode(location.postalCode || location.zip || '');
      const country = String(location.country || 'Canada').trim() || 'Canada';

      const queries = [];
      const addQuery = (parts) => {
        const query = parts.filter(Boolean).join(', ');
        if (query && !queries.includes(query)) queries.push(query);
      };

      addQuery([address, city, state, postalCode, country]);
      addQuery([city, state, postalCode, country]);
      addQuery([postalCode, state, country]);
      addQuery([postalCode, country]);

      return queries;
    },

    async geocodeCoordinates(location = {}) {
      const queries = this.buildGeocodeQueries(location);
      if (!queries.length) return null;

      for (const query of queries) {
        try {
          const country = String(location.country || 'Canada').trim().toLowerCase();
          const countryCodes = (!country || country === 'canada') ? '&countrycodes=ca' : '';
          const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1${countryCodes}&q=${encodeURIComponent(query)}`;
          const response = await fetch(url, {
            headers: {
              'Accept': 'application/json'
            }
          });
          if (!response.ok) continue;

          const results = await response.json();
          if (!Array.isArray(results) || results.length === 0) continue;

          const latitude = Number(results[0].lat);
          const longitude = Number(results[0].lon);
          if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            return { latitude, longitude };
          }
        } catch {
          // Best-effort geocoding; continue trying fallback queries.
        }
      }

      return null;
    },

    async populateRegistrationCoordinates() {
      const latField = document.getElementById('register-lat');
      const lngField = document.getElementById('register-lng');
      if (!latField || !lngField) return null;

      const postalCode = document.getElementById('register-postal')?.value?.trim() || '';
      const province = document.getElementById('register-province')?.value?.trim() || '';
      if (!postalCode && !province) return null;

      const coords = await this.geocodeCoordinates({
        postalCode,
        province,
        state: province,
        country: 'Canada'
      });

      if (coords) {
        latField.value = coords.latitude.toFixed(6);
        lngField.value = coords.longitude.toFixed(6);
      }

      return coords;
    },

    getBuyerLatLng() {
      const loc = this.currentBuyer?.location || null;
      return this.extractCoordinates(loc);
    },

    async loadNetworkFarms() {
      const select = document.getElementById('single-farm-id');
      if (!select) return;

      try {
        const response = await fetch('/api/wholesale/network/farms');
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.status !== 'ok') throw new Error('network/farms unavailable');

        this.networkFarms = data.data?.farms || [];

        select.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Select a farm...';
        select.appendChild(defaultOption);
        this.networkFarms
          .filter((f) => f?.status !== 'inactive')
          .forEach((f) => {
            const option = document.createElement('option');
            option.value = String(f.farm_id || '');
            option.textContent = String(f.farm_name || f.farm_id || 'Farm');
            select.appendChild(option);
          });
      } catch (error) {
        console.warn('Failed to load network farms:', error);
        select.innerHTML = '<option value="">Farms unavailable</option>';
      }
    },

    async loadFarmPerformance() {
      try {
        const response = await fetch('/api/wholesale/farm-performance/dashboard?timeframe=30d');
        const data = await response.json().catch(() => null);
        
        const farms = Array.isArray(data?.farms)
          ? data.farms
          : Array.isArray(data?.data?.farms)
            ? data.data.farms
            : Array.isArray(data?.metrics?.farms)
              ? data.metrics.farms
              : [];

        if (farms.length) {
          // Convert array to lookup object keyed by farm_id
          this.farmPerformance = {};
          farms.forEach(farm => {
            this.farmPerformance[farm.farm_id] = farm.metrics;
          });
          console.log(`[Wholesale] Loaded performance data for ${farms.length} farms`);
        } else {
          this.farmPerformance = {};
        }
      } catch (error) {
        console.warn('[Wholesale] Farm performance data unavailable:', error);
        this.farmPerformance = {};
      }
    },

    getFarmQualityBadge(farmId) {
      const metrics = this.farmPerformance[farmId];
      if (!metrics) return '';
      
      const score = metrics.quality_score || 0;
      let badge = '';
      let className = '';
      
      if (score >= 90) {
        badge = 'Excellent';
        className = 'farm-quality-excellent';
      } else if (score >= 80) {
        badge = 'Good';
        className = 'farm-quality-good';
      } else if (score >= 70) {
        badge = 'Fair';
        className = 'farm-quality-fair';
      } else {
        return ''; // Don't show badge for poor scores
      }
      
      return `<span class="farm-quality-badge ${className}" title="Quality Score: ${score.toFixed(0)}/100"> ${badge}</span>`;
    },

    getFarmResponseTime(farmId) {
      const metrics = this.farmPerformance[farmId];
      if (!metrics || !metrics.avg_response_time_hours) return '';
      
      const hours = metrics.avg_response_time_hours;
      let className = '';
      let icon = '';
      
      if (hours <= 4) {
        className = 'response-fast';
        icon = '';
      } else if (hours <= 12) {
        className = 'response-normal';
        icon = '';
      } else {
        return ''; // Don't show slow response times
      }
      
      return `<span class="farm-response ${className}" title="Average response time">${icon} ${hours.toFixed(1)}h</span>`;
    },

    getFarmReliability(farmId) {
      const metrics = this.farmPerformance[farmId];
      if (!metrics || !metrics.acceptance_rate) return '';
      
      const rate = metrics.acceptance_rate;
      if (rate < 85) return ''; // Don't show low reliability
      
      let className = rate >= 95 ? 'reliability-excellent' : 'reliability-good';
      return `<span class="farm-reliability ${className}" title="Order fulfillment rate">${rate.toFixed(0)}% reliable</span>`;
    },

    getFarmCertificationBadges(farmId) {
      // Get farm data from directory
      const farm = this.farmDirectory[farmId] || this.networkFarms.find(f => f.farm_id === farmId);
      if (!farm || !farm.certifications) return '';

      // Check for food safety certification
      const foodSafetyCerts = ['CanadaGAP', 'GlobalGAP', 'HACCP', 'SQF', 'BRC', 'FSSC 22000'];
      const hasFoodSafety = farm.certifications.some(cert => 
        foodSafetyCerts.some(fs => cert.toLowerCase().includes(fs.toLowerCase()))
      );

      if (!hasFoodSafety) return '';

      // Get the actual cert name
      const cert = farm.certifications.find(c => 
        foodSafetyCerts.some(fs => c.toLowerCase().includes(fs.toLowerCase()))
      );

      return `<span class="farm-cert-badge food-safety-cert" title="Food Safety Certified: ${cert}">️ Food Safety</span>`;
    },

    getSkuGrowingBadges(sku) {
      const farms = sku.farms || [];
      const allPractices = new Set(
        farms.flatMap(f => {
          const dir = this.farmDirectory[f.farm_id] || {};
          return [...(f.practices || []), ...(dir.practices || [])];
        })
      );
      if (!allPractices.size) return '';
      let badges = '';
      if (allPractices.has('hydroponic')) {
        badges += `<span class="growing-badge growing-badge-hydroponic" title="Grown hydroponically">Hydroponic</span>`;
      }
      if (allPractices.has('pesticide_free')) {
        badges += `<span class="growing-badge growing-badge-no-pesticides" title="No pesticides used">No Pesticides</span>`;
      }
      if (allPractices.has('herbicide_free')) {
        badges += `<span class="growing-badge growing-badge-no-herbicides" title="No herbicides used">No Herbicides</span>`;
      }
      return badges ? `<span class="growing-badges">${badges}</span>` : '';
    },

    /**
     * Load buyer insights dashboard
     */
    async loadBuyerInsights() {
      const marketSnapshot = await this.fetchMarketInsightSnapshot(2);

      await Promise.all([
        this.loadDemandTrends(marketSnapshot),
        this.loadPriceAlerts(marketSnapshot),
        this.loadEnvironmentalImpact()
      ]);
    },

    /**
     * Fetch price-watch market context once and reuse for insight cards.
     */
    async fetchMarketInsightSnapshot(threshold = 7, recencyDays = 14) {
      try {
        const headers = {};
        if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
        const response = await fetch(`/api/wholesale/market/price-alerts?threshold=${encodeURIComponent(threshold)}&recencyDays=${encodeURIComponent(recencyDays)}`, { headers });
        if (!response.ok) return null;
        const payload = await response.json();
        return payload?.ok ? payload : null;
      } catch (error) {
        console.warn('[Wholesale] Market insight snapshot unavailable:', error);
        return null;
      }
    },

    /**
     * Load demand trends from actual order data
     */
    async loadDemandTrends(marketSnapshot = null) {
      const demandContent = document.getElementById('demand-content');
      const contextualSignals = Array.isArray(marketSnapshot?.topSignals)
        ? marketSnapshot.topSignals.slice(0, 3)
        : [];

      const aiContextHtml = contextualSignals.length > 0
        ? `
          <div style="margin-top: 0.75rem; padding-top: 0.65rem; border-top: 1px solid var(--border);">
            <div style="font-size: 0.78rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.4rem;">
              AI National/North American Demand Context
            </div>
            ${contextualSignals.map((signal) => {
              const leadDriver = (signal.movementDrivers || []).find((driver) => driver?.hasEvidence) || (signal.movementDrivers || [])[0];
              const driverText = leadDriver?.evidence || 'No explicit demand driver available in the latest AI narrative.';
              const retailerCount = Array.isArray(signal.retailers) ? signal.retailers.length : 0;
              const changeText = signal.change || '0.0%';
              return `
                <div style="margin-bottom: 0.45rem; padding: 0.45rem 0.5rem; border-radius: 6px; background: rgba(0, 0, 0, 0.03);">
                  <div style="display:flex; justify-content:space-between; gap:0.4rem; align-items:flex-start;">
                    <strong style="font-size:0.76rem;">${escapeHtml(signal.product || 'Market signal')}</strong>
                    <span style="font-size:0.74rem; color:var(--text-secondary);">${escapeHtml(changeText)}</span>
                  </div>
                  <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:0.2rem;">${escapeHtml(driverText)}</div>
                  <div style="font-size:0.7rem; color:var(--text-secondary); margin-top:0.2rem;">Coverage: ${retailerCount} national retailers • Confidence: ${escapeHtml(signal.confidence || 'unknown')}</div>
                </div>
              `;
            }).join('')}
          </div>
        `
        : '';

      try {
        // Use previously loaded orders or fetch them
        const orders = this.orders || [];
        if (orders.length === 0) {
          // No orders yet -- show catalog availability as trending
          const catalog = this.catalog || [];
          if (catalog.length === 0) {
            demandContent.innerHTML = '<div class="loading-state">Catalog loading...</div>';
            return;
          }
          const top = [...catalog]
            .filter(s => s.total_qty_available > 0)
            .sort((a, b) => b.total_qty_available - a.total_qty_available)
            .slice(0, 5);
          if (top.length === 0) {
            demandContent.innerHTML = '<div class="loading-state">No products currently in stock</div>';
            return;
          }
          demandContent.innerHTML = top.map((sku, i) => `
            <div class="demand-item">
              <div class="demand-rank">${i + 1}</div>
              <div class="demand-info">
                <div class="demand-name">${sku.product_name}</div>
                <div class="demand-stats">${sku.total_qty_available} ${sku.unit || 'units'} available from ${(sku.farms || []).length} farm${(sku.farms || []).length !== 1 ? 's' : ''}</div>
              </div>
              <div class="demand-trend trending-stable">In Stock</div>
            </div>
          `).join('') + aiContextHtml;
          return;
        }

        // Aggregate product demand from order items
        const productMap = {};
        for (const order of orders) {
          const items = order.items || [];
          const subs = order.farm_sub_orders || [];
          const allItems = [...items];
          for (const sub of subs) {
            allItems.push(...(sub.line_items || sub.items || []));
          }
          for (const item of allItems) {
            const name = item.sku_name || item.product_name || item.sku_id || 'Unknown';
            if (!productMap[name]) {
              productMap[name] = { productName: name, totalQty: 0, orderCount: 0 };
            }
            productMap[name].totalQty += Number(item.qty || item.quantity || 0);
            productMap[name].orderCount++;
          }
        }

        const sorted = Object.values(productMap).sort((a, b) => b.orderCount - a.orderCount).slice(0, 5);

        if (sorted.length === 0) {
          demandContent.innerHTML = '<div class="loading-state">No product data yet</div>';
          return;
        }

        const html = sorted.map((item, i) => `
          <div class="demand-item">
            <div class="demand-rank">${i + 1}</div>
            <div class="demand-info">
              <div class="demand-name">${item.productName}</div>
              <div class="demand-stats">${item.orderCount} orders -- ${item.totalQty} units total</div>
            </div>
            <div class="demand-trend trending-stable">
              ${item.orderCount} orders
            </div>
          </div>
        `).join('');

        demandContent.innerHTML = html + aiContextHtml;
      } catch (err) {
        console.error('[Wholesale] Demand trends error:', err);
        demandContent.innerHTML = '<div class="loading-state">Unable to load demand data</div>';
      }
    },

    isPriceWatchNewsworthy(alert) {
      const hasArticles = Array.isArray(alert?.articles) && alert.articles.length > 0;
      const meaningfulDrivers = (Array.isArray(alert?.movementDrivers) ? alert.movementDrivers : [])
        .filter((driver) => driver && (driver.hasEvidence !== false))
        .filter((driver) => ['article', 'ai_reasoning', 'seasonality', 'inferred'].includes(String(driver.source || '').toLowerCase()));
      return hasArticles || meaningfulDrivers.length > 0;
    },

    renderPriceWatchModal(alerts, result) {
      const monitorScope = result?.monitorScope === 'national_retailers'
        ? 'National + North American retailers'
        : 'North American retailer coverage';
      const recencyWindowDays = Number(result?.recencyWindowDays || 14);

      let modal = document.getElementById('price-watch-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'price-watch-modal';
        modal.className = 'modal';
        modal.style.display = 'none';
        document.body.appendChild(modal);
      }

      const alertsHtml = (Array.isArray(alerts) ? alerts : []).map((alert) => {
        const alertClass = `anomaly-${alert.type}`;
        const changeColor = alert.type === 'increase' ? 'color: var(--warning)' : 'color: var(--info)';
        const movementDrivers = (Array.isArray(alert.movementDrivers) ? alert.movementDrivers : [])
          .filter((driver) => driver && (driver.hasEvidence !== false))
          .slice(0, 4);
        const articles = Array.isArray(alert.articles) ? alert.articles : [];

        const driversHtml = movementDrivers.length > 0
          ? `<div style="margin-top: 0.6rem; padding: 0.6rem; background: rgba(0, 0, 0, 0.03); border-radius: 6px;">
              <div style="font-size: 0.78rem; font-weight: 600; margin-bottom: 0.35rem;">Likely Cost Drivers</div>
              ${movementDrivers.map((driver) => `
                <div style="font-size: 0.78rem; margin-bottom: 0.28rem; line-height: 1.45;">
                  <strong>${escapeHtml(driver.label || 'Driver')}:</strong> ${escapeHtml(driver.evidence || '')}
                </div>
              `).join('')}
            </div>`
          : '';

        const newsHtml = articles.length > 0
          ? `<div style="margin-top: 0.65rem; font-size: 0.78rem; line-height: 1.45;">
              <strong>News-worthy Events:</strong>
              <div style="margin-top: 0.25rem; display: grid; gap: 0.25rem;">
                ${articles.slice(0, 3).map((article) => `
                  <a href="${safeUrl(article.url)}" target="_blank" rel="noopener noreferrer" style="color: var(--primary); text-decoration: none;">
                    ${escapeHtml(article.title || 'Market article')} (${escapeHtml(article.source || 'source')})
                  </a>
                `).join('')}
              </div>
            </div>`
          : '';

        return `
          <div class="price-alert ${alertClass}" style="margin-bottom: 0.75rem;">
            <div class="price-alert-header">
              <span class="price-alert-product">${escapeHtml(alert.product)}</span>
              <span class="price-change" style="${escapeAttr(changeColor)}">${escapeHtml(alert.change)}</span>
            </div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
              $${Number(alert.previousPrice || 0).toFixed(2)} -> $${Number(alert.currentPrice || 0).toFixed(2)} ${escapeHtml(alert.priceUnit || '')}
            </div>
            <div class="price-alert-summary">${escapeHtml(alert.summary || '')}</div>
            ${driversHtml}
            ${newsHtml}
          </div>
        `;
      }).join('');

      modal.innerHTML = `
        <div class="modal-content" style="max-width: min(96vw, 1400px); width: 96vw; margin: 1rem auto;">
          <div class="modal-header">
            <h2>Price Watch - Global Market Event Viewer</h2>
            <button class="modal-close" data-action="close-price-watch-modal">&times;</button>
          </div>
          <div class="modal-body" style="max-height: 78vh; overflow-y: auto;">
            <p style="margin-bottom: 0.85rem; color: var(--text-secondary);">
              Showing <strong>${alerts.length}</strong> recently changed produce categories (last ${recencyWindowDays} days) from ${escapeHtml(monitorScope)}.
            </p>
            ${alertsHtml || '<div class="loading-state">No recent events to display.</div>'}
          </div>
        </div>
      `;
    },

    openPriceWatchModal() {
      const modal = document.getElementById('price-watch-modal');
      if (!modal) return;
      modal.style.display = 'flex';
    },

    closePriceWatchModal() {
      const modal = document.getElementById('price-watch-modal');
      if (!modal) return;
      modal.style.display = 'none';
    },

    /**
     * Load price anomaly alerts with real market data from North American retailers
     */
    async loadPriceAlerts(marketSnapshot = null) {
      const priceContent = document.getElementById('price-content');
      
      try {
        const result = marketSnapshot || await this.fetchMarketInsightSnapshot(2, 14);
        if (!result || !result.ok) {
          priceContent.innerHTML = '<div class="loading-state">Price Watch is temporarily unavailable.</div>';
          return;
        }

        const recencyWindowDays = Number(result.recencyWindowDays || 14);
        const alerts = (Array.isArray(result.alerts) ? result.alerts : [])
          .filter((alert) => {
            if (!alert?.lastUpdated) return false;
            const updatedTs = new Date(alert.lastUpdated).getTime();
            if (!Number.isFinite(updatedTs)) return false;
            const ageMs = Date.now() - updatedTs;
            return ageMs >= 0 && ageMs <= recencyWindowDays * 24 * 60 * 60 * 1000;
          })
          .sort((a, b) => Math.abs(parseFloat(b.change || '0')) - Math.abs(parseFloat(a.change || '0')));

        const monitorScope = result.monitorScope === 'national_retailers'
          ? 'National + North American retailers'
          : 'North American retailer coverage';
        const alertThreshold = Number(result.threshold || 7);

        this.priceWatchState = { alerts, result };
        
        if (alerts.length === 0) {
          priceContent.innerHTML = `<div class="loading-state">No recent produce price changes above ${alertThreshold.toFixed(0)}% were detected in the last ${recencyWindowDays} days.</div>`;
          return;
        }

        this.renderPriceWatchModal(alerts, result);

        const newsworthyAlerts = alerts.filter((alert) => this.isPriceWatchNewsworthy(alert));
        const collapseToModal = alerts.length > 1 && newsworthyAlerts.length > 1;

        if (collapseToModal) {
          const compactRows = alerts.slice(0, 2).map((alert) => {
            const changeColor = alert.type === 'increase' ? 'color: var(--warning)' : 'color: var(--info)';
            return `
              <div style="padding: 0.55rem 0.65rem; margin-bottom: 0.45rem; background: var(--bg); border-radius: 6px;">
                <div style="display:flex; justify-content:space-between; gap:0.5rem; align-items:center;">
                  <strong style="font-size:0.86rem;">${escapeHtml(alert.product)}</strong>
                  <span style="font-weight:700; ${escapeAttr(changeColor)}">${escapeHtml(alert.change)}</span>
                </div>
                <div style="font-size:0.76rem; color:var(--text-secondary); margin-top:0.2rem;">
                  ${escapeHtml(alert.summary || '')}
                </div>
              </div>
            `;
          }).join('');

          priceContent.innerHTML = `
            <div style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:0.55rem;">
              ${alerts.length} produce categories changed recently. ${newsworthyAlerts.length} include new cost-of-goods signals.
            </div>
            ${compactRows}
            <button class="btn btn-primary" data-action="open-price-watch-modal" style="width:100%; margin-top:0.35rem;">
              Open Full-Width Market Event Viewer
            </button>
            <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:0.4rem;">
              Scope: ${escapeHtml(monitorScope)} - Threshold: ${alertThreshold.toFixed(0)}% - Window: ${recencyWindowDays} days
            </div>
          `;
          return;
        }

        const html = alerts.slice(0, 3).map((alert) => {
          const alertClass = `anomaly-${alert.type}`;
          const changeColor = alert.type === 'increase' ? 'color: var(--warning)' : 'color: var(--info)';
          const movementDrivers = (Array.isArray(alert.movementDrivers) ? alert.movementDrivers : [])
            .filter((driver) => driver && (driver.hasEvidence !== false));
          const leadDriver = movementDrivers[0];

          const updatedDisplay = alert.lastUpdated
            ? new Date(alert.lastUpdated).toLocaleString()
            : 'Unknown';
          
          return `
            <div class="price-alert ${alertClass}">
              <div class="price-alert-header">
                  <span class="price-alert-product">${escapeHtml(alert.product)}</span>
                  <span class="price-change" style="${escapeAttr(changeColor)}">${escapeHtml(alert.change)}</span>
              </div>
              <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.5rem;">
                  $${Number(alert.previousPrice || 0).toFixed(2)} → $${Number(alert.currentPrice || 0).toFixed(2)} ${escapeHtml(alert.priceUnit || '')}
              </div>
              <div class="price-alert-summary">
                  ${escapeHtml(alert.summary || '')}
              </div>
              ${leadDriver ? `
                <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.5rem; padding: 0.45rem 0.55rem; background: rgba(0, 0, 0, 0.03); border-radius: 6px; line-height:1.45;">
                  <strong>Likely Driver:</strong> ${escapeHtml(leadDriver.label || 'Market Driver')} - ${escapeHtml(leadDriver.evidence || '')}
                </div>
              ` : ''}
              <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--border);">
                  ${alert.retailers && alert.retailers.length > 0 ? `<strong>Coverage:</strong> ${escapeHtml(alert.retailers.join(', '))} (${Number(alert.dataPoints || 0)} observations)<br/>` : ''}
                  <strong>Updated:</strong> ${escapeHtml(updatedDisplay)} • <strong>Confidence:</strong> ${escapeHtml(alert.confidence || 'unknown')}
                  ${alert.articles && alert.articles.length > 0 ? `<br/><strong>News:</strong> ${alert.articles.slice(0, 2).map(a => `<a href="${safeUrl(a.url)}" target="_blank" rel="noopener noreferrer" style="color: var(--primary);">${escapeHtml(a.title)} (${escapeHtml(a.source)})</a>`).join(', ')}` : ''}
              </div>
            </div>
          `;
        }).join('');

        priceContent.innerHTML = `${html}
          ${alerts.length > 1 ? `
            <button class="btn btn-secondary" data-action="open-price-watch-modal" style="width:100%; margin-top: 0.45rem;">
              View All ${alerts.length} Recent Changes (Full Width)
            </button>
          ` : ''}
          <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:0.4rem;">
            Scope: ${escapeHtml(monitorScope)} • Threshold: ${alertThreshold.toFixed(0)}% • Window: ${recencyWindowDays} days
          </div>`;
        
        console.log(`[Price Watch] Loaded ${alerts.length} recent alerts from ${result.totalProductsMonitored} monitored products`);
        
      } catch (error) {
        console.error('Price Watch error:', error);
        priceContent.innerHTML = '<div class="loading-state">Price Watch is temporarily unavailable.</div>';
      }
    },

    /**
     * Calculate environmental impact based on buyer and farm locations
     */
    async loadEnvironmentalImpact() {
      const impactContent = document.getElementById('impact-content');
      const impactScore = document.getElementById('impact-score');
      
      if (!this.currentBuyer) {
        // Show general network info even without auth
        const farmCount = (this.networkFarms || []).length || 1;
        impactContent.innerHTML = `
          <div class="impact-metric">
            <span class="impact-label">GreenReach Network</span>
            <span class="impact-value">${farmCount} local farm${farmCount !== 1 ? 's' : ''}</span>
          </div>
          <div class="impact-metric">
            <span class="impact-label">Growing Method</span>
            <span class="impact-value">Hydroponic, Year-Round</span>
          </div>
          <div class="impact-metric">
            <span class="impact-label">Region</span>
            <span class="impact-value">Kingston, ON</span>
          </div>
          <div class="impact-comparison">
            <div class="comparison-text">Sign in to see personalized distance and carbon savings calculations based on your location.</div>
          </div>
        `;
        if (impactScore) impactScore.textContent = 'A';
        return;
      }

      let buyerLoc = this.getBuyerLatLng();
      if (!buyerLoc && this.currentBuyer?.location) {
        // Coordinates missing from profile -- attempt geocoding from address
        try {
          buyerLoc = await this.geocodeCoordinates(this.currentBuyer.location);
          if (buyerLoc) {
            // Cache for future use
            this.currentBuyer.location.latitude = buyerLoc.latitude;
            this.currentBuyer.location.longitude = buyerLoc.longitude;
          }
        } catch (err) {
          console.warn('[Environmental Impact] Geocoding failed:', err.message);
        }
      }
      if (!buyerLoc) {
        impactContent.innerHTML = `
          <div class="impact-metric">
            <span class="impact-label">GreenReach Network</span>
            <span class="impact-value">${(this.networkFarms || []).length || 1} local farm${((this.networkFarms || []).length || 1) !== 1 ? 's' : ''}</span>
          </div>
          <div class="impact-metric">
            <span class="impact-label">Growing Method</span>
            <span class="impact-value">Hydroponic, Year-Round</span>
          </div>
          <div class="impact-metric">
            <span class="impact-label">Region</span>
            <span class="impact-value">Kingston, ON</span>
          </div>
          <div class="impact-comparison">
            <div class="comparison-text">Add your city and postal code in Account Settings to enable distance and carbon savings calculations.</div>
          </div>
        `;
        if (impactScore) impactScore.textContent = 'A';
        return;
      }

      // Get farms with coordinates
      let farmsInCatalog = [];

      const mapFarmRecord = (farm) => {
        if (!farm || typeof farm !== 'object') return null;
        const location = farm.location || farm.farm_location || {};
        const coords = this.extractCoordinates(location) || this.extractCoordinates(farm);
        if (!coords) return null;

        return {
          farm_id: farm.farm_id || farm.farmId || farm.id || '',
          farm_name: farm.farm_name || farm.name || farm.farmId || 'Farm',
          city: location.city || location.town || location.municipality || '',
          state: location.state || location.province || location.region || '',
          latitude: coords.latitude,
          longitude: coords.longitude
        };
      };
      
      // Try demo farm data first if in demo mode
      if (this.demoMode && this.demoData?.farms) {
        farmsInCatalog = this.demoData.farms
          .map(mapFarmRecord)
          .filter(Boolean);
      }

      if (farmsInCatalog.length === 0 && Array.isArray(this.networkFarms) && this.networkFarms.length > 0) {
        farmsInCatalog = this.networkFarms
          .map(mapFarmRecord)
          .filter(Boolean);
      }
      
      // If no farms loaded yet, fetch buyer-safe wholesale network farms
      if (farmsInCatalog.length === 0) {
        try {
          const headers = {};
          if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
          const response = await fetch('/api/wholesale/network/farms', { headers });
          const data = await response.json();
          
          const farms = data?.data?.farms || [];
          if (response.ok && Array.isArray(farms) && farms.length > 0) {
            farmsInCatalog = farms
              .map(mapFarmRecord)
              .filter(Boolean);
          }
        } catch (error) {
          console.warn('Failed to load farms from wholesale network API:', error);
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
      const buyerLat = buyerLoc.latitude;
      const buyerLng = buyerLoc.longitude;

      const farmDistances = farmsInCatalog.map(farm => {
        const distance = this.calculateDistance(
          buyerLat,
          buyerLng,
          farm.latitude,
          farm.longitude
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

      const distanceDisplay = avgDistance < 1 ? '< 1' : avgDistance.toFixed(0);

      const html = `
        <div class="impact-metric">
          <span class="impact-label">Average Farm Distance</span>
          <span class="impact-value">${distanceDisplay} km</span>
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
    },

    /**
     * Initialize Square Web Payments SDK and attach card element
     */
    squarePayments: null,
    squareCard: null,
    squareCardAttached: false,
    squareAttachRecoveryInProgress: false,

    async initializeSquare() {
      if (!window.Square) {
        console.warn('Square SDK not loaded');
        return false;
      }

      try {
        if (!this.squarePayments || !this.squareCard) {
          // Fetch Square credentials from server
          const cfgRes = await fetch('/api/wholesale/payment/config');
          const cfgJson = await cfgRes.json();
          const appId = cfgJson?.data?.appId;
          const locationId = cfgJson?.data?.locationId;

          if (!appId || !locationId) {
            console.warn('Square credentials not configured on server');
            return false;
          }

          this.squarePayments = window.Square.payments(appId, locationId);
          this.squareCard = await this.squarePayments.card();
          this.squareCardAttached = false;
        }

        return await this.ensureSquareCardAttached({ showError: false });
      } catch (err) {
        console.error('Square init error:', err);
        this.squarePayments = null;
        this.squareCard = null;
        this.squareCardAttached = false;
        const displayError = document.getElementById('card-errors');
        if (displayError) displayError.textContent = 'Payment form could not load. Please refresh.';
        return false;
      }
    },

    async ensureSquareCardAttached({ showError = true } = {}) {
      if (!this.squareCard) return false;

      const checkoutView = document.getElementById('checkout-view');
      const cardElementContainer = document.getElementById('card-element');
      const checkoutIsActive = checkoutView?.classList?.contains('active');

      // Do not attach while checkout is hidden; retry after navigation.
      if (!checkoutIsActive || !cardElementContainer) {
        return false;
      }

      if (this.squareCardAttached) return true;

      try {
        await this.squareCard.attach('#card-element');
        this.squareCardAttached = true;
        const displayError = document.getElementById('card-errors');
        if (displayError) displayError.textContent = '';
        return true;
      } catch (err) {
        const errName = String(err?.name || '');
        const errMessage = String(err?.message || '');
        if (errName === 'PaymentMethodAlreadyAttachedError' || errMessage.includes('already been attached')) {
          this.squareCardAttached = true;
          const displayError = document.getElementById('card-errors');
          if (displayError) displayError.textContent = '';
          return true;
        }

        // Recover from transient Card instance errors by rebuilding once.
        if (!this.squareAttachRecoveryInProgress) {
          this.squareAttachRecoveryInProgress = true;
          try {
            const recovered = await this.rebuildSquareCard();
            if (recovered) return true;
          } finally {
            this.squareAttachRecoveryInProgress = false;
          }
        }

        console.error('Square attach error:', err);
        this.squareCardAttached = false;
        const displayError = document.getElementById('card-errors');
        if (showError && displayError) {
          displayError.textContent = 'Payment form could not load. Please refresh.';
        }
        return false;
      }
    },

    async rebuildSquareCard() {
      if (!this.squarePayments) return false;

      try {
        if (this.squareCard?.destroy) {
          await this.squareCard.destroy();
        }
      } catch (_) {
        // Ignore destroy failures for invalid/intermediate SDK states.
      }

      this.squareCard = null;
      this.squareCardAttached = false;

      try {
        this.squareCard = await this.squarePayments.card();
        await this.squareCard.attach('#card-element');
        this.squareCardAttached = true;
        const displayError = document.getElementById('card-errors');
        if (displayError) displayError.textContent = '';
        return true;
      } catch (err) {
        console.error('Square rebuild error:', err);
        return false;
      }
    },

    /**
     * Tokenize card via Square Web Payments SDK
     */
    async createPaymentToken() {
      if (!this.squarePayments || !this.squareCard) {
        throw new Error('Square payments not initialized');
      }

      const attached = await this.ensureSquareCardAttached();
      if (!attached) {
        throw new Error('Payment form is still loading. Please wait and try again.');
      }

      const result = await this.squareCard.tokenize();

      if (result.status === 'OK') {
        return result.token;
      }

      const msgs = (result.errors || []).map(e => e.message).join('; ');
      throw new Error(msgs || 'Card tokenization failed');
    },

    /**
     * Show saved card or new-card form in the checkout payment section.
     */
    async updateCheckoutCardDisplay() {
      const savedEl = document.getElementById('checkout-saved-card');
      const newEl = document.getElementById('checkout-new-card');
      if (!savedEl || !newEl) return;

      if (this.currentBuyer?.squareCardId) {
        try {
          const { response, json } = await this.apiFetch('/api/wholesale/buyers/me/card');
          if (response.ok && json?.status === 'ok' && (json.data.cards || []).length > 0) {
            const c = json.data.cards[0];
            document.getElementById('checkout-card-brand').textContent = c.brand || 'Card';
            document.getElementById('checkout-card-last4').textContent = c.last4 || '****';
            document.getElementById('checkout-card-exp').textContent = (c.expMonth || '??') + '/' + (c.expYear || '????');
            savedEl.style.display = '';
            newEl.style.display = 'none';
            return;
          }
        } catch (e) {
          console.error('Checkout card display error:', e);
        }
      }

      // No card on file -- show the card input form
      savedEl.style.display = 'none';
      newEl.style.display = '';
      this.initializeSquare();
      setTimeout(() => this.initializeSquare(), 500);
    },

    /**
     * Switch from saved-card display to fresh card form at checkout.
     */
    useNewCardAtCheckout() {
      const savedEl = document.getElementById('checkout-saved-card');
      const newEl = document.getElementById('checkout-new-card');
      if (savedEl) savedEl.style.display = 'none';
      if (newEl) newEl.style.display = '';
      this.initializeSquare();
      setTimeout(() => this.initializeSquare(), 500);
    },

    // === PRODUCT REQUESTS ===
    
    openProductRequestModal() {
      const modal = document.getElementById('product-request-modal');
      if (modal) {
        modal.style.display = 'flex';
        // Set minimum date to tomorrow
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const minDate = tomorrow.toISOString().split('T')[0];
        document.getElementById('request-needed-by').min = minDate;
      }
    },

    closeProductRequestModal() {
      const modal = document.getElementById('product-request-modal');
      if (modal) {
        modal.style.display = 'none';
        document.getElementById('product-request-form').reset();
      }
    },

    async submitProductRequest(e) {
      e.preventDefault();
      
      if (!this.currentBuyer) {
        this.showToast('Please sign in to submit a product request', 'error');
        return;
      }

      const formData = {
        buyer_id: this.currentBuyer.id,
        product_name: document.getElementById('request-product-name').value,
        quantity: parseFloat(document.getElementById('request-quantity').value),
        unit: document.getElementById('request-unit').value,
        needed_by_date: document.getElementById('request-needed-by').value,
        description: document.getElementById('request-description').value || null,
        max_price_per_unit: parseFloat(document.getElementById('request-max-price').value) || null,
        certifications_required: document.getElementById('request-organic').checked ? ['Organic'] : []
      };

      try {
        const response = await fetch('/api/wholesale/product-requests/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (!response.ok || !result.ok) {
          throw new Error(result.message || 'Failed to submit request');
        }

        this.showToast(`Request submitted! ${result.matched_farms} farms notified`, 'success');
        this.closeProductRequestModal();
        
        // Reload requests if on that view
        if (this.currentView === 'requests') {
          await this.loadProductRequests();
        }

      } catch (error) {
        console.error('Product request error:', error);
        this.showToast(error.message || 'Failed to submit request', 'error');
      }
    },

    async loadProductRequests() {
      if (!this.currentBuyer) return;

      try {
        const response = await fetch(`/api/wholesale/product-requests/buyer/${this.currentBuyer.id}`, {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        });

        const result = await response.json();

        if (response.ok && result.ok) {
          this.productRequests = result.requests || [];
          this.renderProductRequests();
        }

      } catch (error) {
        console.error('Failed to load product requests:', error);
      }
    },

    renderProductRequests() {
      const container = document.getElementById('requests-list');
      if (!container) return;

      if (!this.currentBuyer) {
        container.innerHTML = '<div class="order-empty"><div class="order-empty-icon">Locked</div><p>Please sign in to view your product requests.</p></div>';
        return;
      }

      if (!this.productRequests || !this.productRequests.length) {
        container.innerHTML = '<div class="order-empty"><div class="order-empty-icon">No Requests</div><p>No product requests yet. Use the "Request a Product" button in the catalog to submit one.</p></div>';
        return;
      }

      const statusColors = {
        open: 'pending',
        matched: 'confirmed',
        fulfilled: 'completed',
        expired: 'cancelled',
        cancelled: 'cancelled'
      };

      container.innerHTML = this.productRequests.map(req => {
        const statusClass = statusColors[req.status] || 'pending';
        const neededBy = req.needed_by_date
          ? new Date(req.needed_by_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : 'No date specified';
        const created = new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const certs = req.certifications_required && req.certifications_required.length
          ? req.certifications_required.map(c => '<span class="cert-tag">' + escapeHtml(c) + '</span>').join(' ')
          : '';
        const maxPrice = req.max_price_per_unit ? '$' + Number(req.max_price_per_unit).toFixed(2) + '/' + escapeHtml(req.unit || 'unit') : '';

        return '<div class="order-card">'
          + '<div class="order-header">'
          + '  <div class="order-id">' + escapeHtml(req.product_name) + '</div>'
          + '  <div class="order-status ' + statusClass + '">' + escapeHtml(req.status) + '</div>'
          + '</div>'
          + '<div class="order-meta">'
          + '  <div class="order-meta-item"><div class="order-meta-label">Quantity</div><div class="order-meta-value">' + escapeHtml(String(req.quantity)) + ' ' + escapeHtml(req.unit || 'units') + '</div></div>'
          + '  <div class="order-meta-item"><div class="order-meta-label">Needed By</div><div class="order-meta-value">' + neededBy + '</div></div>'
          + '  <div class="order-meta-item"><div class="order-meta-label">Submitted</div><div class="order-meta-value">' + created + '</div></div>'
          + (maxPrice ? '  <div class="order-meta-item"><div class="order-meta-label">Max Price</div><div class="order-meta-value">' + maxPrice + '</div></div>' : '')
          + '</div>'
          + (req.description ? '<div style="padding: 0 1.25rem 1rem; color: var(--text-secondary); font-size: 0.9rem;">' + escapeHtml(req.description) + '</div>' : '')
          + (certs ? '<div style="padding: 0 1.25rem 1rem;">' + certs + '</div>' : '')
          + (req.status === 'open' ? '<div style="padding: 0 1.25rem 1.25rem;"><button class="btn btn-secondary" onclick="WholesaleApp.cancelProductRequest(' + req.id + ')" style="font-size: 0.8rem;">Cancel Request</button></div>' : '')
          + '</div>';
      }).join('');
    },

    async cancelProductRequest(requestId) {
      if (!confirm('Cancel this product request?')) return;
      try {
        const { response, json } = await this.apiFetch('/api/wholesale/product-requests/' + requestId + '/cancel', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'cancelled' })
        });
        if (response.ok) {
          this.showToast('Request cancelled', 'success');
          this.loadProductRequests();
        } else {
          this.showToast(json?.error || 'Failed to cancel request', 'error');
        }
      } catch (err) {
        console.error('Cancel request failed:', err);
        this.showToast('Failed to cancel request', 'error');
      }
    },

    // === BATCH PAYMENTS ===
    
    openBatchPaymentModal() {
      // Get all unpaid orders
      const unpaidOrders = this.orders.filter(order => 
        order.payment_status === 'authorized' || order.payment_status === 'pending'
      );

      if (unpaidOrders.length === 0) {
        this.showToast('No outstanding invoices to pay', 'info');
        return;
      }

      // Group by farm and calculate totals
      const farmTotals = {};
      let grandTotal = 0;

      unpaidOrders.forEach(order => {
        const farmId = order.farm_id || 'MULTIPLE';
        if (!farmTotals[farmId]) {
          farmTotals[farmId] = {
            farm_name: order.farm_name || 'Multiple Farms',
            orders: [],
            total: 0
          };
        }
        farmTotals[farmId].orders.push(order);
        farmTotals[farmId].total += order.total_amount || 0;
        grandTotal += order.total_amount || 0;
      });

      // Render summary
      const summaryHtml = Object.values(farmTotals).map(farm => `
        <div style="padding: 0.75rem; border-bottom: 1px solid var(--border);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong>${escapeHtml(farm.farm_name)}</strong>
              <div style="font-size: 0.85rem; color: var(--text-secondary);">
                ${farm.orders.length} order${farm.orders.length !== 1 ? 's' : ''}
              </div>
            </div>
            <div style="font-weight: 600; color: var(--primary);">
              $${farm.total.toFixed(2)}
            </div>
          </div>
        </div>
      `).join('');

      document.getElementById('batch-payment-summary').innerHTML = summaryHtml;
      document.getElementById('batch-payment-total').textContent = `$${grandTotal.toFixed(2)}`;
      
      const modal = document.getElementById('batch-payment-modal');
      if (modal) {
        modal.style.display = 'flex';
      }
    },

    closeBatchPaymentModal() {
      const modal = document.getElementById('batch-payment-modal');
      if (modal) {
        modal.style.display = 'none';
      }
    },

    async processBatchPayment() {
      const btn = document.getElementById('process-batch-payment-btn');
      if (!btn) return;

      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = 'Processing...';

      try {
        const unpaidOrders = this.orders.filter(order => 
          order.payment_status === 'authorized' || order.payment_status === 'pending'
        );

        const orderIds = unpaidOrders.map(o => o.order_id);

        // In production, this would call the backend API
        const response = await fetch('/api/wholesale/orders/batch-payment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({ order_ids: orderIds })
        });

        const result = await response.json();

        if (!response.ok || !result.ok) {
          throw new Error(result.message || 'Payment failed');
        }

        this.showToast(`Successfully paid ${orderIds.length} invoice${orderIds.length !== 1 ? 's' : ''}`, 'success');
        this.closeBatchPaymentModal();
        
        // Reload orders
        await this.loadOrders();

      } catch (error) {
        console.error('Batch payment error:', error);
        this.showToast(error.message || 'Payment failed', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    },

    updatePayAllButton() {
      const payAllBtn = document.getElementById('pay-all-btn');
      if (!payAllBtn) return;

      const unpaidOrders = this.orders.filter(order => 
        order.payment_status === 'authorized' || order.payment_status === 'pending'
      );

      if (unpaidOrders.length > 0) {
        const total = unpaidOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
        payAllBtn.textContent = `Pay All Outstanding ($${total.toFixed(2)})`;
        payAllBtn.style.display = 'inline-block';
      } else {
        payAllBtn.style.display = 'none';
      }
    },

    // ── Donations (food_bank buyers) ─────────────────────────────────

    updateDonationsTabVisibility() {
      const tab = document.getElementById('donations-tab');
      if (!tab) return;
      const isFoodBank = this.currentBuyer?.buyerType === 'food_bank';
      tab.style.display = isFoodBank ? '' : 'none';
      if (isFoodBank) this.loadDonations();
    },

    async loadDonations() {
      if (!this.currentBuyer || this.currentBuyer.buyerType !== 'food_bank') return;
      await Promise.all([this.loadAvailableDonations(), this.loadClaimedDonations()]);
    },

    async loadAvailableDonations() {
      const container = document.getElementById('donation-offers-list');
      if (!container) return;
      container.innerHTML = '<p style="color: var(--text-secondary);">Loading available donations...</p>';

      try {
        const { response, json } = await this.apiFetch('/api/wholesale/donations/available');
        if (!response.ok || json?.status !== 'ok') {
          container.innerHTML = '<p style="color: var(--text-secondary);">Unable to load donations at this time.</p>';
          return;
        }
        const offers = json.data?.offers || [];
        if (offers.length === 0) {
          container.innerHTML = '<p style="color: var(--text-secondary);">No surplus produce currently available. You will be notified by email when new donations are posted.</p>';
          return;
        }
        container.innerHTML = offers.map(offer => this.renderDonationOfferCard(offer)).join('');
      } catch (err) {
        console.error('Load donations error:', err);
        container.innerHTML = '<p style="color: var(--text-secondary);">Error loading donations.</p>';
      }
    },

    renderDonationOfferCard(offer) {
      const items = offer.items || [];
      const totalFmv = items.reduce((s, i) => s + Number(i.fair_market_value || 0), 0);
      const reasonLabel = { surplus: 'Surplus', planned: 'Planned', seasonal: 'Seasonal', end_of_day: 'End of Day' }[offer.reason] || offer.reason;
      const expiresAt = offer.expires_at ? new Date(offer.expires_at).toLocaleDateString('en-CA') : 'No expiry';

      return `
        <div class="order-card" style="border-left: 4px solid #2d5016;" data-offer-id="${offer.id}">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <h3 style="margin: 0 0 0.25rem 0;">Donation Offer</h3>
              <p style="margin: 0; font-size: 0.85rem; color: var(--text-secondary);">
                ${reasonLabel} | Farm: ${offer.farm_id} | Available until: ${expiresAt}
              </p>
              ${offer.pickup_window ? `<p style="margin: 0.25rem 0 0 0; font-size: 0.85rem;">Pickup: ${offer.pickup_window}</p>` : ''}
            </div>
            <span style="background: #e8f5e9; color: #2d5016; padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600;">
              FMV $${totalFmv.toFixed(2)}
            </span>
          </div>
          <div style="margin-top: 0.75rem;">
            <table style="width: 100%; font-size: 0.9rem; border-collapse: collapse;">
              <thead>
                <tr style="border-bottom: 1px solid var(--border-color);">
                  <th style="text-align: left; padding: 0.35rem 0;">Product</th>
                  <th style="text-align: right; padding: 0.35rem 0;">Available</th>
                  <th style="text-align: right; padding: 0.35rem 0;">Claim Qty</th>
                </tr>
              </thead>
              <tbody>
                ${items.map(item => `
                  <tr>
                    <td style="padding: 0.35rem 0;">${item.product_name}${item.category ? ` <span style="color:var(--text-secondary);font-size:0.8rem;">(${item.category})</span>` : ''}</td>
                    <td style="text-align: right; padding: 0.35rem 0;">${item.remaining_qty} ${item.unit || 'lbs'}</td>
                    <td style="text-align: right; padding: 0.35rem 0;">
                      <input type="number" min="0" max="${item.remaining_qty}" step="0.5" value="${item.remaining_qty}"
                             class="donation-claim-qty" data-product="${item.product_name}"
                             style="width: 70px; padding: 0.25rem; text-align: right; border: 1px solid var(--border-color); border-radius: 4px;" />
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${offer.notes ? `<p style="margin: 0.5rem 0 0 0; font-size: 0.85rem; color: var(--text-secondary);">Note: ${offer.notes}</p>` : ''}
          <div style="margin-top: 0.75rem; text-align: right;">
            <button class="btn btn-primary" onclick="WholesaleApp.claimDonation('${offer.id}')" style="background: #2d5016;">
              Claim Donation
            </button>
          </div>
        </div>`;
    },

    async claimDonation(offerId) {
      const card = document.querySelector(`[data-offer-id="${offerId}"]`);
      if (!card) return;

      const inputs = card.querySelectorAll('.donation-claim-qty');
      const items = [];
      inputs.forEach(input => {
        const qty = parseFloat(input.value);
        if (qty > 0) {
          items.push({ product_name: input.dataset.product, quantity: qty });
        }
      });

      if (items.length === 0) {
        this.showToast('Enter quantities to claim', 'info');
        return;
      }

      try {
        const { response, json } = await this.apiFetch('/api/wholesale/donations/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offer_id: offerId, items })
        });

        if (response.ok && json?.status === 'ok') {
          this.showToast(`Donation claimed. Order ${json.data.order_id} created.`, 'success');
          this.loadDonations();
        } else {
          this.showToast(json?.message || 'Failed to claim donation', 'error');
        }
      } catch (err) {
        console.error('Claim donation error:', err);
        this.showToast('Error claiming donation', 'error');
      }
    },

    async loadClaimedDonations() {
      const container = document.getElementById('claimed-donations-list');
      if (!container) return;

      try {
        const { response, json } = await this.apiFetch('/api/wholesale/donations/my-claims');
        if (!response.ok || json?.status !== 'ok') {
          container.innerHTML = '<p style="color: var(--text-secondary);">Unable to load claim history.</p>';
          return;
        }
        const claims = json.data?.claims || [];
        if (claims.length === 0) {
          container.innerHTML = '<p style="color: var(--text-secondary);">No donations claimed yet.</p>';
          return;
        }
        container.innerHTML = claims.map(claim => this.renderClaimedDonationCard(claim)).join('');
      } catch (err) {
        console.error('Load claimed donations error:', err);
        container.innerHTML = '<p style="color: var(--text-secondary);">Error loading claim history.</p>';
      }
    },

    renderClaimedDonationCard(claim) {
      const items = claim.items || [];
      const totalFmv = items.reduce((s, i) => s + Number(i.fair_market_value || 0), 0);
      const statusColors = { claimed: '#1565c0', fulfilled: '#2d5016', cancelled: '#c62828' };
      const statusColor = statusColors[claim.status] || '#666';
      const claimedDate = new Date(claim.claimed_at).toLocaleDateString('en-CA');

      return `
        <div class="order-card" style="border-left: 4px solid ${statusColor};">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <h3 style="margin: 0 0 0.25rem 0;">${claim.id}</h3>
              <p style="margin: 0; font-size: 0.85rem; color: var(--text-secondary);">
                Claimed: ${claimedDate} | Farm: ${claim.farm_id} | Order: ${claim.order_id || 'N/A'}
              </p>
            </div>
            <div style="text-align: right;">
              <span style="background: ${statusColor}22; color: ${statusColor}; padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600;">
                ${claim.status}
              </span>
              <div style="font-size: 0.85rem; margin-top: 0.25rem; color: var(--text-secondary);">FMV $${totalFmv.toFixed(2)}</div>
            </div>
          </div>
          <div style="margin-top: 0.5rem;">
            ${items.map(i => `<span style="display: inline-block; background: var(--bg-card); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.85rem; margin: 0.15rem 0.15rem 0 0;">${i.quantity} ${i.unit || 'lbs'} ${i.product_name}</span>`).join('')}
          </div>
          ${claim.status === 'claimed' ? `<div style="margin-top: 0.5rem; text-align: right;">
            <button class="btn btn-secondary" onclick="WholesaleApp.cancelDonationClaim('${claim.id}')" style="font-size: 0.85rem;">Cancel Claim</button>
          </div>` : ''}
        </div>`;
    },

    async cancelDonationClaim(claimId) {
      if (!confirm('Cancel this donation claim?')) return;
      try {
        const { response, json } = await this.apiFetch(`/api/wholesale/donations/claims/${claimId}/cancel`, {
          method: 'POST'
        });
        if (response.ok && json?.status === 'ok') {
          this.showToast('Claim cancelled', 'info');
          this.loadDonations();
        } else {
          this.showToast(json?.message || 'Failed to cancel claim', 'error');
        }
      } catch (err) {
        console.error('Cancel claim error:', err);
        this.showToast('Error cancelling claim', 'error');
      }
    }
  };

  window.WholesaleApp = app;

  document.addEventListener('DOMContentLoaded', () => {
    app.init();
    
    // Initialize Square when navigating to checkout
    const checkoutNavBtn = document.querySelector('[data-view="checkout"]');
    if (checkoutNavBtn) {
      checkoutNavBtn.addEventListener('click', () => {
        setTimeout(() => {
          app.initializeSquare();
        }, 100);
      });
    }
    
    // Handle place order button
    const placeOrderBtn = document.getElementById('place-order-btn');
    if (placeOrderBtn) {
      placeOrderBtn.addEventListener('click', () => {
        app.placeOrder();
      });
    }

    // Product request modal handlers
    const requestProductBtn = document.getElementById('request-product-btn');
    if (requestProductBtn) {
      requestProductBtn.addEventListener('click', () => {
        app.openProductRequestModal();
      });
    }

    const closeRequestBtns = document.querySelectorAll('[data-action="close-product-request"]');
    closeRequestBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        app.closeProductRequestModal();
      });
    });

    const productRequestForm = document.getElementById('product-request-form');
    if (productRequestForm) {
      productRequestForm.addEventListener('submit', (e) => {
        app.submitProductRequest(e);
      });
    }

    // Batch payment handlers
    const payAllBtn = document.getElementById('pay-all-btn');
    if (payAllBtn) {
      payAllBtn.addEventListener('click', () => {
        app.openBatchPaymentModal();
      });
    }

    const closeBatchPaymentBtns = document.querySelectorAll('[data-action="close-batch-payment"]');
    closeBatchPaymentBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        app.closeBatchPaymentModal();
      });
    });

    const processBatchPaymentBtn = document.getElementById('process-batch-payment-btn');
    if (processBatchPaymentBtn) {
      processBatchPaymentBtn.addEventListener('click', () => {
        app.processBatchPayment();
      });
    }
  });
})();
