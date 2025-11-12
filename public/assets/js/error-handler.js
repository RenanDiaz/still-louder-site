/**
 * Error Handling Module
 * Centralized error handling with user-friendly messages
 */

import CONFIG from './config.js';
import analytics from './analytics.js';

class ErrorHandler {
  constructor() {
    this.errorLog = [];
    this.maxLogSize = 50;
    this.initialized = false;
  }

  /**
   * Initialize global error handlers
   */
  init() {
    if (this.initialized) return;

    // Handle uncaught errors
    window.addEventListener('error', (event) => {
      this.handleError({
        type: 'uncaught',
        message: event.message,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
        error: event.error
      });
    });

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.handleError({
        type: 'unhandled_promise',
        message: event.reason?.message || 'Unhandled promise rejection',
        error: event.reason
      });
    });

    this.initialized = true;
  }

  /**
   * Handle and log errors
   * @param {Object} errorInfo - Error information
   */
  handleError(errorInfo) {
    const error = {
      ...errorInfo,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent
    };

    // Add to log
    this.logError(error);

    // Track in analytics
    analytics.trackError(error.type, error.message);

    // Log to console in development
    if (this.isDevelopment()) {
      console.error('Error caught:', error);
    }

    // Show user-friendly message for critical errors
    if (this.isCritical(error)) {
      this.showErrorMessage(CONFIG.messages.error.generic);
    }
  }

  /**
   * Log error to internal log
   * @param {Object} error - Error object
   */
  logError(error) {
    this.errorLog.push(error);

    // Trim log if it exceeds max size
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize);
    }
  }

  /**
   * Handle network errors
   * @param {Error} error - Network error
   */
  handleNetworkError(error) {
    this.handleError({
      type: 'network',
      message: CONFIG.messages.error.network,
      error
    });

    this.showErrorMessage(CONFIG.messages.error.network);
  }

  /**
   * Handle image loading errors
   * @param {HTMLImageElement} img - Image element
   * @param {string} fallbackSrc - Fallback image source
   */
  handleImageError(img, fallbackSrc = null) {
    this.handleError({
      type: 'image_load',
      message: `Failed to load image: ${img.src}`,
      src: img.src
    });

    if (fallbackSrc) {
      img.src = fallbackSrc;
    } else {
      // Add error class for styling
      img.classList.add('image-error');
      img.alt = 'Imagen no disponible';
    }
  }

  /**
   * Handle audio loading errors
   * @param {HTMLAudioElement} audio - Audio element
   */
  handleAudioError(audio) {
    const errorCode = audio.error?.code;
    const errorMessages = {
      1: 'Carga abortada',
      2: 'Error de red',
      3: 'Error de decodificación',
      4: 'Formato no soportado'
    };

    const message = errorMessages[errorCode] || 'Error al cargar el audio';

    this.handleError({
      type: 'audio_load',
      message,
      code: errorCode,
      src: audio.src
    });

    this.showErrorMessage(`Error al cargar el audio: ${message}`);
  }

  /**
   * Handle form submission errors
   * @param {Error} error - Form error
   * @param {string} formName - Form identifier
   */
  handleFormError(error, formName) {
    this.handleError({
      type: 'form_submit',
      message: error.message,
      form: formName,
      error
    });

    this.showErrorMessage(CONFIG.messages.error.commentFailed);
  }

  /**
   * Show error message to user
   * @param {string} message - Error message
   * @param {number} duration - Display duration in ms
   */
  showErrorMessage(message, duration = 5000) {
    // Remove existing error if present
    const existing = document.querySelector('.error-notification');
    if (existing) {
      existing.remove();
    }

    const notification = document.createElement('div');
    notification.className = 'error-notification';
    notification.textContent = message;
    notification.setAttribute('role', 'alert');
    notification.setAttribute('aria-live', 'assertive');

    // Add styles
    Object.assign(notification.style, {
      position: 'fixed',
      top: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '16px 24px',
      borderRadius: '8px',
      backgroundColor: '#f44336',
      color: '#ffffff',
      fontSize: '14px',
      fontWeight: '600',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
      zIndex: '10000',
      maxWidth: '90vw',
      textAlign: 'center',
      animation: 'error-slide-down 0.3s ease-out'
    });

    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Cerrar notificación');
    Object.assign(closeBtn.style, {
      marginLeft: '12px',
      background: 'none',
      border: 'none',
      color: '#ffffff',
      fontSize: '20px',
      cursor: 'pointer',
      padding: '0',
      lineHeight: '1'
    });

    closeBtn.addEventListener('click', () => notification.remove());
    notification.appendChild(closeBtn);

    // Add animation keyframes if not present
    if (!document.querySelector('#error-animations')) {
      const style = document.createElement('style');
      style.id = 'error-animations';
      style.textContent = `
        @keyframes error-slide-down {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(notification);

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => notification.remove(), duration);
    }
  }

  /**
   * Check if error is critical
   * @param {Object} error - Error object
   * @returns {boolean}
   */
  isCritical(error) {
    const criticalTypes = ['uncaught', 'unhandled_promise'];
    return criticalTypes.includes(error.type);
  }

  /**
   * Check if in development mode
   * @returns {boolean}
   */
  isDevelopment() {
    return window.location.hostname === 'localhost' ||
           window.location.hostname === '127.0.0.1' ||
           window.location.port !== '';
  }

  /**
   * Get error log
   * @returns {Array} - Error log
   */
  getErrorLog() {
    return [...this.errorLog];
  }

  /**
   * Clear error log
   */
  clearErrorLog() {
    this.errorLog = [];
  }

  /**
   * Create retry button
   * @param {Function} retryFn - Function to execute on retry
   * @returns {HTMLElement}
   */
  createRetryButton(retryFn) {
    const button = document.createElement('button');
    button.className = 'retry-button';
    button.textContent = 'Reintentar';
    button.setAttribute('aria-label', 'Reintentar');

    Object.assign(button.style, {
      marginTop: '12px',
      padding: '8px 16px',
      backgroundColor: '#2196f3',
      color: '#ffffff',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '600'
    });

    button.addEventListener('click', () => {
      try {
        retryFn();
      } catch (error) {
        this.handleError({
          type: 'retry_failed',
          message: error.message,
          error
        });
      }
    });

    return button;
  }
}

// Create singleton instance
const errorHandler = new ErrorHandler();

// Export for use in other modules
export default errorHandler;

// Also export as window global
if (typeof window !== 'undefined') {
  window.stillLouderErrorHandler = errorHandler;
}
