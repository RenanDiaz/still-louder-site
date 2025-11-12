// Still Louder - Service Worker Registration & Install Prompt
// Version 1.0.0

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    swPath: '/sw.js',
    updateCheckInterval: 60000, // Check for updates every 60 seconds
    installPromptDelay: 3000, // Show install prompt after 3 seconds
    enableNotifications: false, // Set to true to enable push notifications
    debug: true // Set to false in production
  };

  // State
  let deferredPrompt = null;
  let swRegistration = null;
  let isInstalled = false;

  // Utility functions
  function log(...args) {
    if (CONFIG.debug) {
      console.log('[SW Register]', ...args);
    }
  }

  function logError(...args) {
    console.error('[SW Register]', ...args);
  }

  // Check if browser supports Service Workers
  function isServiceWorkerSupported() {
    return 'serviceWorker' in navigator;
  }

  // Check if app is already installed
  function checkIfInstalled() {
    // Check if running as standalone (installed PWA)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      isInstalled = true;
      log('App is running as installed PWA');
      return true;
    }

    // Check iOS
    if (window.navigator.standalone === true) {
      isInstalled = true;
      log('App is running as installed PWA (iOS)');
      return true;
    }

    return false;
  }

  // Register Service Worker
  async function registerServiceWorker() {
    if (!isServiceWorkerSupported()) {
      log('Service Workers not supported in this browser');
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.register(CONFIG.swPath, {
        scope: '/',
        updateViaCache: 'none' // Always check for updates
      });

      swRegistration = registration;
      log('Service Worker registered successfully:', registration);

      // Check for updates
      setupUpdateChecks(registration);

      // Handle controller change (new SW activated)
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        log('New Service Worker activated, reloading page...');
        window.location.reload();
      });

      return registration;
    } catch (error) {
      logError('Service Worker registration failed:', error);
      return null;
    }
  }

  // Setup automatic update checks
  function setupUpdateChecks(registration) {
    // Check for updates on page load
    registration.update();

    // Check for updates periodically
    setInterval(() => {
      log('Checking for Service Worker updates...');
      registration.update();
    }, CONFIG.updateCheckInterval);

    // Listen for new service worker waiting to activate
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      log('New Service Worker found, installing...');

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New service worker installed, show update notification
          log('New Service Worker installed, update available');
          showUpdateNotification(registration);
        }
      });
    });
  }

  // Show update notification
  function showUpdateNotification(registration) {
    // Create update notification UI
    const notification = document.createElement('div');
    notification.id = 'sw-update-notification';
    notification.innerHTML = `
      <div style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: linear-gradient(135deg, #1a1a1a 0%, #000000 100%);
        color: white;
        padding: 20px 25px;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        z-index: 10000;
        max-width: 350px;
        font-family: 'Inter', sans-serif;
        border: 1px solid rgba(255, 255, 255, 0.1);
        animation: slideIn 0.3s ease-out;
      ">
        <div style="font-weight: 600; margin-bottom: 8px; font-size: 16px;">
          Nueva versión disponible
        </div>
        <div style="color: #cccccc; margin-bottom: 15px; font-size: 14px; line-height: 1.4;">
          Hay una actualización disponible para Still Louder.
        </div>
        <div style="display: flex; gap: 10px;">
          <button id="sw-update-btn" style="
            flex: 1;
            padding: 10px 20px;
            background: white;
            color: black;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s ease;
          ">
            Actualizar
          </button>
          <button id="sw-dismiss-btn" style="
            padding: 10px 20px;
            background: transparent;
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s ease;
          ">
            Después
          </button>
        </div>
      </div>
      <style>
        @keyframes slideIn {
          from {
            transform: translateX(400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        #sw-update-btn:hover {
          background: #e0e0e0;
        }
        #sw-dismiss-btn:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      </style>
    `;

    document.body.appendChild(notification);

    // Update button
    document.getElementById('sw-update-btn').addEventListener('click', () => {
      // Skip waiting and activate new service worker
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    });

    // Dismiss button
    document.getElementById('sw-dismiss-btn').addEventListener('click', () => {
      notification.remove();
    });
  }

  // Handle beforeinstallprompt event
  function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent default mini-infobar on mobile
      e.preventDefault();

      // Store event for later use
      deferredPrompt = e;
      log('Install prompt available');

      // Show custom install prompt after delay
      if (!isInstalled) {
        setTimeout(() => {
          showInstallPrompt();
        }, CONFIG.installPromptDelay);
      }
    });

    // Listen for app installed event
    window.addEventListener('appinstalled', () => {
      log('PWA installed successfully');
      isInstalled = true;
      deferredPrompt = null;

      // Track installation in analytics
      if (typeof gtag !== 'undefined') {
        gtag('event', 'pwa_install', {
          event_category: 'pwa',
          event_label: 'app_installed'
        });
      }

      // Hide any visible install prompts
      const existingPrompt = document.getElementById('sw-install-prompt');
      if (existingPrompt) {
        existingPrompt.remove();
      }

      // Show success message
      showInstallSuccessMessage();
    });
  }

  // Show custom install prompt
  function showInstallPrompt() {
    if (!deferredPrompt || isInstalled) {
      return;
    }

    // Don't show if user previously dismissed
    if (localStorage.getItem('installPromptDismissed') === 'true') {
      return;
    }

    // Create custom install prompt UI
    const prompt = document.createElement('div');
    prompt.id = 'sw-install-prompt';
    prompt.innerHTML = `
      <div style="
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #1a1a1a 0%, #000000 100%);
        color: white;
        padding: 20px 25px;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        z-index: 10000;
        max-width: 90%;
        width: 400px;
        font-family: 'Inter', sans-serif;
        border: 1px solid rgba(255, 255, 255, 0.1);
        animation: slideUp 0.3s ease-out;
      ">
        <div style="display: flex; align-items: start; gap: 15px;">
          <div style="font-size: 36px;">🎵</div>
          <div style="flex: 1;">
            <div style="font-weight: 600; margin-bottom: 8px; font-size: 16px;">
              Instalar Still Louder
            </div>
            <div style="color: #cccccc; margin-bottom: 15px; font-size: 14px; line-height: 1.4;">
              Accede rápidamente a tu música favorita desde tu pantalla de inicio.
            </div>
            <div style="display: flex; gap: 10px;">
              <button id="sw-install-btn" style="
                flex: 1;
                padding: 12px 20px;
                background: white;
                color: black;
                border: none;
                border-radius: 8px;
                font-weight: 600;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s ease;
              ">
                Instalar
              </button>
              <button id="sw-install-dismiss-btn" style="
                padding: 12px 20px;
                background: transparent;
                color: white;
                border: 1px solid rgba(255, 255, 255, 0.3);
                border-radius: 8px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s ease;
              ">
                Ahora no
              </button>
            </div>
          </div>
        </div>
      </div>
      <style>
        @keyframes slideUp {
          from {
            transform: translateX(-50%) translateY(100px);
            opacity: 0;
          }
          to {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
          }
        }
        #sw-install-btn:hover {
          background: #e0e0e0;
        }
        #sw-install-dismiss-btn:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      </style>
    `;

    document.body.appendChild(prompt);

    // Install button
    document.getElementById('sw-install-btn').addEventListener('click', async () => {
      if (!deferredPrompt) return;

      // Show native install prompt
      deferredPrompt.prompt();

      // Wait for user choice
      const { outcome } = await deferredPrompt.userChoice;
      log('Install prompt outcome:', outcome);

      // Track in analytics
      if (typeof gtag !== 'undefined') {
        gtag('event', 'pwa_install_prompt', {
          event_category: 'pwa',
          event_label: outcome
        });
      }

      // Reset deferred prompt
      deferredPrompt = null;

      // Remove prompt
      prompt.remove();
    });

    // Dismiss button
    document.getElementById('sw-install-dismiss-btn').addEventListener('click', () => {
      localStorage.setItem('installPromptDismissed', 'true');
      prompt.remove();
      log('Install prompt dismissed by user');

      // Track dismissal
      if (typeof gtag !== 'undefined') {
        gtag('event', 'pwa_install_dismissed', {
          event_category: 'pwa'
        });
      }
    });
  }

  // Show install success message
  function showInstallSuccessMessage() {
    const message = document.createElement('div');
    message.innerHTML = `
      <div style="
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #1a1a1a 0%, #000000 100%);
        color: white;
        padding: 20px 25px;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        z-index: 10000;
        font-family: 'Inter', sans-serif;
        border: 1px solid rgba(255, 255, 255, 0.1);
        animation: slideIn 0.3s ease-out;
      ">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="font-size: 24px;">✓</div>
          <div>
            <div style="font-weight: 600; font-size: 15px;">¡Instalación exitosa!</div>
            <div style="color: #cccccc; font-size: 13px; margin-top: 4px;">
              Still Louder está listo para usar
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(message);

    // Auto-remove after 4 seconds
    setTimeout(() => {
      message.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => message.remove(), 300);
    }, 4000);
  }

  // Add manual install button functionality
  function setupManualInstallButton() {
    // Find install buttons in the page
    const installButtons = document.querySelectorAll('[data-pwa-install]');

    installButtons.forEach(button => {
      button.addEventListener('click', async (e) => {
        e.preventDefault();

        if (!deferredPrompt) {
          log('Install prompt not available');
          return;
        }

        // Show native install prompt
        deferredPrompt.prompt();

        // Wait for user choice
        const { outcome } = await deferredPrompt.userChoice;
        log('Manual install outcome:', outcome);

        // Track in analytics
        if (typeof gtag !== 'undefined') {
          gtag('event', 'pwa_manual_install', {
            event_category: 'pwa',
            event_label: outcome
          });
        }

        deferredPrompt = null;
      });
    });
  }

  // Check connection status
  function setupConnectionMonitoring() {
    function updateOnlineStatus() {
      const isOnline = navigator.onLine;
      log('Connection status changed:', isOnline ? 'online' : 'offline');

      // Track in analytics
      if (typeof gtag !== 'undefined') {
        gtag('event', isOnline ? 'connection_online' : 'connection_offline', {
          event_category: 'pwa'
        });
      }

      // Dispatch custom event
      window.dispatchEvent(new CustomEvent('connectionchange', {
        detail: { online: isOnline }
      }));
    }

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
  }

  // Request notification permission (if enabled)
  async function setupNotifications() {
    if (!CONFIG.enableNotifications || !('Notification' in window)) {
      return;
    }

    if (Notification.permission === 'default') {
      // Could show a custom UI here before requesting permission
      log('Notification permission not yet requested');
    }
  }

  // Initialize everything
  async function init() {
    log('Initializing PWA features...');

    // Check if already installed
    checkIfInstalled();

    // Register Service Worker
    await registerServiceWorker();

    // Setup install prompt
    setupInstallPrompt();

    // Setup manual install buttons
    setupManualInstallButton();

    // Setup connection monitoring
    setupConnectionMonitoring();

    // Setup notifications (if enabled)
    await setupNotifications();

    log('PWA features initialized successfully');

    // Track PWA initialization
    if (typeof gtag !== 'undefined') {
      gtag('event', 'pwa_initialized', {
        event_category: 'pwa',
        installed: isInstalled
      });
    }
  }

  // Start initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose public API
  window.StillLouderPWA = {
    showInstallPrompt,
    isInstalled: () => isInstalled,
    getRegistration: () => swRegistration,
    checkForUpdates: () => swRegistration?.update(),
    clearCache: async () => {
      if (swRegistration) {
        swRegistration.active?.postMessage({ type: 'CLEAR_CACHE' });
        log('Cache clear requested');
      }
    }
  };

})();
