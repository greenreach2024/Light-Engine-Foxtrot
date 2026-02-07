/**
 * HOTFIX: Patch saveSession to write legacy localStorage keys
 * This fixes the redirect loop caused by missing token/farm_id/farm_name/email keys
 * 
 * Deploy this by adding <script src="/hotfix-session-storage.js"></script> to HTML pages
 */

(function() {
    console.log('[HOTFIX] Patching saveSession for localStorage compatibility');
    
    // Wait for saveSession to exist (from farm-admin.js)
    const patchInterval = setInterval(() => {
        if (typeof saveSession === 'function') {
            clearInterval(patchInterval);
            
            // Save original function
            const originalSaveSession = window.saveSession;
            
            // Override with patched version
            window.saveSession = function(session) {
                console.log('[HOTFIX] saveSession called with:', session);
                
                // Call original
                originalSaveSession(session);
                
                // Write legacy keys for compatibility
                if (session?.token) {
                    localStorage.setItem('token', session.token);
                    console.log('[HOTFIX] Wrote token to localStorage');
                }
                if (session?.farmId) {
                    localStorage.setItem('farm_id', session.farmId);
                    console.log('[HOTFIX] Wrote farm_id to localStorage');
                }
                if (session?.farmName) {
                    localStorage.setItem('farm_name', session.farmName);
                    console.log('[HOTFIX] Wrote farm_name to localStorage');
                }
                if (session?.email) {
                    localStorage.setItem('email', session.email);
                    console.log('[HOTFIX] Wrote email to localStorage');
                }
                
                console.log('[HOTFIX] Legacy localStorage keys written successfully');
            };
            
            console.log('[HOTFIX] saveSession patched successfully');
        }
    }, 100);
    
    // Timeout after 5 seconds
    setTimeout(() => {
        clearInterval(patchInterval);
        if (typeof saveSession !== 'function') {
            console.warn('[HOTFIX] saveSession not found after 5 seconds - patch failed');
        }
    }, 5000);
})();
