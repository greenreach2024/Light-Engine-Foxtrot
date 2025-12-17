/**
 * Demo Mode Intro Card Component
 * Displays welcoming information cards at the top of dashboard pages
 */

(function() {
  'use strict';

  /**
   * Create and display an intro card for the current page
   * @param {string} pageId - The page identifier (e.g., 'farm-summary', 'farm-inventory')
   * @param {string} containerId - Optional container ID where the card should be inserted
   */
  window.showIntroCard = async function(pageId, containerId = null) {
    try {
      console.log('[IntroCard] showIntroCard called for page:', pageId, 'container:', containerId);
      
      // Remove any existing modals from other pages first
      const existingModals = document.querySelectorAll('.intro-modal-overlay');
      if (existingModals.length > 0) {
        console.log('[IntroCard] Removing', existingModals.length, 'existing modal(s)');
        existingModals.forEach(modal => modal.remove());
      }
      
      // Fetch intro card data
      // Demo mode: use stub data
      let data;
      if (window.DEMO_MODE || localStorage.getItem('demoMode') === 'true') {
        data = {
          ok: true,
          demo: true,
          card: {
            title: 'Light Engine Demo',
            icon: '',
            description: 'Welcome to the Light Engine platform demo. This is a read-only demonstration showcasing our indoor farming automation capabilities.',
            features: [
              'Real-time environmental monitoring',
              'Intelligent lighting control',
              'Automated nutrient management',
              'Harvest planning and tracking'
            ]
          }
        };
      } else {
        const response = await fetch(`/api/demo/intro-cards?page=${encodeURIComponent(pageId)}`);
        
        if (!response.ok) {
          console.warn('[IntroCard] Failed to fetch intro card data:', response.status);
          return;
        }

        data = await response.json();
      }
      console.log('[IntroCard] API response:', { ok: data.ok, demo: data.demo, hasCard: !!data.card });
      
      // Only show in demo mode
      if (!data.demo || !data.card) {
        console.log('[IntroCard] Not in demo mode or no card data available');
        return;
      }

      const card = data.card;
      
      // Check if user has dismissed this card before
      // In demo mode, we'll show it once per session (not persist across browser sessions)
      const dismissedKey = `introCard_dismissed_${pageId}`;
      const sessionDismissedKey = `introCard_session_dismissed_${pageId}`;
      
      // Check if dismissed in this session (don't check localStorage in demo mode)
      if (sessionStorage.getItem(sessionDismissedKey) === 'true') {
        console.log('[IntroCard] User has dismissed this card in current session');
        return;
      }

      // Create intro modal HTML
      const cardHTML = `
        <div id="intro-modal-overlay-${pageId}" class="intro-modal-overlay" style="
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.75);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          padding: 20px;
          animation: fadeIn 0.3s ease-out;
        " onclick="if(event.target === this) dismissIntroCard('${pageId}')">
          <div id="intro-modal-${pageId}" class="intro-modal" style="
            background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
            border: 2px solid rgba(59, 130, 246, 0.3);
            border-radius: 20px;
            padding: 0;
            max-width: 700px;
            width: 100%;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 100px rgba(59, 130, 246, 0.1);
            animation: slideUp 0.4s ease-out;
            position: relative;
          " onclick="event.stopPropagation()">
            
            <!-- Header -->
            <div style="
              background: linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(147, 197, 253, 0.1) 100%);
              padding: 2rem 2.5rem;
              border-bottom: 1px solid rgba(59, 130, 246, 0.2);
              position: relative;
            ">
              <button onclick="dismissIntroCard('${pageId}')" style="
                position: absolute;
                top: 1.5rem;
                right: 1.5rem;
                background: rgba(239, 68, 68, 0.1);
                border: 1px solid rgba(239, 68, 68, 0.3);
                border-radius: 8px;
                width: 36px;
                height: 36px;
                color: #f87171;
                cursor: pointer;
                font-size: 1.25rem;
                font-weight: 700;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
                line-height: 1;
              " 
              onmouseover="this.style.background='rgba(239, 68, 68, 0.2)'; this.style.borderColor='rgba(239, 68, 68, 0.5)';"
              onmouseout="this.style.background='rgba(239, 68, 68, 0.1)'; this.style.borderColor='rgba(239, 68, 68, 0.3)';">
                ×
              </button>
              
              <div style="display: flex; align-items: center; gap: 1.25rem;">
                <div style="
                  font-size: 3.5rem;
                  line-height: 1;
                  flex-shrink: 0;
                ">${card.icon}</div>
                
                <div>
                  <h2 style="
                    font-size: 1.875rem;
                    font-weight: 700;
                    color: #93c5fd;
                    margin: 0;
                    letter-spacing: -0.025em;
                  ">${card.title}</h2>
                </div>
              </div>
            </div>
            
            <!-- Content -->
            <div style="padding: 2rem 2.5rem;">
              <div style="
                font-size: 1.0625rem;
                line-height: 1.75;
                color: #e5e7eb;
                margin-bottom: 1.5rem;
              ">${card.description}</div>
              
              ${card.features && card.features.length > 0 ? `
                <div style="
                  background: rgba(59, 130, 246, 0.05);
                  border: 1px solid rgba(59, 130, 246, 0.15);
                  border-radius: 12px;
                  padding: 1.5rem;
                  margin-top: 1.5rem;
                ">
                  <h3 style="
                    font-size: 1rem;
                    font-weight: 600;
                    color: #60a5fa;
                    margin: 0 0 1rem 0;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                  ">Key Features</h3>
                  <div style="
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                  ">
                    ${card.features.map(feature => `
                      <div style="
                        display: flex;
                        align-items: flex-start;
                        gap: 0.75rem;
                        font-size: 1rem;
                        line-height: 1.6;
                        color: #cbd5e1;
                      ">
                        <span style="
                          color: #10b981;
                          font-weight: 700;
                          flex-shrink: 0;
                          font-size: 1.25rem;
                        ">✓</span>
                        <span>${feature}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
            
            <!-- Footer -->
            <div style="
              background: rgba(15, 23, 42, 0.5);
              padding: 1.25rem 2.5rem;
              border-top: 1px solid rgba(59, 130, 246, 0.1);
              text-align: center;
            ">
              <button onclick="dismissIntroCard('${pageId}', ${card.nextPage ? `'${card.nextPage}'` : 'null'}, ${card.lockPage || false})" style="
                background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                border: none;
                border-radius: 8px;
                padding: 0.75rem 2rem;
                color: white;
                cursor: pointer;
                font-size: 1rem;
                font-weight: 600;
                transition: all 0.2s;
                box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
              "
              onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(59, 130, 246, 0.4)';"
              onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(59, 130, 246, 0.3)';">
                ${card.nextPage ? 'Continue Tour →' : "Got it, let's go!"}
              </button>
            </div>
          </div>
        </div>
        
        <style>
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          
          @keyframes slideUp {
            from {
              opacity: 0;
              transform: translateY(30px) scale(0.95);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          
          @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; }
          }
          
          .intro-modal::-webkit-scrollbar {
            width: 8px;
          }
          
          .intro-modal::-webkit-scrollbar-track {
            background: rgba(15, 23, 42, 0.5);
            border-radius: 4px;
          }
          
          .intro-modal::-webkit-scrollbar-thumb {
            background: rgba(59, 130, 246, 0.3);
            border-radius: 4px;
          }
          
          .intro-modal::-webkit-scrollbar-thumb:hover {
            background: rgba(59, 130, 246, 0.5);
          }
          
          @media (max-width: 768px) {
            .intro-modal {
              max-width: 95% !important;
            }
            .intro-modal h2 {
              font-size: 1.5rem !important;
            }
            .intro-modal button {
              font-size: 0.875rem !important;
              padding: 0.625rem 1.5rem !important;
            }
          }
        </style>
      `;

      // Insert the modal overlay
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = cardHTML.trim();
      
      // Get the actual modal element (skip any text nodes)
      const modalElement = tempDiv.querySelector('.intro-modal-overlay');
      
      if (modalElement) {
        // Append to body for full-screen overlay
        document.body.appendChild(modalElement);
        console.log('[IntroCard] Intro modal displayed successfully for page:', pageId);
      } else {
        console.error('[IntroCard] Failed to create modal element from HTML');
      }

    } catch (error) {
      console.error('[IntroCard] Error displaying intro card:', error);
    }
  };

  /**
   * Dismiss the intro card and remember the user's preference
   * @param {string} pageId - The page identifier
   * @param {string} nextPage - Optional URL to navigate to after dismissal
   * @param {boolean} lockPage - Whether to lock the current page (disable interactions)
   */
  window.dismissIntroCard = function(pageId, nextPage = null, lockPage = false) {
    const overlay = document.getElementById(`intro-modal-overlay-${pageId}`);
    const modal = document.getElementById(`intro-modal-${pageId}`);
    
    if (overlay && modal) {
      // Fade out animation
      modal.style.animation = 'fadeOut 0.2s ease-out';
      overlay.style.transition = 'opacity 0.2s ease-out';
      overlay.style.opacity = '0';
      
      setTimeout(() => {
        overlay.remove();
        
        // Lock page if requested
        if (lockPage) {
          lockCurrentPage();
        }
        
        // Navigate to next page if specified
        if (nextPage) {
          setTimeout(() => {
            window.location.href = nextPage;
          }, 300);
        }
      }, 200);
    }
    
    // Remember dismissal (use sessionStorage so it shows again on new browser session)
    const sessionDismissedKey = `introCard_session_dismissed_${pageId}`;
    sessionStorage.setItem(sessionDismissedKey, 'true');
    
    console.log('[IntroCard] Intro modal dismissed for this session');
  };

  /**
   * Lock the current page by disabling all interactive elements
   */
  function lockCurrentPage() {
    console.log('[IntroCard] Locking current page');
    
    // Create overlay to block interactions
    const lockOverlay = document.createElement('div');
    lockOverlay.id = 'page-lock-overlay';
    lockOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(4px);
    `;
    
    lockOverlay.innerHTML = `
      <div style="
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 2px solid rgba(59, 130, 246, 0.3);
        border-radius: 12px;
        padding: 2rem;
        max-width: 400px;
        text-align: center;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      ">
        <div style="font-size: 3rem; margin-bottom: 1rem;">🔒</div>
        <h3 style="color: #3b82f6; margin: 0 0 0.5rem 0; font-size: 1.5rem;">Page Locked</h3>
        <p style="color: #cbd5e1; margin: 0; line-height: 1.6;">
          Continuing the Light Engine tour...
        </p>
      </div>
    `;
    
    document.body.appendChild(lockOverlay);
    
    // Disable all buttons and links (except in modals)
    const interactiveElements = document.querySelectorAll('button:not([onclick*="dismissIntroCard"]), a, input, select, textarea');
    interactiveElements.forEach(el => {
      if (!el.closest('.intro-modal-overlay') && !el.closest('#page-lock-overlay')) {
        el.style.pointerEvents = 'none';
        el.style.opacity = '0.5';
      }
    });
  }

  /**
   * Reset all dismissed intro cards (for testing/development)
   */
  window.resetIntroCards = function() {
    // Clear both localStorage and sessionStorage
    const localKeys = Object.keys(localStorage).filter(key => key.startsWith('introCard_'));
    localKeys.forEach(key => localStorage.removeItem(key));
    
    const sessionKeys = Object.keys(sessionStorage).filter(key => key.startsWith('introCard_'));
    sessionKeys.forEach(key => sessionStorage.removeItem(key));
    
    console.log('[IntroCard] Reset all dismissed intro cards from localStorage and sessionStorage');
  };

  console.log('[IntroCard] Intro card component loaded');
})();
