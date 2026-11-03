import { readFileSync } from 'node:fs';
import { BLENDSHAPE_NAMES } from '../../js/facs.js';

// Blendshape "a riposo" (mediane dei volti neutri misurate sul dataset di
// taratura) + eventuali valori modificati.
export function blendshapes(overrides = {}) {
  const b = {};
  for (const n of BLENDSHAPE_NAMES) b[n] = 0.003;
  b.eyeBlinkLeft = b.eyeBlinkRight = 0.1;
  b.eyeSquintLeft = b.eyeSquintRight = 0.37;
  b.browDownLeft = b.browDownRight = 0.1;
  b.browInnerUp = 0.01;
  b.mouthPressLeft = b.mouthPressRight = 0.03;
  b.mouthRollUpper = 0.035;
  b.mouthRollLower = 0.02;
  b.jawOpen = 0.03;
  return { ...b, ...overrides };
}

export const restGeom = (overrides = {}) => ({
  interOcular: 120, faceScale: 0.19, lipGapRatio: 0.005, lipThickness: 0.2,
  mouthWidthRatio: 0.6, ear: 0.3, center: { x: 0.5, y: 0.5 }, ...overrides,
});

// Risultato finto di FaceLandmarker (struttura identica a quella reale).
export function fakeResult(b, { matrix = identity(), landmarks = fakeLandmarks() } = {}) {
  return {
    faceLandmarks: [landmarks],
    faceBlendshapes: [{ categories: Object.entries(b).map(([categoryName, score], index) => ({ categoryName, score, index })) }],
    facialTransformationMatrixes: [{ rows: 4, columns: 4, data: matrix }],
  };
}

export function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -60, 1];
}

// 478 landmark realistici: "viso medio" neutro (mediana di ~1.200 volti
// allineati, generato da tools/model/shape_stats.mjs; non è una persona reale).
const AVERAGE_FACE = JSON.parse(readFileSync(new URL('./fixtures/average-face.json', import.meta.url), 'utf8'));
export function fakeLandmarks() {
  return AVERAGE_FACE.map(([x, y, z]) => ({ x, y, z }));
}

export function rotation(axis, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  // Matrici row-major, poi convertite in column-major come MediaPipe.
  const R = {
    x: [[1, 0, 0], [0, c, -s], [0, s, c]],
    y: [[c, 0, s], [0, 1, 0], [-s, 0, c]],
    z: [[c, -s, 0], [s, c, 0], [0, 0, 1]],
  }[axis];
  const m = new Array(16).fill(0);
  for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) m[col * 4 + r] = R[r][col];
  m[15] = 1;
  return m;
}
