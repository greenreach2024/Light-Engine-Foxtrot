// Show the farm-admin intro card in demo mode on page load.
// Extracted from public/LE-farm-admin.html. Mirrored to greenreach-central.
// Show intro card when page loads (only in demo mode)
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        showIntroCard('farm-admin');
    }, 500);
});
