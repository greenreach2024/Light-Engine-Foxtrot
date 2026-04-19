// Tesla Tab Controller -- open/close dropdown panels.
// Extracted verbatim from public/LE-farm-admin.html (previously inline
// <script> block at lines 1242-1270). Mirrored to greenreach-central.
(function initTeslaTabs() {
  var tabs = document.querySelectorAll('.tesla-tab');
  tabs.forEach(function(tab) {
    var trigger = tab.querySelector('.tesla-tab__trigger');
    if (!trigger) return;
    trigger.addEventListener('click', function(e) {
      e.stopPropagation();
      var wasOpen = tab.classList.contains('is-open');
      // Close all tabs first
      tabs.forEach(function(t) { t.classList.remove('is-open'); });
      if (!wasOpen) tab.classList.add('is-open');
    });
  });
  // Close tabs on outside click
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.tesla-tab')) {
      tabs.forEach(function(t) { t.classList.remove('is-open'); });
    }
  });
  // Close tab when a nav-item inside it is clicked
  document.querySelectorAll('.tesla-tab__panel .nav-item').forEach(function(item) {
    item.addEventListener('click', function() {
      tabs.forEach(function(t) { t.classList.remove('is-open'); });
    });
  });
})();
