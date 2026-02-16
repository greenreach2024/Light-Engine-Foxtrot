(() => {
  if (window.__leHeaderDropdownNavInitialized) {
    return;
  }
  window.__leHeaderDropdownNavInitialized = true;

  const navMenu = document.querySelector('.nav-menu');
  if (!navMenu) {
    return;
  }

  const OPEN_CLASS = 'open';

  const ensureOpenStyle = () => {
    if (document.getElementById('le-header-dropdown-open-style')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'le-header-dropdown-open-style';
    style.textContent = `
      .nav-item.${OPEN_CLASS} .dropdown-menu {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }
      .nav-item.${OPEN_CLASS} .nav-arrow {
        transform: rotate(180deg);
      }
    `;
    document.head.appendChild(style);
  };

  ensureOpenStyle();

  const navItems = Array.from(navMenu.querySelectorAll('.nav-item'));

  const closeAllDropdowns = (exceptItem = null) => {
    navItems.forEach((item) => {
      if (item !== exceptItem) {
        item.classList.remove(OPEN_CLASS);
      }
    });
  };

  navItems.forEach((item) => {
    const button = item.querySelector('.nav-button');
    const dropdown = item.querySelector('.dropdown-menu');

    if (!button || !dropdown) {
      return;
    }

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const willOpen = !item.classList.contains(OPEN_CLASS);
      closeAllDropdowns(item);
      item.classList.toggle(OPEN_CLASS, willOpen);
    });

    dropdown.querySelectorAll('a.dropdown-item').forEach((link) => {
      link.addEventListener('click', () => {
        closeAllDropdowns();
      });
    });
  });

  document.addEventListener('click', (event) => {
    if (!navMenu.contains(event.target)) {
      closeAllDropdowns();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllDropdowns();
    }
  });
})();
