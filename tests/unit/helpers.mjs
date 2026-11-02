import { BLENDSHAPE_NAMES } from '../../js/facs.js';

// Blendshape "a riposo" + eventuali valori modificati.
export function blendshapes(overrides = {}) {
  const b = {};
  for (const n of BLENDSHAPE_NAMES) b[n] = 0.02;
  b.eyeBlinkLeft = b.eyeBlinkRight = 0.08;
  b.eyeSquintLeft = b.eyeSquintRight = 0.1;
  b.browInnerUp = 0.05;
  b.mouthShrugLower = 0.06;
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

// 478 landmark plausibili: occhi, bocca e naso nelle posizioni usate da geometry().
export function fakeLandmarks() {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const set = (i, x, y, z = 0) => { lm[i] = { x, y, z }; };
  set(33, 0.40, 0.42); set(133, 0.46, 0.42); set(159, 0.43, 0.41); set(145, 0.43, 0.43);
  set(263, 0.60, 0.42); set(362, 0.54, 0.42); set(386, 0.57, 0.41); set(374, 0.57, 0.43);
  set(1, 0.5, 0.5, -0.05); set(10, 0.5, 0.3); set(152, 0.5, 0.7);
  set(61, 0.45, 0.6); set(291, 0.55, 0.6); set(0, 0.5, 0.58); set(13, 0.5, 0.595);
  set(14, 0.5, 0.6); set(17, 0.5, 0.62);
  return lm;
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
