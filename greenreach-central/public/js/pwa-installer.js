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
    
    // Register service worker
    if ('serviceWorker' in navigator) {
      try {
        const serviceWorkerProbe = await fetch('/service-worker.js', {
          method: 'HEAD',
          cache: 'no-store'
        });

        if (!serviceWorkerProbe.ok) {
          console.log('[PWA] Service worker script not found; skipping registration');
          return;
        }

        this.serviceWorkerRegistration = await navigator.serviceWorker.register('/service-worker.js', {
          scope: '/'
        });
        
        console.log('[PWA] Service Worker registered:', this.serviceWorkerRegistration.scope);
        
        // Check for updates
        this.serviceWorkerRegistration.addEventListener('updatefound', () => {
          console.log('[PWA] Service Worker update found');
          this.handleUpdate();
        });
        
        // Listen for controller change
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log('[PWA] Service Worker controller changed');
          if (!this.isInstalled) {
            window.location.reload();
          }
        });
        
      } catch (error) {
        console.error('[PWA] Service Worker registration failed:', error);
      }
    }
    
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
   */
  updateOnlineStatus() {
    let indicator = document.getElementById('pwa-online-status');
    
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'pwa-online-status';
      indicator.className = 'pwa-online-status';
      document.body.appendChild(indicator);
    }
    
    if (this.isOnline) {
      indicator.className = 'pwa-online-status online';
      indicator.innerHTML = '<span class="status-dot"></span> Online';
      
      // Hide after 3 seconds
      setTimeout(() => {
        indicator.style.opacity = '0';
      }, 3000);
    } else {
      indicator.className = 'pwa-online-status offline';
      indicator.innerHTML = '<span class="status-dot"></span> Offline Mode';
      indicator.style.opacity = '1';
    }
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
    if (!this.serviceWorkerRegistration) {
      return;
    }
    
    try {
      await this.serviceWorkerRegistration.update();
      console.log('[PWA] Checked for updates');
    } catch (error) {
      console.error('[PWA] Update check failed:', error);
    }
  }
  
  /**
   * Get cache version
   */
  async getCacheVersion() {
    if (!navigator.serviceWorker.controller) {
      return null;
    }
    
    return new Promise((resolve) => {
      const messageChannel = new MessageChannel();
      messageChannel.port1.onmessage = (event) => {
        resolve(event.data.version);
      };
      navigator.serviceWorker.controller.postMessage(
        { type: 'GET_VERSION' },
        [messageChannel.port2]
      );
    });
  }
  
  /**
   * Clear cache
   */
  async clearCache() {
    if (!navigator.serviceWorker.controller) {
      return;
    }
    
    return new Promise((resolve, reject) => {
      const messageChannel = new MessageChannel();
      messageChannel.port1.onmessage = (event) => {
        if (event.data.success) {
          resolve(event.data.message);
        } else {
          reject(new Error('Cache clear failed'));
        }
      };
      navigator.serviceWorker.controller.postMessage(
        { type: 'CLEAR_CACHE' },
        [messageChannel.port2]
      );
    });
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
