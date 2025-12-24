/**
 * UI Utilities Module
 * Loading states, animations, and UI helper functions
 */

import CONFIG from './config.js';

class UIUtils {
  constructor() {
    this.loadingElements = new Set();
  }

  /**
   * Add loading state to element
   * @param {HTMLElement} element - Element to add loading state
   * @param {Object} options - Loading options
   */
  addLoadingState(element, options = {}) {
    if (!element) return;

    const loadingClass = options.className || 'is-loading';
    element.classList.add(loadingClass);
    element.setAttribute('aria-busy', 'true');

    // Disable if it's a button or input
    if (element.tagName === 'BUTTON' || element.tagName === 'INPUT') {
      element.disabled = true;
    }

    // Add spinner if requested
    if (options.showSpinner) {
      const spinner = this.createSpinner();
      element.appendChild(spinner);
    }

    this.loadingElements.add(element);
  }

  /**
   * Remove loading state from element
   * @param {HTMLElement} element - Element to remove loading state
   * @param {Object} options - Loading options
   */
  removeLoadingState(element, options = {}) {
    if (!element) return;

    const loadingClass = options.className || 'is-loading';
    element.classList.remove(loadingClass);
    element.removeAttribute('aria-busy');

    // Re-enable if it's a button or input
    if (element.tagName === 'BUTTON' || element.tagName === 'INPUT') {
      element.disabled = false;
    }

    // Remove spinner if present
    const spinner = element.querySelector('.spinner');
    if (spinner) {
      spinner.remove();
    }

    this.loadingElements.delete(element);
  }

  /**
   * Create spinner element
   * @param {Object} options - Spinner options
   * @returns {HTMLElement}
   */
  createSpinner(options = {}) {
    const spinner = document.createElement('div');
    spinner.className = options.className || 'spinner';
    spinner.setAttribute('role', 'status');
    spinner.setAttribute('aria-label', 'Cargando...');

    // Add screen reader text
    const srText = document.createElement('span');
    srText.className = 'sr-only';
    srText.textContent = 'Cargando...';
    spinner.appendChild(srText);

    return spinner;
  }

  /**
   * Create skeleton loader
   * @param {Object} options - Skeleton options
   * @returns {HTMLElement}
   */
  createSkeleton(options = {}) {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton';
    skeleton.setAttribute('aria-busy', 'true');
    skeleton.setAttribute('aria-label', 'Cargando contenido...');

    if (options.width) skeleton.style.width = options.width;
    if (options.height) skeleton.style.height = options.height;
    if (options.borderRadius) skeleton.style.borderRadius = options.borderRadius;

    return skeleton;
  }

  /**
   * Add image loading states
   * @param {HTMLImageElement} img - Image element
   * @param {Object} options - Loading options
   */
  handleImageLoading(img, options = {}) {
    if (!img) return;

    // Add loading class
    img.classList.add('image-loading');

    // Create skeleton overlay if requested
    if (options.showSkeleton) {
      const skeleton = this.createSkeleton({
        width: img.width || '100%',
        height: img.height || '100%'
      });
      skeleton.style.position = 'absolute';
      skeleton.style.top = '0';
      skeleton.style.left = '0';

      const wrapper = img.parentElement;
      if (wrapper) {
        wrapper.style.position = 'relative';
        wrapper.appendChild(skeleton);
      }
    }

    // Handle load
    img.addEventListener(
      'load',
      () => {
        img.classList.remove('image-loading');
        img.classList.add('fade-in');

        // Remove skeleton
        const skeleton = img.parentElement?.querySelector('.skeleton');
        if (skeleton) {
          skeleton.remove();
        }
      },
      { once: true }
    );

    // Handle error
    img.addEventListener(
      'error',
      () => {
        img.classList.remove('image-loading');
        img.classList.add('image-error');

        // Remove skeleton
        const skeleton = img.parentElement?.querySelector('.skeleton');
        if (skeleton) {
          skeleton.remove();
        }

        // Use fallback if provided
        if (options.fallback) {
          img.src = options.fallback;
        }
      },
      { once: true }
    );
  }

  /**
   * Initialize lazy loading for images
   * @param {string} selector - Image selector
   */
  initLazyLoading(selector = 'img[loading="lazy"]') {
    if ('IntersectionObserver' in window) {
      const images = document.querySelectorAll(selector);

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const img = entry.target;
              this.handleImageLoading(img, { showSkeleton: true });
              observer.unobserve(img);
            }
          });
        },
        {
          rootMargin: '50px'
        }
      );

      images.forEach((img) => observer.observe(img));
    }
  }

  /**
   * Animate element entrance
   * @param {HTMLElement} element - Element to animate
   * @param {string} animation - Animation type
   * @param {number} delay - Delay in ms
   */
  animateIn(element, animation = 'fade-in', delay = 0) {
    if (!element) return;

    setTimeout(() => {
      element.classList.add(animation);
    }, delay);
  }

  /**
   * Stagger animation for multiple elements
   * @param {NodeList|Array} elements - Elements to animate
   * @param {Object} options - Animation options
   */
  staggerAnimation(elements, options = {}) {
    const animation = options.animation || 'slide-up';
    const stagger = options.stagger || 100;

    elements.forEach((element, index) => {
      this.animateIn(element, animation, index * stagger);
    });
  }

  /**
   * Smooth scroll to element
   * @param {HTMLElement|string} target - Target element or selector
   * @param {Object} options - Scroll options
   */
  smoothScrollTo(target, options = {}) {
    const element = typeof target === 'string' ? document.querySelector(target) : target;

    if (!element) return;

    const offset = options.offset || 0;
    const behavior = options.behavior || 'smooth';

    const elementPosition = element.getBoundingClientRect().top + window.pageYOffset;
    const offsetPosition = elementPosition - offset;

    window.scrollTo({
      top: offsetPosition,
      behavior: behavior
    });
  }

  /**
   * Debounce function
   * @param {Function} func - Function to debounce
   * @param {number} wait - Wait time in ms
   * @returns {Function}
   */
  debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * Throttle function
   * @param {Function} func - Function to throttle
   * @param {number} limit - Time limit in ms
   * @returns {Function}
   */
  throttle(func, limit = 300) {
    let inThrottle;
    return function executedFunction(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  }

  /**
   * Check if element is in viewport
   * @param {HTMLElement} element - Element to check
   * @param {number} offset - Offset in pixels
   * @returns {boolean}
   */
  isInViewport(element, offset = 0) {
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    return (
      rect.top >= -offset &&
      rect.left >= -offset &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) + offset &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth) + offset
    );
  }

  /**
   * Lock body scroll
   */
  lockScroll() {
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = this.getScrollbarWidth() + 'px';
  }

  /**
   * Unlock body scroll
   */
  unlockScroll() {
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  }

  /**
   * Get scrollbar width
   * @returns {number}
   */
  getScrollbarWidth() {
    const outer = document.createElement('div');
    outer.style.visibility = 'hidden';
    outer.style.overflow = 'scroll';
    document.body.appendChild(outer);

    const inner = document.createElement('div');
    outer.appendChild(inner);

    const scrollbarWidth = outer.offsetWidth - inner.offsetWidth;
    outer.parentNode.removeChild(outer);

    return scrollbarWidth;
  }

  /**
   * Format time (for audio player)
   * @param {number} seconds - Time in seconds
   * @returns {string}
   */
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Generate unique ID
   * @returns {string}
   */
  generateId() {
    return `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clean up loading states
   */
  cleanup() {
    this.loadingElements.forEach((element) => {
      this.removeLoadingState(element);
    });
    this.loadingElements.clear();
  }
}

// Create singleton instance
const uiUtils = new UIUtils();

// Export for use in other modules
export default uiUtils;

// Also export as window global
if (typeof window !== 'undefined') {
  window.stillLouderUI = uiUtils;
}
