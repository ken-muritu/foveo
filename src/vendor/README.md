# WebGazer.js 2.0.1 (fetched, not included)

Run `scripts/fetch-webgazer.sh` from the repo root to download `webgazer.js` into this folder. The script checks its SHA-256 (`d05db7bb…1107736`) so you get exactly the build Foveo was tested with.

- **Source**: `https://raw.githubusercontent.com/brownhci/WebGazer/webgazer2.0.1/www/search/webgazer.js`
  (tag `webgazer2.0.1`, ~2018, 2.3 MB minified)
- **License**: GPLv3, with an exception for companies with a valuation under $1M (LGPLv3).
  See the header of `webgazer.js` and the repo's `gplv3.md` / `gnu-lgpl-v3.0.md`.

## Why 2.0.1 and not the current build

Foveo's PRD calls for fully local, on-device processing. The current WebGazer build
(3.5.x / webgazer.cs.brown.edu) ships with the `TFFaceMesh` tracker only, whose model
weights are hard-coded to `https://tfhub.dev/mediapipe/tfjs-model/...` URLs. **tfhub.dev
has been sunset (migrated to Kaggle) and those URLs now return 404** — verified
2026-08-28; see also upstream issue brownhci/WebGazer#314 ("Failed to fetch saved
models", open). The current build therefore cannot load its face tracker at all
without intervention.

The 2.0.1 build still bundles the **tracking.js** (Viola-Jones) face tracker entirely
in-file: zero runtime network requests, which is exactly what the PRD's privacy
requirement asks for. Trade-off: Viola-Jones landmarks are weaker than MediaPipe
FaceMesh in poor lighting. That is acceptable for the MVP and matches the PRD's plan —
§6.2 already specifies a swappable inference backend behind `getGazePoint()`, with a
MediaPipe-based backend as the v1.5 accuracy upgrade.

## API notes (verified against this bundle)

- `webgazer.begin()` — triggers the camera permission prompt; shows a harmless
  advisory `alert()` on non-https origins (suppressed by `gaze-engine.js`).
- `webgazer.setGazeListener(cb)` — `cb({x, y}, elapsedTime)` per processed frame.
- `webgazer.recordScreenPosition(x, y, eventType)` — eventType `'click'` | `'move'`.
- `webgazer.getCurrentPrediction()` — async current estimate.
- `webgazer.setRegression('ridge')` — default regression; `'weightedRidge'` also present.
- `webgazer.setTracker(...)` — registry in this build contains the tracking.js tracker.
- `webgazer.showPredictionPoints(bool)`, `webgazer.showGazeDot(bool)`.
- `webgazer.end()` — stops tracking and persists calibration data to localStorage
  (restored automatically on the next `begin()` on this origin).
- Not present in 2.0.1 (added in 3.x): `applyKalmanFilter`, `showVideo`, `showFaceOverlay`.
  The engine wraps these in feature checks so a later backend swap stays drop-in.

## CSP safety

The only `new Function` in the bundle is webpack's `globalThis` polyfill guard, which is
never reached in Chrome. No eval on any hot path — safe under Manifest V3 extension-page
CSP (`script-src 'self'`).
