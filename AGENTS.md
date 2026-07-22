# Repository instructions

## Runtime and commands

- This is a static browser app with no build step. Use Node 18+ and `npm ci` for test dependencies.
- Start the app with `npm run dev`; the expected URL is `http://localhost:8080`.
- Run all tests with `npm test`. Run one case with `npx playwright test tests/smoke.spec.ts -g "test name"`; Playwright starts and reuses its own server on port 8080.
- There is no lint or typecheck setup. For a focused syntax check, run `node --check js/<file>.js`.

## Architecture

- `index.html` is the application shell and declares classic scripts in dependency order. The files share top-level IIFE globals; do not reorder them or convert one file to an ES module without rewiring all dependencies.
- `js/app.js` is the UI entrypoint. Recording flows through `app.js -> recorder.js -> crop.js`; screenshot editing flows through `app.js -> capture.js -> crop.js/tools.js`.
- All recording modes intentionally pass through `Crop.createPipeline`, including full-screen recordings without a camera. Do not bypass the canvas compositor: it supplies live annotations, camera composition and periodic frames when the captured source is static.
- `tools.js` is shared by live annotations and screenshot editing. `stats.js` owns IndexedDB; `dashboard.js` only renders it.
- Capture mode deliberately reuses its display stream between captures. Recording mode owns and must stop display, camera, microphone, compositor and AudioContext resources on every exit path.
- The app has no backend. Preferences use localStorage, recording metadata uses IndexedDB, and normal recordings remain in memory until downloaded.

## Browser and test constraints

- Media capture requires HTTPS or localhost. Document Picture-in-Picture targets Chrome/Edge 116+ and cannot be considered verified by a generic headless browser run.
- Playwright runs Chromium only, replaces display/camera/microphone with synthetic streams, disables web security and blocks service workers. A green suite does not validate real permissions, hardware, PiP chrome, audio mixing, PWA caching or deployment headers.
- When changing recording composition, verify the downloaded media content or decoded frames; checking only the container signature is insufficient.
- Recording output is MP4-only. Use standard `avc1`/`mp4a` codec identifiers; never request H.264 inside `video/webm`, because Chromium emits Matroska that upload services may reject or misread.

## PWA and deployment

- Production is intended for a root-mounted subdomain such as `rec.tudominio.com`. Current manifest, service-worker registration and precache paths are root-absolute and do not support deployment under `/rec/`; the `/rec/` option in `deploy/nginx.conf.example` is stale.
- `sw.js` strips query strings before cache lookup and uses an explicit asset list. Update the cache strategy/version and asset list when changing shipped resources; query suffixes alone do not invalidate cached files.

## Sources of truth

- Trust executable code and tests over `PROGRESO.md` or `MEJORAS.md`; both contain historical claims that conflict with current behavior.
- `PLAN_DE_ACCION.md` records agreed product decisions and phased improvements. Do not treat unresolved items there as existing behavior.
