/* Foveo — gaze engine orchestration.
 *
 * Runs in the dedicated extension window that owns the camera (PRD §6.1).
 * Pipeline per sample: WebGazer listener -> One-Euro smooth -> I-VT classify
 * -> stream over the runtime port to the service worker.
 *
 * Modes:
 *   #calibrate (or no stored calibration) -> run the 9-dot flow, then stream.
 *   default                                -> stream with stored calibration.
 */

(function () {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const port = api.runtime.connect({ name: 'foveo-engine' });

  const els = {
    camera: document.getElementById('pill-camera'),
    face: document.getElementById('pill-face'),
    rate: document.getElementById('pill-rate'),
    note: document.querySelector('.hud-note'),
  };

  function setPill(el, text, tone) {
    el.textContent = text;
    el.className = 'pill' + (tone ? ` ${tone}` : '');
  }

  const backend = new WebGazerBackend();
  window.foveoBackend = backend;

  const euroX = new OneEuroFilter(1.1, 0.015, 1.0);
  const euroY = new OneEuroFilter(1.1, 0.015, 1.0);
  const fixation = new FixationClassifier();

  let streaming = false;
  let lastSampleAt = 0;
  let sampleTimes = [];
  let calibratedOrigin = null;

  function onSample(raw) {
    const t = performance.now();
    lastSampleAt = t;

    const x = euroX.filter(raw.x, t);
    const y = euroY.filter(raw.y, t);
    const { state } = fixation.push(x, y, t);

    if (streaming) {
      try {
        port.postMessage({
          type: 'gaze',
          x, y,
          t: Date.now(),
          state,
          fixation: state === 'fixation',
        });
      } catch (_) { /* port torn down; service worker will reopen */ }
    }

    sampleTimes.push(t);
    if (sampleTimes.length > 90) sampleTimes.shift();
  }

  // ---- HUD meters ---------------------------------------------------------

  setInterval(() => {
    if (!backend.ready) return;
    const now = performance.now();
    setPill(els.face, now - lastSampleAt < 900 ? 'face: locked' : 'face: searching',
      now - lastSampleAt < 900 ? 'ok' : 'warn');
    const cutoff = now - 1000;
    const hz = sampleTimes.filter((s) => s > cutoff).length;
    setPill(els.rate, `${hz} hz`, hz >= 15 ? 'ok' : (hz > 0 ? 'warn' : 'bad'));
  }, 500);

  // Keep the stored screen-space origin honest if the engine window is moved
  // (client coords are unaffected by moves, so a fresh origin is all the
  // content script needs). A *resize* genuinely invalidates the regression —
  // flag it instead of silently drifting.
  let resized = false;
  window.addEventListener('move', async () => {
    if (!calibratedOrigin) return;
    calibratedOrigin = { x: window.screenLeft, y: window.screenTop };
    const { foveoCalibration } = await api.storage.local.get('foveoCalibration');
    if (foveoCalibration) {
      foveoCalibration.originX = calibratedOrigin.x;
      foveoCalibration.originY = calibratedOrigin.y;
      await api.storage.local.set({ foveoCalibration });
    }
  });
  window.addEventListener('resize', () => {
    if (!calibratedOrigin || resized) return;
    resized = true;
    els.note.textContent = 'Window resized — calibration may drift. Recalibrate from the Foveo popup if the window feels off.';
    setPill(els.camera, 'camera: resized', 'warn');
  });

  // ---- Startup ------------------------------------------------------------

  async function startStreaming(origin) {
    calibratedOrigin = origin;
    streaming = true;
    port.postMessage({
      type: 'phase',
      phase: 'ready',
      shrinkRect: { width: 340, height: 180 },
    });
    setPill(els.camera, 'camera: on', 'ok');
    els.note.textContent = 'Tracking. Keep this window open; it can sit small and out of the way.';
  }

  async function runCalibration() {
    streaming = false;
    port.postMessage({ type: 'phase', phase: 'calibrating' });
    const cal = new FoveoCalibration(backend, {
      onStatus: ({ message }) => { els.note.textContent = message; },
      onDone: async ({ meanPx, origin }) => {
        await startStreaming(origin);
        port.postMessage({ type: 'phase', phase: 'ready', accuracyPx: meanPx,
          shrinkRect: { width: 340, height: 180 } });
      },
    });
    await cal.run();
  }

  async function main() {
    setPill(els.camera, 'camera: requesting…');
    try {
      await backend.init({ onSample });
    } catch (e) {
      setPill(els.camera, 'camera: denied', 'bad');
      els.note.textContent =
        'Camera permission was denied or unavailable. Allow camera access for this extension and reload.';
      port.postMessage({ type: 'log', level: 'error', text: String(e) });
      return;
    }
    setPill(els.camera, 'camera: on', 'ok');
    port.postMessage({ type: 'log', level: 'info', text: 'webgazer backend initialized' });

    const wantCalibrate = location.hash === '#calibrate';
    const { foveoCalibration } = await api.storage.local.get('foveoCalibration');

    if (wantCalibrate || !foveoCalibration) {
      await runCalibration();
    } else {
      await startStreaming({
        x: foveoCalibration.originX || 0,
        y: foveoCalibration.originY || 0,
      });
    }
  }

  port.onMessage.addListener((msg) => {
    if (msg.type === 'mode' && msg.mode === 'calibrate') {
      // Drop stored calibration and rerun from scratch.
      api.storage.local.remove('foveoCalibration').then(() => runCalibration());
    }
  });

  main();
})();
