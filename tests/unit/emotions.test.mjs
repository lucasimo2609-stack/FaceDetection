import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FacsEncoder } from '../../js/facs.js';
import { scoreEmotions, emotionProbabilities, detectBlend, MicroExpressionDetector } from '../../js/emotions.js';
import { blendshapes, restGeom } from './helpers.mjs';

const enc = new FacsEncoder();
const dominant = (b, geom = restGeom()) => {
  const scores = scoreEmotions(enc.encode(blendshapes(b), geom));
  const probs = emotionProbabilities(scores);
  const top = Object.entries(probs).sort((x, y) => y[1] - x[1])[0][0];
  return { top, scores, probs };
};

// Prototipi FACS (EMFACS) espressi in blendshape MediaPipe.
const PROTOTYPES = {
  neutral: [{}, restGeom()],
  joy: [{ mouthSmileLeft: 0.85, mouthSmileRight: 0.85, eyeSquintLeft: 0.72, eyeSquintRight: 0.68, mouthUpperUpLeft: 0.5, mouthUpperUpRight: 0.5, browDownLeft: 0.5, browDownRight: 0.5 }, restGeom({ lipGapRatio: 0.15 })],
  sadness: [{ browInnerUp: 0.6, browDownLeft: 0.3, browDownRight: 0.3, mouthFrownLeft: 0.3, mouthFrownRight: 0.3, mouthShrugLower: 0.35 }, restGeom()],
  surprise: [{ browInnerUp: 0.75, browOuterUpLeft: 0.65, browOuterUpRight: 0.65, eyeWideLeft: 0.45, eyeWideRight: 0.45, jawOpen: 0.55 }, restGeom({ lipGapRatio: 0.35, ear: 0.45 })],
  fear: [{ browInnerUp: 0.7, browOuterUpLeft: 0.4, browOuterUpRight: 0.4, browDownLeft: 0.35, browDownRight: 0.35, eyeWideLeft: 0.45, eyeWideRight: 0.45, mouthStretchLeft: 0.35, mouthStretchRight: 0.35, jawOpen: 0.2 }, restGeom({ lipGapRatio: 0.12, ear: 0.42 })],
  anger: [{ browDownLeft: 0.7, browDownRight: 0.7, eyeSquintLeft: 0.5, eyeSquintRight: 0.5, mouthPressLeft: 0.4, mouthPressRight: 0.4 }, restGeom()],
  disgust: [{ noseSneerLeft: 0.35, noseSneerRight: 0.35, mouthUpperUpLeft: 0.45, mouthUpperUpRight: 0.45, mouthFrownLeft: 0.15, mouthFrownRight: 0.15 }, restGeom()],
  contempt: [{ mouthSmileLeft: 0.4, mouthDimpleLeft: 0.3 }, restGeom()],
};

for (const [expected, [b, geom]] of Object.entries(PROTOTYPES)) {
  test(`prototipo FACS → ${expected}`, () => {
    const { top, probs } = dominant(b, geom);
    assert.equal(top, expected, `atteso ${expected}, ottenuto ${top} (${JSON.stringify(probs)})`);
  });
}

test('le probabilità sommano a 1 e sono finite', () => {
  for (const [b, geom] of Object.values(PROTOTYPES)) {
    const { probs } = dominant(b, geom);
    const sum = Object.values(probs).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
    for (const v of Object.values(probs)) assert.ok(Number.isFinite(v));
  }
});

test('sorriso ampio: niente rabbia/disgusto spuri (compensazione cross-talk)', () => {
  const { scores } = dominant(PROTOTYPES.joy[0], PROTOTYPES.joy[1]);
  assert.ok(scores.joy > 0.8);
  assert.ok(scores.anger < 0.2, `anger=${scores.anger}`);
  assert.ok(scores.disgust < 0.2, `disgust=${scores.disgust}`);
});

test('sorriso di Duchenne: AU6 attribuito allo strizzamento degli occhi', () => {
  const f = enc.encode(blendshapes(PROTOTYPES.joy[0]), PROTOTYPES.joy[1]);
  assert.ok(f.au.AU6 > 0.6);
  assert.ok(f.au.AU7 < 0.25);
  const polite = enc.encode(blendshapes({ mouthSmileLeft: 0.7, mouthSmileRight: 0.7 }), restGeom());
  assert.ok(polite.au.AU6 < 0.15);
});

test('sorpresa e gioia insieme → emozione composta "Meraviglia"', () => {
  const blend = detectBlend({ neutral: 0, joy: 0.7, surprise: 0.8, sadness: 0, fear: 0, anger: 0, disgust: 0, contempt: 0 });
  assert.equal(blend?.name, 'Meraviglia');
  assert.equal(detectBlend({ neutral: 0.9, joy: 0.1, surprise: 0, sadness: 0, fear: 0, anger: 0, disgust: 0, contempt: 0 }), null);
});

test('micro-espressione: picco breve rilevato, espressione lunga ignorata', () => {
  const det = new MicroExpressionDetector();
  const base = { joy: 0, sadness: 0, surprise: 0, fear: 0, anger: 0, disgust: 0, contempt: 0 };
  const events = [];
  let t = 0;
  const run = (ms, patch) => {
    for (let end = t + ms; t < end; t += 33) events.push(...det.update(t, { ...base, ...patch }));
  };
  run(600, {});
  run(200, { anger: 0.6 });   // 200 ms: micro
  run(600, {});
  run(1200, { fear: 0.7 });   // 1,2 s: macro
  run(600, {});
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'anger');
  assert.ok(events[0].duration <= 500);
});
