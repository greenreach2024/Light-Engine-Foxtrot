// Detect private browsing mode by checking if localStorage is restricted.
// Extracted verbatim from public/LE-farm-admin.html (previously inline
// <script> block at lines 1170-1184). Mirrored to greenreach-central.
(function detectPrivateMode() {
  try {
    localStorage.setItem('__test__', '1');
    localStorage.removeItem('__test__');
    console.log('✓ localStorage available (normal browsing mode)');
  } catch (e) {
    // localStorage is blocked - show warning
    document.getElementById('privateModeWarning').style.display = 'block';
    console.warn('⚠ localStorage blocked - private browsing mode detected');
    console.log('💡 Authentication will work via sessionStorage (this tab only)');
  }
})();
