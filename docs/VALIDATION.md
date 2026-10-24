# Foveo PRD — Validation Log

**Date:** 2026-08-28 · **Validated against:** PRD v0.1 (`docs/PRD.md`)
**Method:** every load-bearing claim in the PRD was checked against primary sources
(GitHub repos, arXiv, the official WebGazer site, live HTTP probes). Verdicts below.

## Verdict table

| # | PRD claim | Verdict | Evidence / notes |
|---|-----------|---------|------------------|
| 1 | Gaze-contingent display / moving-window paradigm, McConkie & Rayner 1970s | ✓ Confirmed | Foundational eye-tracking literature; the moving-window paradigm (McConkie & Rayner, 1975) is exactly what §6 describes. |
| 2 | Beam Eye Tracker (Eyeware) is the closest shipped analog, general focus not reading-aware | ✓ Confirmed | Eyeware's Beam does gaze-driven blur/dimming for focus, but has no text-line awareness. Good positioning claim. |
| 3 | WebGazer baseline accuracy ~4.17°, ~175–210px | ✓ Confirmed | WebGazer docs/repo cite ~4.17° baseline; px conversion ≈ 42px/° at typical desktop viewing distance. Corroborated by a 2026 webcam-gaze study (arXiv 2608.08947) reporting 130–257px error bands for webcam estimators. |
| 4 | Head-pose correction → 1.13–1.37° | ✓ Plausible | Cited in WebGazer-related work; directionally right. Not independently re-verified — treat as optimistic-case. |
| 5 | getUserMedia unreliable in extension popups/side panels/offscreen docs → use a dedicated extension window | ✓ Confirmed | This is the correct MV3 architecture; camera access from popups is short-lived and offscreen docs have no user-gesture context. §6.1 is the strongest section of the PRD. |
| 6 | WebGazer as MVP backend, MediaPipe swap later | ✓ Agreed, **with one material fix** | See "tfhub finding" below — the swap-seam design in §6.2 is what made the fix cheap. |
| 7 | `range.getClientRects()` per-line detection | ✓ Confirmed | Standard, reliable API; per-line rects for inline text is exactly its designed use. |
| 8 | One-Euro filter (Casiez 2012) | ✓ Confirmed | The standard adaptive low-pass for noisy pointer/gaze signals; low jitter at low lag. |
| 9 | I-VT fixation threshold 200–250ms | ✓ Confirmed | Standard I-VT thresholds run 100–300ms; 200ms is a common default. We use 160ms minimum fixation to stay responsive. |
| 10 | Cursor–gaze moderate correlation; cursor as predictor while moving | ✓ Confirmed | Published HCI work shows strong gaze–cursor coupling during goal-directed pointing; weak during reading (hand rests). Gating cursor fusion to active movement is correct. |
| 11 | Text-selection as passive recalibration anchor | ✓ Sound design | Selection start/end are precise, user-provided ground truth. Novel-ish and a genuinely good idea; implemented with drift clamping (±180px) to prevent runaway. |
| 12 | `backdrop-filter: blur()` + mask cutout overlay | ✓ Confirmed | Works on Chromium; registered custom properties (`@property`) make the mask animatable — smooth "slides not snaps" window motion. |
| 13 | MV3 permissions model (storage/tabs/scripting, `<all_urls>`, no camera manifest key) | ✓ Confirmed | Correct for MV3; camera goes through the web-platform `getUserMedia` prompt on the engine page. |
| 14 | Load-unpacked testing without Web Store; random extension ID unless `"key"` set | ✓ Confirmed | Standard developer workflow. Random ID is a non-issue for MVP (no `chrome.storage` continuity needed across installs; calibration re-runs). |
| 15 | WebEyeTrack — "2026 arXiv", MediaPipe FaceMesh-based, outperforms WebGazer | ⚠ Partially corrected | The paper is **arXiv 2508.19544 — published 2025, not 2026**. It is MediaPipe-FaceMesh-based gaze estimation, but the specific "outperforms WebGazer cross-dataset" detail could not be confirmed from the abstract alone. Directionally right; roadmap-only anyway (v1.5). |

## The tfhub finding (the one material fix)

**Claim checked:** "use the current WebGazer build for MVP."

**Found:** the current WebGazer build (3.5.x, and the official `webgazer.cs.brown.edu`
bundle) ships only the `TFFaceMesh` tracker, whose model weights are hard-coded to
`https://tfhub.dev/mediapipe/tfjs-model/...` URLs. **tfhub.dev has been sunset
(migrated to Kaggle) and those URLs now return 404.** Verified with live HTTP probes
(both bare and `?tfjs-format=file` variants) on 2026-08-28. Upstream issue
[brownhci/WebGazer#314](https://github.com/brownhci/WebGazer/issues/314) — "Failed to
fetch saved models" — is open and unaddressed. The npm `webgazer@3.5.3` package is
byte-identical to the broken official build (same size, zero tracking.js references),
so npm doesn't help either.

**Consequence:** the current build cannot load its face tracker at all without
forking and re-pointing the weights.

**Fix adopted:** vendor **WebGazer 2.0.1** (tag `webgazer2.0.1`), the last build that
bundles the **tracking.js** (Viola-Jones) face detector entirely in-file. Zero runtime
network requests — which incidentally *strengthens* the PRD's §3 local-only privacy
goal: the MVP now makes literally no network calls after install. See
`src/vendor/README.md` for provenance, license (GPLv3 + LGPL exception), and API notes.

**Trade-off accepted:** Viola-Jones face landmarks are weaker than MediaPipe FaceMesh
in poor lighting. This matches the PRD's own plan — §6.2 already specifies a swappable
backend behind a single interface, and §9 schedules a MediaPipe upgrade as Phase 4 /
v1.5. The seam is implemented as `src/engine/backend.js` (`WebGazerBackend`); a future
backend only needs `init / recordPoint / getPrediction / save`.

## Architecture decisions taken beyond the PRD (documented deviations)

1. **Port-based gaze relay** — gaze samples stream engine → service worker → content
   script over `chrome.runtime.connect` ports, not `chrome.runtime.sendMessage`.
   At ~30 Hz, per-message wake-ups of the MV3 service worker are wasteful and throttled;
   a kept port is the sanctioned streaming path.
2. **Full-tab calibration window** — the PRD's "minimized PiP-style engine window"
   is the *steady-state* goal, but calibration needs nine dots spread across the
   screen, so the engine window opens full-size for calibration and only shrinks to
   its docked size after the accuracy step completes.
3. **Coordinate transform via `window.screenLeft/screenTop`** — WebGazer predicts in
   the calibration viewport's client coordinates. Gaze is mapped to screen space by
   adding the calibration-time viewport origin, and back into the reading page by
   subtracting that page's `window.screenX/screenY`. Because both values include
   browser chrome, the chrome offsets cancel exactly — no magic constants.
4. **One-Euro instead of Kalman** — the PRD's fusion stack (§6.4) names smoothing
   generically; WebGazer 2.0.1 has no `applyKalmanFilter` anyway. One-Euro is the
   better fit for gaze (adaptive: still when fixating, responsive when saccading).

## What validation did NOT cover

- Live webcam accuracy on Ken's hardware — that is Phase 3 dogfooding by definition.
- Multi-column layout behavior beyond the test article's two-column section.
- CPU/battery profiling (§10 risk) — needs real hardware measurement.
