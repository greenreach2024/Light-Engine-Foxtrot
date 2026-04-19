// AI Assist / Getting Started onboarding progress in the admin nav.
// Extracted verbatim from public/LE-farm-admin.html (previously inline
// <script> block at lines 4129-4202 pre-extract). Mirrored to greenreach-central.
(function initAiAssistGettingStarted() {
  const container = document.getElementById('ai-assist-items');
  if (!container) return;

  async function loadSteps() {
    try {
      const headers = {};
      const token = window.currentSession?.token || localStorage.getItem('auth_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/setup/onboarding-status', { headers });
      if (!res.ok) { container.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">Unable to load steps</span>'; return; }
      const data = await res.json();
      if (!data.success || !data.tasks) return;

      // Client-side check for display_prefs
      const farmSettings = localStorage.getItem('farmSettings');
      data.tasks.forEach(t => { if (t.id === 'display_prefs' && farmSettings) t.completed = true; });

      const incomplete = data.tasks.filter(t => !t.completed);
      const complete = data.tasks.filter(t => t.completed);
      const pct = data.tasks.length > 0 ? Math.round((complete.length / data.tasks.length) * 100) : 0;

      // Update the button badge
      const btn = document.querySelector('#ai-assist-getting-started .nav-button');
      if (btn && complete.length === data.tasks.length) {
        btn.innerHTML = '[OK] All Set Up <span class="nav-arrow">▼</span>';
      }

      // Build contextual suggestions — show up to 4 most important next steps
      let html = `<div style="margin-bottom:10px;">
        <div style="background:var(--bg-secondary);border-radius:4px;height:5px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:var(--accent-green);border-radius:4px;transition:width 0.5s ease;"></div>
        </div>
        <span style="font-size:11px;color:var(--text-muted);">${complete.length} of ${data.tasks.length} complete</span>
      </div>`;

      if (incomplete.length === 0) {
        html += '<div style="padding:8px 0;font-size:13px;color:var(--accent-green);">All setup steps complete! You\'re ready to grow.</div>';
      } else {
        const top = incomplete.slice(0, 4);
        top.forEach(task => {
          const badge = task.edgeOnly ? ' <span style="font-size:9px;background:rgba(139,92,246,0.15);color:#a78bfa;padding:1px 5px;border-radius:3px;">Edge</span>' : '';
          html += `<a href="#" onclick="event.preventDefault();navigateOnboardingTask('${task.link}','${task.linkUrl||''}');return false;"
            style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;text-decoration:none;color:var(--text-primary);font-size:13px;transition:background 0.15s;"
            onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background='transparent'">
            <span style="font-size:16px;">${task.icon || '○'}</span>
            <span style="flex:1;">${task.label}${badge}</span>
            <span style="color:var(--text-muted);font-size:12px;">→</span>
          </a>`;
        });
        if (incomplete.length > 4) {
          html += `<div style="padding:6px 10px;font-size:11px;color:var(--text-muted);">+ ${incomplete.length - 4} more in Settings → Getting Started</div>`;
        }
      }

      container.innerHTML = html;
    } catch (e) {
      console.warn('[AI Assist] Failed to load steps:', e);
      container.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">Setup guide unavailable</span>';
    }
  }

  // Load on first open (lazy) and refresh periodically
  let loaded = false;
  const trigger = document.querySelector('#ai-assist-getting-started .nav-button');
  if (trigger) {
    trigger.addEventListener('click', () => { if (!loaded) { loaded = true; loadSteps(); } });
  }
  // Also load after page is ready
  setTimeout(() => { if (!loaded) { loaded = true; loadSteps(); } }, 2000);
})();
