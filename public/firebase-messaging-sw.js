// Firebase Cloud Messaging Service Worker
// Handles background push notifications when app is closed or not in focus

// Import Firebase scripts for service worker
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase configuration
// This will be populated by the app initialization script
// Format: { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId }
let firebaseConfig = null;

// Listen for config message from main app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FIREBASE_CONFIG') {
    firebaseConfig = event.data.config;
    initializeFirebase();
  }
});

function initializeFirebase() {
  if (!firebaseConfig) {
    console.log('[SW] Firebase config not available yet');
    return;
  }

  try {
    firebase.initializeApp(firebaseConfig);
    const messaging = firebase.messaging();

    // Handle background messages
    messaging.onBackgroundMessage((payload) => {
      console.log('[SW] Received background message:', payload);

      const notificationTitle = payload.notification?.title || 'GreenReach Notification';
      const notificationOptions = {
        body: payload.notification?.body || '',
        icon: payload.notification?.icon || '/images/cheo-mascot.svg',
        badge: '/images/cheo-mascot.svg',
        tag: payload.data?.orderId || 'default',
        data: payload.data || {},
        requireInteraction: payload.data?.priority === 'high',
        actions: [
          {
            action: 'open',
            title: 'View Order',
            icon: '/images/icons/open.png'
          },
          {
            action: 'dismiss',
            title: 'Dismiss',
            icon: '/images/icons/close.png'
          }
        ],
        vibrate: [200, 100, 200],
        timestamp: Date.now()
      };

      // Show notification
      return self.registration.showNotification(notificationTitle, notificationOptions);
    });

    console.log('[SW] Firebase initialized successfully');
  } catch (error) {
    console.error('[SW] Failed to initialize Firebase:', error);
  }
}

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.notification.tag);
  event.notification.close();

  const data = event.notification.data || {};
  
  // Determine URL based on action and data
  let targetUrl = '/';
  
  if (event.action === 'dismiss') {
    // Just close notification
    return;
  }
  
  if (event.action === 'open' || !event.action) {
    // Navigate to order details
    if (data.orderId) {
      targetUrl = `/wholesale-admin.html?order=${data.orderId}`;
    } else if (data.url) {
      targetUrl = data.url;
    } else {
      targetUrl = '/wholesale-admin.html';
    }
  }

  // Open or focus window
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if there's already a window open
        for (const client of clientList) {
          if (client.url.includes('/wholesale') && 'focus' in client) {
            client.postMessage({
              type: 'NOTIFICATION_CLICKED',
              data: data
            });
            return client.focus();
          }
        }
        
        // No suitable window found, open new one
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

// Handle service worker activation
self.addEventListener('activate', (event) => {
  console.log('[SW] Service worker activated');
  event.waitUntil(clients.claim());
});

// Handle installation
self.addEventListener('install', (event) => {
  console.log('[SW] Service worker installed');
  self.skipWaiting();
});

// Periodic background sync for checking urgent notifications
// (Optional - requires additional setup)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-urgent-orders') {
    event.waitUntil(checkUrgentOrders());
  }
});

async function checkUrgentOrders() {
  try {
    // Fetch urgent orders from API
    const response = await fetch('/api/wholesale/urgent-orders');
    const data = await response.json();
    
    if (data.urgentOrders && data.urgentOrders.length > 0) {
      // Show notification for urgent orders
      const order = data.urgentOrders[0];
      await self.registration.showNotification('Urgent Order Reminder', {
        body: `Order #${order.id} expires in ${order.hoursLeft} hours`,
        icon: '/images/cheo-mascot.svg',
        tag: `urgent-${order.id}`,
        data: { orderId: order.id },
        requireInteraction: true
      });
    }
  } catch (error) {
    console.error('[SW] Failed to check urgent orders:', error);
  }
}

// Cache-first strategy for offline support (optional)
self.addEventListener('fetch', (event) => {
  // Only cache GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip API calls and external resources
  if (event.request.url.includes('/api/') || 
      event.request.url.includes('firebase') ||
      event.request.url.includes('twilio')) {
    return;
  }

  // Let network handle everything else for now
  // Can add caching strategy here if needed for offline support
});

console.log('[SW] Firebase Messaging Service Worker loaded');
