// Copilot: small helpers only; no visual changes.
(function (g) {
  const state = {
    offline: false,
    backoffMs: 2000, // starts at 2s
    maxBackoffMs: 60000, // caps at 60s
    lastWarn: new Map() // message → timestamp
  };

  function warnOnce(key, msg, minIntervalMs = 15000) {
    const now = Date.now();
    const last = state.lastWarn.get(key) || 0;
    if (now - last >= minIntervalMs) {
      console.warn(msg);
      state.lastWarn.set(key, now);
    }
  }

  async function fetchJSON(url, opts) {
    const { timeout = 10000, ...rest } = (opts || {});
    const ac = new AbortController();
    const id = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, { ...rest, signal: ac.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      // Treat *network* failures as offline; do not throw to UI.
      state.offline = true;
      warnOnce('net-offline', '[net] controller unreachable; entering backoff');
      throw e;
    } finally {
      clearTimeout(id);
    }
  }

  async function healthz(BASE) {
    try {
      const j = await fetchJSON(`${BASE}/healthz`, { timeout: 4000 });
      // Any success → restore normal polling cadence
      state.offline = false;
      state.backoffMs = 2000;
      return j;
    } catch (e) {
      // keep offline=true
      state.backoffMs = Math.min(state.backoffMs * 2, state.maxBackoffMs);
      return null; // never throw upward
    }
  }

  async function guardedPoll(fn) {
    // Runs fn(); if offline, slows down.
    if (state.offline) {
      await new Promise(r => setTimeout(r, state.backoffMs));
    }
    try {
      return await fn();
    } catch {
      // on failure, we’re already offline; slow down more next time
      return null;
    }
  }

  g.NetGuard = { state, fetchJSON, healthz, guardedPoll, warnOnce };
})(window);
