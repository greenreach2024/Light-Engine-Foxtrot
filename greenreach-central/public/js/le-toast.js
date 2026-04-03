/**
 * le-toast.js -- Shared toast notification utility
 * Usage: leToast('Message text', 'success');  // success | error | warning | info
 *        leToast.dismiss();                   // dismiss current toast
 */
(function () {
  'use strict';

  var container = null;
  var dismissTimer = null;

  function ensureContainer() {
    if (container) return container;
    container = document.createElement('div');
    container.id = 'le-toast-container';
    container.style.cssText =
      'position:fixed;top:20px;right:20px;z-index:100000;pointer-events:none;' +
      'display:flex;flex-direction:column;gap:8px;max-width:380px;';
    document.body.appendChild(container);
    return container;
  }

  var ICONS = {
    success: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke="#10b981" stroke-width="2"/><path d="M6 10l3 3 5-5" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    error:   '<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke="#ef4444" stroke-width="2"/><path d="M7 7l6 6M13 7l-6 6" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/></svg>',
    warning: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 2l8.66 15H1.34L10 2z" stroke="#f59e0b" stroke-width="2" stroke-linejoin="round"/><path d="M10 8v4M10 14v1" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/></svg>',
    info:    '<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke="#3b82f6" stroke-width="2"/><path d="M10 9v5M10 6v1" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"/></svg>'
  };

  var COLORS = {
    success: { bg: 'rgba(16,185,129,0.12)', border: '#10b981', text: '#6ee7b7' },
    error:   { bg: 'rgba(239,68,68,0.12)',   border: '#ef4444', text: '#fca5a5' },
    warning: { bg: 'rgba(245,158,11,0.12)',  border: '#f59e0b', text: '#fcd34d' },
    info:    { bg: 'rgba(59,130,246,0.12)',   border: '#3b82f6', text: '#93c5fd' }
  };

  function show(message, type, duration) {
    type = type || 'info';
    duration = duration || 4000;
    var c = COLORS[type] || COLORS.info;
    var icon = ICONS[type] || ICONS.info;

    ensureContainer();

    var el = document.createElement('div');
    el.style.cssText =
      'pointer-events:auto;display:flex;align-items:center;gap:10px;' +
      'padding:12px 16px;border-radius:8px;font-size:14px;line-height:1.4;' +
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
      'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
      'border:1px solid ' + c.border + ';background:' + c.bg + ';color:' + c.text + ';' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.3);' +
      'transform:translateX(120%);transition:transform 0.3s ease,opacity 0.3s ease;opacity:0;';

    el.innerHTML = '<span style="flex-shrink:0;">' + icon + '</span>' +
      '<span style="flex:1;">' + message + '</span>' +
      '<button style="background:none;border:none;color:' + c.text + ';cursor:pointer;' +
      'font-size:16px;padding:0 2px;opacity:0.7;flex-shrink:0;" aria-label="Dismiss">&times;</button>';

    el.querySelector('button').addEventListener('click', function () { remove(el); });

    container.appendChild(el);

    // Animate in
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.style.transform = 'translateX(0)';
        el.style.opacity = '1';
      });
    });

    // Auto dismiss
    var timer = setTimeout(function () { remove(el); }, duration);
    el._timer = timer;

    return el;
  }

  function remove(el) {
    if (!el || !el.parentNode) return;
    clearTimeout(el._timer);
    el.style.transform = 'translateX(120%)';
    el.style.opacity = '0';
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 300);
  }

  function dismissAll() {
    if (!container) return;
    var items = container.children;
    for (var i = items.length - 1; i >= 0; i--) {
      remove(items[i]);
    }
  }

  // Public API
  window.leToast = show;
  window.leToast.dismiss = dismissAll;
  window.leToast.success = function (msg, dur) { return show(msg, 'success', dur); };
  window.leToast.error = function (msg, dur) { return show(msg, 'error', dur); };
  window.leToast.warning = function (msg, dur) { return show(msg, 'warning', dur); };
  window.leToast.info = function (msg, dur) { return show(msg, 'info', dur); };

  // Bridge: alias window.showToast for legacy code
  if (!window.showToast) {
    window.showToast = show;
  }

})();
