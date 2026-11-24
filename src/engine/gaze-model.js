/* Foveo — gaze model: MediaPipe face features -> screen point.
 *
 * Pure functions, no DOM, so they run under `node --test`.
 * Feature idea (head pose + iris position inside the eye) follows LookHop's
 * tracker; LookHop only classifies "laptop vs monitor", Foveo needs x,y, so the
 * features here feed a ridge regression trained from calibration clicks.
 *
 * Features (7): yaw, pitch (deg), iris_h, iris_v (eye-relative ratios),
 *               face_cx, face_cy (nose position in the camera frame, 0..1),
 *               face_scale (inter-eye distance in the frame, ~distance to camera).
 */
(function (root) {
  const EYE_R = [33, 133, 468];   // outer corner, inner corner, iris centre
  const EYE_L = [362, 263, 473];  // inner corner, outer corner, iris centre
  const NOSE = 1;
  const FEATURE_COUNT = 7;

  function eyeRatio(pts, eye, w, h) {
    const a = pts[eye[0]], b = pts[eye[1]], iris = pts[eye[2]];
    // work in pixels so the eye-axis normal is truly perpendicular
    const ax = a.x * w, ay = a.y * h, bx = b.x * w, by = b.y * h;
    const ix = iris.x * w, iy = iris.y * h;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return [0.5, 0];
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    return [((ix - ax) * ux + (iy - ay) * uy) / len, ((ix - mx) * nx + (iy - my) * ny) / len];
  }

  // 4x4 face transform, column-major (MediaPipe JS Matrix.data). Sign or
  // transposition mistakes are harmless: the regression learns the sign.
  function headAngles(data) {
    const m = (r, c) => data[c * 4 + r];
    const col = [0, 1, 2].map((c) => Math.hypot(m(0, c), m(1, c), m(2, c)) || 1);
    const R = (r, c) => m(r, c) / col[c];
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    const yaw = Math.asin(clamp(-R(2, 0))) * 180 / Math.PI;
    let pitch = Math.atan2(R(2, 1), R(2, 2)) * 180 / Math.PI;
    if (pitch > 90) pitch -= 180; else if (pitch < -90) pitch += 180;
    return [yaw, pitch];
  }

  /** landmarks: 478 {x,y,z} (0..1); matrix: 16-number array/Float32Array or null. */
  function extractFeatures(landmarks, matrix, w, h) {
    if (!landmarks || landmarks.length < 478) return null;
    const [h1, v1] = eyeRatio(landmarks, EYE_R, w, h);
    const [h2, v2] = eyeRatio(landmarks, EYE_L, w, h);
    const [yaw, pitch] = matrix ? headAngles(matrix) : [0, 0];
    const nose = landmarks[NOSE];
    const scale = Math.hypot((landmarks[33].x - landmarks[263].x) * w, (landmarks[33].y - landmarks[263].y) * h) / w;
    return [yaw, pitch, (h1 + h2) / 2, (v1 + v2) / 2, nose.x, nose.y, scale];
  }

  // ---- ridge regression ----------------------------------------------------

  function solve(A, b) {           // Gaussian elimination with partial pivoting
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
      [M[i], M[p]] = [M[p], M[i]];
      if (Math.abs(M[i][i]) < 1e-12) M[i][i] = 1e-12;
      for (let r = i + 1; r < n; r++) {
        const f = M[r][i] / M[i][i];
        for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = M[i][n];
      for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c];
      x[i] = s / M[i][i];
    }
    return x;
  }

  class RidgeGaze {
    constructor(lambda = 1.0) { this.lambda = lambda; this.X = []; this.Y = []; this.model = null; }

    add(features, x, y) { this.X.push(features.slice()); this.Y.push([x, y]); }

    get size() { return this.X.length; }

    fit() {
      const n = this.X.length, d = FEATURE_COUNT;
      if (n < d + 3) { this.model = null; return false; }
      const mu = new Array(d).fill(0), sd = new Array(d).fill(0);
      for (const f of this.X) for (let j = 0; j < d; j++) mu[j] += f[j] / n;
      for (const f of this.X) for (let j = 0; j < d; j++) sd[j] += (f[j] - mu[j]) ** 2 / n;
      for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
      const Z = this.X.map((f) => [...f.map((v, j) => (v - mu[j]) / sd[j]), 1]);
      const D = d + 1;
      const A = Array.from({ length: D }, () => new Array(D).fill(0));
      const bx = new Array(D).fill(0), by = new Array(D).fill(0);
      for (let i = 0; i < n; i++) {
        for (let r = 0; r < D; r++) {
          bx[r] += Z[i][r] * this.Y[i][0];
          by[r] += Z[i][r] * this.Y[i][1];
          for (let c = 0; c < D; c++) A[r][c] += Z[i][r] * Z[i][c];
        }
      }
      for (let r = 0; r < d; r++) A[r][r] += this.lambda;   // bias unregularised
      this.model = { mu, sd, wx: solve(A, bx), wy: solve(A, by) };
      return true;
    }

    predict(features) {
      const m = this.model;
      if (!m) return null;
      let px = m.wx[FEATURE_COUNT], py = m.wy[FEATURE_COUNT];
      for (let j = 0; j < FEATURE_COUNT; j++) {
        const z = (features[j] - m.mu[j]) / m.sd[j];
        px += m.wx[j] * z; py += m.wy[j] * z;
      }
      return { x: px, y: py };
    }

    toJSON() { return { lambda: this.lambda, X: this.X, Y: this.Y }; }

    static fromJSON(o) {
      const r = new RidgeGaze(o.lambda);
      r.X = o.X || []; r.Y = o.Y || [];
      r.fit();
      return r;
    }
  }

  const api = { extractFeatures, headAngles, eyeRatio, RidgeGaze, FEATURE_COUNT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FoveoGazeModel = api;
})(typeof self !== 'undefined' ? self : this);
