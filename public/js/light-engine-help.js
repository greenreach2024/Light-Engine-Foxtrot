/**
 * Light Engine Global Help System
 * Provides context-sensitive help, AI insights, and how-tos.
 */

(function() {
  // Skip when loaded inside an iframe to prevent duplicate help buttons
  try {
    if (window.self !== window.top) {
      console.debug('[LE Help] Skipping — running inside iframe');
      return;
    }
  } catch (e) {
    console.debug('[LE Help] Skipping — cross-origin iframe');
    return;
  }

  function initHelp() {
    console.log('Light Engine Help System Initializing...');

    // Create UI Elements
    function createHelpUI() {
      // 1. Help Toggle Button
      const toggleBtn = document.createElement('button');
      toggleBtn.id = 'le-help-toggle';
      toggleBtn.innerHTML = '?';
      toggleBtn.title = 'Toggle Help Mode';
      toggleBtn.setAttribute('aria-label', 'Toggle Help Mode');
      
      // Ensure visibility with high z-index and explicit styles
      toggleBtn.style.cssText = `
          position: fixed;
          bottom: 90px;
          right: 20px;
          z-index: 99999;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: #3b82f6;
          color: white;
          border: none;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          font-size: 20px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
          transition: bottom 0.3s ease;
      `;
      
      document.body.appendChild(toggleBtn);

      // 2. Help Popup Container
      const popup = document.createElement('div');
      popup.id = 'le-help-popup';
      popup.innerHTML = `
        <h3 id="le-help-title"></h3>
        <p id="le-help-text"></p>
        <div id="le-help-ai" class="ai-insight" style="display:none">
          <strong>AI Insight</strong>
          <span id="le-help-ai-content"></span>
        </div>
      `;
      // Ensure popup is on top too
      popup.style.zIndex = '2147483647';
      document.body.appendChild(popup);

      return { toggleBtn, popup };
    }

    // Initialize
    const { toggleBtn, popup } = createHelpUI();
    let helpActive = false;

    function toggleHelpMode() {
      helpActive = !helpActive;
      
      if (helpActive) {
        document.body.classList.add('le-help-active');
        toggleBtn.classList.add('active');
        toggleBtn.style.background = '#ef4444'; // Red for verify/active state (easy vis)
        toggleBtn.innerHTML = '×'; // Close icon
        showToast('Help Mode Active: Hover over elements for details.');
      } else {
        document.body.classList.remove('le-help-active');
        toggleBtn.classList.remove('active');
        toggleBtn.style.background = '#3b82f6'; // Back to Blue
        toggleBtn.innerHTML = '?';
        hidePopup();
      }
    }

    // Toggle Handler
    toggleBtn.addEventListener('click', toggleHelpMode);

  // Bind to sidebar help link if exists
    const helpLink = document.querySelector('a[href="#help"]');
    if (helpLink) {
      helpLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (!helpActive) toggleHelpMode();
      });
    }

  // Hover Handlers (Delegated)
    document.addEventListener('mouseover', (e) => {
      if (!helpActive) return;

      const target = e.target.closest('[data-help]');
      if (target) {
        showPopup(target, e);
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!helpActive) return;
      const target = e.target.closest('[data-help]');
      if (target) {
          updatePopupPosition(e);
      }
    });

    document.addEventListener('mouseout', (e) => {
      if (!helpActive) return;
      const target = e.target.closest('[data-help]');
      if (target) {
        hidePopup();
      }
    });

  // Popup Logic
    const titleEl = document.getElementById('le-help-title');
    const textEl = document.getElementById('le-help-text');
    const aiContainer = document.getElementById('le-help-ai');
    const aiContent = document.getElementById('le-help-ai-content');

    function showPopup(target, event) {
    const title = target.getAttribute('data-help-title') || 'Help';
    const text = target.getAttribute('data-help') || target.getAttribute('data-help-text') || ''; // fallback
    const aiText = buildLiveAiInsight(target);

    if (!text && !aiText) return;

    titleEl.textContent = title;
    
    // Show/hide text element based on content
    if (text) {
      textEl.textContent = text;
      textEl.style.display = 'block';
    } else {
      textEl.style.display = 'none';
    }

    if (aiText) {
      aiContainer.style.display = 'block';
      aiContent.textContent = aiText;
    } else {
      aiContainer.style.display = 'none';
    }

    popup.style.display = 'block';
    updatePopupPosition(event);
  }

    function hidePopup() {
      popup.style.display = 'none';
    }

    function updatePopupPosition(event) {
    const x = event.clientX + 15;
    const y = event.clientY + 15;
    
    // Bounds checking (simple)
    const rect = popup.getBoundingClientRect();
    let finalX = x;
    let finalY = y;

    if (x + rect.width > window.innerWidth) {
      finalX = event.clientX - rect.width - 10;
    }
    if (y + rect.height > window.innerHeight) {
      finalY = event.clientY - rect.height - 10;
    }

    popup.style.left = `${finalX}px`;
    popup.style.top = `${finalY}px`;
  }

  // Simple Toast for Feedback
    function showToast(msg) {
    try {
        const toast = document.createElement('div');
        toast.textContent = msg;
        toast.style.cssText = `
          position: fixed;
          bottom: 80px;
          right: 20px;
          background: #333;
          color: white;
          padding: 10px 20px;
          border-radius: 8px;
          z-index: 2147483647;
          animation: fadeIn 0.3s;
          pointer-events: none;
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
          if (toast.parentNode) {
              toast.style.opacity = '0';
              setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
          }
        }, 3000);
    } catch (e) {
        console.error('Toast failed:', e);
    }
  }

  // Expose API for Canvas Elements
    function buildLiveAiInsight(target) {
      const sourceSelector = target.getAttribute('data-help-ai-source');
      if (sourceSelector) {
        const sourceEl = document.querySelector(sourceSelector);
        const value = sourceEl ? (sourceEl.textContent || '').trim() : '';
        if (value) return `Current value: ${value}`;
      }

      const valueEl = target.querySelector(
        '[data-kpi-value], .kpi-value, .stat-value, .value, .metric-value, .kpi-value-large'
      );
      if (valueEl) {
        const value = (valueEl.textContent || '').trim();
        if (value) return `Current value: ${value}`;
      }

      const dataValue = target.getAttribute('data-value');
      if (dataValue) return `Current value: ${dataValue}`;

      return '';
    }

    window.LightEngineHelp = {
      toggle: toggleHelpMode,
      show: (x, y, title, text, aiText) => {
        if (!text && !aiText) return;
        titleEl.textContent = title || 'Help';
        
        // Show/hide text element based on content
        if (text) {
          textEl.textContent = text;
          textEl.style.display = 'block';
        } else {
          textEl.style.display = 'none';
        }
        
        if (aiText) {
          aiContainer.style.display = 'block';
          aiContent.textContent = aiText;
        } else {
          aiContainer.style.display = 'none';
        }
        popup.style.display = 'block';
        
        // Manual positioning
        const rect = popup.getBoundingClientRect();
        let finalX = x + 15;
        let finalY = y + 15;
        if (finalX + rect.width > window.innerWidth) finalX = x - rect.width - 10;
        if (finalY + rect.height > window.innerHeight) finalY = y - rect.height - 10;
        
        popup.style.left = `${finalX}px`;
        popup.style.top = `${finalY}px`;
    },
      hide: hidePopup,
      isActive: () => helpActive
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHelp);
  } else {
    initHelp();
  }
})();
