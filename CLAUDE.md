# CLAUDE.md - AI Assistant Guide for Still Louder Website

## Project Overview

This is the official website for **Still Louder**, a Panamanian rock band, promoting their single "Al Vacío". The site is a static, performant landing page that links to various streaming platforms and provides information about the release.

**Live URL**: https://stillouder.space/
**Repository**: https://github.com/RenanDiaz/still-louder-site

---

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Vite | 7.x | Build tool with hot reload, minification, compression |
| ES6 Modules | - | JavaScript module system |
| CSS3 | - | Styling with CSS custom properties (variables) |
| ESLint | 8.x | Code linting |
| Prettier | 3.x | Code formatting |
| Terser | 5.x | JavaScript minification |
| Sharp | 0.33.x | Image optimization |
| Vercel | - | Hosting and deployment |
| Google Analytics 4 | - | Analytics tracking |

**Required Node.js version**: >=18.0.0

---

## Project Structure

```
still-louder-site/
├── public/                      # Source files (Vite root)
│   ├── assets/
│   │   ├── css/
│   │   │   ├── variables.css    # Design system tokens (colors, spacing, typography)
│   │   │   ├── style.css        # Main styles
│   │   │   └── al-vacio-pre-release/  # Pre-release page styles
│   │   ├── js/
│   │   │   ├── config.js        # Centralized configuration (URLs, settings)
│   │   │   ├── analytics.js     # GA4 tracking module
│   │   │   ├── share.js         # Web Share API module
│   │   │   ├── error-handler.js # Global error handling
│   │   │   ├── ui-utils.js      # UI utilities (loading states, lazy loading)
│   │   │   ├── sw-register.js   # Service Worker registration
│   │   │   └── al-vacio-pre-release/  # Pre-release page scripts
│   │   ├── images/              # Optimized images (WebP, AVIF formats)
│   │   ├── site.webmanifest     # PWA manifest
│   │   └── links.json           # Platform links data
│   ├── .well-known/
│   │   └── security.txt         # Security contact information
│   ├── index.html               # Main landing page
│   ├── al-vacio-pre-release.html # Pre-release page
│   ├── offline.html             # Offline fallback page
│   ├── sw.js                    # Service Worker
│   ├── sitemap.xml              # SEO sitemap
│   └── robots.txt               # Search engine directives
├── scripts/
│   └── optimize-images.js       # Image optimization script
├── dist/                        # Build output (generated, gitignored)
├── vite.config.js               # Vite configuration
├── vercel.json                  # Vercel deployment config (headers, caching)
├── .eslintrc.json               # ESLint rules
├── .prettierrc                  # Prettier configuration
└── package.json                 # Dependencies and scripts
```

---

## Development Workflow

### Quick Start

```bash
# Install dependencies
npm install

# Start development server (http://localhost:3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `npm run dev` | Start Vite dev server with hot reload |
| `build` | `npm run build` | Build production bundle to `dist/` |
| `preview` | `npm run preview` | Preview production build locally |
| `lint` | `npm run lint` | Run ESLint on JavaScript files |
| `lint:fix` | `npm run lint:fix` | Auto-fix ESLint issues |
| `format` | `npm run format` | Format code with Prettier |
| `format:check` | `npm run format:check` | Check code formatting |
| `validate` | `npm run validate` | Run lint + format check |
| `optimize:images` | `npm run optimize:images` | Optimize images with Sharp |

### Before Committing

Always run validation before committing:
```bash
npm run validate
```

---

## Code Conventions

### JavaScript

- **Module system**: ES6 modules (`import`/`export`)
- **Quotes**: Single quotes (`'string'`)
- **Semicolons**: Required
- **Indentation**: 2 spaces
- **Max line length**: 120 characters
- **Variables**: Use `const` by default, `let` when reassignment needed, never `var`
- **Functions**: Prefer arrow functions for callbacks
- **No console.log**: Use `console.warn` or `console.error` only (linting rule)
- **Strict equality**: Always use `===` and `!==`
- **Trailing commas**: None

Example:
```javascript
import { CONFIG } from './config.js';

const handleClick = (event) => {
  const platform = event.target.dataset.platform;
  if (platform === 'spotify') {
    analytics.trackEvent('click_platform', { platform_name: 'spotify' });
  }
};

export default handleClick;
```

### CSS

- **Use CSS variables** defined in `variables.css` for all values
- **BEM-like naming**: `.component-name`, `.component-name__element`, `.component-name--modifier`
- **Mobile-first**: Base styles for mobile, media queries for larger screens
- **Prefer CSS transitions** over JavaScript animations
- **Respect `prefers-reduced-motion`** for accessibility

Example:
```css
.platform-link {
  background: var(--color-link-bg);
  padding: var(--spacing-md);
  border-radius: var(--border-radius-md);
  transition: all var(--transition-normal);
}

.platform-link:hover {
  background: var(--color-accent);
  transform: translateY(-2px);
}

@media (prefers-reduced-motion: reduce) {
  .platform-link {
    transition: none;
  }
}
```

### HTML

- **Language**: `lang="es"` (Spanish content)
- **Semantic elements**: Use `<main>`, `<nav>`, `<section>`, `<footer>` appropriately
- **ARIA labels**: Add `aria-label` for interactive elements, especially links
- **External links**: Always include `target="_blank" rel="noopener noreferrer"`
- **SVG icons**: Include `aria-hidden="true" focusable="false"` on decorative SVGs

---

## Architecture Decisions

### Centralized Configuration (`config.js`)

All URLs, settings, and constants are centralized in `public/assets/js/config.js`. The config object is frozen to prevent accidental mutations.

```javascript
import { CONFIG } from './config.js';

// Access platform URLs
CONFIG.platforms.spotify.url

// Access UI settings
CONFIG.ui.animationDuration

// Access messages
CONFIG.messages.success.copiedToClipboard
```

### Design Tokens (`variables.css`)

All design values are CSS custom properties:
- Colors: `--color-*`
- Typography: `--font-*`
- Spacing: `--spacing-*`
- Borders: `--border-radius-*`
- Shadows: `--shadow-*`
- Transitions: `--transition-*`
- Z-index: `--z-*`

### Service Worker Strategies

The service worker (`sw.js`) uses different caching strategies:
- **Cache First**: Images, fonts (static assets)
- **Network First**: HTML pages (dynamic content)
- **Stale While Revalidate**: CSS, JavaScript (balance of speed and freshness)

### Security Headers

All security headers are configured in `vercel.json`:
- Content Security Policy (CSP)
- HSTS (2 years, preload ready)
- X-Frame-Options (DENY)
- X-Content-Type-Options (nosniff)
- Referrer-Policy (strict-origin-when-cross-origin)
- Permissions-Policy (restrictive)

---

## Key Files to Know

| File | Purpose | When to Modify |
|------|---------|----------------|
| `public/index.html` | Main landing page | Adding new sections, updating meta tags |
| `public/assets/js/config.js` | All URLs and settings | Changing links, messages, feature flags |
| `public/assets/css/variables.css` | Design tokens | Changing colors, spacing, typography |
| `public/assets/css/style.css` | Main styles | Styling changes |
| `vercel.json` | Security headers, caching | Security policy updates |
| `vite.config.js` | Build configuration | Build optimization changes |
| `public/assets/site.webmanifest` | PWA configuration | App name, icons, theme |

---

## Important Patterns

### Adding a New Platform Link

1. Add the platform config to `public/assets/js/config.js`:
```javascript
platforms: {
  newPlatform: {
    name: 'Platform Name',
    url: 'https://...',
    icon: 'platform-icon',
    color: '#hexcolor'
  }
}
```

2. Add the HTML in `public/index.html` following the existing pattern with proper ARIA labels.

3. Add brand color to `variables.css` if needed.

### Tracking Analytics Events

Use the analytics module:
```javascript
import analytics from './analytics.js';

// Track custom event
analytics.trackEvent('event_name', {
  event_category: 'category',
  event_label: 'label'
});
```

### Showing User Feedback

Use toast notifications via the UI utils:
```javascript
import uiUtils from './ui-utils.js';

// Show success message
uiUtils.showToast(CONFIG.messages.success.copiedToClipboard, 'success');
```

---

## Testing Checklist

Before deploying, verify:

- [ ] `npm run validate` passes (lint + format)
- [ ] Dev server works: `npm run dev`
- [ ] Production build works: `npm run build && npm run preview`
- [ ] All platform links work and open in new tabs
- [ ] Share button works (or falls back to clipboard)
- [ ] No console errors in browser DevTools
- [ ] Page loads correctly on mobile viewport
- [ ] Keyboard navigation works (Tab, Enter)
- [ ] `prefers-reduced-motion` is respected

### Security Testing

After deployment:
- Check security headers at https://securityheaders.com/
- Run Mozilla Observatory scan: https://observatory.mozilla.org/
- Verify HTTPS: https://www.ssllabs.com/ssltest/

---

## Deployment

The site is deployed on **Vercel** and auto-deploys from the `main` branch.

### Manual Deployment

```bash
# Build
npm run build

# Deploy (if Vercel CLI installed)
vercel --prod
```

### Environment

- No environment variables required for basic functionality
- Google Analytics ID is hardcoded in `index.html` and `config.js`

---

## Common Tasks

### Update streaming platform URLs

Edit `public/assets/js/config.js` → `platforms` object and update the corresponding links in `public/index.html`.

### Change theme colors

Edit `public/assets/css/variables.css` → modify `--color-*` variables.

### Add new content section

1. Add semantic HTML to `public/index.html`
2. Add styles to `public/assets/css/style.css`
3. Use existing CSS variables for consistency

### Optimize new images

1. Add images to `public/assets/images/`
2. Run `npm run optimize:images`
3. Use the optimized WebP/AVIF versions in HTML with proper `srcset`

---

## Do's and Don'ts

### Do

- Use CSS variables from `variables.css` for all style values
- Add `aria-label` to all interactive elements
- Include `rel="noopener noreferrer"` on external links
- Use the centralized config for URLs and settings
- Respect `prefers-reduced-motion` for animations
- Run `npm run validate` before committing
- Keep JavaScript modules small and focused

### Don't

- Don't hardcode URLs - use `config.js`
- Don't add inline styles - use CSS classes with variables
- Don't use `var` - use `const` or `let`
- Don't use `console.log` in production code
- Don't skip accessibility attributes (ARIA labels, alt text)
- Don't modify the frozen CONFIG object
- Don't add dependencies without considering bundle size
- Don't remove security headers from `vercel.json`

---

## Commit Convention

Follow conventional commits:

```
feat: add new feature
fix: bug fix
docs: documentation changes
style: formatting, no code change
refactor: code restructuring
perf: performance improvements
test: adding tests
chore: maintenance tasks
```

Examples:
```
feat: add TikTok platform link
fix: correct Apple Music URL encoding
style: format CSS with Prettier
perf: optimize cover image loading
```

---

## Related Documentation

- `README.md` - User-facing documentation
- `SECURITY_SUMMARY.md` - Detailed security implementation
- `PWA_IMPLEMENTATION.md` - Service Worker and PWA details
- `PHASE_5_6_IMPLEMENTATION.md` - UX improvements documentation

---

## Contact

- **Developer**: Renan Diaz
- **Band**: Still Louder
- **Social**: @stilllouder on Instagram, Facebook, YouTube
