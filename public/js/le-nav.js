/**
 * le-nav.js -- Shared iframe navigation for view pages
 * Auto-injects a breadcrumb bar when running inside LE-farm-admin.html iframe.
 * Replaces window.close() / history.back() patterns with parent postMessage.
 *
 * Usage: include <script src="/js/le-nav.js"></script> in any view page.
 */
(function () {
  'use strict';

  var inIframe = false;
  try { inIframe = window.self !== window.top; } catch (e) { inIframe = true; }

  // Only inject breadcrumbs when iframed
  if (!inIframe) return;

  // Page name from <title> or fallback
  var pageName = document.title || 'Page';
  // Remove common suffixes
  pageName = pageName.replace(/\s*[-|]\s*Light Engine.*$/i, '').trim();
  pageName = pageName.replace(/\s*[-|]\s*GreenReach.*$/i, '').trim();

  // Build breadcrumb bar
  var bar = document.createElement('div');
  bar.id = 'le-nav-breadcrumb';
  bar.style.cssText =
    'position:sticky;top:0;left:0;right:0;z-index:9000;' +
    'display:flex;align-items:center;gap:8px;' +
    'padding:8px 16px;font-size:13px;line-height:1;' +
    'font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
    'background:rgba(15,25,35,0.85);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);' +
    'border-bottom:1px solid rgba(52,211,153,0.15);color:#94a3b8;';

  var homeBtn = document.createElement('button');
  homeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10l7-7 7 7M5 8v8a1 1 0 001 1h3v-4h2v4h3a1 1 0 001-1V8"/></svg>';
  homeBtn.title = 'Back to Dashboard';
  homeBtn.style.cssText =
    'background:none;border:none;color:#34d399;cursor:pointer;padding:2px;' +
    'display:flex;align-items:center;opacity:0.8;transition:opacity 0.2s;';
  homeBtn.addEventListener('mouseenter', function () { homeBtn.style.opacity = '1'; });
  homeBtn.addEventListener('mouseleave', function () { homeBtn.style.opacity = '0.8'; });
  homeBtn.addEventListener('click', function () {
    window.parent.postMessage({ type: 'le-nav', action: 'dashboard' }, '*');
  });

  var sep = document.createElement('span');
  sep.textContent = '/';
  sep.style.cssText = 'color:#475569;';

  var label = document.createElement('span');
  label.textContent = pageName;
  label.style.cssText = 'color:#cbd5e1;font-weight:500;';

  bar.appendChild(homeBtn);
  bar.appendChild(sep);
  bar.appendChild(label);

  // Insert at top of body
  if (document.body.firstChild) {
    document.body.insertBefore(bar, document.body.firstChild);
  } else {
    document.body.appendChild(bar);
  }

  // Override window.close to navigate back to dashboard
  window.close = function () {
    window.parent.postMessage({ type: 'le-nav', action: 'dashboard' }, '*');
  };

})();
