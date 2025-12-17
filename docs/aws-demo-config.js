// AWS S3 Demo Configuration
// This file is loaded before the main app to configure demo mode

(function() {
  'use strict';
  
  // Enable demo mode
  window.DEMO_MODE = true;
  window.DEMO_ENABLED = true;
  
  // Set API base to current origin (S3 URL)
  window.API_BASE = window.location.origin;
  
  // Configure for static demo (no backend)
  window.STATIC_DEMO = true;
  
  // Set demo farm ID
  window.DEMO_FARM_ID = 'DEMO-FARM-001';
  
  console.log('[AWS Demo Config] Demo mode enabled');
  console.log('[AWS Demo Config] API Base:', window.API_BASE);
})();
