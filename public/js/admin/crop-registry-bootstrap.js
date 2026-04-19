// Bootstrap crop registry synchronously so farm-admin.js can use cropUtils.
// Extracted verbatim from public/LE-farm-admin.html (previously inline
// <script> block at lines 4106-4121). Mirrored to greenreach-central.
//
// NOTE: This file is loaded WITHOUT `defer` so the synchronous XHR blocks
// parsing and cropUtils is populated before the farm-admin.js <script>
// immediately below it begins executing. Do not add `defer` or `async`.
(function() {
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/data/crop-registry.json', false); // sync
    xhr.send();
    if (xhr.status === 200) {
      var reg = JSON.parse(xhr.responseText);
      if (window.cropUtils && reg) cropUtils.setRegistry(reg);
    }
  } catch (e) {
    console.warn('crop-registry.json bootstrap failed:', e);
  }
})();
