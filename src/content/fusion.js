/* Foveo — fusion stack (PRD §6.4).
 *
 * Consumes engine gaze samples and decides WHICH LINE BAND the window should
 * be on. Layers, in order:
 *   1. coordinate transform   engine client coords -> this viewport's coords
 *   2. fixation gate          saccade samples never move the window
 *   3. cursor fusion          only while the pointer is actively moving
 *   4. viewport guard         gaze off-page -> hold last position
 *   5. layout prior + hysteresis  small moves settle fast, jumps need evidence
 *   6. selection anchors      text selection is user-provided ground truth;
 *                             it snaps the window and trims residual drift
 */

(function () {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  class FoveoFusion {
    constructor(lines) {
      this.lines = lines;
      this.cal = null;
      this.driftX = 0;
      this.driftY = 0;

      this.curBand = null;
      this.candidate = null;
      this.candidateSince = 0;
      this.candidateSamples = 0;

      this.recent = [];            // recent accepted gaze points (viewport coords)
      this.mouse = { x: 0, y: 0, vx: 0, vy: 0, t: 0 };

      lines.onRebuild = () => this._remapAfterRebuild();

      window.addEventListener('mousemove', (e) => this._onMouse(e), { passive: true });
      document.addEventListener('selectionchange', () => this._onSelection(), { passive: true });
    }

    configure(cal) {
      this.cal = cal;
      this.driftX = 0;
      this.driftY = 0;
      this.curBand = null;
      this.candidate = null;
      this.recent = [];
    }

    /**
     * @param {{x:number,y:number,state:string,fixation:boolean}} msg
     *        x/y are One-Euro-filtered engine client coords.
     * @returns {object|null} band to display; null = keep current.
     */
    pushGaze(msg) {
      if (!this.cal) return null;

      // 1 — engine client coords -> screen -> this viewport, plus drift trim.
      const gx = msg.x + this.cal.originX - window.screenX + this.driftX;
      const gy = msg.y + this.cal.originY - window.screenY + this.driftY;

      // 4 — gaze left the page entirely: hold.
      const m = 40;
      if (gx < -m || gy < -m || gx > window.innerWidth + m || gy > window.innerHeight + m) {
        return this.curBand;
      }

      // 2 — never chase a saccade.
      if (msg.state === 'saccade') return this.curBand;

      // 3 — cursor fusion while the pointer is actively moving.
      let fx = gx, fy = gy;
      const now = performance.now();
      const md = now - this.mouse.t;
      const mSpeed = Math.hypot(this.mouse.vx, this.mouse.vy);
      if (md < 400 && mSpeed > 30) {
        const w = 0.22;
        const lead = 0.1; // seconds of cursor extrapolation
        fx = gx * (1 - w) + (this.mouse.x + this.mouse.vx * lead) * w;
        fy = gy * (1 - w) + (this.mouse.y + this.mouse.vy * lead) * w;
      }

      this.recent.push({ x: fx, y: fy, t: now });
      if (this.recent.length > 12) this.recent.shift();

      const band = this.lines.nearestBand(fx, fy);
      if (!band) return this.curBand;

      // 5 — layout prior + hysteresis.
      return this._consider(band, now);
    }

    _consider(band, now) {
      if (!this.curBand) {
        this.curBand = band;
        return band;
      }
      if (band.idx === this.curBand.idx) {
        this.candidate = null;
        return this.curBand;
      }

      if (!this.candidate || this.candidate.idx !== band.idx) {
        this.candidate = band;
        this.candidateSince = now;
        this.candidateSamples = 1;
        return this.curBand;
      }

      this.candidateSamples += 1;
      const jump = Math.abs(band.idx - this.curBand.idx);
      const needMs = jump <= 2 ? 90 : 260;
      const needSamples = jump <= 2 ? 4 : 8;

      if (now - this.candidateSince >= needMs && this.candidateSamples >= needSamples) {
        this.curBand = band;
        this.candidate = null;
        return band;
      }
      return this.curBand;
    }

    _onMouse(e) {
      const now = performance.now();
      const dt = Math.max(now - this.mouse.t, 1) / 1000;
      if (this.mouse.t) {
        this.mouse.vx = (e.clientX - this.mouse.x) / dt;
        this.mouse.vy = (e.clientY - this.mouse.y) / dt;
      }
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.t = now;
    }

    // 6 — the user selected text: the selection rect is precise ground truth
    // for where they're looking. Snap the window there, and use the gap
    // between gaze centroid and selection center to trim calibration drift.
    _onSelection() {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || !this.recent.length) return;

      const range = sel.getRangeAt(0);
      const rects = range.getClientRects();
      if (!rects.length) return;
      const r = rects[0];
      const band = this.lines.nearestBand(r.left + r.width / 2, r.top + r.height / 2);
      if (!band) return;

      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const g = this.recent.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
      g.x /= this.recent.length;
      g.y /= this.recent.length;

      const dx = cx - g.x;
      const dy = cy - g.y;
      if (Math.hypot(dx, dy) < 300) {
        this.driftX = clamp(this.driftX * 0.4 + dx * 0.6, -180, 180);
        this.driftY = clamp(this.driftY * 0.4 + dy * 0.6, -180, 180);
      }

      this.curBand = band;
      this.candidate = null;
    }

    // After scroll/layout rebuild, re-home onto the band nearest to where the
    // previous one moved to, so the window rides the page instead of jumping.
    _remapAfterRebuild() {
      if (!this.curBand) return;
      const cy = this.curBand.cy;
      let best = null;
      let bestD = Infinity;
      for (const b of this.lines.bands) {
        const d = Math.abs(b.cy - cy);
        if (d < bestD) { bestD = d; best = b; }
      }
      // Only trust small movements (a scroll); big jumps mean layout changed.
      this.curBand = bestD < 200 ? best : null;
      this.candidate = null;
    }
  }

  window.FoveoFusion = FoveoFusion;
})();
