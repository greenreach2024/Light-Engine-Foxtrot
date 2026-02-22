/**
 * Service Introduction Banner Component
 * 
 * Reusable dismissible announcement banner for new features/services.
 * Persists dismissal state in localStorage to avoid showing repeatedly.
 * 
 * Usage:
 *   const banner = new ServiceIntroBanner({
 *     serviceId: 'delivery-service-2026',
 *     title: 'New: Farm-to-Door Delivery',
 *     description: 'Fresh produce delivered to your business or home.',
 *     ctaText: 'Learn More',
 *     ctaUrl: '/views/delivery-setup.html'
 *   });
 *   document.body.insertAdjacentHTML('afterbegin', banner.render());
 */

class ServiceIntroBanner {
  constructor(options = {}) {
    this.serviceId = options.serviceId || 'default-service';
    this.title = options.title || 'New Feature';
    this.description = options.description || '';
    this.ctaText = options.ctaText || 'Learn More';
    this.ctaUrl = options.ctaUrl || '#';
    this.dismissKey = `dismissed_banner_${this.serviceId}`;
    this.theme = options.theme || 'green'; // green, blue, purple
  }

  /**
   * Check if user has previously dismissed this banner
   */
  isDismissed() {
    return localStorage.getItem(this.dismissKey) !== null;
  }

  /**
   * Get theme colors based on theme name
   */
  getThemeColors() {
    const themes = {
      green: { gradient: 'linear-gradient(135deg, #4ade80 0%, #16a34a 100%)', cta: '#16a34a' },
      blue: { gradient: 'linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)', cta: '#2563eb' },
      purple: { gradient: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)', cta: '#7c3aed' }
    };
    return themes[this.theme] || themes.green;
  }

  /**
   * Render the banner HTML
   * Returns empty string if already dismissed
   */
  render() {
    if (this.isDismissed()) return '';

    const colors = this.getThemeColors();
    
    return `
      <div class="service-intro-banner" id="banner-${this.serviceId}" style="
        background: ${colors.gradient};
        color: white;
        padding: 12px 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        z-index: 1000;
      ">
        <div class="banner-content" style="
          display: flex;
          align-items: center;
          gap: 16px;
          max-width: 1200px;
          width: 100%;
          justify-content: center;
          flex-wrap: wrap;
        ">
          <div class="banner-text" style="text-align: left;">
            <strong style="font-size: 1rem; display: block; margin-bottom: 2px;">${this.title}</strong>
            <span style="font-size: 0.875rem; opacity: 0.95;">${this.description}</span>
          </div>
          <a href="${this.ctaUrl}" class="banner-cta" style="
            background: white;
            color: ${colors.cta};
            padding: 8px 20px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 600;
            font-size: 0.875rem;
            white-space: nowrap;
            transition: transform 0.15s ease, box-shadow 0.15s ease;
          " onmouseover="this.style.transform='scale(1.02)';this.style.boxShadow='0 2px 8px rgba(0,0,0,0.2)'" 
             onmouseout="this.style.transform='scale(1)';this.style.boxShadow='none'">${this.ctaText}</a>
          <button class="banner-dismiss" onclick="ServiceIntroBanner.dismiss('${this.serviceId}')" style="
            background: none;
            border: none;
            color: white;
            font-size: 1.5rem;
            cursor: pointer;
            opacity: 0.7;
            position: absolute;
            right: 16px;
            top: 50%;
            transform: translateY(-50%);
            padding: 4px 8px;
            line-height: 1;
          " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'" 
             aria-label="Dismiss banner" title="Dismiss">&times;</button>
        </div>
      </div>
    `;
  }

  /**
   * Static method to dismiss a banner by serviceId
   * Called from onclick handler
   */
  static dismiss(serviceId) {
    localStorage.setItem(`dismissed_banner_${serviceId}`, Date.now().toString());
    const banner = document.getElementById(`banner-${serviceId}`);
    if (banner) {
      banner.style.transition = 'opacity 0.3s ease, max-height 0.3s ease';
      banner.style.opacity = '0';
      banner.style.maxHeight = '0';
      banner.style.overflow = 'hidden';
      setTimeout(() => banner.remove(), 300);
    }
  }

  /**
   * Static method to reset a banner (for testing)
   */
  static reset(serviceId) {
    localStorage.removeItem(`dismissed_banner_${serviceId}`);
    console.log(`Banner ${serviceId} reset. Refresh page to see it again.`);
  }

  /**
   * Static method to create and inject delivery service banner
   * Convenience method for the most common use case
   */
  static injectDeliveryBanner(options = {}) {
    const banner = new ServiceIntroBanner({
      serviceId: 'delivery-service-2026',
      title: 'New: Farm-to-Door Delivery',
      description: 'Fresh, locally-grown produce delivered directly to your business or home.',
      ctaText: 'Set Up Delivery',
      ctaUrl: options.ctaUrl || '/wholesale-about.html#delivery',
      theme: 'green',
      ...options
    });
    
    const html = banner.render();
    if (html) {
      document.body.insertAdjacentHTML('afterbegin', html);
    }
  }
}

// Export for module usage (if applicable)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ServiceIntroBanner;
}
