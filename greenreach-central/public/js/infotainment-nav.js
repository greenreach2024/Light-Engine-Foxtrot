/**
 * infotainment-nav.js
 * 3-level navigation state machine for LE-farm-admin.html
 *
 * Levels:
 *   0 = Home (dashboard + category grid)
 *   1 = Category detail (sub-item grid)
 *   2 = Page view (content-section or iframe)
 *
 * Preserves the existing renderEmbeddedView / data-section / data-url contract
 * from farm-admin.js so EVIE, onboarding, and plan-features keep working.
 */
(function () {
  'use strict';

  // ---- Data: Category -> Sub-items ----
  var CATEGORIES = {
    growing: {
      label: 'Growing',
      icon: 'icon-growing',
      items: [
        { id: 'planting-scheduler', label: 'Planting Scheduler', icon: 'icon-planting-scheduler', section: 'iframe-view', url: '/views/planting-scheduler.html' },
        { id: 'tray-setup',         label: 'Tray Setup',         icon: 'icon-tray-setup',         section: 'iframe-view', url: '/views/tray-setup.html' },
        { id: 'nutrient-mgmt',      label: 'Nutrient Management', icon: 'icon-nutrient',          section: 'iframe-view', url: '/views/nutrient-management.html' },
        { id: 'farm-inventory',     label: 'Crop Inventory',      icon: 'icon-crop-inventory',    section: 'iframe-view', url: '/views/farm-inventory.html' },
        { id: 'crop-weight',        label: 'Crop Weight Analytics', icon: 'icon-weight-analytics', section: 'iframe-view', url: '/views/crop-weight-analytics.html' },
        { id: 'room-heatmap',       label: 'Heat Map',            icon: 'icon-heatmap',           section: 'iframe-view', url: '/views/room-heatmap.html' },
        { id: 'farm-vitality',      label: 'Farm Vitality',       icon: 'icon-vitality',          section: 'external',    url: '/farm-vitality.html' }
      ]
    },
    operations: {
      label: 'Operations',
      icon: 'icon-operations',
      items: [
        { id: 'farm-summary',  label: 'Farm Summary',  icon: 'icon-farm-summary',  section: 'iframe-view', url: '/views/farm-summary.html' },
        { id: 'activity-hub',  label: 'Activity Hub',  icon: 'icon-activity-hub',  section: 'iframe-view', url: '/views/tray-inventory.html' },
        { id: 'setup-update',  label: 'Setup / Update', icon: 'icon-setup',        section: 'iframe-view', url: '/LE-dashboard.html' },
        { id: 'devices',       label: 'Devices',        icon: 'icon-devices',      section: 'devices' },
        { id: 'supplies',      label: 'Supplies',       icon: 'icon-supplies',     section: 'inventory-mgmt' },
        { id: 'calendar',      label: 'Calendar',       icon: 'icon-calendar',     section: 'iframe-view', url: '/views/calendar.html' },
        { id: 'evie-core',         label: 'E.V.I.E. Core',        icon: 'icon-evie',        section: 'iframe-view', url: '/evie-core.html' },
        { id: 'gwen',              label: 'G.W.E.N.',             icon: 'icon-gwen',        section: 'iframe-view', url: '/gwen-core.html' },
        { id: 'research-workspace', label: 'Research Workspace',  icon: 'icon-research',    section: 'iframe-view', url: '/views/research-workspace.html' },
        { id: 'research-overview',  label: 'Research Overview',   icon: 'icon-research',    section: 'iframe-view', url: '/research-subscription.html' }
      ]
    },
    business: {
      label: 'Business',
      icon: 'icon-business',
      items: [
        { id: 'farm-sales',       label: 'Farm Sales Terminal', icon: 'icon-pos',           section: 'iframe-view', url: '/farm-sales-pos.html' },
        { id: 'wholesale-orders', label: 'Wholesale Orders',    icon: 'icon-wholesale',     section: 'wholesale-orders' },
        { id: 'procurement',      label: 'Procurement',         icon: 'icon-procurement',   section: 'iframe-view', url: '/views/procurement-portal.html' },
        { id: 'pricing',          label: 'Pricing',             icon: 'icon-pricing',       section: 'pricing' },
        { id: 'crop-value',       label: 'Crop Value',          icon: 'icon-crop-value',    section: 'crop-value' },
        { id: 'traceability',     label: 'Lot Traceability',    icon: 'icon-traceability',  section: 'traceability' },
        { id: 'sustainability',   label: 'Sustainability',      icon: 'icon-sustainability', section: 'sustainability' },
        { id: 'quality',          label: 'Quality Control',     icon: 'icon-quality',       section: 'quality' },
        { id: 'accounting',       label: 'Accounting',          icon: 'icon-accounting',    section: 'accounting' }
      ]
    },
    settings: {
      label: 'Settings',
      icon: 'icon-settings',
      items: [
        { id: 'users',    label: 'Users',    icon: 'icon-users',    section: 'users' },
        { id: 'settings', label: 'Settings', icon: 'icon-settings', section: 'settings' },
        { id: 'exports',  label: 'Exports',  icon: 'icon-exports',  section: 'exports' },
        { id: 'payments', label: 'Payments', icon: 'icon-payments', section: 'payments' },
        { id: 'help',     label: 'Help',     icon: 'icon-help',     section: 'help' },
        { id: 'contact-support', label: 'Contact Support', icon: 'icon-help', section: 'external', url: 'mailto:support@lightengine.io' },
      ]
    }
  };

  // ---- State ----
  var currentLevel = 0;
  var currentCategory = null;
  var currentItem = null;

  // ---- DOM refs (set in init) ----
  var layerHome = null;
  var layerCategory = null;
  var layerContent = null;
  var breadcrumbBar = null;
  var categoryGrid = null;
  var subGrid = null;
  var dashboardSection = null;

  // ---- SVG helper ----
  function svgUse(iconId, cls) {
    return '<svg class="' + (cls || '') + '" aria-hidden="true"><use href="/icons/farm-nav-icons.svg#' + iconId + '"/></svg>';
  }

  // ---- Move content-sections from old layout into infotainment layers ----
  function rearrangeDOM() {
    // Move dashboard into home layer (before category grid)
    if (dashboardSection && layerHome) {
      var grid = document.getElementById('infotainment-category-grid');
      layerHome.insertBefore(dashboardSection, grid);
      dashboardSection.style.display = 'block';
    }

    // Move iframe view + remaining content-sections into content layer
    var mainContent = document.querySelector('.main-content');
    if (mainContent && layerContent) {
      var sections = mainContent.querySelectorAll('.content-section');
      for (var i = 0; i < sections.length; i++) {
        layerContent.appendChild(sections[i]);
      }
    }
  }

  // ---- Bind hero bar elements ----
  function bindHeroBar() {
    // EVIE orb click opens EVIE chat
    var orb = document.getElementById('evie-hero-orb');
    if (orb) {
      orb.addEventListener('click', function () {
        if (window.EVIE && window.EVIE.open) window.EVIE.open();
      });
    }

    // Mirror farm name from page header
    var srcName = document.getElementById('farmNameHeader');
    var heroName = document.getElementById('evie-hero-farm-name');
    if (srcName && heroName) heroName.textContent = srcName.textContent;

    // Populate environment chip from latest sensor data if available
    try {
      var envChip = document.getElementById('chip-environment');
      if (envChip && window.sensorData) {
        var t = window.sensorData.temperature;
        var h = window.sensorData.humidity;
        if (t != null && h != null) {
          envChip.textContent = Math.round(t) + ' F / ' + Math.round(h) + '%';
        }
      }
    } catch (ignore) {}
  }

  // ---- Build home layer (dashboard + category grid) ----
  function buildHomeLayer() {
    categoryGrid = document.getElementById('infotainment-category-grid');
    if (!categoryGrid) return;

    var html = '';
    var keys = ['growing', 'operations', 'business', 'settings'];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var cat = CATEGORIES[key];
      html += '<button class="infotainment-tile infotainment-tile--' + key + '" data-category="' + key + '">'
            + svgUse(cat.icon, 'infotainment-tile__icon')
            + '<span class="infotainment-tile__label">' + cat.label + '</span>'
            + '<span class="infotainment-tile__count">' + cat.items.length + ' items</span>'
            + '</button>';
    }
    categoryGrid.innerHTML = html;

    // Bind clicks
    categoryGrid.addEventListener('click', function (e) {
      var tile = e.target.closest('[data-category]');
      if (tile) navigateToCategory(tile.dataset.category);
    });
  }

  // ---- Render sub-item grid for a category ----
  function buildSubGrid(catKey) {
    subGrid = document.getElementById('infotainment-sub-grid');
    if (!subGrid) return;

    var cat = CATEGORIES[catKey];
    if (!cat) return;

    subGrid.className = 'infotainment-sub-grid infotainment-sub-grid--' + catKey;

    var html = '';
    for (var i = 0; i < cat.items.length; i++) {
      var item = cat.items[i];
      html += '<button class="infotainment-sub-tile" data-item-id="' + item.id + '" data-cat="' + catKey + '">'
            + svgUse(item.icon, 'infotainment-sub-tile__icon')
            + '<span class="infotainment-sub-tile__label">' + item.label + '</span>'
            + '</button>';
    }
    subGrid.innerHTML = html;
  }

  // ---- Show / hide layers ----
  function setActiveLayer(level) {
    if (layerHome) layerHome.classList.toggle('is-active', level === 0);
    if (layerCategory) layerCategory.classList.toggle('is-active', level === 1);
    if (layerContent) layerContent.classList.toggle('is-active', level === 2);
    currentLevel = level;
    updateBreadcrumb();
  }

  // ---- Navigation functions ----
  function navigateHome() {
    currentCategory = null;
    currentItem = null;
    // Show dashboard section within home layer
    showDashboardInHome();
    setActiveLayer(0);
    history.replaceState(null, '', window.location.pathname);
  }

  function navigateToCategory(catKey) {
    var cat = CATEGORIES[catKey];
    if (!cat) return;
    currentCategory = catKey;
    currentItem = null;
    buildSubGrid(catKey);
    setActiveLayer(1);
    history.replaceState(null, '', window.location.pathname + '#' + catKey);
  }

  function navigateToItem(catKey, itemId) {
    var cat = CATEGORIES[catKey];
    if (!cat) return;

    var item = null;
    for (var i = 0; i < cat.items.length; i++) {
      if (cat.items[i].id === itemId) { item = cat.items[i]; break; }
    }
    if (!item) return;

    currentCategory = catKey;
    currentItem = item;

    // Hide all content-sections in the content layer
    var sections = layerContent.querySelectorAll('.content-section');
    for (var j = 0; j < sections.length; j++) sections[j].style.display = 'none';

    if (item.section === 'external') {
      // Open in same tab (farm-vitality)
      window.location.href = item.url;
      return;
    }

    if (item.section === 'iframe-view' && item.url) {
      // Use the existing renderEmbeddedView if available, else direct
      if (typeof window.renderEmbeddedView === 'function') {
        window.renderEmbeddedView(item.url, item.label);
      } else {
        var iframe = document.getElementById('admin-iframe');
        var iframeSec = document.getElementById('section-iframe-view');
        if (iframe && iframeSec) {
          iframe.src = item.url + (item.url.indexOf('?') >= 0 ? '&' : '?') + 'embedded=1';
          iframeSec.style.display = 'block';
        }
      }
    } else {
      // Show the matching content-section
      var sectionEl = document.getElementById('section-' + item.section);
      if (sectionEl) sectionEl.style.display = 'block';

      // Trigger section-specific data loaders (same as farm-admin.js setupNavigation)
      triggerSectionLoader(item.section);
    }

    setActiveLayer(2);
    history.replaceState(null, '', window.location.pathname + '#' + catKey + '/' + itemId);
  }

  function triggerSectionLoader(section) {
    // These functions are defined in farm-admin.js / inline scripts
    switch (section) {
      case 'wholesale-orders':
        if (typeof refreshWholesaleOrders === 'function') refreshWholesaleOrders();
        break;
      case 'accounting':
        if (typeof loadAccountingData === 'function') loadAccountingData();
        break;
      case 'payments':
        if (typeof loadPaymentMethods === 'function') loadPaymentMethods();
        break;
      case 'settings':
        if (typeof loadSettings === 'function') loadSettings();
        break;
      case 'users':
        if (typeof loadUsers === 'function') loadUsers();
        break;
      case 'quality':
        if (typeof loadQualityControl === 'function') loadQualityControl();
        break;
      case 'traceability':
        if (typeof loadTraceRecords === 'function') loadTraceRecords();
        break;
      case 'inventory-mgmt':
        if (typeof loadInventoryDashboard === 'function') loadInventoryDashboard();
        if (typeof loadSeeds === 'function') loadSeeds();
        break;
      case 'sustainability':
        if (typeof loadSustainabilityDashboard === 'function') loadSustainabilityDashboard();
        break;
    }
  }

  function showDashboardInHome() {
    // The dashboard section lives inside layerHome
    if (dashboardSection) dashboardSection.style.display = 'block';
  }

  // ---- Breadcrumb ----
  function updateBreadcrumb() {
    if (!breadcrumbBar) return;

    if (currentLevel === 0) {
      breadcrumbBar.style.display = 'none';
      return;
    }

    breadcrumbBar.style.display = 'flex';
    var parts = [];

    // Back button
    parts.push('<button class="infotainment-breadcrumb__back" id="breadcrumb-back">'
      + svgUse('icon-back') + '</button>');

    // Home
    parts.push('<span class="infotainment-breadcrumb__link" data-bc-level="0">Home</span>');

    if (currentCategory) {
      var cat = CATEGORIES[currentCategory];
      if (currentLevel === 1) {
        parts.push('<span class="infotainment-breadcrumb__sep">/</span>');
        parts.push('<span class="infotainment-breadcrumb__current">' + cat.label + '</span>');
      } else if (currentLevel === 2 && currentItem) {
        parts.push('<span class="infotainment-breadcrumb__sep">/</span>');
        parts.push('<span class="infotainment-breadcrumb__link" data-bc-level="1" data-bc-cat="' + currentCategory + '">' + cat.label + '</span>');
        parts.push('<span class="infotainment-breadcrumb__sep">/</span>');
        parts.push('<span class="infotainment-breadcrumb__current">' + currentItem.label + '</span>');
      }
    }

    breadcrumbBar.innerHTML = parts.join('');
  }

  // ---- Breadcrumb click delegation ----
  function handleBreadcrumbClick(e) {
    var backBtn = e.target.closest('#breadcrumb-back');
    if (backBtn) {
      goBack();
      return;
    }
    var link = e.target.closest('[data-bc-level]');
    if (!link) return;
    var level = parseInt(link.dataset.bcLevel, 10);
    if (level === 0) navigateHome();
    else if (level === 1 && link.dataset.bcCat) navigateToCategory(link.dataset.bcCat);
  }

  function goBack() {
    if (currentLevel === 2) {
      navigateToCategory(currentCategory);
    } else if (currentLevel === 1) {
      navigateHome();
    }
  }

  // ---- Hash-based deep linking (on load) ----
  function handleInitialHash() {
    var hash = window.location.hash.replace('#', '');
    if (!hash) return false;

    var parts = hash.split('/');
    var catKey = parts[0];
    var itemId = parts[1];

    // Check if it's a category
    if (CATEGORIES[catKey]) {
      if (itemId) {
        navigateToItem(catKey, itemId);
      } else {
        navigateToCategory(catKey);
      }
      return true;
    }

    // Legacy hash (e.g. #traceability, #wholesale-orders) -- find which category owns it
    var found = findItemBySection(hash);
    if (found) {
      navigateToItem(found.catKey, found.item.id);
      return true;
    }

    return false;
  }

  function findItemBySection(sectionName) {
    var keys = Object.keys(CATEGORIES);
    for (var k = 0; k < keys.length; k++) {
      var cat = CATEGORIES[keys[k]];
      for (var i = 0; i < cat.items.length; i++) {
        if (cat.items[i].section === sectionName) {
          return { catKey: keys[k], item: cat.items[i] };
        }
      }
    }
    return null;
  }

  // ---- Sub-grid click delegation ----
  function handleSubGridClick(e) {
    var tile = e.target.closest('[data-item-id]');
    if (!tile) return;
    navigateToItem(tile.dataset.cat, tile.dataset.itemId);
  }

  // ---- postMessage listener for le-nav.js and EVIE ----
  function handleExternalNav(e) {
    if (!e.data) return;
    if (e.data.type === 'le-nav' && e.data.action === 'dashboard') {
      navigateHome();
    }
  }

  // ---- Compatibility: patch the old .nav-item[data-section] click API ----
  // Other scripts call navItem.click() to navigate. We need these to still work.
  function patchLegacyNavItems() {
    var legacy = document.querySelectorAll('.nav-item[data-section]');
    for (var i = 0; i < legacy.length; i++) {
      (function (el) {
        el.addEventListener('click', function (e) {
          e.preventDefault(); e.stopImmediatePropagation();
          var section = el.dataset.section;
          var url = el.dataset.url;

          if (section === 'dashboard') {
            navigateHome();
            return;
          }

          // Find the item
          if (section === 'iframe-view' && url) {
            var found = findItemByUrl(url);
            if (found) {
              navigateToItem(found.catKey, found.item.id);
              return;
            }
            // Fallback: render directly
            if (typeof window.renderEmbeddedView === 'function') {
              window.renderEmbeddedView(url, el.textContent.trim());
            }
            setActiveLayer(2);
            return;
          }

          var foundSection = findItemBySection(section);
          if (foundSection) {
            navigateToItem(foundSection.catKey, foundSection.item.id);
          }
        }, true);
      })(legacy[i]);
    }
  }

  function findItemByUrl(url) {
    // Strip query params for matching
    var baseUrl = url.split('?')[0];
    var keys = Object.keys(CATEGORIES);
    for (var k = 0; k < keys.length; k++) {
      var cat = CATEGORIES[keys[k]];
      for (var i = 0; i < cat.items.length; i++) {
        var itemUrl = (cat.items[i].url || '').split('?')[0];
        if (itemUrl === baseUrl) {
          return { catKey: keys[k], item: cat.items[i] };
        }
      }
    }
    return null;
  }

  // ---- Public API (for EVIE, search-routing, external callers) ----
  window.InfoNav = {
    home: navigateHome,
    category: navigateToCategory,
    item: navigateToItem,
    goBack: goBack,
    getState: function () {
      return { level: currentLevel, category: currentCategory, item: currentItem };
    },
    categories: CATEGORIES,
    findItemBySection: findItemBySection,
    findItemByUrl: findItemByUrl
  };

  // ---- Init ----
  function init() {
    layerHome = document.getElementById('infotainment-layer-home');
    layerCategory = document.getElementById('infotainment-layer-category');
    layerContent = document.getElementById('infotainment-layer-content');
    breadcrumbBar = document.getElementById('infotainment-breadcrumb');
    dashboardSection = document.getElementById('section-dashboard');

    if (!layerHome || !layerCategory || !layerContent) {
      console.warn('[InfoNav] Missing layout elements -- skipping init');
      return;
    }

    // Move DOM elements from old layout into infotainment layers
    rearrangeDOM();

    // Activate infotainment mode
    document.body.classList.add('infotainment-active');

    buildHomeLayer();

    // Wire up hero bar (orb, farm name, chips)
    bindHeroBar();

    // Bind sub-grid clicks (delegation on the container)
    var subContainer = document.getElementById('infotainment-sub-grid');
    if (subContainer) subContainer.addEventListener('click', handleSubGridClick);

    // Bind breadcrumb clicks
    if (breadcrumbBar) breadcrumbBar.addEventListener('click', handleBreadcrumbClick);

    // Listen for iframe postMessages
    window.addEventListener('message', handleExternalNav);

    // Patch legacy nav items for backward compat
    patchLegacyNavItems();

    // Initial route
    if (!handleInitialHash()) {
      navigateHome();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
