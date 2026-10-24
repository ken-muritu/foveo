/* Foveo — I-VT fixation classifier (PRD §6.4 step 2).
 *
 * Velocity-threshold classification: samples whose instantaneous velocity
 * exceeds the saccade threshold are saccades; sustained low-velocity runs
 * are fixations. The reading window only re-homes on fixations, so it glides
 * over saccades instead of chasing them.
 */

class FixationClassifier {
  /**
   * @param {object} opts
   * @param {number} opts.pxPerDegree px per visual degree at typical viewing distance (~35)
   * @param {number} opts.saccadeVelocityDegS deg/s above which a sample is a saccade (~55)
   * @param {number} opts.minFixationMs ms of sustained low velocity before 'fixation' (~160)
   */
  constructor(opts = {}) {
    this.pxPerDegree = opts.pxPerDegree || 35;
    this.saccadeVelocityDegS = opts.saccadeVelocityDegS || 55;
    this.minFixationMs = opts.minFixationMs || 160;

    this.prev = null;          // {x, y, t}
    this.fixStart = null;      // timestamp when low-velocity run began
    this.state = 'unknown';    // 'unknown' | 'saccade' | 'fixation'
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} t timestamp ms
   * @returns {{state: string, velocityDegS: number}}
   */
  push(x, y, t) {
    if (!this.prev) {
      this.prev = { x, y, t };
      this.fixStart = t;
      return { state: 'unknown', velocityDegS: 0 };
    }

    const dt = Math.max(t - this.prev.t, 1);
    const dist = Math.hypot(x - this.prev.x, y - this.prev.y);
    const velocityDegS = (dist / this.pxPerDegree) / (dt / 1000);
    this.prev = { x, y, t };

    const saccadeThreshold = this.saccadeVelocityDegS;
    if (velocityDegS > saccadeThreshold) {
      this.state = 'saccade';
      this.fixStart = null;
    } else {
      if (this.fixStart === null) this.fixStart = t;
      this.state = (t - this.fixStart) >= this.minFixationMs ? 'fixation' : 'saccade';
    }
    return { state: this.state, velocityDegS };
  }

  reset() {
    this.prev = null;
    this.fixStart = null;
    this.state = 'unknown';
  }
}

window.FixationClassifier = FixationClassifier;
