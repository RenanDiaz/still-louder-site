/**
 * Enhanced Analytics Module
 * Centralized analytics tracking with improved event handling
 */

import CONFIG from './config.js';

class Analytics {
  constructor() {
    this.enabled = CONFIG.analytics.enabled && typeof gtag === 'function';
    this.sessionStartTime = Date.now();
  }

  /**
   * Track a custom event
   * @param {string} eventName - Event name
   * @param {Object} params - Event parameters
   */
  trackEvent(eventName, params = {}) {
    if (!this.enabled) return;

    try {
      gtag('event', eventName, {
        ...params,
        timestamp: Date.now()
      });
    } catch (error) {
      console.warn('Analytics tracking error:', error);
    }
  }

  /**
   * Track platform link clicks
   * @param {string} platform - Platform name (spotify, apple, etc)
   */
  trackPlatformClick(platform) {
    this.trackEvent('click_platform', {
      event_category: 'streaming',
      event_label: platform,
      platform_name: platform,
      value: 1
    });
  }

  /**
   * Track social media link clicks
   * @param {string} network - Social network name
   */
  trackSocialClick(network) {
    this.trackEvent('social_click', {
      event_category: 'social',
      event_label: network,
      social_network: network,
      value: 1
    });
  }

  /**
   * Track sponsor clicks
   * @param {string} sponsorName - Sponsor name
   */
  trackSponsorClick(sponsorName) {
    this.trackEvent('sponsor_click', {
      event_category: 'engagement',
      event_label: sponsorName,
      sponsor_name: sponsorName,
      value: 1
    });
  }

  /**
   * Track audio player interactions
   * @param {string} action - play, pause, ended, etc.
   */
  trackAudioEvent(action) {
    this.trackEvent(`audio_${action}`, {
      event_category: 'audio',
      event_label: CONFIG.release.title,
      track_name: CONFIG.release.title,
      artist: CONFIG.release.artist,
      value: 1
    });
  }

  /**
   * Track share events
   * @param {string} method - Web Share API, Copy Link, etc.
   */
  trackShare(method) {
    this.trackEvent('share', {
      event_category: 'engagement',
      event_label: method,
      method: method,
      content_type: 'release',
      value: 1
    });
  }

  /**
   * Track comment submission
   * @param {boolean} success - Whether submission was successful
   */
  trackComment(success) {
    this.trackEvent('comment_submit', {
      event_category: 'engagement',
      event_label: success ? 'success' : 'error',
      success: success,
      value: success ? 1 : 0
    });
  }

  /**
   * Track page engagement (time spent)
   */
  trackEngagement() {
    const timeSpent = Math.round((Date.now() - this.sessionStartTime) / 1000);

    // Track at various milestones
    const milestones = [10, 30, 60, 120, 300]; // seconds

    milestones.forEach((milestone) => {
      if (timeSpent === milestone) {
        this.trackEvent('engagement_time', {
          event_category: 'engagement',
          event_label: `${milestone}_seconds`,
          time_seconds: timeSpent,
          value: milestone
        });
      }
    });
  }

  /**
   * Track user interaction with form
   * @param {string} fieldName - Form field name
   */
  trackFormInteraction(fieldName) {
    this.trackEvent('form_interaction', {
      event_category: 'form',
      event_label: fieldName,
      field_name: fieldName
    });
  }

  /**
   * Track errors
   * @param {string} errorType - Type of error
   * @param {string} errorMessage - Error message
   */
  trackError(errorType, errorMessage) {
    this.trackEvent('error', {
      event_category: 'error',
      event_label: errorType,
      error_type: errorType,
      error_message: errorMessage,
      fatal: false
    });
  }

  /**
   * Track page scroll depth
   * @param {number} percentage - Scroll percentage
   */
  trackScrollDepth(percentage) {
    this.trackEvent('scroll_depth', {
      event_category: 'engagement',
      event_label: `${percentage}%`,
      scroll_percentage: percentage,
      value: percentage
    });
  }

  /**
   * Track outbound links
   * @param {string} url - Destination URL
   * @param {string} linkText - Link text/label
   */
  trackOutboundLink(url, linkText) {
    this.trackEvent('click', {
      event_category: 'outbound',
      event_label: url,
      link_text: linkText,
      link_url: url
    });
  }

  /**
   * Initialize automatic tracking
   */
  initAutoTracking() {
    // Track platform links
    this.trackPlatformLinks();

    // Track social links
    this.trackSocialLinks();

    // Track audio events
    this.trackAudioPlayer();

    // Track scroll depth
    this.trackScrollEvents();

    // Track time on page
    this.startEngagementTracking();

    // Track page visibility
    this.trackPageVisibility();
  }

  /**
   * Track all platform links automatically
   */
  trackPlatformLinks() {
    document.querySelectorAll('.platform-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        const platformId = link.id.replace('-link', '');
        this.trackPlatformClick(platformId);
      });
    });
  }

  /**
   * Track all social media links automatically
   */
  trackSocialLinks() {
    document
      .querySelectorAll('.social-links a[aria-label], .social-icons a[aria-label]')
      .forEach((link) => {
        link.addEventListener('click', (e) => {
          const network = link.getAttribute('aria-label');
          this.trackSocialClick(network);
        });
      });
  }

  /**
   * Track audio player events
   */
  trackAudioPlayer() {
    const audio = document.querySelector('audio');
    if (!audio) return;

    const events = ['play', 'pause', 'ended', 'error'];
    events.forEach((eventName) => {
      audio.addEventListener(eventName, () => {
        this.trackAudioEvent(eventName);
      });
    });

    // Track when user seeks in the audio
    audio.addEventListener('seeked', () => {
      this.trackAudioEvent('seeked');
    });

    // Track volume change
    audio.addEventListener('volumechange', () => {
      if (audio.muted) {
        this.trackAudioEvent('muted');
      }
    });
  }

  /**
   * Track scroll depth milestones
   */
  trackScrollEvents() {
    const milestones = [25, 50, 75, 100];
    const triggered = new Set();

    const checkScroll = () => {
      const scrollPercent = Math.round(
        (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100
      );

      milestones.forEach((milestone) => {
        if (scrollPercent >= milestone && !triggered.has(milestone)) {
          triggered.add(milestone);
          this.trackScrollDepth(milestone);
        }
      });
    };

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          checkScroll();
          ticking = false;
        });
        ticking = true;
      }
    });
  }

  /**
   * Start tracking time spent on page
   */
  startEngagementTracking() {
    setInterval(() => {
      this.trackEngagement();
    }, 10000); // Check every 10 seconds
  }

  /**
   * Track page visibility changes (tab switching)
   */
  trackPageVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.trackEvent('page_hidden', {
          event_category: 'engagement',
          event_label: 'tab_switched'
        });
      } else {
        this.trackEvent('page_visible', {
          event_category: 'engagement',
          event_label: 'tab_returned'
        });
      }
    });
  }
}

// Create singleton instance
const analytics = new Analytics();

// Export for use in other modules
export default analytics;

// Also export as window global for inline scripts
if (typeof window !== 'undefined') {
  window.stillLouderAnalytics = analytics;
}
