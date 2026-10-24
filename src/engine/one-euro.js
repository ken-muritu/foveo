/* Foveo — One-Euro filter (Casiez, Roussel, Vogel 2012).
 *
 * Adaptive low-pass: cutoff rises with signal speed, so the filter is strong
 * while fixating (kills jitter) and weak while saccading (minimizes lag).
 * The standard choice for noisy pointer/gaze streams.
 */

class LowPass {
  constructor(alpha, init) {
    this.y = init;
    this.s = init;
    this.initialized = init !== undefined;
    this.alpha = alpha;
  }
  filter(value, alpha) {
    if (alpha !== undefined) this.alpha = alpha;
    if (!this.initialized) {
      this.initialized = true;
      this.y = value;
      this.s = value;
    } else {
      this.y = value;
      this.s = this.alpha * value + (1 - this.alpha) * this.s;
    }
    return this.s;
  }
}

class OneEuroFilter {
  /**
   * @param {number} minCutoff minimum cutoff frequency (Hz). Lower = smoother when still.
   * @param {number} beta speed coefficient. Higher = less lag when moving.
   * @param {number} dCutoff cutoff for the derivative (Hz).
   */
  constructor(minCutoff = 1.1, beta = 0.015, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPass(this._alpha(this.minCutoff, 1 / 60));
    this.dx = new LowPass(this._alpha(this.dCutoff, 1 / 60), 0);
    this.lastT = null;
  }

  _alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /**
   * @param {number} value raw sample
   * @param {number} t timestamp in ms
   * @returns {number} filtered value
   */
  filter(value, t) {
    let dt = 1 / 60;
    if (this.lastT !== null) {
      dt = Math.max((t - this.lastT) / 1000, 1e-3);
    }
    this.lastT = t;

    const prev = this.x.s;
    const dValue = this.x.initialized ? (value - prev) / dt : 0;
    const edValue = this.dx.filter(dValue, this._alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edValue);
    return this.x.filter(value, this._alpha(cutoff, dt));
  }

  reset() {
    this.x = new LowPass(this._alpha(this.minCutoff, 1 / 60));
    this.dx = new LowPass(this._alpha(this.dCutoff, 1 / 60), 0);
    this.lastT = null;
  }
}

window.OneEuroFilter = OneEuroFilter;
