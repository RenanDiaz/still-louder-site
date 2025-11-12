# Quick Start Guide - PWA Testing

## Immediate Testing (2 minutes)

### 1. Start Local Server

```bash
cd /Users/renandiazreyes/DevProjects/still-louder-site
python3 -m http.server 8000 -d public
```

### 2. Open Browser

Navigate to: `http://localhost:8000`

### 3. Open DevTools

Press `F12` or `Cmd+Opt+I` (Mac)

### 4. Check Service Worker

1. Go to **Application** tab
2. Click **Service Workers** in left sidebar
3. Verify status: "activated and running"

### 5. Test Install

- **Desktop**: Look for install icon in address bar (⊕)
- **Or**: Wait 3 seconds for custom install prompt
- Click "Install" or "Instalar"

### 6. Test Offline

1. In DevTools: **Network** tab
2. Check **Offline** box
3. Reload page
4. Should show beautiful offline page

### 7. Verify Caching

1. In DevTools: **Application** > **Cache Storage**
2. Should see 3 caches:
   - `still-louder-v1.0.0-precache`
   - `still-louder-v1.0.0-runtime`
   - `still-louder-v1.0.0-images`

## Run Lighthouse Audit (5 minutes)

1. Open DevTools (F12)
2. Go to **Lighthouse** tab
3. Check **Progressive Web App**
4. Click **Generate report**
5. Target: **100/100** PWA score

## Key Files to Review

```
public/
├── sw.js                      # Service Worker (main PWA logic)
├── offline.html               # Offline fallback page
├── index.html                 # Homepage with SW registration
├── al-vacio-pre-release.html # Pre-release page with SW
└── assets/
    ├── site.webmanifest       # Enhanced manifest
    └── js/
        └── sw-register.js     # Registration & install prompt
```

## Testing Checklist

Quick verification:

- [ ] Service Worker registers (check console)
- [ ] Install prompt appears after 3s
- [ ] Can install app (desktop/mobile)
- [ ] Offline page works
- [ ] Analytics events fire
- [ ] No console errors
- [ ] Manifest loads correctly
- [ ] Icons display

## Troubleshooting

### Service Worker not registering?
- Check you're on `localhost` or HTTPS
- Clear cache: DevTools > Application > Clear Storage
- Hard refresh: `Cmd+Shift+R` or `Ctrl+Shift+R`

### Install prompt not showing?
- Wait 3 seconds after page load
- Check if already installed
- Try incognito/private mode
- Check console for errors

### Offline not working?
- Verify Service Worker is active
- Check cache storage exists
- Test with DevTools offline mode
- Check `offline.html` exists

## Documentation

For detailed information, see:

- **PWA_IMPLEMENTATION.md** - Complete technical guide
- **TESTING_CHECKLIST.md** - Full testing procedures
- **PHASE2_SUMMARY.md** - Overview and features

## Analytics to Monitor

Open Google Analytics Real-Time to see:

- `pwa_initialized` - Page loads
- `pwa_install_prompt` - Install prompts shown
- `pwa_install` - Actual installations
- `click_platform` - Platform link clicks

## Next Steps

After local testing passes:

1. Get team approval
2. Deploy to production
3. Test on real devices
4. Monitor analytics
5. Collect user feedback

## Support

Questions? Check:
1. Console for errors
2. DevTools > Application > Manifest
3. DevTools > Application > Service Workers
4. Documentation files in repo

---

**Quick Start Complete!** You're ready to test the PWA implementation.

For comprehensive testing, follow: **TESTING_CHECKLIST.md**
