/**
 * search-routing.js
 * Natural-language search bar for the EVIE hero bar.
 *
 * Strategy:
 *   1. Fuzzy keyword match against a flat route table
 *   2. If no match: offer "Ask E.V.I.E." as the final result
 *
 * Binds to #evie-search-input and #evie-search-results.
 */
(function () {
  'use strict';

  // ---- Route table: keywords -> navigation target ----
  // Each entry: { keywords[], label, icon, category, catKey, itemId }
  // catKey + itemId map to InfoNav.item(catKey, itemId)
  var ROUTES = [
    // Growing
    { keywords: ['planting', 'scheduler', 'schedule', 'plan', 'seed', 'sowing'], label: 'Planting Scheduler', icon: 'icon-planting-scheduler', category: 'Growing', catKey: 'growing', itemId: 'planting-scheduler' },
    { keywords: ['tray', 'setup', 'tray setup', 'trays', 'media'], label: 'Tray Setup', icon: 'icon-tray-setup', category: 'Growing', catKey: 'growing', itemId: 'tray-setup' },
    { keywords: ['nutrient', 'nutrients', 'feed', 'feeding', 'ec', 'ph', 'solution'], label: 'Nutrient Management', icon: 'icon-nutrient', category: 'Growing', catKey: 'growing', itemId: 'nutrient-mgmt' },
    { keywords: ['inventory', 'crop inventory', 'crops', 'plants', 'what is growing'], label: 'Crop Inventory', icon: 'icon-crop-inventory', category: 'Growing', catKey: 'growing', itemId: 'farm-inventory' },
    { keywords: ['weight', 'harvest weight', 'yield', 'analytics', 'crop weight', 'benchmark'], label: 'Crop Weight Analytics', icon: 'icon-weight-analytics', category: 'Growing', catKey: 'growing', itemId: 'crop-weight' },
    { keywords: ['heatmap', 'heat map', 'temperature map', 'hot spot', 'thermal'], label: 'Heat Map', icon: 'icon-heatmap', category: 'Growing', catKey: 'growing', itemId: 'room-heatmap' },
    { keywords: ['vitality', 'farm vitality', 'health', 'efficiency', 'rings'], label: 'Farm Vitality', icon: 'icon-vitality', category: 'Growing', catKey: 'growing', itemId: 'farm-vitality' },

    // Operations
    { keywords: ['summary', 'farm summary', 'environment', 'overview', 'rooms', 'zones', 'vpd', 'co2', 'humidity', 'temperature'], label: 'Farm Summary', icon: 'icon-farm-summary', category: 'Operations', catKey: 'operations', itemId: 'farm-summary' },
    { keywords: ['activity', 'activity hub', 'tray scan', 'qr', 'movements', 'scan'], label: 'Activity Hub', icon: 'icon-activity-hub', category: 'Operations', catKey: 'operations', itemId: 'activity-hub' },
    { keywords: ['setup', 'update', 'configure', 'configuration', 'dashboard setup', 'recipes', 'groups'], label: 'Setup / Update', icon: 'icon-setup', category: 'Operations', catKey: 'operations', itemId: 'setup-update' },
    { keywords: ['device', 'devices', 'iot', 'sensor', 'sensors', 'switchbot'], label: 'Devices', icon: 'icon-devices', category: 'Operations', catKey: 'operations', itemId: 'devices' },
    { keywords: ['supplies', 'supply', 'packaging', 'equipment', 'lab', 'maintenance', 'reorder'], label: 'Supplies', icon: 'icon-supplies', category: 'Operations', catKey: 'operations', itemId: 'supplies' },
    { keywords: ['calendar', 'schedule', 'event', 'events', 'task', 'tasks'], label: 'Calendar', icon: 'icon-calendar', category: 'Operations', catKey: 'operations', itemId: 'calendar' },

    // Business
    { keywords: ['sales', 'pos', 'point of sale', 'retail', 'transaction', 'cash register'], label: 'Farm Sales Terminal', icon: 'icon-pos', category: 'Business', catKey: 'business', itemId: 'farm-sales' },
    { keywords: ['wholesale', 'orders', 'wholesale orders', 'buyer', 'bulk'], label: 'Wholesale Orders', icon: 'icon-wholesale', category: 'Business', catKey: 'business', itemId: 'wholesale-orders' },
    { keywords: ['procurement', 'purchase', 'supplier', 'order supplies', 'catalog'], label: 'Procurement', icon: 'icon-procurement', category: 'Business', catKey: 'business', itemId: 'procurement' },
    { keywords: ['pricing', 'price', 'prices', 'markup', 'margin', 'cost'], label: 'Pricing', icon: 'icon-pricing', category: 'Business', catKey: 'business', itemId: 'pricing' },
    { keywords: ['crop value', 'value', 'revenue', 'crop revenue'], label: 'Crop Value', icon: 'icon-crop-value', category: 'Business', catKey: 'business', itemId: 'crop-value' },
    { keywords: ['traceability', 'trace', 'lot', 'lot code', 'sfcr', 'recall', 'chain'], label: 'Lot Traceability', icon: 'icon-traceability', category: 'Business', catKey: 'business', itemId: 'traceability' },
    { keywords: ['sustainability', 'esg', 'carbon', 'food miles', 'utility', 'environmental'], label: 'Sustainability', icon: 'icon-sustainability', category: 'Business', catKey: 'business', itemId: 'sustainability' },
    { keywords: ['quality', 'qa', 'inspection', 'standards', 'quality control'], label: 'Quality Control', icon: 'icon-quality', category: 'Business', catKey: 'business', itemId: 'quality' },
    { keywords: ['accounting', 'finance', 'financial', 'report', 'ledger', 'quickbooks'], label: 'Accounting', icon: 'icon-accounting', category: 'Business', catKey: 'business', itemId: 'accounting' },

    // Settings
    { keywords: ['users', 'user', 'team', 'staff', 'permissions', 'roles', 'invite'], label: 'Users', icon: 'icon-users', category: 'Settings', catKey: 'settings', itemId: 'users' },
    { keywords: ['settings', 'config', 'preferences', 'farm settings', 'profile'], label: 'Settings', icon: 'icon-settings', category: 'Settings', catKey: 'settings', itemId: 'settings' },
    { keywords: ['export', 'exports', 'download', 'csv', 'report'], label: 'Exports', icon: 'icon-exports', category: 'Settings', catKey: 'settings', itemId: 'exports' },
    { keywords: ['payment', 'payments', 'billing', 'square', 'card', 'bank'], label: 'Payments', icon: 'icon-payments', category: 'Settings', catKey: 'settings', itemId: 'payments' },
    { keywords: ['help', 'support', 'guide', 'how to', 'documentation'], label: 'Help', icon: 'icon-help', category: 'Settings', catKey: 'settings', itemId: 'help' },
    { keywords: ['evie', 'e.v.i.e', 'ai', 'intelligence', 'copilot', 'assistant'], label: 'E.V.I.E. Core', icon: 'icon-evie', category: 'Settings', catKey: 'settings', itemId: 'evie-core' },

    // Category-level shortcuts
    { keywords: ['growing', 'grow', 'crops', 'garden'], label: 'Growing', icon: 'icon-growing', category: '', catKey: 'growing', itemId: null },
    { keywords: ['operations', 'ops', 'operate', 'monitoring'], label: 'Operations', icon: 'icon-operations', category: '', catKey: 'operations', itemId: null },
    { keywords: ['business', 'money', 'revenue', 'commerce'], label: 'Business', icon: 'icon-business', category: '', catKey: 'business', itemId: null },
    { keywords: ['settings', 'admin', 'administration', 'manage'], label: 'Settings', icon: 'icon-settings', category: '', catKey: 'settings', itemId: null }
  ];

  // ---- Fuzzy matching ----
  function searchRoutes(query) {
    if (!query || query.length < 2) return [];

    var q = query.toLowerCase().trim();
    var scored = [];

    for (var i = 0; i < ROUTES.length; i++) {
      var route = ROUTES[i];
      var maxScore = 0;

      for (var k = 0; k < route.keywords.length; k++) {
        var kw = route.keywords[k];
        var score = 0;

        if (kw === q) {
          score = 100;                          // exact match
        } else if (kw.indexOf(q) === 0) {
          score = 80;                           // starts with
        } else if (kw.indexOf(q) >= 0) {
          score = 60;                           // contains
        } else if (q.indexOf(kw) >= 0) {
          score = 50;                           // query contains keyword
        } else {
          // Check individual words
          var words = q.split(/\s+/);
          for (var w = 0; w < words.length; w++) {
            if (words[w].length >= 2 && kw.indexOf(words[w]) >= 0) {
              score = Math.max(score, 40);
            }
          }
        }

        maxScore = Math.max(maxScore, score);
      }

      // Also check label
      var labelLower = route.label.toLowerCase();
      if (labelLower === q) maxScore = Math.max(maxScore, 100);
      else if (labelLower.indexOf(q) === 0) maxScore = Math.max(maxScore, 75);
      else if (labelLower.indexOf(q) >= 0) maxScore = Math.max(maxScore, 55);

      if (maxScore > 0) {
        scored.push({ route: route, score: maxScore });
      }
    }

    // Sort by score desc, limit to 6
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, 6);
  }

  // ---- SVG helper ----
  function svgUse(iconId, cls) {
    return '<svg class="' + (cls || '') + '" aria-hidden="true"><use href="/icons/farm-nav-icons.svg#' + iconId + '"/></svg>';
  }

  // ---- Render results dropdown ----
  function renderResults(results, query) {
    var dropdown = document.getElementById('evie-search-results');
    if (!dropdown) return;

    if (results.length === 0 && query.length < 2) {
      dropdown.classList.remove('is-visible');
      return;
    }

    var html = '';
    for (var i = 0; i < results.length; i++) {
      var r = results[i].route;
      html += '<div class="evie-search-result" data-idx="' + i + '">'
            + svgUse(r.icon, 'evie-search-result__icon')
            + '<span class="evie-search-result__label">' + r.label + '</span>'
            + (r.category ? '<span class="evie-search-result__category">' + r.category + '</span>' : '')
            + '</div>';
    }

    // Always append "Ask EVIE" at the bottom
    if (query.length >= 2) {
      html += '<div class="evie-search-result evie-search-result--evie" data-evie-ask="1">'
            + svgUse('icon-evie', 'evie-search-result__icon')
            + '<span class="evie-search-result__label">Ask E.V.I.E.: "' + escapeHtml(query) + '"</span>'
            + '</div>';
    }

    dropdown.innerHTML = html;
    dropdown.classList.add('is-visible');
    focusedIdx = -1;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Keyboard navigation ----
  var focusedIdx = -1;
  var lastResults = [];

  function handleKeyDown(e) {
    var dropdown = document.getElementById('evie-search-results');
    if (!dropdown || !dropdown.classList.contains('is-visible')) return;

    var items = dropdown.querySelectorAll('.evie-search-result');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusedIdx = Math.min(focusedIdx + 1, items.length - 1);
      updateFocus(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusedIdx = Math.max(focusedIdx - 1, 0);
      updateFocus(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (focusedIdx >= 0 && items[focusedIdx]) {
        items[focusedIdx].click();
      } else if (items.length > 0) {
        items[0].click();
      }
    } else if (e.key === 'Escape') {
      dropdown.classList.remove('is-visible');
      focusedIdx = -1;
    }
  }

  function updateFocus(items) {
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('is-focused', i === focusedIdx);
    }
  }

  // ---- Result click handling ----
  function handleResultClick(e) {
    var result = e.target.closest('.evie-search-result');
    if (!result) return;

    var dropdown = document.getElementById('evie-search-results');
    var input = document.getElementById('evie-search-input');

    // "Ask EVIE" option
    if (result.dataset.evieAsk) {
      if (window.EVIE && typeof window.EVIE.ask === 'function') {
        window.EVIE.ask(input ? input.value : '');
      }
      if (dropdown) dropdown.classList.remove('is-visible');
      if (input) input.value = '';
      return;
    }

    var idx = parseInt(result.dataset.idx, 10);
    if (isNaN(idx) || !lastResults[idx]) return;

    var route = lastResults[idx].route;

    // Navigate using InfoNav
    if (window.InfoNav) {
      if (route.itemId) {
        window.InfoNav.item(route.catKey, route.itemId);
      } else {
        window.InfoNav.category(route.catKey);
      }
    }

    if (dropdown) dropdown.classList.remove('is-visible');
    if (input) { input.value = ''; input.blur(); }
  }

  // ---- Debounced input handler ----
  var debounceTimer = null;

  function handleInput(e) {
    var query = e.target.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      lastResults = searchRoutes(query);
      renderResults(lastResults, query);
    }, 120);
  }

  // ---- Close on outside click ----
  function handleDocClick(e) {
    var search = document.querySelector('.evie-hero-bar__search');
    var dropdown = document.getElementById('evie-search-results');
    if (!search || !dropdown) return;
    if (!search.contains(e.target)) {
      dropdown.classList.remove('is-visible');
      focusedIdx = -1;
    }
  }

  // ---- Init ----
  function init() {
    var input = document.getElementById('evie-search-input');
    var dropdown = document.getElementById('evie-search-results');

    if (!input || !dropdown) return;

    input.addEventListener('input', handleInput);
    input.addEventListener('keydown', handleKeyDown);
    input.addEventListener('focus', function () {
      if (input.value.length >= 2) {
        lastResults = searchRoutes(input.value);
        renderResults(lastResults, input.value);
      }
    });

    dropdown.addEventListener('click', handleResultClick);
    document.addEventListener('click', handleDocClick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
