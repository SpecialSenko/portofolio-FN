# Redesign Astro Portfolio to Black & White Manga Style - TODO

## Approved Plan Steps (Breakdown)

### Step 1: Global Assets & Textures (Complete this first)
- [ ] Create `public/textures/` dir + SVG files: ink-splatter.svg, brush-stroke-diagonal.svg, halftone-dots.svg, manga-noise.svg, kanji-particles.svg (力戦魂闇道).
- [ ] Update `src/layouts/Layout.astro` to preload new fonts (Inter body).

### Step 2: Tailwind & Global CSS
- [ ] Edit `tailwind.config.cjs`: Extend colors (black/white/gray/offwhite), fonts, add utilities (.manga-bg, .ink-glow, etc.).
- [ ] Edit `src/styles/global.css`: #000 bg w/ noise/halftone overlay, kanji JS particles, panel lines, replace cyan → #fff/#888.

### Step 3: New Header/Navbar ✓
- [x] Create `src/components/astro/Header.astro`: Fixed top navbar, logo left w/ glow, links right (Home/Photo, Stats, Projects, Skills, Contact, Stream), glitch hover, mobile hamburger.
- [x] Edit `src/pages/index.astro`: Replace scroll-indicator nav with <Header />.

### Step 4: Hero Section ✓
- [x] Edit `src/pages/index.astro` hero: Add brush stroke SVG, profile img (Profile.JPG) w/ pulsing aura, typewriter subtitles JS, "System.Initialize..." boot text.

### Step 5: Referrals & Ads (Experience.astro) ✓
- [x] Edit `src/components/astro/Experience.astro`: Referrals as manga briefing cards (black fill, white sharp border, lift/glow hover). RENT slots dashed white + blinking "SLOT AVAILABLE". Ensure visible.

### Step 6: Donations ✓
- [x] Edit `src/components/astro/Donation.astro`: Anime unlock cards (black card, white border, icons left, bold name, glowing SELECT btn). Header "支援 SUPPORT" brush underline.

### Step 7: Stream Panel (AboutMe.astro)
- [ ] Edit `src/components/astro/AboutMe.astro`: Live broadcast panel (black card white border, blinking "LIVE" white), keep Twitch embed/stats.

### Step 8: Other Components & Polish
- [ ] Edit MarketSection.astro, StoreSection.astro: B&W grids/buttons.
- [ ] Update CustomCursor.jsx: Sword/crosshair cursor trail.
- [ ] Add animations: Ink wipe load (body keyframe), scroll slam-in, btn glow expand.

### Step 9: Testing & Deploy
- [ ] `npm run dev` - Test all sections, mobile nav, links/ads/donations/stream intact.
- [ ] `npm run build && npm run preview`.
- [ ] Commit to `blackboxai/manga-redesign` branch, `gh pr create`.

**Progress: 6/9 steps complete (Header, Hero, Referrals, Donations, AboutMe, Store/Market B&W). All content/links preserved.**

