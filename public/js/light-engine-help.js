/**
 * Light Engine Global Help System
 * Provides context-sensitive help, AI insights, and how-tos.
 */

(function() {
  console.log('💡 Light Engine Help System Initializing...');

  // Create UI Elements
  function createHelpUI() {
    // 1. Help Toggle Button
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'le-help-toggle';
    toggleBtn.innerHTML = '?';
    toggleBtn.title = 'Toggle Help Mode';
    toggleBtn.setAttribute('aria-label', 'Toggle Help Mode');
    document.body.appendChild(toggleBtn);

    // 2. Help Popup Container
    const popup = document.createElement('div');
    popup.id = 'le-help-popup';
    popup.innerHTML = `
      <h3 id="le-help-title"></h3>
      <p id="le-help-text"></p>
      <div id="le-help-ai" class="ai-insight" style="display:none">
        <strong>🤖 AI Insight</strong>
        <span id="le-help-ai-content"></span>
      </div>
    `;
    document.body.appendChild(popup);

    return { toggleBtn, popup };
  }

  // Initialize
  const { toggleBtn, popup } = createHelpUI();
  let helpActive = false;

  // Toggle Handler
  toggleBtn.addEventListener('click', () => {
    helpActive = !helpActive;
    
    if (helpActive) {
      document.body.classList.add('le-help-active');
      toggleBtn.classList.add('active');
      toggleBtn.innerHTML = '×'; // Close icon
      showToast('Help Mode Active: Hover over elements for details.');
    } else {
      document.body.classList.remove('le-help-active');
      toggleBtn.classList.remove('active');
      toggleBtn.innerHTML = '?';
      hidePopup();
    }
  });

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
    const aiText = target.getAttribute('data-help-ai') || '';

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
      z-index: 10000;
      animation: fadeIn 0.3s;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Expose API for Canvas Elements
  window.LightEngineHelp = {
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

})();
