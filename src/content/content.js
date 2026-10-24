/* Foveo — content script entry (PRD §5).
 *
 * Wires the pieces on each page: line detection + fusion + overlay, and the
 * runtime port that carries gaze samples in from the service worker.
 */

(function () {
  if (window.__foveoLoaded) return;
  window.__foveoLoaded = true;

  const api = typeof browser !== 'undefined' ? browser : chrome;

  const DEFAULT_SETTINGS = {
    blurPx: 6,
    windowLines: 1.6,
    softPx: 28,
    dim: 0.05,
    transitionMs: 180,
    pxPerDegree: 35,
  };

  let lines = null;
  let fusion = null;
  let overlay = null;
  let port = null;
  let running = false;

  function ensurePort() {
    if (port) return port;
    port = api.runtime.connect({ name: 'foveo-content' });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'start') start(msg.settings);
      else if (msg.type === 'stop') stop();
      else if (msg.type === 'gaze') onGaze(msg);
    });

    port.onDisconnect.addListener(() => {
      port = null;
      // If we were reading, try to reconnect — the service worker may have
      // been recycled mid-session.
      if (running) {
        setTimeout(() => {
          try {
            ensurePort().postMessage({ type: 'hello' });
          } catch (_) { /* extension reloaded; overlay stays off */ }
        }, 1000);
      }
    });

    return port;
  }

  async function start(settings) {
    const { foveoCalibration } = await api.storage.local.get('foveoCalibration');
    if (!foveoCalibration) return; // nothing to map gaze with

    const merged = Object.assign({}, DEFAULT_SETTINGS, settings);

    if (!lines) lines = new FoveoLines();
    if (!overlay) overlay = new FoveoOverlay();
    if (!fusion) fusion = new FoveoFusion(lines);

    fusion.configure(foveoCalibration);
    overlay.mount(merged);
    running = true;
  }

  function stop() {
    running = false;
    if (overlay) overlay.hide();
  }

  function onGaze(msg) {
    if (!running || document.hidden || !fusion) return;
    const band = fusion.pushGaze(msg);
    if (band && lines) {
      overlay.showBand(band, lines.medianHeight);
    }
  }

  // Settings edited live from the popup.
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.foveoSettings && overlay) {
      overlay.updateSettings(
        Object.assign({}, DEFAULT_SETTINGS, changes.foveoSettings.newValue)
      );
    }
    if (changes.foveoCalibration && fusion && running) {
      fusion.configure(changes.foveoCalibration.newValue);
    }
  });

  ensurePort().postMessage({ type: 'hello' });
})();
