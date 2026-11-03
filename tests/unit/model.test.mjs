import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL } from '../../js/model-data.js';
import { predictGlobal, featureOffset, combineProbs, PersonalModel } from '../../js/model.js';
import { featureVector, personalVector, FEATURE_NAMES } from '../../js/features.js';
import { SHAPE_DATA } from '../../js/shape-data.js';
import { SHAPE_NAMES } from '../../js/shape.js';
import { Analyzer } from '../../js/analyzer.js';
import { EMOTION_IDS } from '../../js/emotions.js';
import { blendshapes, restGeom, fakeResult } from './helpers.mjs';

const top = (p) => Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];

// Rumore deterministico per simulare fotogrammi diversi.
function rng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 - 0.5; };
}

test('modello globale: coerente con le feature e con probabilità valide', () => {
  assert.equal(MODEL.features.length, FEATURE_NAMES.length);
  assert.equal(MODEL.coef.length, MODEL.classes.length);
  assert.ok(MODEL.scale.every((v) => v > 0), 'nessuna scala nulla');
  const p = predictGlobal(MODEL.neutralMedian);
  const sum = EMOTION_IDS.reduce((s, id) => s + p[id], 0);
  assert.ok(Math.abs(sum - 1) < 1e-3);
  for (const id of EMOTION_IDS) assert.ok(Number.isFinite(p[id]));
});

test('modello globale: viso neutro medio → neutralità, sorriso → gioia', () => {
  assert.equal(top(predictGlobal(MODEL.neutralMedian)), 'neutral');
  const smile = featureVector(blendshapes({ mouthSmileLeft: 0.85, mouthSmileRight: 0.85, eyeSquintLeft: 0.6, eyeSquintRight: 0.6, mouthLowerDownLeft: 0.3, mouthLowerDownRight: 0.3 }), restGeom({ lipGapRatio: 0.15, mouthWidthRatio: 0.75 }));
  assert.equal(top(predictGlobal(smile)), 'joy');
  const surprise = featureVector(blendshapes({ jawOpen: 0.45, browInnerUp: 0.5, browOuterUpLeft: 0.6, browOuterUpRight: 0.6, eyeSquintLeft: 0.15, eyeSquintRight: 0.15, mouthLowerDownLeft: 0.3, mouthLowerDownRight: 0.3 }), restGeom({ lipGapRatio: 0.4, ear: 0.4 }));
  assert.equal(top(predictGlobal(surprise)), 'surprise');
});

test('offset di calibrazione: un viso a riposo "atipico" torna neutro', () => {
  // Persona con sopracciglia alte e bocca socchiusa di natura.
  const rest = featureVector(blendshapes({ browInnerUp: 0.45, browOuterUpLeft: 0.5, browOuterUpRight: 0.5, jawOpen: 0.2 }), restGeom({ lipGapRatio: 0.2, ear: 0.38 }));
  const off = featureOffset([rest, rest, rest]);
  const corrected = rest.map((v, j) => v - off[j]);
  assert.equal(top(predictGlobal(corrected)), 'neutral');
});

test('combinazione di probabilità: media geometrica normalizzata', () => {
  const a = Object.fromEntries(EMOTION_IDS.map((id) => [id, id === 'joy' ? 0.9 : 0.1 / 7]));
  const b = Object.fromEntries(EMOTION_IDS.map((id) => [id, 1 / 8]));
  const c = combineProbs([{ probs: a, weight: 0.8 }, { probs: b, weight: 0.2 }]);
  assert.ok(Math.abs(EMOTION_IDS.reduce((s, id) => s + c[id], 0) - 1) < 1e-9);
  assert.equal(top(c), 'joy');
});

// Espressioni "personali" sintetiche: blendshape tipici di ciascuna emozione.
const PERSON = {
  neutral: {},
  joy: { mouthSmileLeft: 0.8, mouthSmileRight: 0.8, eyeSquintLeft: 0.65, eyeSquintRight: 0.65 },
  surprise: { browInnerUp: 0.6, browOuterUpLeft: 0.6, browOuterUpRight: 0.6, jawOpen: 0.45, eyeSquintLeft: 0.15, eyeSquintRight: 0.15 },
  sadness: { browInnerUp: 0.5, mouthFrownLeft: 0.2, mouthFrownRight: 0.2, mouthShrugLower: 0.3, eyeLookDownLeft: 0.3, eyeLookDownRight: 0.3 },
  anger: { browDownLeft: 0.7, browDownRight: 0.7, eyeSquintLeft: 0.6, eyeSquintRight: 0.6, mouthPressLeft: 0.3, mouthPressRight: 0.3 },
};
// Forma (in unità di "espressione marcata") tipica di ciascuna espressione.
const PERSON_SHAPE = {
  neutral: {},
  joy: { mouthCorners: 1.2, mouthWidth: 0.8, lowerLid: -0.8 },
  surprise: { browInner: 1, browOuter: 1, browArch: 0.6, eyeOpen: 0.8, mouthOpen: 1 },
  sadness: { browSlope: 1, browInner: 0.6, mouthCorners: -0.8, upperLid: -0.6 },
  anger: { browInner: -0.9, browSlope: -0.8, browGap: -0.8, lowerLid: -0.5 },
};
function frames(id, n, seed, scale = 1) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const over = {};
    for (const [k, v] of Object.entries(PERSON[id])) over[k] = 0.003 + (v - 0.003) * scale + r() * 0.04;
    const shape = SHAPE_NAMES.map((name, j) => SHAPE_DATA.neutralMedian[j] +
      SHAPE_DATA.scale[j] * ((PERSON_SHAPE[id][name] ?? 0) * scale + r() * 0.15));
    out.push(personalVector(blendshapes(over), restGeom(), shape));
  }
  return out;
}

test('modello personale: riconosce le espressioni registrate e ne stima l\'intensità', () => {
  const samples = {};
  Object.keys(PERSON).forEach((id, i) => { samples[id] = frames(id, 40, i + 1); });
  const pm = PersonalModel.train(samples);
  for (const id of Object.keys(PERSON)) {
    const x = frames(id, 1, 99)[0];
    const { probs } = pm.predict(x);
    assert.equal(top(probs), id, `${id}: ${JSON.stringify(probs)}`);
  }
  // Mezzo sorriso → intensità di gioia intermedia.
  const half = pm.predict(frames('joy', 1, 7, 0.5)[0]).intensity.joy;
  const full = pm.predict(frames('joy', 1, 8, 1)[0]).intensity.joy;
  assert.ok(half > 0.25 && half < 0.75, `half=${half}`);
  assert.ok(full > 0.8, `full=${full}`);
  // Serializzabile (salvato nel browser come solo numeri).
  const again = new PersonalModel(JSON.parse(JSON.stringify(pm.data)));
  assert.equal(top(again.predict(frames('anger', 1, 5)[0]).probs), 'anger');
  // Le emozioni non registrate ricevono la probabilità del modello globale.
  const full8 = pm.fullProbs(pm.predict(frames('joy', 1, 3)[0]).probs, predictGlobal(MODEL.neutralMedian));
  assert.ok(Math.abs(EMOTION_IDS.reduce((s, id) => s + full8[id], 0) - 1) < 1e-9);
});

test('modello personale: richiede almeno neutro + 2 espressioni', () => {
  assert.throws(() => PersonalModel.train({ joy: frames('joy', 20, 1), anger: frames('anger', 20, 2) }));
  assert.throws(() => PersonalModel.train({ neutral: frames('neutral', 20, 1), joy: frames('joy', 20, 2) }));
});

test('analyzer: cattura guidata, modello personale e probabilità finali', async () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const an = new Analyzer({ storage });
  let t = 0;
  const feed = (over) => an.update(fakeResult(blendshapes(over)), (t += 33), 640, 480);
  const samples = {};
  for (const id of Object.keys(PERSON)) {
    const p = an.capture(1000);
    for (let i = 0; i < 40; i++) feed(PERSON[id]);
    const got = await p;
    assert.ok(got.length >= 25, `${id}: ${got.length} campioni`);
    samples[id] = got.map((s) => s.x);
    if (id === 'neutral') an.calibrateFrom(got);
  }
  an.setPersonal(PersonalModel.train(samples));
  assert.ok(mem.has('facs-personal-v1'), 'modello personale salvato');
  for (const id of Object.keys(PERSON)) {
    let r;
    for (let i = 0; i < 45; i++) r = feed(PERSON[id]);
    assert.equal(r.dominant, id, `${id}: ${JSON.stringify(r.probs)}`);
    assert.ok(r.personal && r.sources.personal);
  }
  // Ricaricato da storage in una nuova sessione.
  const an2 = new Analyzer({ storage });
  assert.ok(an2.personal && an2.calibration?.featOffset);
});
