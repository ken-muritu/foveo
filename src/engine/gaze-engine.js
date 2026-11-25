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

  let backend = new MediaPipeBackend();   // falls back to WebGazer if MediaPipe cannot start
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

  // "face" and "hz" describe what the camera sees. Before calibration the
  // model has nothing to predict with, so gaze samples alone would read as
  // "searching / 0 hz" even with a face in perfect view.
  setInterval(() => {
    if (!backend.ready) return;
    const now = performance.now();
    const cutoff = now - 1000;
    const faceAt = typeof backend.lastFaceAt === 'number' ? backend.lastFaceAt : lastSampleAt;
    const times = Array.isArray(backend.faceTimes) ? backend.faceTimes : sampleTimes;
    const locked = now - faceAt < 900;
    setPill(els.face, locked ? 'face: locked' : 'face: searching', locked ? 'ok' : 'warn');
    const hz = times.filter((s) => s > cutoff).length;
    setPill(els.rate, `${hz} hz`, hz >= 15 ? 'ok' : (hz > 0 ? 'warn' : 'bad'));
  }, 500);

  // The model maps your face to coordinates in this window *as it was placed
  // during calibration*, so the stored origin must stay fixed: moving the
  // small window out of the way later changes nothing about where you look.
  // Resizing is harmless for the same reason.

  // ---- Startup ------------------------------------------------------------

  // ---- Startup ------------------------------------------------------------

  async function startStreaming(origin, accuracyPx) {
    calibratedOrigin = origin;
    streaming = true;
    port.postMessage({
      type: 'phase',
      phase: 'ready',
      accuracyPx: typeof accuracyPx === 'number' ? accuracyPx : undefined,
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
        await startStreaming(origin, meanPx);
      },
    });
    await cal.run();
  }

  async function main() {
    setPill(els.camera, 'camera: requesting…');
    try {
      try {
        await backend.init({ onSample });
        port.postMessage({ type: 'log', level: 'info', text: 'mediapipe backend initialized' });
      } catch (mpErr) {
        port.postMessage({ type: 'log', level: 'warn', text: 'mediapipe failed, using webgazer: ' + mpErr });
        if (backend.stream) backend.stream.getTracks().forEach((t) => t.stop());
        backend = new WebGazerBackend();
        window.foveoBackend = backend;
        await backend.init({ onSample });
      }
    } catch (e) {
      setPill(els.camera, 'camera: denied', 'bad');
      els.note.textContent =
        'Camera permission was denied or unavailable. Allow camera access for this extension and reload.';
      port.postMessage({ type: 'log', level: 'error', text: String(e) });
      return;
    }
    setPill(els.camera, 'camera: on', 'ok');
    port.postMessage({ type: 'log', level: 'info', text: (backend.constructor.name) + ' ready' });

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
