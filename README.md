# Still Louder - Al Vacío

Official website for Still Louder's single "Al Vacío". A modern, performant, and accessible web experience built with progressive enhancement principles.

## Features

### Current Release (Phase 1, 5 & 6 Complete)

- **Optimized Performance**
  - Vite build system with code splitting
  - Image optimization (WebP, AVIF formats)
  - Lazy loading for images
  - Gzip and Brotli compression
  - Minified CSS and JavaScript

- **Enhanced User Experience**
  - Loading states with skeleton loaders
  - Smooth animations with stagger effects
  - Ripple effects on button clicks
  - Web Share API for native sharing
  - Toast notifications for feedback
  - Respects `prefers-reduced-motion` for accessibility

- **Comprehensive Analytics**
  - Platform click tracking (Spotify, Apple Music, YouTube, Deezer, Amazon)
  - Social media engagement tracking
  - Audio player event tracking
  - Scroll depth monitoring
  - Time on page tracking
  - Error tracking

- **Robust Architecture**
  - Modular ES6 modules
  - Centralized configuration
  - Global error handling
  - CSS variables design system
  - Code quality enforcement (ESLint, Prettier)

- **Accessibility**
  - WCAG 2.1 Level AA compliant
  - Keyboard navigation support
  - Screen reader optimized
  - ARIA labels throughout
  - Reduced motion support

## Technology Stack

- **Build Tool:** Vite 5.x
- **JavaScript:** ES6+ Modules
- **Styling:** CSS3 with Variables
- **Analytics:** Google Analytics 4
- **Code Quality:** ESLint, Prettier
- **Compression:** Gzip, Brotli

## Project Structure

```
still-louder-site/
├── public/
│   ├── assets/
│   │   ├── css/
│   │   │   ├── variables.css          # Design system tokens
│   │   │   ├── style.css              # Main styles
│   │   │   └── al-vacio-pre-release/  # Pre-release page styles
│   │   ├── js/
│   │   │   ├── config.js              # Centralized configuration
│   │   │   ├── analytics.js           # Analytics tracking
│   │   │   ├── share.js               # Web Share API
│   │   │   ├── error-handler.js       # Error management
│   │   │   ├── ui-utils.js            # UI utilities
│   │   │   └── al-vacio-pre-release/  # Pre-release page scripts
│   │   └── images/                    # Optimized images
│   ├── index.html                     # Main landing page
│   └── al-vacio-pre-release.html      # Pre-release page
├── scripts/
│   └── optimize-images.js             # Image optimization script
├── .eslintrc.json                     # ESLint configuration
├── .prettierrc                        # Prettier configuration
├── vite.config.js                     # Vite configuration
├── package.json                       # Dependencies and scripts
├── PLAN_DE_MEJORAS.md                 # Improvement plan
├── PHASE_5_6_IMPLEMENTATION.md        # Implementation details
└── SUMMARY.md                         # Quick summary
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Modern web browser

### Installation

```bash
# Clone the repository
git clone https://github.com/RenanDiaz/still-louder-site.git
cd still-louder-site

# Install dependencies
npm install
```

### Development

```bash
# Start development server with hot reload
npm run dev

# The site will be available at http://localhost:5173
```

### Building for Production

```bash
# Build optimized production bundle
npm run build

# Preview production build locally
npm run preview
```

### Code Quality

```bash
# Lint JavaScript
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Format code with Prettier
npm run format

# Check formatting
npm run format:check

# Run all validations
npm run validate
```

## Configuration

### Updating Configuration

Edit `/public/assets/js/config.js` to customize:

```javascript
export const CONFIG = {
  platforms: { /* Streaming platform URLs */ },
  social: { /* Social media links */ },
  analytics: { /* Google Analytics settings */ },
  release: { /* Release information */ },
  site: { /* Site metadata */ },
  messages: { /* User-facing messages */ },
  features: { /* Feature flags */ },
  ui: { /* UI timings and settings */ }
};
```

### Customizing Design System

Edit `/public/assets/css/variables.css` to change:
- Colors (primary, secondary, accent)
- Typography (fonts, sizes, weights)
- Spacing scale
- Shadows and borders
- Transition timings
- Animation durations

## Modules

### Analytics Module (`analytics.js`)

```javascript
import analytics from './assets/js/analytics.js';

// Track custom event
analytics.trackEvent('custom_event', { /* params */ });

// Automatic tracking initialized on page load
analytics.initAutoTracking();
```

### Share Module (`share.js`)

```javascript
import shareManager from './assets/js/share.js';

// Share with Web Share API or clipboard fallback
await shareManager.share({
  title: 'Title',
  text: 'Description',
  url: 'https://example.com'
});
```

### Error Handler (`error-handler.js`)

```javascript
import errorHandler from './assets/js/error-handler.js';

// Initialize global handlers
errorHandler.init();

// Handle specific error
errorHandler.handleError({
  type: 'custom',
  message: 'Error message'
});
```

### UI Utils (`ui-utils.js`)

```javascript
import uiUtils from './assets/js/ui-utils.js';

// Add loading state
uiUtils.addLoadingState(element);

// Remove loading state
uiUtils.removeLoadingState(element);

// Initialize lazy loading
uiUtils.initLazyLoading();
```

## Analytics Events Tracked

- `click_platform` - Streaming platform clicks
- `social_click` - Social media clicks
- `audio_play/pause/ended` - Audio player events
- `scroll_depth` - Scroll milestones (25%, 50%, 75%, 100%)
- `engagement_time` - Time on page milestones
- `share` - Share button usage
- `comment_submit` - Comment submissions
- `error` - Error occurrences

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Safari iOS (latest)
- Chrome Android (latest)

## Performance Metrics

- Lighthouse Performance: 95+
- First Contentful Paint: < 1.5s
- Largest Contentful Paint: < 2.5s
- Time to Interactive: < 3s
- Total Bundle Size: ~500KB (gzipped)

## Accessibility

- WCAG 2.1 Level AA compliant
- Keyboard navigation fully supported
- Screen reader optimized
- High contrast mode support
- Reduced motion preferences respected
- ARIA labels and roles throughout

## Deployment

The site is optimized for deployment on:
- Vercel (recommended)
- Netlify
- GitHub Pages
- Any static hosting service

### Vercel Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Commit Convention

We use conventional commits:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc)
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

## Documentation

- **PLAN_DE_MEJORAS.md** - Complete 6-phase improvement plan
- **PHASE_5_6_IMPLEMENTATION.md** - Detailed Phase 5 & 6 documentation
- **SUMMARY.md** - Quick implementation summary

## Roadmap

### Phase 1: Performance Optimization ✅
- Image optimization
- Build system setup
- Code minification
- Caching strategies

### Phase 2: PWA Implementation (Planned)
- Service Worker
- Offline support
- App manifest
- Installability

### Phase 3: SEO & Accessibility (Planned)
- Structured data
- Sitemap
- Enhanced accessibility
- Meta tags optimization

### Phase 4: Security (Planned)
- Content Security Policy
- Security headers
- Safe external links

### Phase 5: Refactoring ✅
- CSS variables
- Code consolidation
- Linting setup
- Documentation

### Phase 6: UX/UI Improvements ✅
- Loading states
- Animations
- Error handling
- Web Share API
- Enhanced analytics

## License

All rights reserved - Still Louder © 2025

## Credits

- **Music & Art:** Still Louder
- **Development:** Still Louder Team
- **Implementation Support:** Claude Code

## Contact

- Instagram: [@stilllouder](https://www.instagram.com/stilllouder/)
- Facebook: [stilllouder](https://www.facebook.com/stilllouder/)
- YouTube: [@StillLouder](https://www.youtube.com/@StillLouder)

---

**Made with passion for independent music** 🎸

For support or questions, please open an issue on GitHub.
