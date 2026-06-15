/**
 * Still Louder - Main Application Script
 * Modern website with scroll spy, reveal animations, and audio player
 */

import APP_CONFIG from './config.js';

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  scrollOffset: 100,
  revealThreshold: 0.15,
  headerScrollThreshold: 50,
  toastDuration: 3000,
  share: {
    title: 'Still Louder - Skirlaz',
    text: 'Escucha "Skirlaz" de Still Louder y mira el lyric video oficial - Rock panameño disponible ahora en todas las plataformas.',
    url: 'https://stilllouder.space/'
  },
  analytics: {
    enabled: typeof gtag !== 'undefined'
  }
};

// ============================================
// UTILITIES
// ============================================

/**
 * Throttle function to limit execution rate
 */
const throttle = (func, limit) => {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
};

/**
 * Format time in M:SS format
 */
const formatTime = (seconds) => {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Track analytics event
 */
const trackEvent = (eventName, params = {}) => {
  if (CONFIG.analytics.enabled) {
    gtag('event', eventName, params);
  }
};

// ============================================
// HEADER SCROLL EFFECT
// ============================================

const initHeaderScroll = () => {
  const header = document.getElementById('site-header');
  if (!header) return;

  const handleScroll = throttle(() => {
    if (window.scrollY > CONFIG.headerScrollThreshold) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }, 100);

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll(); // Initial check
};

// ============================================
// SCROLL SPY - Navigation Highlighting
// ============================================

const initScrollSpy = () => {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll(
    '.nav-link[data-section], .mobile-nav-link[data-section]'
  );

  if (sections.length === 0 || navLinks.length === 0) return;

  const observerOptions = {
    root: null,
    rootMargin: `-${CONFIG.scrollOffset}px 0px -50% 0px`,
    threshold: 0
  };

  const observerCallback = (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const sectionId = entry.target.id;

        // Update all nav links
        navLinks.forEach((link) => {
          if (link.dataset.section === sectionId) {
            link.classList.add('active');
          } else {
            link.classList.remove('active');
          }
        });
      }
    });
  };

  const observer = new IntersectionObserver(observerCallback, observerOptions);
  sections.forEach((section) => observer.observe(section));
};

// ============================================
// REVEAL ANIMATIONS ON SCROLL
// ============================================

const initRevealAnimations = () => {
  const revealElements = document.querySelectorAll('.reveal-up, .reveal-left');

  if (revealElements.length === 0) return;

  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: CONFIG.revealThreshold
  };

  const observerCallback = (entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target); // Only animate once
      }
    });
  };

  const observer = new IntersectionObserver(observerCallback, observerOptions);
  revealElements.forEach((el) => observer.observe(el));
};

// ============================================
// MOBILE MENU
// ============================================

const initMobileMenu = () => {
  const menuBtn = document.getElementById('mobile-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');
  const mobileLinks = document.querySelectorAll('.mobile-nav-link');

  if (!menuBtn || !mobileMenu) return;

  const toggleMenu = () => {
    const isActive = menuBtn.classList.toggle('active');
    mobileMenu.classList.toggle('active');
    document.body.style.overflow = isActive ? 'hidden' : '';
    menuBtn.setAttribute('aria-label', isActive ? 'Cerrar menú' : 'Abrir menú');
  };

  const closeMenu = () => {
    menuBtn.classList.remove('active');
    mobileMenu.classList.remove('active');
    document.body.style.overflow = '';
    menuBtn.setAttribute('aria-label', 'Abrir menú');
  };

  menuBtn.addEventListener('click', toggleMenu);

  mobileLinks.forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  // Close on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobileMenu.classList.contains('active')) {
      closeMenu();
    }
  });
};

// ============================================
// SMOOTH SCROLL FOR ANCHOR LINKS
// ============================================

const initSmoothScroll = () => {
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const targetId = anchor.getAttribute('href');
      if (targetId === '#') return;

      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const headerHeight = document.getElementById('site-header')?.offsetHeight || 0;
        const targetPosition = target.getBoundingClientRect().top + window.scrollY - headerHeight;

        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
};

// ============================================
// SHARE FUNCTIONALITY
// ============================================

const initShare = () => {
  const shareBtn = document.getElementById('share-btn');
  if (!shareBtn) return;

  shareBtn.addEventListener('click', async () => {
    const shareData = CONFIG.share;

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        trackEvent('share', {
          event_category: 'engagement',
          event_label: 'native_share'
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          fallbackCopyToClipboard(shareData.url);
        }
      }
    } else {
      fallbackCopyToClipboard(shareData.url);
    }
  });
};

const fallbackCopyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Enlace copiado al portapapeles', 'success');
    trackEvent('share', {
      event_category: 'engagement',
      event_label: 'clipboard_copy'
    });
  } catch (err) {
    showToast('No se pudo copiar el enlace', 'error');
  }
};

// ============================================
// TOAST NOTIFICATIONS
// ============================================

const showToast = (message, type = 'info') => {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'alert');

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, CONFIG.toastDuration);
};

// ============================================
// PLATFORM LINK TRACKING
// ============================================

const initPlatformTracking = () => {
  const platformLinks = document.querySelectorAll('.platform-card');

  platformLinks.forEach((link) => {
    link.addEventListener('click', () => {
      const platform = link.id.replace('-link', '');
      trackEvent('click_platform', {
        event_category: 'streaming',
        event_label: platform,
        platform_name: platform
      });
    });
  });

  // Social link tracking
  const socialLinks = document.querySelectorAll('.social-card');
  socialLinks.forEach((link) => {
    link.addEventListener('click', () => {
      const platform = link.classList.contains('social-card--instagram')
        ? 'instagram'
        : link.classList.contains('social-card--facebook')
          ? 'facebook'
          : link.classList.contains('social-card--tiktok')
            ? 'tiktok'
            : 'youtube';
      trackEvent('click_social', {
        event_category: 'social',
        event_label: platform
      });
    });
  });

  // Store link tracking
  const storeLink = document.getElementById('cuanto-link');
  if (storeLink) {
    storeLink.addEventListener('click', () => {
      trackEvent('click_store', {
        event_category: 'store',
        event_label: 'cuanto'
      });
    });
  }

  // Tickets link tracking
  const ticketsLink = document.getElementById('tickets-link');
  if (ticketsLink) {
    ticketsLink.addEventListener('click', () => {
      trackEvent('click_tickets', {
        event_category: 'tickets',
        event_label: 'when-we-were-young-3'
      });
    });
  }
};

// ============================================
// CONTACT FORM (Google Forms, backend-less)
// ============================================

const initContactForm = () => {
  if (!APP_CONFIG.features?.contact) return;

  const form = document.getElementById('contact-form');
  if (!form) return;

  const nameInput = document.getElementById('contact-name');
  const emailInput = document.getElementById('contact-email');
  const messageInput = document.getElementById('contact-message');
  const honeypot = document.getElementById('contact-website');
  const submitBtn = document.getElementById('contact-submit');

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const { formUrl, messageField } = APP_CONFIG.contact;
  const { error: errMsg, success: okMsg } = APP_CONFIG.messages;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Bot trap: a real visitor never fills the hidden honeypot. Pretend success
    // so the bot gets no signal, and bail without sending.
    if (honeypot && honeypot.value.trim() !== '') {
      form.reset();
      return;
    }

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const message = messageInput.value.trim();

    if (name.length < 2 || !email || message.length < 2) {
      showToast(errMsg.contactIncomplete, 'error');
      return;
    }
    if (!EMAIL_RE.test(email)) {
      showToast(errMsg.contactInvalidEmail, 'error');
      return;
    }

    // The reused Google Form has a single text field, so we fold name, email
    // and message into one composed value.
    const composed = `Nombre: ${name}\nCorreo: ${email}\n\nMensaje:\n${message}`;
    const formData = new FormData();
    formData.append(messageField, composed);

    submitBtn.disabled = true;
    submitBtn.setAttribute('aria-busy', 'true');

    try {
      // no-cors: Google Forms returns no CORS headers, so the response is
      // opaque (unreadable), but the submission still registers.
      await fetch(formUrl, { method: 'POST', mode: 'no-cors', body: formData });
      form.reset();
      showToast(okMsg.contactSent, 'success');
      trackEvent('contact_submit', { event_category: 'contact', event_label: 'success' });
    } catch (err) {
      showToast(errMsg.contactFailed, 'error');
      trackEvent('contact_submit', { event_category: 'contact', event_label: 'error' });
    } finally {
      submitBtn.disabled = false;
      submitBtn.removeAttribute('aria-busy');
    }
  });
};

// ============================================
// PARALLAX EFFECT FOR HERO
// ============================================

const initParallax = () => {
  const heroBg = document.querySelector('.hero-bg');
  if (!heroBg) return;

  // Only enable on desktop for performance
  if (window.matchMedia('(min-width: 768px)').matches) {
    const handleScroll = throttle(() => {
      const scrollY = window.scrollY;
      const heroHeight = document.querySelector('.hero')?.offsetHeight || 0;

      if (scrollY < heroHeight) {
        const parallaxOffset = scrollY * 0.4;
        heroBg.style.transform = `scale(1.1) translateY(${parallaxOffset}px)`;
      }
    }, 16);

    window.addEventListener('scroll', handleScroll, { passive: true });
  }
};

// ============================================
// PWA SHORTCUTS HANDLER
// ============================================

const initPWAShortcuts = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const action = urlParams.get('action');

  if (action) {
    trackEvent('pwa_shortcut', {
      event_category: 'pwa',
      event_label: action
    });

    const platformMap = {
      spotify: 'https://open.spotify.com/track/7jc86BEyQt8sdJsEbqtllU?si=1c59b85003e84b02',
      apple: 'https://music.apple.com/pa/album/skirlaz/1871380684?i=1871380685&l=en-GB',
      youtube: 'https://youtu.be/ukpbbWdqh_A'
    };

    if (platformMap[action]) {
      setTimeout(() => {
        window.open(platformMap[action], '_blank');
      }, 500);
    }
  }
};

// ============================================
// INITIALIZATION
// ============================================

const init = () => {
  // Core functionality
  initHeaderScroll();
  initScrollSpy();
  initRevealAnimations();
  initMobileMenu();
  initSmoothScroll();

  // Features
  initShare();
  initPlatformTracking();
  initContactForm();
  initParallax();
  initPWAShortcuts();

  // Log initialization
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(
      '%c Still Louder - Skirlaz ',
      'background: #c0282e; color: #fff; font-size: 18px; font-weight: bold; padding: 10px;'
    );
  }
};

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export for potential testing
export { init, showToast, formatTime };
