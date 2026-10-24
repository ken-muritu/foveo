# Foveo — Product Requirements Document (MVP)
**Gaze-contingent reading assistant, Chrome extension**
Version 0.1 · Draft for internal build · Author: Kennedy Muritu

---

## 1. One-line description

Foveo is a Chrome extension that watches where you're looking on a webpage through your webcam, keeps the sentence/line you're reading sharp, and softly blurs everything else — so your eyes are guided down the page instead of losing their place.

## 2. Problem & why this is real

This isn't a new idea dressed up — it's a documented technique with a name: a **gaze-contingent display** (moving-window paradigm), used in reading research since the 1970s (McConkie & Rayner) to study peripheral vision during reading. What's new is doing it live, for real reading, on a consumer webcam, as a browser tool.

Closest existing products, and why none of them are Foveo:
- **Beam Eye Tracker** (Eyeware) — a desktop app that already blurs/dims everything you're not looking at, toggled by hotkey, fully local processing. It's a general "focus" tool, not reading-aware — no line detection, no text-structure logic, not a browser extension.
- **WebGazer.js** demos, **RealEye**, **GazeRecorder**, **iMotions WebET** — these are eye-tracking *research/analytics* tools (heatmaps, attention studies), not reading aids. No product wraps this specifically around the reading experience.
- Academic prototypes (e.g., webcam-reading gaze visualization studies) exist as lab demos, not shipped tools.

**Conclusion:** the mechanic is validated science, the closest commercial analog (Beam) proves people will install webcam-based focus software, but no one has built the reading-specific version as a browser extension. That's the gap.

## 3. Goals for the MVP

1. Prove the core loop works and feels good on real webpages: gaze estimate → smoothing → current-line detection → sharp/blur overlay.
2. Keep everything **local/on-device** — no video or gaze data leaves the machine. This is both a privacy requirement and a trust/marketing requirement (Beam's whole pitch rests on this).
3. Make it testable by Ken (and a small number of others) **without publishing to the Chrome Web Store**.
4. Be honest about accuracy limits (see §7) rather than over-promising word-level precision the hardware can't deliver.

### Non-goals for MVP
- No word-level highlighting (webcam accuracy doesn't reliably support it — see §7).
- No support for native apps, PDFs opened outside the browser, or non-Chromium browsers.
- No mobile version.
- No cloud sync, accounts, or analytics dashboard.
- No auto-scroll / pacing feature yet (candidate for v2).

## 4. Target user (v1)

Solo readers doing long-form reading in the browser — articles, docs, long PDFs rendered in-tab, Kindle Cloud Reader — who want a gentle visual aid to stay anchored to their place, similar in spirit to a finger tracing a line of text, but hands-free.

## 5. Core user flow

1. User installs the unpacked extension (see §10).
2. First run: extension opens a small calibration window. User looks at and clicks 9 dots across the screen (standard calibration pattern used by WebGazer and most browser gaze tools).
3. Calibration reports an accuracy score. If poor, user is prompted to improve lighting/distance and recalibrate.
4. User browses to any article/page and toggles Foveo on (toolbar icon or hotkey).
5. A "reading window" (a soft-edged clear zone around the current line) follows the user's gaze down the page; everything outside it is blurred at an adjustable strength.
6. User can pause/resume, adjust blur strength and window height from the toolbar popup, and recalibrate at any time.

## 6. Technical architecture

This is the part that needed the real research, because Manifest V3 imposes specific constraints that change the design from what a naive "content script with a webcam" plan would assume.

### 6.1 The camera-access constraint (critical finding)

Chrome **restricts `getUserMedia()` in extension side panels and popups** — camera capture in those contexts is unreliable across Chrome versions. The documented, reliable pattern is to open camera capture in **a dedicated extension tab** via `chrome.tabs.create()`, not in a popup, side panel, or directly injected into arbitrary host-page content scripts (host pages can also restrict camera access via their own `Permissions-Policy` headers, which a content script cannot override).

**Architecture decision:** Foveo runs its camera + gaze-inference pipeline inside a **persistent extension-owned tab or popup window** (`chrome-extension://.../gaze-engine.html`), not inside the content script of the page being read. This engine window:
- Requests camera permission once (extension-origin permission, stable across all sites — the user is never re-prompted per-website).
- Runs the gaze model continuously.
- Sends smoothed gaze coordinates (mapped to screen-space) to the active tab's content script via `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`, at ~30-60Hz.

The content script injected into the page the user is reading is only responsible for:
- Detecting text line/paragraph geometry (via the DOM `Range` API — see §6.3).
- Rendering the sharp/blur overlay in that page's DOM based on the coordinates it receives.

This split is necessary — it is not the simplest possible architecture, but the alternative (getUserMedia directly in a content script) is documented as unreliable and blocked in many contexts.

A minimized, always-on-top **picture-in-picture engine window** is the intended UX so the camera view stays open across tab switches without a full extra browser tab cluttering the window list. (Chrome extensions can keep a small popup-style window open via `chrome.windows.create` with `type: "popup"`.)

### 6.2 Gaze inference engine — two viable options, one recommendation

**Option A — WebGazer.js.** Mature (10 years), open source, pure JavaScript, self-calibrates from clicks/cursor movement during normal use, runs fully client-side. Documented accuracy: baseline mean error of **4.17° visual angle** (roughly 175-210px on a typical setup) in real-world conditions — enough to know which *paragraph* someone's reading, not which *line*. With head-pose correction added, published results bring error down to **1.13-1.37°**, and a higher-resolution webcam alone can bring it to ~1.4°. WebGazer's own accuracy **degrades significantly with head movement**, which matters for a reading tool since people shift posture.

**Option B — MediaPipe FaceMesh/Iris + a lightweight learned regression.** A 2026 research system (WebEyeTrack, using a compact "BlazeGaze" model on top of MediaPipe FaceMesh landmarks) is benchmarked as **outperforming WebGazer in cross-dataset, real-world conditions**, while running efficiently on ordinary hardware (benchmarked on a standard i7 laptop CPU, no GPU required). MediaPipe Iris also independently estimates user-to-screen distance from iris size with <10% relative error, which is a free input for head-movement compensation that WebGazer doesn't have.

**Recommendation: build the MVP on WebGazer.js first** (fastest to a working prototype, huge amount of existing calibration/UI code to borrow from its own demo pages), but **architect the gaze-engine window so the inference backend is swappable** — isolate it behind a single `getGazePoint()` interface. Move to MediaPipe FaceMesh + a custom regression (or adopt WebEyeTrack's approach directly, it's open research code) as the v1.5 accuracy upgrade once the rest of the pipeline (calibration UX, overlay rendering, fusion) is proven out. Don't block MVP shipping on training a custom model.

### 6.3 Detecting "which line is this" in the DOM

Once we have a (possibly noisy) screen-space gaze point, we need to map it to an actual line of text on the page, not just raw pixel coordinates:
- Walk the page's visible text nodes and use the `Range` API (`range.getClientRects()`) to get precise per-line bounding boxes — this correctly handles wrapped lines, mixed inline elements, and varying font sizes, which naive CSS-selector-based line detection does not.
- Build a sorted list of line bounding boxes for the currently-visible viewport, refreshed on scroll/resize.
- Match the smoothed gaze point to the nearest line box (with hysteresis, so the highlight doesn't flicker between two adjacent lines when gaze is right on the boundary).

### 6.4 Smoothing and sensor fusion pipeline

Raw gaze coordinates are too jittery to drive a UI directly. The recommended signal-processing stack, in order:

1. **One-Euro filter** on the raw gaze stream — a standard low-jitter, low-lag smoothing filter well suited to real-time pointer/gaze data (adapts smoothing strength to movement speed, so it damps small tremor but doesn't lag behind fast eye jumps).
2. **I-VT (velocity-threshold) fixation classification** — classify each smoothed sample as part of a *fixation* (true reading pause, ~200-250ms) vs. a *saccade* (fast transit between fixations). Only update the visible highlight during fixations; ignore saccade-transit samples. This alone removes most of the "shaky" feeling.
3. **Text-layout prior** — reading follows a predictable left-to-right, top-to-bottom pattern with an expected ~10-15% rate of regressions (eyes jumping back). Use this as a Bayesian/state-space prior that nudges the raw estimate toward plausible next-line positions rather than trusting the raw signal outright.
4. **Cursor fusion (secondary signal, not primary)** — research shows a *moderate*, not strong, correlation between mouse cursor and gaze position, and it's only useful while the cursor is actively moving (idle cursor tells you nothing). Weight cursor position into the fusion only when recent mouse movement exists, and note that gaze-cursor alignment is measurably tighter when comparing gaze to a *slightly future* cursor position — i.e., people move the mouse toward where they're about to look, so cursor can act as a short-horizon predictor, not just confirmation.
5. **Free recalibration anchors** — any text selection (click-drag) by the user is a strong ground-truth signal of exact reading position (used in prior research to predict reading focus paragraph with ~79% accuracy from interaction signals alone). Use every text-selection event as a passive recalibration point to correct drift over a session, without asking the user to redo the 9-dot calibration.
6. **Scroll position/velocity** — free, zero-noise signal that constrains which viewport region is even plausible, and combined with a words-per-minute estimate for the user gives a rough independent check on the vision-based estimate.

### 6.5 Overlay rendering

- CSS `backdrop-filter: blur()` applied via an injected full-viewport overlay element with a clip-path/mask cut out around the current line's bounding box (expanded by a configurable margin — "reading window height").
- Transition the clip-path with a short easing animation (~150-250ms) each time the current line changes, so the window "slides" rather than snaps — this is the mechanic that gives the "goes slowly with me as I read" feel the idea started from.
- Blur strength and window height are user-adjustable via the toolbar popup (stored via `chrome.storage.local`, not synced — no account system in MVP).

### 6.6 Manifest / permissions (Manifest V3)

- `manifest_version: 3`
- `permissions`: `storage`, `tabs`, `scripting`
- `host_permissions`: `<all_urls>` (needed for the content script to run on arbitrary reading pages the user chooses — can be narrowed to activeTab + user-granted origins later to reduce the install-time permission warning)
- Camera access is requested via `getUserMedia()` inside the extension's own `gaze-engine.html` page — this is a **web platform permission prompt**, not a `manifest.json` permission key (Chrome extensions don't have a dedicated "camera" manifest permission the way mobile app manifests do).
- No `offscreen` document for the camera — offscreen documents cannot reliably sustain the camera+DOM combination needed here and can't access host-page DOM anyway; the dedicated tab/window pattern is the documented working approach.

## 7. Accuracy — what we can honestly promise for MVP

Based on the published numbers above, set expectations explicitly rather than leaving this as a gap:

| Setup | Typical error | What that means in practice |
|---|---|---|
| WebGazer, baseline, real-world conditions | ~4.2° visual angle (~175-210px) | Reliable at **paragraph** level only |
| WebGazer + head-pose correction | ~1.1-1.4° | Borderline **line-level**, needs the fusion stack in §6.4 to be usable |
| Higher-res webcam alone | ~1.4° | Same ballpark as above |
| MediaPipe-based (WebEyeTrack-style) | Reported to outperform WebGazer cross-dataset | Best current path to reliable line-level in v1.5 |
| Dedicated eye-tracking hardware (Tobii etc.) | Sub-degree, word-level feasible | Out of scope — MVP targets consumer webcams only |

**MVP commitment:** ship with a **line-to-few-line granularity** reading window, not a single-word highlight. Market and design around "keeps you anchored to where you are," not "tracks your exact word" — the latter isn't honest with current consumer webcam tech.

## 8. Testing without the Chrome Web Store — yes, this is fully supported

You do **not** need to publish to the Web Store to test, and this isn't a workaround — it's Chrome's standard developer workflow, unchanged and fully supported as of 2026:

1. Go to `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select the folder containing your `manifest.json`.
4. The extension installs immediately, runs like any other extension, and reloads instantly whenever you click the refresh icon after editing code — no review process, no store listing, no waiting.

Notes worth knowing:
- Chrome shows a persistent "Developer mode extensions are active" banner while any unpacked extension is loaded — cosmetic, not a functional limitation.
- The extension gets a **randomly generated ID** each time it's loaded unpacked unless you pin one via a `"key"` field in `manifest.json` (generate this once via `chrome://extensions` → "Pack extension") — worth doing early if anything (e.g., OAuth client IDs) ever needs to reference a stable extension ID.
- If you want to hand a build to a few other testers without Developer Mode hassle, you can also **pack** the extension into a `.crx` + share it, though unsigned CRX installs outside the Web Store face additional Chrome warnings on non-Dev-channel Chrome — Developer Mode + Load Unpacked remains the simplest path for a small internal test group.
- None of this requires Chrome Web Store review, a developer account fee, or public listing at any point in MVP testing.

## 9. Milestones

**Phase 0 — Skeleton (few days)**
Manifest V3 scaffold, gaze-engine window opens camera, WebGazer running, raw gaze point logged to console. No overlay yet.

**Phase 1 — Core loop**
9-point calibration UI, One-Euro smoothing, I-VT fixation classification, line-detection via Range API, blur overlay following fixations on a static test article.

**Phase 2 — Fusion & feel**
Add text-layout prior, cursor-fusion weighting, text-selection recalibration anchors, scroll-position constraint. Tune window height/blur/animation until it "feels" right on real articles (this is a taste-tuning phase, budget real time for it).

**Phase 3 — Personal dogfood**
Load unpacked, use it daily on real reading for a week+, log where it breaks (fast scrollers, small text, multi-column layouts, dark mode pages, code blocks).

**Phase 4 (post-MVP, not in this PRD's scope)**
Evaluate MediaPipe/WebEyeTrack swap-in for the inference backend; consider auto-scroll pacing; consider Web Store submission once stable.

## 10. Open risks (named explicitly, not hidden)

- **Lighting/webcam quality variance** — accuracy numbers above assume decent lighting and a normal laptop webcam; low-light or low-res cameras will perform worse than the cited figures.
- **Multi-column / non-linear layouts** (comment sections, code blocks, tables) break the left-to-right/top-to-bottom prior that the fusion model leans on — needs explicit handling or graceful degradation (e.g., disable the effect on detected non-prose regions).
- **Performance** — running a webcam ML model continuously has real CPU/battery cost; needs profiling before claiming "works great all day."
- **Permission friction** — `<all_urls>` host permission plus persistent camera access is a meaningfully scary install prompt; worth reconsidering scope (activeTab-only) once core loop is proven.
- **Glasses/lighting edge cases** — iris/eye-tracking models are documented to have somewhat higher error rates for users wearing glasses; not a blocker, but should be tested for explicitly, not assumed away.

## 11. Key references used for this PRD

- WebGazer.js (brownhci/WebGazer) — open-source library and accuracy benchmarks
- WebEyeTrack (2026 arXiv) — MediaPipe FaceMesh-based gaze estimation outperforming WebGazer cross-dataset
- MediaPipe Iris (Google Research) — iris landmark and distance-estimation model
- Beam Eye Tracker (Eyeware) — closest existing shipped product (general focus/blur, not reading-specific)
- Chrome for Developers — Offscreen Documents API, Manifest V3 reference, camera-in-extension-context limitations
- Published HCI research on mouse-cursor/gaze correlation and paragraph-focus prediction from interaction signals
