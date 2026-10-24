# Foveo

**Gaze-contingent reading assistant — a Chrome and Firefox extension.**
Watches where you're looking through your webcam, keeps the line you're reading
sharp, and softly blurs everything else. All processing happens on your machine.

> Foveo is built from the PRD in [`docs/PRD.md`](docs/PRD.md), with the validation
> record in [`docs/VALIDATION.md`](docs/VALIDATION.md).

## How it works

```
webcam (engine window) → WebGazer 2.0.1 → One-Euro smoothing → I-VT fixation gate
        ↓ runtime port (via service worker)
content script: line-band detection → fusion stack → backdrop-blur overlay
```

1. **Engine window** (`src/engine/`) — a small dedicated extension window owns the
   camera and inference. WebGazer 2.0.1 (fetched once by `scripts/fetch-webgazer.sh`, then fully offline) estimates gaze at
   ~30 Hz; a One-Euro filter smooths it; an I-VT classifier splits samples into
   saccades and fixations.
2. **Service worker** (`src/background/`) — relays gaze samples over a kept port to
   the tab you're reading.
3. **Content script** (`src/content/`) — finds the visual text lines on the page via
   `Range.getClientRects()`, fuses gaze with cursor movement, layout priors,
   hysteresis, and text-selection anchors, then renders a `backdrop-filter: blur()`
   overlay whose sharp band glides between lines (registered `@property` values,
   ~180 ms eased transitions).

## Quick start (load unpacked)

First fetch the gaze library (WebGazer.js 2.0.1, GPLv3, not included in this repo):

```bash
./scripts/fetch-webgazer.sh   # downloads it from the WebGazer repo and checks its SHA-256
```

**Chrome:** `chrome://extensions` → toggle **Developer mode** → **Load unpacked** →
select this repo's root (the folder containing `manifest.json`).

**Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** →
select `manifest.json` in this repo's root. (Temporary add-ons are removed when
Firefox closes — for a permanent install, submit to
[addons.mozilla.org](https://addons.mozilla.org).)

Then, in either browser:

1. Click the Foveo toolbar icon → **Turn on**. The engine window opens and asks for
   camera permission (the ordinary browser prompt).
2. **Calibrate.** Keep the engine window maximized, sit ~50–70 cm from the screen,
   face it straight, and click each of the nine dots as instructed. You'll get an
   accuracy verdict in pixels.
3. Open any text-heavy page (or `test/article.html`, included for this) and press
   the Foveo toggle. The blur window appears and follows your reading.

Tune the feel from the popup: **blur** (2–16 px), **window height** (1–4 lines),
**edge softness** (8–60 px). Settings persist via `chrome.storage.local`.

## Accuracy — what to expect

| Calibration result | Meaning |
|---|---|
| ≤ 110 px avg error | Excellent — tight line tracking |
| 110–220 px | Good — the MVP's sweet spot |
| 220–400 px | Usable — try better lighting |
| > 400 px | Poor — recalibrate (lighting, distance, head pose) |

The MVP ships **line-to-few-line granularity, not word-level** (PRD §7). The fusion
stack — fixation gating, layout priors, cursor fusion, selection anchors, scroll
remapping — exists to turn a ~4° raw estimate into a stable line choice.

## Repo layout

```
manifest.json              MV3 manifest
src/
  background/service-worker.js   state, gaze relay, engine lifecycle
  engine/
    gaze-engine.html/.css/.js    camera window, orchestration, HUD
    backend.js                   swappable gaze backend seam (PRD §6.2)
    calibration.js               9-dot training + accuracy probe
    one-euro.js                  adaptive gaze smoothing
    fixation.js                  I-VT saccade/fixation classifier
  content/
    lines.js                     text line-band detection
    fusion.js                    gaze → line decision stack (PRD §6.4)
    overlay.js + content.css     backdrop-blur reading window
    content.js                   per-page wiring + port
  popup/                         toggle + settings UI
  vendor/                        WebGazer 2.0.1 goes here (see vendor README)
  icons/
scripts/fetch-webgazer.sh  downloads and verifies WebGazer 2.0.1
docs/PRD.md                the product spec
docs/VALIDATION.md         claim-by-claim validation log
test/article.html          self-contained long-form test page
```

## Documented deviations from the PRD

All recorded in [`docs/VALIDATION.md`](docs/VALIDATION.md):

- **WebGazer pinned to 2.0.1.** The current build's face-tracker weights are
  hard-coded to tfhub.dev URLs, which have been sunset (404). 2.0.1 bundles the
  tracking.js detector in-file: zero runtime network requests.
- **Port-based gaze relay** instead of `sendMessage` (service-worker wake-up cost at 30 Hz).
- **Full-size engine window during calibration**, shrinking to ~340×180 after.
- **Screen-space coordinate transform** via `window.screenLeft/screenTop` on both
  sides (browser-chrome offsets cancel exactly).
- **One-Euro filter** in place of Kalman (better fit for gaze; 2.0.1 has no Kalman API).

## Limitations (known and honest)

- Lighting, glasses, and head pose degrade webcam gaze; the calibration verdict
  tells you where you landed.
- Multi-column layouts work via horizontal position but are the hard case —
  `test/article.html` includes a two-column section to exercise them.
- Text inside iframes is not covered (top frame only).
- Resizing the engine window after calibration can drift the regression — the HUD
  flags it; recalibrate if the window feels off. Moving it is fine.
- `chrome-extension://` pages and most `chrome://` pages can't receive the overlay.

## Roadmap (PRD §9)

- **v1.5** — MediaPipe FaceMesh backend behind the existing seam (`src/engine/backend.js`).
- Auto-scroll when gaze reaches the bottom of the viewport.
- Chrome Web Store packaging.

## Privacy

Camera frames are processed in-memory in the engine window and discarded per frame.
Nothing leaves the machine: no server, no account, no analytics, no network calls
after install (WebGazer 2.0.1 needs no model downloads).

## Licence

Foveo's own code: copyright © 2026 Kennedy Muritu, all rights reserved. It is public to read, not to reuse. See [LICENSE](LICENSE).

WebGazer.js is not part of this repository. It belongs to the Brown HCI Group and is licensed under GPLv3 (LGPLv3 for companies valued under $1M). `scripts/fetch-webgazer.sh` downloads it from its authors' repository.
