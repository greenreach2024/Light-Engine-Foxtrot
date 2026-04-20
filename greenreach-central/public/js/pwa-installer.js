/**
 * PWA Installation Manager
 * Handles service worker registration, install prompts, and offline detection
 */

class PWAInstaller {
  constructor() {
    this.deferredPrompt = null;
    this.isInstalled = false;
    this.isOnline = navigator.onLine;
    this.serviceWorkerRegistration = null;
    
    this.init();
  }
  
  async init() {
    // Check if already installed
    this.isInstalled = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true;

    await this.retireLegacyServiceWorker();

    // Service worker registration is intentionally disabled.
    // The previous PWA cache layer caused stale admin shells to persist across deploys.
    // Keep install-prompt UX available without registering a worker.

    // Listen for install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      this.showInstallButton();
    });

    // Check if already installed
    window.addEventListener('appinstalled', () => {
      console.log('[PWA] App installed');
      this.isInstalled = true;
      this.hideInstallButton();
    });

    // Online/offline detection
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.updateOnlineStatus();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.updateOnlineStatus();
    });

    // Initial online status
    this.updateOnlineStatus();

    // iOS detection and install instructions
    if (this.isIOS() && !this.isInstalled) {
      this.showIOSInstructions();
    }
  }

  async retireLegacyServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
        this.serviceWorkerRegistration = null;

        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(
            cacheNames
              .filter((cacheName) => cacheName.startsWith('light-engine-'))
              .map((cacheName) => caches.delete(cacheName))
          );
        }

        console.log('[PWA] Retired legacy service worker registrations and cleared stale caches');
      } catch (error) {
        console.error('[PWA] Failed to retire legacy service worker:', error);
      }
    }
  }
  
  /**
   * Handle service worker update
   */
  handleUpdate() {
    const installingWorker = this.serviceWorkerRegistration.installing;
    
    if (!installingWorker) return;
    
    installingWorker.addEventListener('statechange', () => {
      if (installingWorker.state === 'installed') {
        if (navigator.serviceWorker.controller) {
          // New service worker available
          this.showUpdateNotification();
        } else {
          // First install
          console.log('[PWA] Service Worker installed for the first time');
        }
      }
    });
  }
  
  /**
   * Show update notification
   */
  showUpdateNotification() {
    const notification = document.createElement('div');
    notification.className = 'pwa-update-notification';
    notification.innerHTML = `
      <div class="pwa-update-content">
        <span>New version available!</span>
        <button onclick="window.pwaInstaller.applyUpdate()">Update</button>
        <button onclick="this.parentElement.parentElement.remove()">Later</button>
      </div>
    `;
    
    document.body.appendChild(notification);
  }
  
  /**
   * Apply service worker update
   */
  applyUpdate() {
    if (!this.serviceWorkerRegistration || !this.serviceWorkerRegistration.waiting) {
      return;
    }
    
    this.serviceWorkerRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  }
  
  /**
   * Show install button
   */
  showInstallButton() {
    let button = document.getElementById('pwa-install-button');
    
    if (!button) {
      button = document.createElement('button');
      button.id = 'pwa-install-button';
      button.className = 'pwa-install-button';
      button.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        Install App
      `;
      button.onclick = () => this.promptInstall();
      
      document.body.appendChild(button);
    }
    
    button.style.display = 'flex';
  }
  
  /**
   * Hide install button
   */
  hideInstallButton() {
    const button = document.getElementById('pwa-install-button');
    if (button) {
      button.style.display = 'none';
    }
  }
  
  /**
   * Prompt user to install PWA
   */
  async promptInstall() {
    if (!this.deferredPrompt) {
      console.log('[PWA] No install prompt available');
      return;
    }
    
    this.deferredPrompt.prompt();
    
    const { outcome } = await this.deferredPrompt.userChoice;
    console.log('[PWA] Install prompt outcome:', outcome);
    
    if (outcome === 'accepted') {
      this.hideInstallButton();
    }
    
    this.deferredPrompt = null;
  }
  
  /**
   * Update online status indicator
   * Disabled - using main System Status indicator instead
   */
  updateOnlineStatus() {
    // Disabled: redundant with main communicationStatus indicator
    return;
  }
  
  /**
   * Check if device is iOS
   */
  isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }
  
  /**
   * Show iOS installation instructions
   */
  showIOSInstructions() {
    // Only show if not already dismissed
    if (localStorage.getItem('ios-install-dismissed')) {
      return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'pwa-ios-modal';
    modal.innerHTML = `
      <div class="pwa-ios-content">
        <h3>Install Light Engine</h3>
        <p>Add this app to your Home Screen for the best experience:</p>
        <ol>
          <li>
            Tap the Share button
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
              <polyline points="16 6 12 2 8 6"></polyline>
              <line x1="12" y1="2" x2="12" y2="15"></line>
            </svg>
          </li>
          <li>Scroll down and tap "Add to Home Screen"</li>
          <li>Tap "Add" in the top right corner</li>
        </ol>
        <button onclick="window.pwaInstaller.dismissIOSInstructions()">Got it</button>
      </div>
    `;
    
    document.body.appendChild(modal);
  }
  
  /**
   * Dismiss iOS instructions
   */
  dismissIOSInstructions() {
    const modal = document.querySelector('.pwa-ios-modal');
    if (modal) {
      modal.remove();
      localStorage.setItem('ios-install-dismissed', 'true');
    }
  }
  
  /**
   * Check for app updates
   */
  async checkForUpdates() {
    return;
  }
  
  /**
   * Get cache version
   */
  async getCacheVersion() {
    return null;
  }
  
  /**
   * Clear cache
   */
  async clearCache() {
    if (!('caches' in window)) {
      return;
    }

    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith('light-engine-'))
        .map((cacheName) => caches.delete(cacheName))
    );

    return 'Legacy Light Engine caches cleared';
  }
}

// Initialize PWA installer
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.pwaInstaller = new PWAInstaller();
  });
} else {
  window.pwaInstaller = new PWAInstaller();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PWAInstaller;
}
