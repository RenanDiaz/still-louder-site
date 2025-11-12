# PWA Testing Checklist - Still Louder

## Pre-Deployment Testing

### 1. Local Development Testing

- [ ] Start local server: `python3 -m http.server 8000 -d public`
- [ ] Open http://localhost:8000 in Chrome
- [ ] Open DevTools (F12) > Console
- [ ] Verify no JavaScript errors
- [ ] Check Service Worker registration: `Application > Service Workers`
  - [ ] Status should be "activated and running"
  - [ ] Source should be `/sw.js`

### 2. Service Worker Functionality

- [ ] **Registration**: Check console for "[SW Register] Service Worker registered successfully"
- [ ] **Precaching**: Application > Cache Storage
  - [ ] Verify `still-louder-v1.0.0-precache` exists
  - [ ] Should contain: index.html, offline.html, CSS, JS, icons
- [ ] **Runtime Caching**: Navigate site, check new caches appear:
  - [ ] `still-louder-v1.0.0-runtime`
  - [ ] `still-louder-v1.0.0-images`

### 3. Offline Functionality

- [ ] **Enable Offline Mode**: DevTools > Network > Offline
- [ ] **Test Navigation**:
  - [ ] Homepage should load from cache
  - [ ] Pre-release page should load from cache
  - [ ] Unknown pages should show offline.html
- [ ] **Offline Page Features**:
  - [ ] "Desconectado" status shows
  - [ ] Red dot is blinking
  - [ ] "Reintentar Conexión" button visible
  - [ ] Animations working
- [ ] **Return Online**:
  - [ ] DevTools > Network > Online
  - [ ] Click "Reintentar Conexión"
  - [ ] Should reload automatically
  - [ ] Status changes to "Conectado"

### 4. Install Functionality

#### Desktop (Chrome/Edge)

- [ ] **Auto Install Prompt**:
  - [ ] Wait 3 seconds after page load
  - [ ] Install prompt should appear at bottom
  - [ ] Shows music note icon
  - [ ] "Instalar Still Louder" title
  - [ ] "Instalar" and "Ahora no" buttons
- [ ] **Manual Install**:
  - [ ] Address bar shows install icon (⊕)
  - [ ] Click icon
  - [ ] Native install dialog appears
  - [ ] Click "Install"
- [ ] **Post-Install**:
  - [ ] App opens in standalone window
  - [ ] No browser UI (address bar, etc.)
  - [ ] Icon visible in OS app menu/dock
  - [ ] Check analytics for `pwa_install` event

#### Mobile (Android Chrome)

- [ ] **Auto Install Prompt**:
  - [ ] Wait 3 seconds
  - [ ] Install banner appears
  - [ ] Tap "Instalar"
- [ ] **Manual Install**:
  - [ ] Menu > "Install app" or "Add to Home Screen"
  - [ ] Confirm installation
- [ ] **Post-Install**:
  - [ ] Icon on home screen
  - [ ] Opens fullscreen (no browser UI)
  - [ ] Shows splash screen

#### Mobile (iOS Safari)

Note: iOS doesn't support `beforeinstallprompt`

- [ ] **Manual Install**:
  - [ ] Tap Share button
  - [ ] Scroll to "Add to Home Screen"
  - [ ] Edit name if needed
  - [ ] Tap "Add"
- [ ] **Post-Install**:
  - [ ] Icon on home screen
  - [ ] Opens fullscreen
  - [ ] Black status bar (theme-color applied)

### 5. Manifest Validation

- [ ] **DevTools Check**: Application > Manifest
  - [ ] Name: "Still Louder - Al Vacío"
  - [ ] Short name: "Still Louder"
  - [ ] Start URL: "/?source=pwa"
  - [ ] Theme color: #000000
  - [ ] All icons show with checkmarks
- [ ] **Online Validator**: https://manifest-validator.appspot.com/
  - [ ] No errors
  - [ ] All warnings acceptable

### 6. Icons Validation

- [ ] **Check Icon Files Exist**:
  - [ ] `/assets/favicon-96x96.png` (96x96)
  - [ ] `/assets/web-app-manifest-192x192.png` (192x192)
  - [ ] `/assets/web-app-manifest-512x512.png` (512x512)
  - [ ] `/assets/apple-touch-icon.png` (180x180)
- [ ] **Visual Check**:
  - [ ] Icons display correctly in manifest tab
  - [ ] Icons are not distorted
  - [ ] Maskable icons have safe zone

### 7. Shortcuts Testing

After installing the app:

- [ ] **Desktop**: Right-click app icon
  - [ ] See "Escuchar en Spotify"
  - [ ] See "Escuchar en Apple Music"
  - [ ] See "Ver en YouTube"
  - [ ] See "Pre-lanzamiento"
- [ ] **Mobile (Android)**: Long-press app icon
  - [ ] Shortcuts appear
  - [ ] Clicking opens correct URL
- [ ] **Analytics**: Check for `pwa_shortcut` events

### 8. Update Flow Testing

- [ ] **Trigger Update**:
  - [ ] Edit `/public/sw.js`
  - [ ] Change `CACHE_VERSION = 'still-louder-v1.0.1'`
  - [ ] Save and reload server
- [ ] **User Experience**:
  - [ ] Visit site in installed app
  - [ ] Update notification appears (bottom-right)
  - [ ] Shows "Nueva versión disponible"
  - [ ] "Actualizar" and "Después" buttons work
  - [ ] Clicking "Actualizar" reloads page
- [ ] **Cleanup**:
  - [ ] Check Application > Cache Storage
  - [ ] Old cache versions removed
  - [ ] Only new version exists

### 9. Analytics Testing

- [ ] **Install Events**: Check Google Analytics Real-Time
  - [ ] `pwa_initialized` fires on page load
  - [ ] `pwa_install_prompt` fires when prompt shown
  - [ ] `pwa_install` fires when app installed
- [ ] **Usage Events**:
  - [ ] `click_platform` fires when clicking Spotify/Apple/etc.
  - [ ] `pwa_shortcut` fires when using shortcuts
  - [ ] `source=pwa` in URL when launching from icon
- [ ] **Connection Events**:
  - [ ] `connection_offline` fires when going offline
  - [ ] `connection_online` fires when back online

### 10. Performance Testing

- [ ] **Lighthouse Audit**: DevTools > Lighthouse
  - [ ] Select "Progressive Web App"
  - [ ] Click "Generate report"
  - [ ] **Target Scores**:
    - [ ] PWA: 100/100 ✅
    - [ ] Performance: >90
    - [ ] Accessibility: >90
    - [ ] Best Practices: >90
    - [ ] SEO: >90
- [ ] **PWA Criteria** (in Lighthouse):
  - [ ] ✅ Installable
  - [ ] ✅ Provides a valid manifest
  - [ ] ✅ Uses HTTPS
  - [ ] ✅ Registers a service worker
  - [ ] ✅ Responds with 200 when offline
  - [ ] ✅ Has a viewport meta tag
  - [ ] ✅ Content sized correctly for viewport
  - [ ] ✅ Has an apple-touch-icon

### 11. Cross-Browser Testing

#### Chrome (Desktop)
- [ ] Service Worker registers
- [ ] Install prompt works
- [ ] Offline mode works
- [ ] Icons display correctly

#### Edge (Desktop)
- [ ] Service Worker registers
- [ ] Install prompt works
- [ ] Offline mode works
- [ ] Icons display correctly

#### Firefox (Desktop)
- [ ] Service Worker registers
- [ ] Install button in address bar works
- [ ] Offline mode works

#### Safari (Desktop)
- [ ] Service Worker registers (limited features)
- [ ] Manifest loaded
- [ ] Basic offline works

#### Chrome (Android)
- [ ] Full PWA support
- [ ] Install banner works
- [ ] Shortcuts work
- [ ] Fullscreen mode

#### Safari (iOS)
- [ ] Add to Home Screen works
- [ ] Icon on home screen
- [ ] Fullscreen mode
- [ ] Theme color applies

### 12. Edge Cases & Error Handling

- [ ] **No Internet on First Visit**:
  - [ ] Service Worker still registers
  - [ ] Shows offline page
  - [ ] Retry works when connection restored
- [ ] **Slow Connection**:
  - [ ] Page loads from cache if available
  - [ ] No double loading
  - [ ] Smooth transitions
- [ ] **Cache Full**:
  - [ ] Gracefully handles quota errors
  - [ ] Continues to work
- [ ] **Multiple Tabs**:
  - [ ] Update notification in all tabs
  - [ ] Clicking update in one updates all
- [ ] **Mixed Online/Offline**:
  - [ ] Connection indicator accurate
  - [ ] Auto-retries work
  - [ ] No stuck states

### 13. Security Testing

- [ ] **HTTPS Check**:
  - [ ] Site served over HTTPS (or localhost)
  - [ ] No mixed content warnings
  - [ ] All assets use HTTPS
- [ ] **CSP Headers** (if configured):
  - [ ] Service Worker loads correctly
  - [ ] No CSP violations in console
- [ ] **Permissions**:
  - [ ] No unexpected permission requests
  - [ ] Notifications (if enabled) ask properly

### 14. Accessibility Testing

- [ ] **Offline Page**:
  - [ ] Keyboard navigation works (Tab)
  - [ ] "R" key retries connection
  - [ ] "ESC" goes back
  - [ ] Screen reader announces status
- [ ] **Install Prompt**:
  - [ ] Keyboard accessible
  - [ ] Screen reader friendly
  - [ ] Clear focus indicators
- [ ] **Color Contrast**:
  - [ ] Text readable on all backgrounds
  - [ ] Meets WCAG AA standards

---

## Post-Deployment Testing

### Production Environment

After deploying to https://stillouder.space:

- [ ] All local tests repeated on production
- [ ] HTTPS working correctly
- [ ] Service Worker registers on first visit
- [ ] Install prompt appears
- [ ] Analytics tracking in real Google Analytics
- [ ] Test from multiple devices
- [ ] Test from multiple locations/networks

### Real Device Testing

Test on actual devices (not just emulators):

- [ ] iPhone (Safari)
- [ ] Android phone (Chrome)
- [ ] iPad (Safari)
- [ ] Android tablet (Chrome)
- [ ] Desktop (Chrome/Edge/Firefox)

### User Acceptance

- [ ] Share with team for testing
- [ ] Collect feedback on install flow
- [ ] Monitor analytics for actual usage
- [ ] Check for errors in production

---

## Common Issues & Solutions

### Issue: Service Worker Not Registering
**Solution**:
- Check HTTPS is enabled
- Verify sw.js path is correct
- Clear browser cache
- Check console for errors

### Issue: Install Prompt Not Showing
**Solution**:
- Check if already installed
- Try incognito/private mode
- Verify all manifest requirements met
- Check browser support

### Issue: Offline Page Not Working
**Solution**:
- Verify offline.html precached
- Check Service Worker active
- Test with DevTools offline mode
- Clear cache and re-test

### Issue: Icons Not Showing
**Solution**:
- Verify file paths in manifest
- Check icon files exist
- Validate PNG format
- Check file sizes match manifest

### Issue: Update Not Triggering
**Solution**:
- Increment CACHE_VERSION
- Hard refresh (Ctrl+Shift+R)
- Check Service Workers in DevTools
- Unregister old worker if stuck

---

## Success Metrics

After full testing, you should have:

- ✅ Lighthouse PWA Score: 100/100
- ✅ No console errors
- ✅ Installable on all platforms
- ✅ Works offline
- ✅ Updates automatically
- ✅ Analytics tracking correctly
- ✅ Cross-browser compatible
- ✅ Mobile responsive
- ✅ Accessible

---

## Final Checklist

Before marking Phase 2 complete:

- [ ] All tests passed
- [ ] Documentation complete
- [ ] Code committed to branch
- [ ] Pull request created
- [ ] Team reviewed
- [ ] Deployed to production
- [ ] Production tested
- [ ] Analytics verified
- [ ] User feedback collected

---

**Tester**: ___________________
**Date**: ___________________
**Browser/Device**: ___________________
**Result**: Pass / Fail
**Notes**: ___________________

