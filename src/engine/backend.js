/* Foveo — gaze backend seam (PRD §6.2: swappable inference backend).
 *
 * A backend must implement:
 *   init({ onSample })          -> Promise   (onSample({x, y}) in this page's client coords)
 *   recordPoint(x, y)           -> void      (calibration anchor; 'click'-quality weight)
 *   getPrediction()             -> Promise<{x, y} | null>
 *   save()                      -> Promise   (persist calibration for next session)
 *
 * The MVP backend wraps the vendored WebGazer 2.0.1 bundle (tracking.js face
 * detector, fully offline — see src/vendor/README.md for why not 3.x).
 * Every 3.x-only API is behind a typeof guard, so a later MediaPipe or
 * WebGazer-3.x backend stays drop-in for the engine.
 */

class WebGazerBackend {
  constructor() {
    this.ready = false;
    this.onSample = null;
    this._lastSample = null;
  }

  async init({ onSample }) {
    this.onSample = onSample;
    if (typeof webgazer === 'undefined') {
      throw new Error('webgazer bundle not loaded');
    }

    // WebGazer's begin() shows an advisory alert() on non-https origins.
    // chrome-extension:// is secure but not https, so swallow it.
    const realAlert = window.alert;
    window.alert = () => {};
    try {
      const result = webgazer.begin();
      // 2.0.1 may return undefined rather than a Promise.
      await Promise.resolve(result);
    } finally {
      window.alert = realAlert;
    }

    if (typeof webgazer.showPredictionPoints === 'function') {
      webgazer.showPredictionPoints(false);
    }
    if (typeof webgazer.showGazeDot === 'function') {
      webgazer.showGazeDot(false);
    }
    if (typeof webgazer.setRegression === 'function') {
      try { webgazer.setRegression('ridge'); } catch (_) { /* default already ridge */ }
    }

    webgazer.setGazeListener((data, _elapsed) => {
      if (data && Number.isFinite(data.x) && Number.isFinite(data.y)) {
        this._lastSample = { x: data.x, y: data.y };
        if (this.onSample) this.onSample(this._lastSample);
      }
    });

    this.ready = true;
  }

  recordPoint(x, y) {
    if (!this.ready) return;
    webgazer.recordScreenPosition(x, y, 'click');
  }

  async getPrediction() {
    if (!this.ready) return null;
    try {
      const pred = await webgazer.getCurrentPrediction();
      if (pred && Number.isFinite(pred.x) && Number.isFinite(pred.y)) {
        return { x: pred.x, y: pred.y };
      }
    } catch (_) { /* not ready yet */ }
    return this._lastSample;
  }

  async save() {
    if (!this.ready) return;
    try {
      const result = webgazer.end();
      await Promise.resolve(result);
    } catch (_) { /* end() can throw if already stopped */ }
    this.ready = false;
  }
}

// Persist calibration when the engine window closes. WebGazer 2.0.1 writes to
// localStorage on end(); the next begin() on this origin restores it.
window.addEventListener('beforeunload', () => {
  if (window.foveoBackend && window.foveoBackend.ready) {
    try { webgazer.end(); } catch (_) { /* best effort */ }
  }
});

window.WebGazerBackend = WebGazerBackend;
