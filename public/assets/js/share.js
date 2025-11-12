/**
 * Web Share API Module
 * Implements native sharing with fallback to clipboard
 */

import CONFIG from './config.js';
import analytics from './analytics.js';

class ShareManager {
  constructor() {
    this.canShare = typeof navigator.share === 'function';
    this.canCopy = typeof navigator.clipboard?.writeText === 'function';
  }

  /**
   * Share content using Web Share API or fallback
   * @param {Object} options - Share options
   * @returns {Promise<boolean>} - Success status
   */
  async share(options = {}) {
    const shareData = {
      title: options.title || `${CONFIG.release.artist} - ${CONFIG.release.title}`,
      text: options.text || CONFIG.site.description,
      url: options.url || CONFIG.site.url
    };

    // Try Web Share API first (mobile/modern browsers)
    if (this.canShare) {
      try {
        await navigator.share(shareData);
        analytics.trackShare('Web Share API');
        this.showToast(CONFIG.messages.success.shareSuccess);
        return true;
      } catch (error) {
        // User cancelled or error occurred
        if (error.name !== 'AbortError') {
          console.warn('Share failed:', error);
        }
        // Fall through to clipboard fallback
      }
    }

    // Fallback to clipboard
    return this.copyToClipboard(shareData.url);
  }

  /**
   * Copy URL to clipboard
   * @param {string} url - URL to copy
   * @returns {Promise<boolean>} - Success status
   */
  async copyToClipboard(url) {
    if (!this.canCopy) {
      // Legacy fallback for older browsers
      return this.legacyCopyToClipboard(url);
    }

    try {
      await navigator.clipboard.writeText(url);
      analytics.trackShare('Copy to Clipboard');
      this.showToast(CONFIG.messages.success.copiedToClipboard);
      return true;
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      analytics.trackError('clipboard_error', error.message);
      this.showToast(CONFIG.messages.error.shareFailed, 'error');
      return false;
    }
  }

  /**
   * Legacy copy method for older browsers
   * @param {string} text - Text to copy
   * @returns {boolean} - Success status
   */
  legacyCopyToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.setAttribute('aria-hidden', 'true');

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);

      if (successful) {
        analytics.trackShare('Legacy Copy');
        this.showToast(CONFIG.messages.success.copiedToClipboard);
        return true;
      }
    } catch (error) {
      console.error('Legacy copy failed:', error);
      document.body.removeChild(textArea);
    }

    this.showToast(CONFIG.messages.error.shareFailed, 'error');
    return false;
  }

  /**
   * Show toast notification
   * @param {string} message - Message to display
   * @param {string} type - Toast type (success, error, info)
   */
  showToast(message, type = 'success') {
    // Remove existing toast if present
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.textContent = message;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    // Add styles inline to avoid CSS dependency
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '12px 24px',
      borderRadius: '8px',
      backgroundColor: type === 'error' ? '#f44336' : '#4caf50',
      color: '#ffffff',
      fontSize: '14px',
      fontWeight: '600',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
      zIndex: '10000',
      animation: 'toast-slide-up 0.3s ease-out',
      maxWidth: '90vw',
      textAlign: 'center'
    });

    // Add animation keyframes
    if (!document.querySelector('#toast-animations')) {
      const style = document.createElement('style');
      style.id = 'toast-animations';
      style.textContent = `
        @keyframes toast-slide-up {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }
        @keyframes toast-fade-out {
          to {
            opacity: 0;
            transform: translateX(-50%) translateY(20px);
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    // Auto-remove after duration
    setTimeout(() => {
      toast.style.animation = 'toast-fade-out 0.3s ease-out forwards';
      setTimeout(() => toast.remove(), 300);
    }, CONFIG.ui.toastDuration);
  }

  /**
   * Create share button element
   * @param {Object} options - Button options
   * @returns {HTMLElement} - Share button element
   */
  createShareButton(options = {}) {
    const button = document.createElement('button');
    button.className = options.className || 'share-button';
    button.setAttribute('aria-label', 'Compartir');

    // Share icon SVG
    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
        <path d="M13.5 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M11 2.5a2.5 2.5 0 1 1 .603 1.628l-6.718 3.12a2.5 2.5 0 0 1 0 1.504l6.718 3.12a2.5 2.5 0 1 1-.488.876l-6.718-3.12a2.5 2.5 0 1 1 0-3.256l6.718-3.12A2.5 2.5 0 0 1 11 2.5m-8.5 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m11 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"/>
      </svg>
      <span>${options.label || 'Compartir'}</span>
    `;

    button.addEventListener('click', () => this.share(options.shareData));

    return button;
  }

  /**
   * Initialize share buttons on page
   * @param {string} selector - CSS selector for container
   */
  initShareButtons(selector = '.share-container') {
    const containers = document.querySelectorAll(selector);

    containers.forEach(container => {
      const button = this.createShareButton({
        shareData: {
          title: container.dataset.shareTitle,
          text: container.dataset.shareText,
          url: container.dataset.shareUrl
        }
      });
      container.appendChild(button);
    });
  }
}

// Create singleton instance
const shareManager = new ShareManager();

// Export for use in other modules
export default shareManager;

// Also export as window global for inline scripts
if (typeof window !== 'undefined') {
  window.stillLouderShare = shareManager;
}
