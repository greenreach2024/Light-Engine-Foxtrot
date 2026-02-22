class ServiceIntroBanner {
  constructor(options = {}) {
    this.serviceId = options.serviceId || 'default-service';
    this.title = options.title || 'New Feature';
    this.description = options.description || '';
    this.ctaText = options.ctaText || 'Learn More';
    this.ctaUrl = options.ctaUrl || '#';
    this.dismissKey = `dismissed_banner_${this.serviceId}`;
  }

  static ensureStyles() {
    if (document.getElementById('service-intro-banner-styles')) return;
    const style = document.createElement('style');
    style.id = 'service-intro-banner-styles';
    style.textContent = `
      .service-intro-banner {
        position: relative;
        z-index: 1000;
        border-bottom: 1px solid var(--border, var(--text-muted));
        background: var(--primary, var(--bg-secondary));
        color: var(--text-primary, #fff);
      }
      .service-intro-banner__inner {
        width: 100%;
        max-width: 1400px;
        margin: 0 auto;
        padding: 0.625rem 2rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .service-intro-banner__text {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }
      .service-intro-banner__title {
        font-weight: 600;
        font-size: 0.95rem;
      }
      .service-intro-banner__desc {
        font-size: 0.8125rem;
        color: var(--text-secondary, currentColor);
      }
      .service-intro-banner__actions {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
      }
      .service-intro-banner__cta {
        border: 1px solid var(--border, currentColor);
        border-radius: 6px;
        padding: 0.35rem 0.75rem;
        text-decoration: none;
        font-size: 0.8125rem;
        font-weight: 600;
        color: inherit;
        background: transparent;
      }
      .service-intro-banner__dismiss {
        border: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font-size: 1rem;
        line-height: 1;
        padding: 0.2rem 0.4rem;
      }
    `;
    document.head.appendChild(style);
  }

  isDismissed() {
    try {
      return localStorage.getItem(this.dismissKey) !== null;
    } catch (_error) {
      return false;
    }
  }

  render() {
    if (this.isDismissed()) return '';

    return `
      <div class="service-intro-banner" id="banner-${this.serviceId}">
        <div class="service-intro-banner__inner">
          <div class="service-intro-banner__text">
            <span class="service-intro-banner__title">${this.title}</span>
            <span class="service-intro-banner__desc">${this.description}</span>
          </div>
          <div class="service-intro-banner__actions">
            <a href="${this.ctaUrl}" class="service-intro-banner__cta">${this.ctaText}</a>
            <button
              type="button"
              class="service-intro-banner__dismiss"
              onclick="ServiceIntroBanner.dismiss('${this.serviceId}')"
              aria-label="Dismiss banner"
              title="Dismiss"
            >×</button>
          </div>
        </div>
      </div>
    `;
  }

  static dismiss(serviceId) {
    try {
      localStorage.setItem(`dismissed_banner_${serviceId}`, Date.now().toString());
    } catch (_error) {
    }

    const banner = document.getElementById(`banner-${serviceId}`);
    if (banner) banner.remove();
  }

  static reset(serviceId) {
    try {
      localStorage.removeItem(`dismissed_banner_${serviceId}`);
    } catch (_error) {
    }
  }

  static injectDeliveryBanner(options = {}) {
    ServiceIntroBanner.ensureStyles();
    const banner = new ServiceIntroBanner({
      serviceId: 'delivery-service-2026',
      title: 'New: Farm-to-Door Delivery',
      description: 'Fresh, locally-grown produce delivered directly to your business or home.',
      ctaText: 'Learn More',
      ctaUrl: options.ctaUrl || '/wholesale-about.html#delivery',
      ...options
    });

    const html = banner.render();
    if (html) {
      document.body.insertAdjacentHTML('afterbegin', html);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ServiceIntroBanner;
}
