/* Foveo — 9-point calibration + accuracy probe (PRD §5).
 *
 * Flow:
 *   0. Size check — dots need screen spread; the engine window must be large.
 *   1. Record the viewport origin (window.screenLeft/screenTop) — this anchors
 *      WebGazer's client-coord predictions to screen space.
 *   2. Training: nine dots on a 3x3 grid (center first), 5 clicks each.
 *   3. Accuracy probe: nine fresh dots; measure prediction error at click time.
 *   4. Verdict + save.
 */

(function () {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const GRID = [
    [0.5, 0.5],              // center first — face lock-on happens here
    [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9],
    [0.5, 0.1], [0.1, 0.5], [0.9, 0.5], [0.5, 0.9],
  ];
  const CLICKS_PER_DOT = 5;
  const MIN_W = 760;
  const MIN_H = 520;

  const VERDICTS = [
    { max: 110, label: 'Excellent', tone: 'good',
      note: 'Line-level tracking should feel tight.' },
    { max: 220, label: 'Good', tone: 'good',
      note: 'Solid for the MVP reading window.' },
    { max: 400, label: 'Usable', tone: 'warn',
      note: 'The window will feel a bit loose. Better lighting usually helps.' },
    { max: Infinity, label: 'Poor', tone: 'bad',
      note: 'Try again: face the screen straight on, steady head, even light on your face.' },
  ];

  class Calibration {
    constructor(backend, { onStatus, onDone }) {
      this.backend = backend;
      this.onStatus = onStatus || (() => {});
      this.onDone = onDone || (() => {});
      this.layer = null;
      this.origin = null;
      this.errors = [];
      this.latest = null;
      this._onSample = (s) => { this.latest = s; };
    }

    async run() {
      // Step 0 — size check.
      if (window.innerWidth < MIN_W || window.innerHeight < MIN_H) {
        this.onStatus({
          phase: 'blocked',
          message: `Maximize this window first — calibration needs at least ${MIN_W}×${MIN_H}.`,
        });
        return;
      }

      this._buildLayer();
      this._prevOnSample = this.backend.onSample;
      this.backend.onSample = (s) => {
        this._onSample(s);
        if (this._prevOnSample) this._prevOnSample(s);
      };

      // Step 1 — origin. window.screenLeft/screenTop give the viewport's screen
      // position INCLUDING browser chrome, which is exactly what the content
      // script's transform needs (both sides include chrome → offsets cancel).
      this.origin = { x: window.screenLeft, y: window.screenTop };

      // Step 2 — training.
      this.onStatus({ phase: 'training', message: 'Click each dot 5 times. Look straight at it.' });
      for (let i = 0; i < GRID.length; i++) {
        await this._dotPass(GRID[i], CLICKS_PER_DOT, i + 1, GRID.length, true);
      }

      // Step 3 — accuracy probe. Same grid, fresh order, capture prediction at click.
      this.onStatus({ phase: 'probing', message: 'Accuracy check — click each dot once.' });
      this.errors = [];
      const probe = [...GRID].sort(() => 0.5 - Math.random()).slice(0, 9);
      for (let i = 0; i < probe.length; i++) {
        await this._dotPass(probe[i], 1, i + 1, probe.length, false);
      }

      // Step 4 — verdict.
      this.backend.onSample = this._prevOnSample;
      this._finish();
    }

    _buildLayer() {
      this.layer = document.createElement('div');
      this.layer.id = 'fv-cal';
      this.layer.innerHTML = `
        <div class="fv-cal-hint" id="fv-cal-hint"></div>
        <div class="fv-cal-dot" id="fv-cal-dot"><span class="fv-cal-count"></span></div>
        <div class="fv-cal-feedback" id="fv-cal-fb"></div>
      `;
      document.documentElement.appendChild(this.layer);
      this.dotEl = this.layer.querySelector('#fv-cal-dot');
      this.hintEl = this.layer.querySelector('#fv-cal-hint');
      this.countEl = this.layer.querySelector('.fv-cal-count');
      this.fbEl = this.layer.querySelector('#fv-cal-fb');
    }

    _dotPass([fx, fy], clicks, n, total, training) {
      return new Promise((resolve) => {
        const x = fx * window.innerWidth;
        const y = fy * window.innerHeight;
        this.dotEl.style.left = `${x}px`;
        this.dotEl.style.top = `${y}px`;
        this.dotEl.classList.remove('fv-hit');
        this.hintEl.textContent = `Dot ${n} of ${total} — ${clicks > 1 ? `${clicks} clicks` : '1 click'}`;
        this.fbEl.classList.remove('show');

        let got = 0;
        const onDown = (e) => {
          if (!training) {
            const pred = this.latest;
            if (pred) {
              const err = Math.hypot(pred.x - x, pred.y - y);
              this.errors.push(err);
              this._showFeedback(x, y, pred, err);
            }
          }
          this.backend.recordPoint(x, y);
          got += 1;
          this.dotEl.classList.add('fv-hit');
          this.countEl.textContent = training ? `${clicks - got}` : '';
          if (got >= clicks) {
            document.removeEventListener('mousedown', onDown, true);
            setTimeout(resolve, training ? 120 : 550);
          }
        };
        document.addEventListener('mousedown', onDown, true);
      });
    }

    _showFeedback(x, y, pred, err) {
      this.fbEl.innerHTML = `
        <span class="fb-dot" style="left:${pred.x}px; top:${pred.y}px"></span>
        <span class="fb-label" style="left:${pred.x + 12}px; top:${pred.y + 12}px">
          ${Math.round(err)}px off
        </span>`;
      this.fbEl.classList.add('show');
    }

    _finish() {
      const errs = this.errors.length ? this.errors : [999];
      const sorted = [...errs].sort((a, b) => a - b);
      const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
      const verdict = VERDICTS.find((v) => mean <= v.max);

      this.layer.classList.add('fv-results');
      this.layer.innerHTML = `
        <div class="fv-results-card">
          <h2>${verdict.label}</h2>
          <p class="fv-mean">Average error: <strong>${Math.round(mean)}px</strong>
            <span class="fv-p95">(p95 ${Math.round(p95)}px)</span></p>
          <p class="fv-note">${verdict.note}</p>
          <div class="fv-actions">
            <button id="fv-redo">Recalibrate</button>
            <button id="fv-go" class="primary">Start reading</button>
          </div>
        </div>`;

      const record = {
        at: new Date().toISOString(),
        originX: this.origin.x,
        originY: this.origin.y,
        meanPx: Math.round(mean),
        p95Px: Math.round(p95),
        dotsClicked: GRID.length * CLICKS_PER_DOT,
        engine: 'webgazer-2.0.1',
      };

      const finish = async () => {
        await api.storage.local.set({ foveoCalibration: record });
        this.layer.remove();
        this.onDone({
          meanPx: Math.round(mean),
          p95Px: Math.round(p95),
          verdict: verdict.label,
          origin: this.origin,
        });
      };

      this.layer.querySelector('#fv-go').addEventListener('click', finish);
      this.layer.querySelector('#fv-redo').addEventListener('click', () => {
        this.layer.remove();
        this.run();
      });
    }
  }

  window.FoveoCalibration = Calibration;
})();
