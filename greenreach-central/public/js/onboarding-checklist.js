/**
 * Onboarding Checklist Widget
 * Persistent, collapsible panel showing setup progress for new farms.
 * Renders into #onboarding-checklist-container on the Settings page
 * and optionally shows a banner on the Dashboard.
 */

async function loadOnboardingChecklist() {
  const container = document.getElementById('onboarding-checklist-container');
  if (!container) return;

  // Check if user dismissed the checklist
  const dismissed = localStorage.getItem('onboarding_checklist_dismissed');
  if (dismissed === 'true') {
    container.style.display = 'none';
    return;
  }

  try {
    const headers = {};
    const token = window.currentSession?.token || localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch('/api/setup/onboarding-status', { headers });
    if (!response.ok) {
      console.warn('[Onboarding] Status API returned', response.status);
      container.style.display = 'none';
      return;
    }

    const data = await response.json();
    if (!data.success) {
      container.style.display = 'none';
      return;
    }

    // Client-side checks for localStorage-based tasks
    const farmSettings = localStorage.getItem('farmSettings');
    data.tasks.forEach(task => {
      if (task.id === 'display_prefs' && farmSettings) {
        task.completed = true;
      }
    });

    // Recalculate completed count
    const completedCount = data.tasks.filter(t => t.completed).length;
    const totalCount = data.tasks.length;
    const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    // If all done, auto-dismiss
    if (completedCount === totalCount) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    container.innerHTML = renderChecklist(data.tasks, completedCount, totalCount, pct, data.planType);

    // Also show banner on Dashboard if not all done
    showDashboardOnboardingBanner(completedCount, totalCount, pct);

  } catch (error) {
    console.warn('[Onboarding] Failed to load checklist:', error);
    container.style.display = 'none';
  }
}

function renderChecklist(tasks, completedCount, totalCount, pct, planType) {
  const isCollapsed = localStorage.getItem('onboarding_checklist_collapsed') === 'true';
  const bodyDisplay = isCollapsed ? 'none' : 'block';
  const chevron = isCollapsed ? '▸' : '▾';

  let taskListHTML = tasks.map(task => {
    const icon = task.completed
      ? '<span style="color: var(--accent-green); font-size: 18px;">✓</span>'
      : '<span style="color: var(--text-muted); font-size: 18px; opacity: 0.4;">○</span>';
    const textStyle = task.completed
      ? 'text-decoration: line-through; color: var(--text-muted);'
      : 'color: var(--text-primary);';
    const edgeBadge = task.edgeOnly
      ? ' <span style="font-size: 10px; background: rgba(139,92,246,0.15); color: #a78bfa; padding: 2px 6px; border-radius: 4px; margin-left: 4px;">Edge</span>'
      : '';
    const clickAttr = task.completed ? '' : `onclick="navigateOnboardingTask('${task.link}', '${task.linkUrl || ''}')" style="cursor: pointer;"`;

    return `
      <div style="display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border);" ${clickAttr}>
        ${icon}
        <span style="flex: 1; font-size: 13px; ${textStyle}">${task.icon || ''} ${task.label}${edgeBadge}</span>
        ${task.completed ? '' : '<span style="color: var(--text-muted); font-size: 12px;">→</span>'}
      </div>`;
  }).join('');

  return `
    <div class="card" style="border: 2px solid rgba(16, 185, 129, 0.3); background: rgba(16, 185, 129, 0.03);">
      <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="toggleOnboardingChecklist()">
        <div>
          <h2 style="margin: 0; font-size: 16px;">🚀 Getting Started — ${completedCount} of ${totalCount} complete</h2>
          <div style="margin-top: 8px; background: var(--bg-secondary); border-radius: 4px; height: 6px; width: 100%; max-width: 300px; overflow: hidden;">
            <div style="height: 100%; width: ${pct}%; background: var(--accent-green); border-radius: 4px; transition: width 0.5s ease;"></div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button onclick="event.stopPropagation(); dismissOnboardingChecklist();" style="background: none; border: none; color: var(--text-muted); font-size: 11px; cursor: pointer; padding: 4px 8px;">Dismiss</button>
          <span id="onboarding-chevron" style="color: var(--text-muted); font-size: 14px;">${chevron}</span>
        </div>
      </div>
      <div id="onboarding-checklist-body" style="display: ${bodyDisplay}; margin-top: 16px;">
        ${taskListHTML}
      </div>
    </div>`;
}

function toggleOnboardingChecklist() {
  const body = document.getElementById('onboarding-checklist-body');
  const chevron = document.getElementById('onboarding-chevron');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  if (chevron) chevron.textContent = isHidden ? '▾' : '▸';
  localStorage.setItem('onboarding_checklist_collapsed', isHidden ? 'false' : 'true');
}

function dismissOnboardingChecklist() {
  localStorage.setItem('onboarding_checklist_dismissed', 'true');
  const container = document.getElementById('onboarding-checklist-container');
  if (container) container.style.display = 'none';
  const banner = document.getElementById('dashboard-onboarding-banner');
  if (banner) banner.style.display = 'none';
}

function navigateOnboardingTask(link, linkUrl) {
  if (link === '#settings') {
    // Already on settings — just scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (link === '#iframe-view' && linkUrl) {
    // Extract base path for nav-item matching (strip query params)
    const basePath = linkUrl.split('?')[0];
    // Navigate via the sidebar system — try exact match first, then base path
    const navItem = document.querySelector(`.nav-item[data-url="${linkUrl}"]`)
                 || document.querySelector(`.nav-item[data-url="${basePath}"]`);
    if (navItem) {
      // If linkUrl has query params, use renderEmbeddedView for deep-linking
      if (linkUrl.includes('?') && typeof renderEmbeddedView === 'function') {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        navItem.classList.add('active');
        renderEmbeddedView(linkUrl, navItem.textContent.trim() || 'Setup');
      } else {
        navItem.click();
      }
      return;
    }
  }
  // Fallback: try clicking matching nav item
  const navItem = document.querySelector(`.nav-item[data-section="${link.replace('#', '')}"]`);
  if (navItem) {
    navItem.click();
  }
}

function showDashboardOnboardingBanner(completedCount, totalCount, pct) {
  const dashboardSection = document.getElementById('section-dashboard');
  if (!dashboardSection) return;

  // Don't duplicate
  if (document.getElementById('dashboard-onboarding-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'dashboard-onboarding-banner';
  banner.style.cssText = 'margin: 0 20px 20px; padding: 16px 20px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; display: flex; align-items: center; justify-content: space-between;';
  banner.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <span style="font-size: 20px;">🚀</span>
      <div>
        <strong style="font-size: 14px;">Setup Progress: ${completedCount} of ${totalCount} steps complete</strong>
        <div style="margin-top: 6px; background: var(--bg-secondary); border-radius: 4px; height: 5px; width: 200px; overflow: hidden;">
          <div style="height: 100%; width: ${pct}%; background: var(--accent-green); border-radius: 4px;"></div>
        </div>
      </div>
    </div>
    <a href="#settings" class="nav-item" data-section="settings" onclick="this.closest('.nav-item')?.click()" style="color: var(--accent-green); font-size: 13px; font-weight: 500; text-decoration: none;">
      View Checklist →
    </a>
  `;

  // Insert after the header
  const header = dashboardSection.querySelector('.header');
  if (header && header.nextSibling) {
    dashboardSection.insertBefore(banner, header.nextSibling);
  } else {
    dashboardSection.appendChild(banner);
  }
}
