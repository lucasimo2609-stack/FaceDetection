import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreStates, STATE_IDS } from '../../js/states.js';
import { AU_IDS } from '../../js/facs.js';

// Volto neutro, testa ferma e frontale, sguardo sullo schermo.
function scenario({ au = {}, f = {}, T = {}, blink = {}, pose = {} } = {}) {
  const A = Object.fromEntries(AU_IDS.map((k) => [k, 0]));
  Object.assign(A, au);
  const P = { yaw: 0, pitch: 0, roll: 0, ...pose };
  const F = { au: A, asym: { AU12: 0, AU14: 0, AU10: 0, brow: 0 }, smileSym: A.AU12, mouthSideways: 0, leanIn: 0, ...f };
  const emo = { neutral: 1, joy: 0, sadness: 0, surprise: 0, fear: 0, anger: 0, disgust: 0, contempt: 0 };
  const TT = {
    talking: 0, motionLevel: 0.15, motion: 6, gazeAwayFrac: 0, gazeShiftRate: 0.2, lookUpSideFrac: 0, lookDownFrac: 0,
    activity: 0.15, meanPose: { ...P }, headShake: 0, presence: 1, elapsed: 60000, yawns: 0, yawnAgo: Infinity,
    blink: { rate: 15, perclos: 0.01, longCount: 0, meanDur: 150, currentClosed: 0, ready: true, ...blink },
    ...T,
  };
  return scoreStates(F, emo, TT, P);
}

const CASES = {
  concentration: { au: { AU4: 0.35, AU7: 0.4 }, T: { motionLevel: 0.02, motion: 1 }, blink: { rate: 5 } },
  interest: { au: { AU1: 0.3, AU2: 0.3, AU5: 0.3 }, f: { leanIn: 0.8 }, pose: { roll: 9 } },
  confusion: { au: { AU4: 0.45, AU7: 0.3, AU14: 0.3 }, pose: { roll: 16 }, T: { gazeShiftRate: 0.8 } },
  skepticism: { au: { AU7: 0.3, AU24: 0.35 }, f: { asym: { AU12: 0, AU14: 0.35, AU10: 0, brow: 0.5 } } },
  boredom: { au: { AU43: 0.45 }, T: { activity: 0.01, gazeAwayFrac: 0.6, yawnAgo: 30000 }, pose: { pitch: -16 } },
  fatigue: { au: { AU43: 0.4 }, blink: { perclos: 0.22, longCount: 3, meanDur: 400 }, T: { yawns: 2, yawnAgo: 20000 } },
  anxiety: { au: { AU1: 0.4, AU4: 0.35, AU20: 0.35, AU24: 0.4 }, blink: { rate: 40 }, T: { motion: 45, motionLevel: 1, gazeShiftRate: 2 } },
  frustration: { au: { AU4: 0.45, AU24: 0.45, AU17: 0.45, AU14: 0.3 }, T: { headShake: 0.7 } },
  embarrassment: { au: { AU12: 0.35, AU24: 0.4 }, T: { lookDownFrac: 0.8 }, pose: { pitch: -16 } },
  politeSmile: { au: { AU12: 0.55 } },
  contemplation: { au: { AU17: 0.3 }, f: { mouthSideways: 0.4 }, T: { lookUpSideFrac: 0.9, motionLevel: 0.05 } },
  pride: { au: { AU12: 0.35 }, pose: { pitch: 20 } },
};

test('ogni stato ha uno scenario di test', () => {
  assert.deepEqual(Object.keys(CASES).sort(), [...STATE_IDS].sort());
});

for (const [id, sc] of Object.entries(CASES)) {
  test(`stato "${id}" raggiungibile e prevalente nel suo scenario`, () => {
    const s = scenario(sc);
    const ranked = Object.entries(s).sort((a, b) => b[1] - a[1]);
    assert.ok(s[id] >= 0.45, `${id}=${s[id].toFixed(2)} (${JSON.stringify(s)})`);
    assert.ok(ranked.slice(0, 2).some(([k]) => k === id), `${id} non tra i primi 2: ${JSON.stringify(ranked.slice(0, 3))}`);
  });
}

test('volto neutro: nessuno stato forte', () => {
  const s = scenario();
  for (const [k, v] of Object.entries(s)) assert.ok(v < 0.45, `${k}=${v.toFixed(2)}`);
});
