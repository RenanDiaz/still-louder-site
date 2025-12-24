/**
 * Still Louder - Main Application Script
 * Modern website with scroll spy, reveal animations, and audio player
 */

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  scrollOffset: 100,
  revealThreshold: 0.15,
  headerScrollThreshold: 50,
  toastDuration: 3000,
  share: {
    title: 'Still Louder - Al Vacío',
    text: 'Escucha "Al Vacío" de Still Louder - Rock panameño disponible ahora en todas las plataformas.',
    url: 'https://stillouder.space/'
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
// AUDIO PLAYER
// ============================================

const initAudioPlayer = () => {
  const audio = document.getElementById('audio-preview');
  const playBtn = document.getElementById('play-btn');
  const progressBar = document.getElementById('progress-bar');
  const audioProgress = document.getElementById('audio-progress');
  const currentTimeEl = document.getElementById('current-time');
  const durationEl = document.getElementById('duration');

  if (!audio || !playBtn) return;

  // Update duration when metadata loads
  audio.addEventListener('loadedmetadata', () => {
    durationEl.textContent = formatTime(audio.duration);
  });

  // Play/Pause toggle
  playBtn.addEventListener('click', () => {
    if (audio.paused) {
      audio.play();
      playBtn.classList.add('is-playing');
      playBtn.setAttribute('aria-label', 'Pausar preview de Al Vacío');
      trackEvent('audio_play', {
        event_category: 'audio',
        event_label: 'Al Vacío Preview'
      });
    } else {
      audio.pause();
      playBtn.classList.remove('is-playing');
      playBtn.setAttribute('aria-label', 'Reproducir preview de Al Vacío');
    }
  });

  // Update progress bar
  audio.addEventListener('timeupdate', () => {
    const progress = (audio.currentTime / audio.duration) * 100;
    audioProgress.style.width = `${progress}%`;
    currentTimeEl.textContent = formatTime(audio.currentTime);
  });

  // Click on progress bar to seek
  progressBar.addEventListener('click', (e) => {
    const rect = progressBar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    audio.currentTime = percent * audio.duration;
  });

  // Reset when audio ends
  audio.addEventListener('ended', () => {
    playBtn.classList.remove('is-playing');
    playBtn.setAttribute('aria-label', 'Reproducir preview de Al Vacío');
    audioProgress.style.width = '0%';
    audio.currentTime = 0;
    trackEvent('audio_complete', {
      event_category: 'audio',
      event_label: 'Al Vacío Preview'
    });
  });

  // Keyboard support
  playBtn.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      playBtn.click();
    }
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
      spotify: 'https://open.spotify.com/track/4zBlVazxK6AQBMPZl9Rcgj?si=a96b91e05196497f',
      apple: 'https://music.apple.com/pa/album/al-vac%C3%ADo/1829334537?i=1829334538',
      youtube: 'https://youtu.be/L1JoCgyumzY?si=vdopuSJKVCdSvT9y'
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
  initAudioPlayer();
  initShare();
  initPlatformTracking();
  initParallax();
  initPWAShortcuts();

  // Log initialization
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(
      '%c Still Louder - Al Vacío ',
      'background: #ff6b35; color: #000; font-size: 18px; font-weight: bold; padding: 10px;'
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
