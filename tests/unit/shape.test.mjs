import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeFeaturesRaw, shapeFeatures, shapeDeltas, shapeObject, quadCurvature, SHAPE_NAMES } from '../../js/shape.js';
import { FacsEncoder, buildCalibration } from '../../js/facs.js';
import { fakeLandmarks, blendshapes, restGeom } from './helpers.mjs';

const W = 640, H = 640;

// Ruota/scala/sposta i landmark in 3D attorno al centro del viso.
function transform(lm, { yaw = 0, pitch = 0, roll = 0, scale = 1, dx = 0, dy = 0 } = {}) {
  const r = (d) => (d * Math.PI) / 180;
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(r(yaw)), Math.sin(r(yaw)), Math.cos(r(pitch)), Math.sin(r(pitch)), Math.cos(r(roll)), Math.sin(r(roll))];
  return lm.map(({ x, y, z }) => {
    let X = (x - 0.5) * W, Y = (y - 0.5) * H, Z = z * W;
    [X, Z] = [X * cy + Z * sy, -X * sy + Z * cy];
    [Y, Z] = [Y * cp - Z * sp, Y * sp + Z * cp];
    [X, Y] = [X * cr - Y * sr, X * sr + Y * cr];
    return { x: 0.5 + dx + (X * scale) / W, y: 0.5 + dy + (Y * scale) / H, z: (Z * scale) / W };
  });
}

// Sposta verticalmente (in unità di distanza fra gli occhi) alcuni punti.
function moveUp(lm, indices, amount) {
  const iod = Math.hypot((lm[263].x - lm[33].x) * W, (lm[263].y - lm[33].y) * H);
  const out = lm.map((p) => ({ ...p }));
  indices.forEach((i, k) => {
    const a = Array.isArray(amount) ? amount[k] : amount;
    out[i].y -= (a * iod) / H;
  });
  return out;
}

const BROW_R_INNER = [107, 55], BROW_L_INNER = [336, 285];
const BROW_R_OUTER = [70, 46], BROW_L_OUTER = [300, 276];
const BROW_MID = [105, 52, 334, 282, 63, 53, 293, 283];

test('curvatura: parabola e retta', () => {
  assert.ok(Math.abs(quadCurvature([-1, 0, 1], [1, 0, 1]) - 1) < 1e-9);
  assert.ok(Math.abs(quadCurvature([0, 1, 2, 3], [0, 1, 2, 3])) < 1e-9);
});

test('forma invariante a rotazione, distanza e posizione della testa', () => {
  const base = shapeFeaturesRaw(fakeLandmarks(), W, H);
  for (const t of [{ roll: 15 }, { yaw: 20 }, { yaw: -15, roll: -10 }, { scale: 0.6, dx: 0.1, dy: -0.05 }]) {
    const f = shapeFeaturesRaw(transform(fakeLandmarks(), t), W, H);
    SHAPE_NAMES.forEach((n, j) => {
      assert.ok(Math.abs(f[j] - base[j]) < 0.01, `${n} cambia con ${JSON.stringify(t)}: ${base[j].toFixed(4)} → ${f[j].toFixed(4)}`);
    });
  }
});

test('sopracciglia: interno alzato → obliquo; interno abbassato → a V; centro alzato → arco', () => {
  const ref = shapeObject(shapeFeatures(fakeLandmarks(), W, H));
  const worried = shapeObject(shapeFeatures(moveUp(fakeLandmarks(), [...BROW_R_INNER, ...BROW_L_INNER], 0.06), W, H));
  assert.ok(worried.browInner > ref.browInner + 0.04);
  assert.ok(worried.browSlope > ref.browSlope + 0.04, 'obliquità');
  const angry = shapeObject(shapeFeatures(moveUp(fakeLandmarks(), [...BROW_R_INNER, ...BROW_L_INNER], -0.06), W, H));
  assert.ok(angry.browSlope < ref.browSlope - 0.04, 'a V');
  const arched = shapeObject(shapeFeatures(moveUp(fakeLandmarks(), BROW_MID, 0.04), W, H));
  assert.ok(arched.browArch > ref.browArch + 0.01, `arco ${ref.browArch} → ${arched.browArch}`);
  const outer = shapeObject(shapeFeatures(moveUp(fakeLandmarks(), [...BROW_R_OUTER, ...BROW_L_OUTER], 0.05), W, H));
  assert.ok(outer.browOuter > ref.browOuter + 0.03);
});

test('bocca: angoli in giù / in su e asimmetria', () => {
  const ref = shapeObject(shapeFeatures(fakeLandmarks(), W, H));
  const down = shapeObject(shapeFeatures(moveUp(fakeLandmarks(), [61, 291], -0.05), W, H));
  const up = shapeObject(shapeFeatures(moveUp(fakeLandmarks(), [61, 291], 0.05), W, H));
  const one = shapeObject(shapeFeatures(moveUp(fakeLandmarks(), [291], 0.06), W, H));
  assert.ok(down.mouthCorners < ref.mouthCorners - 0.03);
  assert.ok(up.mouthCorners > ref.mouthCorners + 0.03);
  assert.ok(one.mouthCornerAsym > ref.mouthCornerAsym + 0.04);
});

test('AU dalla geometria dopo la calibrazione: angoli in giù → AU15, interno su → AU1', () => {
  const enc = new FacsEncoder();
  const b = blendshapes();
  const lm0 = fakeLandmarks();
  const s0 = shapeFeatures(lm0, W, H);
  enc.setCalibration(buildCalibration(Array.from({ length: 20 }, () => ({ b, geom: restGeom(), pose: { yaw: 0, pitch: 0, roll: 0 }, shape: s0 }))));
  const neutral = enc.encode(b, restGeom(), s0);
  const sad = enc.encode(b, restGeom(), shapeFeatures(moveUp(moveUp(lm0, [61, 291], -0.06), [...BROW_R_INNER, ...BROW_L_INNER], 0.06), W, H));
  assert.ok(neutral.au.AU15 < 0.1 && neutral.au.AU1 < 0.1);
  assert.ok(sad.au.AU15 > 0.5, `AU15=${sad.au.AU15}`);
  assert.ok(sad.au.AU1 > 0.25, `AU1=${sad.au.AU1}`);
  // Scarti nulli rispetto al proprio neutro.
  const d = shapeDeltas(s0, enc.calibration.shape);
  assert.ok(Object.values(d).every((v) => Math.abs(v) < 1e-9));
});
