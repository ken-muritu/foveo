/* Foveo — MediaPipe Face Landmarker backend (same seam as WebGazerBackend).
 *
 * Camera -> Face Landmarker (478 points + face transform) -> 7 features ->
 * ridge regression trained from calibration clicks -> {x, y} in client coords.
 * Fully local: wasm + model are vendored (scripts/fetch-mediapipe.sh).
 */
(function () {
  const M = window.FoveoGazeModel;
  const STORE_KEY = 'foveoMediaPipeModel';
  const MIN_FIT = 10;      // samples before predictions start
  const AVG_FRAMES = 4;    // features are averaged over the last N frames at a click

  class MediaPipeBackend {
    constructor() {
      this.ready = false;
      this.onSample = null;
      this.model = new M.RidgeGaze(1.0);
      this.recent = [];
      this._last = null;
      this._stop = false;
      this.fps = 0;
    }

    async init({ onSample }) {
      this.onSample = onSample;
      if (typeof Vision === 'undefined') throw new Error('MediaPipe bundle not loaded');

      const base = new URL('../vendor/mediapipe/', location.href).href;
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      const v = this.video = document.createElement('video');
      v.muted = true; v.playsInline = true; v.srcObject = this.stream;
      await v.play();

      const fileset = await Vision.FilesetResolver.forVisionTasks(base + 'wasm');
      this.landmarker = await Vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: base + 'face_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      });

      try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
        if (saved) this.model = M.RidgeGaze.fromJSON(saved);
      } catch (_) { /* start fresh */ }

      this.ready = true;
      this._loop();
    }

    _loop() {
      const step = () => {
        if (this._stop) return;
        const v = this.video;
        if (v.readyState >= 2 && v.videoWidth) this._frame(v);
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step); else requestAnimationFrame(step);
      };
      step();
    }

    _frame(v) {
      let res;
      try { res = this.landmarker.detectForVideo(v, performance.now()); } catch (_) { return; }
      const lm = res.faceLandmarks && res.faceLandmarks[0];
      if (!lm) { this._last = null; return; }
      const mat = res.facialTransformationMatrixes && res.facialTransformationMatrixes[0];
      const f = M.extractFeatures(lm, mat ? mat.data : null, v.videoWidth, v.videoHeight);
      if (!f) return;
      this._last = f;
      this.recent.push(f);
      if (this.recent.length > AVG_FRAMES) this.recent.shift();
      const p = this.model.predict(f);
      if (p && Number.isFinite(p.x) && this.onSample) this.onSample(p);
    }

    _averaged() {
      if (!this.recent.length) return null;
      const out = new Array(M.FEATURE_COUNT).fill(0);
      for (const f of this.recent) for (let j = 0; j < out.length; j++) out[j] += f[j] / this.recent.length;
      return out;
    }

    recordPoint(x, y) {
      const f = this._averaged();
      if (!f || !this._last) return;           // no face this instant: skip rather than poison the fit
      this.model.add(f, x, y);
      if (this.model.size >= MIN_FIT) this.model.fit();
    }

    async getPrediction() {
      return this._last ? this.model.predict(this._last) : null;
    }

    async save() {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(this.model)); } catch (_) { /* quota */ }
      this._stop = true;
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      try { this.landmarker && this.landmarker.close(); } catch (_) { /* already closed */ }
      this.ready = false;
    }
  }

  window.addEventListener('beforeunload', () => {
    const b = window.foveoBackend;
    if (b instanceof MediaPipeBackend && b.ready) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(b.model)); } catch (_) { /* best effort */ }
    }
  });

  window.MediaPipeBackend = MediaPipeBackend;
})();
