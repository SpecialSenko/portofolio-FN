<!--
  Project-specific Copilot instructions for the `portofolio-FN` Astro site.
  Keep this short, actionable, and tied to real files and workflows.
-->
# Copilot / AI agent instructions — portofolio-FN

Summary
- This repository is an Astro site with a small React island usage pattern.
- Key decisions: hybrid Astro + React components, centralized skill data, and a custom full-page scroll in `index.astro`.

Quick start (developer commands)
- Use the project scripts in `package.json`: `npm run dev`, `npm run build`, `npm run preview` (or `bun dev` / `bun build` if Bun is available). See [package.json](package.json).

Architecture & important files
- Entry/layout: `src/layouts/Layout.astro` — global markup & CSS import.
- Pages: `src/pages/index.astro` — hero/sections; contains client-side fullpage scroll logic (be conservative when editing). See the scroll script at the bottom of the file.
- Components:
  - Astro components: `src/components/astro/*` (e.g., `AboutMe.astro`, `BackgroundParticles.astro`) — server-rendered by default.
  - React islands: `src/components/react/*` (e.g., `CustomCursor.jsx`, `FilmStrip.jsx`) — mounted client-side using Astro client directives (e.g., `client:only="react"`).
- Central data: `src/data/skillsData.js` — the single source of truth for skill entries; modify here if you want to change skill labels/progress.
- Helpers: `src/function/` — small utilities like `isMobileDevice.js` and `optimizedImage.js`.

Patterns & conventions
- React islands: When a component lives in `src/components/react/` it should be treated as a client-only/interactive island. Import with a client directive in an Astro page, e.g. `<FilmStrip client:only="react" />` (see [src/pages/index.astro](src/pages/index.astro)).
- One-source data: Update visual listings or skill progress only in `src/data/skillsData.js`. Other components derive from that file; avoid duplicating skill entries elsewhere.
- Styling: Global styles are imported in `src/layouts/Layout.astro` and local CSS sits under `src/styles/`. Tailwind is declared in `package.json` deps but the project currently uses local CSS files — check `src/styles/global.css` first.
- Client-side scripts: `src/pages/index.astro` contains inline page-control JS (scrolling). Keep its semantics unless you intentionally refactor page navigation.

Build & deploy notes
- The project includes `@astrojs/vercel` in dependencies — the preferred deploy target is Vercel. Use standard Astro build: `npm run build` then `npm run preview` to verify.
- README mentions Bun; package scripts use `astro`. Both are valid — prefer `npm run dev` unless the environment explicitly uses Bun.

Editing guidance (do this, not that)
- Do: Add or update UI in `src/components/astro` for static/server-rendered pieces.
- Do: Add interactivity as React components in `src/components/react` and mount them with Astro client directives.
- Don't: Move or duplicate `skillsData` entries into components — update `src/data/skillsData.js` only.
- Don't: Remove or change the inline fullpage-scroll script in `src/pages/index.astro` without testing navigation behavior.

Examples (concrete edits)
- To add a new skill: update `src/data/skillsData.js` with the new key and meta; `baseSkills` is derived automatically.
- To convert an Astro-only component to interactive React: create `src/components/react/MyWidget.jsx`, then replace usage in pages with `<MyWidget client:only="react" />`.

Common pitfalls
- Mixing server/client rendering: ensure React-only components are not relied on for important SEO content — server-rendered Astro components should hold primary content.
- Build discrepancies: README suggests using Bun; CI or developer machines using Node/npm may need `npm install` before running scripts.

Where to look next (for humans or deeper automation)
- `src/pages/index.astro` — navigation and hero/section composition.
- `src/data/skillsData.js` — canonical content source for skills.
- `package.json` — scripts and adapters (Vercel).

If anything here is unclear or you'd like more specific examples (tests, component conversion, or deployment steps), tell me which area to expand.
