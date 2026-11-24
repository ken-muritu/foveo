const test = require('node:test');
const assert = require('node:assert');
const { RidgeGaze, extractFeatures, headAngles, FEATURE_COUNT } = require('../src/engine/gaze-model.js');

// deterministic noise
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;

// Synthetic ground truth: screen position is a (noisy) linear function of features.
function synth(n, noise) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = [rnd() * 30, rnd() * 20, rnd() * 0.3 + 0.5, rnd() * 0.2, rnd() * 0.3 + 0.5, rnd() * 0.3 + 0.5, rnd() * 0.05 + 0.2];
    const x = 960 + 40 * f[0] + 1800 * (f[2] - 0.5) + 300 * (f[4] - 0.5) + rnd() * noise;
    const y = 540 + 30 * f[1] + 1500 * f[3] + 200 * (f[5] - 0.5) + rnd() * noise;
    out.push({ f, x, y });
  }
  return out;
}

test('ridge recovers a linear mapping and generalises', () => {
  const m = new RidgeGaze(1.0);
  for (const s of synth(200, 4)) m.add(s.f, s.x, s.y);
  assert.ok(m.fit());
  const errs = synth(100, 0).map((s) => { const p = m.predict(s.f); return Math.hypot(p.x - s.x, p.y - s.y); });
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
  assert.ok(mean < 15, `mean error ${mean.toFixed(1)}px should be <15`);
});

test('too few samples -> no model, predict returns null', () => {
  const m = new RidgeGaze();
  for (const s of synth(FEATURE_COUNT + 2, 0)) m.add(s.f, s.x, s.y);
  assert.strictEqual(m.fit(), false);
  assert.strictEqual(m.predict([0, 0, 0, 0, 0, 0, 0]), null);
});

test('survives JSON round trip with identical predictions', () => {
  const m = new RidgeGaze(1.0);
  for (const s of synth(60, 3)) m.add(s.f, s.x, s.y);
  m.fit();
  const m2 = RidgeGaze.fromJSON(JSON.parse(JSON.stringify(m)));
  const f = synth(1, 0)[0].f;
  assert.deepStrictEqual(m2.predict(f), m.predict(f));
});

test('headAngles: identity matrix is facing the camera (0,0)', () => {
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const [yaw, pitch] = headAngles(I);
  assert.ok(Math.abs(yaw) < 1e-9 && Math.abs(pitch) < 1e-9);
});

test('extractFeatures: iris centred in the eye -> h≈0.5, v≈0', () => {
  const pts = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  pts[33] = { x: 0.40, y: 0.40, z: 0 }; pts[133] = { x: 0.46, y: 0.40, z: 0 }; pts[468] = { x: 0.43, y: 0.40, z: 0 };
  pts[362] = { x: 0.54, y: 0.40, z: 0 }; pts[263] = { x: 0.60, y: 0.40, z: 0 }; pts[473] = { x: 0.57, y: 0.40, z: 0 };
  const f = extractFeatures(pts, null, 640, 480);
  assert.strictEqual(f.length, FEATURE_COUNT);
  assert.ok(Math.abs(f[2] - 0.5) < 1e-6, `iris_h ${f[2]}`);
  assert.ok(Math.abs(f[3]) < 1e-6, `iris_v ${f[3]}`);
  assert.strictEqual(extractFeatures(pts.slice(0, 468), null, 640, 480), null);
});
