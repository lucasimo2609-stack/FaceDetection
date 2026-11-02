import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poseFromMatrix } from '../../js/headpose.js';
import { BlinkDetector } from '../../js/temporal.js';
import { Analyzer, flattenForExport } from '../../js/analyzer.js';
import { STATE_IDS, scoreStates } from '../../js/states.js';
import { softmax, median, mad, TimeBuffer } from '../../js/util.js';
import { blendshapes, fakeResult, rotation } from './helpers.mjs';

test('util: softmax, mediana, MAD, buffer temporale', () => {
  const p = softmax({ a: 1, b: 0, c: 0 });
  assert.ok(Math.abs(p.a + p.b + p.c - 1) < 1e-12 && p.a > p.b);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(mad([1, 1, 2, 2, 4, 6, 9]), 1);
  const tb = new TimeBuffer(1000);
  for (let t = 0; t <= 3000; t += 100) tb.push(t, t);
  assert.ok(tb.values(0).every((v) => v >= 2000));
});

test('posa della testa: convenzioni di yaw, pitch e roll', () => {
  const close = (a, b) => Math.abs(a - b) < 1e-6;
  // Rotazione attorno a Y positiva: naso verso la destra dell'immagine.
  assert.ok(close(poseFromMatrix(rotation('y', 20)).yaw, 20));
  // Rotazione attorno a X positiva: naso verso il basso → pitch negativo.
  assert.ok(close(poseFromMatrix(rotation('x', 15)).pitch, -15));
  // Rotazione antioraria attorno a Z: inclinazione verso sinistra dell'immagine → roll negativo.
  assert.ok(close(poseFromMatrix(rotation('z', 10)).roll, -10));
});

test('ammiccamenti: frequenza e PERCLOS', () => {
  const bd = new BlinkDetector();
  // 30 s a 30 fps, un ammiccamento da 150 ms ogni 3 s → 20/min.
  for (let t = 0; t <= 30000; t += 33) {
    const phase = t % 3000;
    bd.update(t, phase < 150 ? 0.95 : 0.05);
  }
  const s = bd.stats(30000);
  assert.ok(s.rate > 17 && s.rate < 23, `rate=${s.rate}`);
  assert.ok(s.perclos < 0.08);
  // Occhi socchiusi/chiusi per lunghi tratti → PERCLOS alto e chiusure lunghe.
  const tired = new BlinkDetector();
  for (let t = 0; t <= 60000; t += 33) tired.update(t, t % 4000 < 1500 ? 0.95 : 0.1);
  const ts = tired.stats(60000);
  assert.ok(ts.perclos > 0.3, `perclos=${ts.perclos}`);
  assert.ok(ts.longCount >= 10);
});

test('pipeline completa: numeri finiti, calibrazione, esportazione', async () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const an = new Analyzer({ storage });
  let t = 0;
  const step = (b, opts) => { t += 33; return an.update(fakeResult(b, opts), t, 640, 480); };

  // Calibrazione con un volto "a riposo" che ha sopracciglia alte di natura.
  const rest = blendshapes({ browInnerUp: 0.35, browOuterUpLeft: 0.3, browOuterUpRight: 0.3 });
  const cal = an.startCalibration(1000);
  for (let i = 0; i < 40; i++) step(rest);
  const c = await cal;
  assert.ok(c.blend.browInnerUp.median > 0.3);
  assert.ok(mem.has('facs-calibration-v1'), 'calibrazione salvata (solo numeri)');

  // Dopo la calibrazione lo stesso volto deve risultare neutro (non sorpreso).
  let r;
  for (let i = 0; i < 60; i++) r = step(rest);
  assert.equal(r.dominant, 'neutral');

  // Sorriso → gioia.
  for (let i = 0; i < 60; i++) r = step(blendshapes({ ...rest, mouthSmileLeft: 0.85, mouthSmileRight: 0.85, eyeSquintLeft: 0.6, eyeSquintRight: 0.6 }));
  assert.equal(r.dominant, 'joy');
  assert.ok(r.duchenne >= 0.5);

  // Testa inclinata indietro + piccolo sorriso → orgoglio sale.
  for (let i = 0; i < 90; i++) {
    r = step(blendshapes({ ...rest, mouthSmileLeft: 0.35, mouthSmileRight: 0.35 }), { matrix: rotation('x', -22) });
  }
  assert.ok(r.pose.pitch > 15);
  assert.ok(r.states.pride > 0.3, `pride=${r.states.pride}`);

  for (const v of [...Object.values(r.probs), ...Object.values(r.states), ...Object.values(r.au), r.valence, r.arousal, r.attention]) {
    assert.ok(Number.isFinite(v));
  }
  const row = flattenForExport(r, STATE_IDS);
  assert.equal(row.volto, 1);
  assert.ok('AU12' in row && 'emo_joy' in row && 'stato_pride' in row);
  assert.ok(!Object.values(row).some((v) => typeof v === 'object'), 'solo valori scalari');

  // Volto assente.
  const none = an.update({ faceLandmarks: [] }, t + 33, 640, 480);
  assert.equal(none.face, false);
});

test('stati: stanchezza con PERCLOS alto e sbadigli', () => {
  const au = Object.fromEntries(['AU1', 'AU2', 'AU4', 'AU5', 'AU6', 'AU7', 'AU9', 'AU10', 'AU12', 'AU14', 'AU15', 'AU16', 'AU17', 'AU18', 'AU20', 'AU22', 'AU23', 'AU24', 'AU25', 'AU26', 'AU27', 'AU28', 'AU34', 'AU43'].map((k) => [k, 0]));
  au.AU43 = 0.5;
  const f = { au, asym: { AU12: 0, AU14: 0, AU10: 0, brow: 0 }, smileSym: 0, mouthSideways: 0, leanIn: 0 };
  const emo = { neutral: 1, joy: 0, sadness: 0, surprise: 0, fear: 0, anger: 0, disgust: 0, contempt: 0 };
  const T = {
    talking: 0, motionLevel: 0.05, motion: 2, gazeAwayFrac: 0.3, gazeShiftRate: 0, lookUpSideFrac: 0, lookDownFrac: 0.2,
    activity: 0.02, meanPose: { yaw: 0, pitch: -8, roll: 4 }, headShake: 0, presence: 1, elapsed: 60000,
    yawns: 2, yawnAgo: 20000,
    blink: { rate: 8, perclos: 0.25, longCount: 3, meanDur: 420, currentClosed: 0, ready: true },
  };
  const s = scoreStates(f, emo, T, { yaw: 0, pitch: -8, roll: 4 });
  assert.ok(s.fatigue > 0.7, `fatigue=${s.fatigue}`);
  assert.ok(s.boredom > 0.4, `boredom=${s.boredom}`);
  assert.ok(s.anxiety < 0.2);
});
