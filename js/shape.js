// Geometria della forma del volto: curvatura e inclinazione delle
// sopracciglia, apertura e curvatura delle palpebre, ali del naso, angoli e
// curvatura delle labbra.
//
// I punti 3D di MediaPipe vengono riportati in un sistema di riferimento
// solidale al viso, costruito su punti rigidi (angoli esterni degli occhi e
// dorso del naso): così rotazione, inclinazione e distanza dalla camera non
// alterano le misure. Tutte le lunghezze sono in unità di distanza fra gli
// angoli esterni degli occhi (IOD).

import { poseFromLandmarks } from './headpose.js';
import { SHAPE_DATA } from './shape-data.js';

// Indici MediaPipe Face Mesh (lato "R" = destro della persona = sinistra
// dell'immagine non specchiata).
const IDX = {
  R: {
    eyeOuter: 33, eyeInner: 133, eyeTop: 159, eyeBottom: 145,
    upperLid: [33, 246, 161, 160, 159, 158, 157, 173, 133],
    lowerLid: [33, 7, 163, 144, 145, 153, 154, 155, 133],
    browUpper: [70, 63, 105, 66, 107], // dall'esterno all'interno
    browLower: [46, 53, 52, 65, 55],
    noseWing: 98,
    mouthCorner: 61,
  },
  L: {
    eyeOuter: 263, eyeInner: 362, eyeTop: 386, eyeBottom: 374,
    upperLid: [263, 466, 388, 387, 386, 385, 384, 398, 362],
    lowerLid: [263, 249, 390, 373, 374, 380, 381, 382, 362],
    browUpper: [300, 293, 334, 296, 336],
    browLower: [276, 283, 282, 295, 285],
    noseWing: 327,
    mouthCorner: 291,
  },
};
const NOSE_BRIDGE = 168, SUBNASALE = 2, NOSE_TIP = 1;
const LIP_UPPER_TOP = 0, LIP_UPPER_IN = 13, LIP_LOWER_IN = 14, LIP_LOWER_BOTTOM = 17, CHIN = 152;
const UPPER_LIP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291];
const LOWER_LIP = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];

export const SHAPE_NAMES = [
  'browInner', 'browMid', 'browOuter', 'browSlope', 'browArch', 'browGap',
  'eyeOpen', 'upperLid', 'lowerLid', 'upperLidCurve', 'lowerLidCurve',
  'noseWing', 'philtrum',
  'mouthWidth', 'mouthOpen', 'mouthCorners', 'upperLipCurve', 'lowerLipCurve', 'lipThickness', 'chin',
  'browInnerAsym', 'browOuterAsym', 'eyeOpenAsym', 'mouthCornerAsym',
];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Coefficiente quadratico "a" di v = a·t² + b·t + c (minimi quadrati),
// con t normalizzato in [-1, 1] sull'estensione dei punti.
export function quadCurvature(ts, vs) {
  const tmin = Math.min(...ts), tmax = Math.max(...ts);
  const half = (tmax - tmin) / 2 || 1, mid = (tmax + tmin) / 2;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, y0 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < ts.length; i++) {
    const t = (ts[i] - mid) / half, t2 = t * t, v = vs[i];
    s0 += 1; s1 += t; s2 += t2; s3 += t2 * t; s4 += t2 * t2;
    y0 += v; y1 += t * v; y2 += t2 * v;
  }
  // Risolve il sistema normale 3x3 con la regola di Cramer.
  const M = [[s4, s3, s2], [s3, s2, s1], [s2, s1, s0]];
  const Y = [y2, y1, y0];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  if (Math.abs(D) < 1e-12) return 0;
  const Ma = M.map((row, r) => [Y[r], row[1], row[2]]);
  return det(Ma) / D;
}

// Riferimento solidale al viso: u verso la sinistra della persona, v verso
// l'alto, in unità IOD, origine fra gli angoli esterni degli occhi.
export function faceFrame(landmarks, width, height) {
  const P = (i) => [landmarks[i].x * width, landmarks[i].y * height, landmarks[i].z * width];
  const R = P(IDX.R.eyeOuter), L = P(IDX.L.eyeOuter);
  const iod = Math.hypot(...sub(L, R)) || 1;
  const O = [(R[0] + L[0]) / 2, (R[1] + L[1]) / 2, (R[2] + L[2]) / 2];
  const ex = norm(sub(L, R));
  // Asse verticale dal dorso del naso (rigido): sub-nasale → radice del naso.
  const upRaw = sub(P(NOSE_BRIDGE), P(SUBNASALE));
  const ey = norm(sub(upRaw, ex.map((c) => c * dot(upRaw, ex))));
  const cache = new Map();
  return (i) => {
    let r = cache.get(i);
    if (!r) {
      const d = sub(P(i), O);
      r = [dot(d, ex) / iod, dot(d, ey) / iod];
      cache.set(i, r);
    }
    return r;
  };
}

// Contorni (sopracciglia, occhi, labbra) nel riferimento del viso: servono a
// disegnarne la forma indipendentemente da posizione e rotazione della testa.
export const CONTOURS = {
  browR: [...IDX.R.browUpper, ...[...IDX.R.browLower].reverse()],
  browL: [...IDX.L.browUpper, ...[...IDX.L.browLower].reverse()],
  eyeR: [...IDX.R.upperLid, ...[...IDX.R.lowerLid].reverse().slice(1, -1)],
  eyeL: [...IDX.L.upperLid, ...[...IDX.L.lowerLid].reverse().slice(1, -1)],
  lips: [...UPPER_LIP, ...[...LOWER_LIP].reverse().slice(1, -1)],
  // Contorno interno: mostra l'apertura della bocca.
  mouth: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95],
};
export function shapeContours(landmarks, width, height) {
  const uv = faceFrame(landmarks, width, height);
  return Object.fromEntries(Object.entries(CONTOURS).map(([k, idx]) => [k, idx.map((i) => uv(i))]));
}

// Misure "grezze" (senza compensare l'inclinazione della testa).
// landmarks: array di {x, y, z} normalizzati (output MediaPipe).
export function shapeFeaturesRaw(landmarks, width, height) {
  const uv = faceFrame(landmarks, width, height);
  const u = (i) => uv(i)[0];
  const v = (i) => uv(i)[1];
  const avgV = (a, b) => (v(a) + v(b)) / 2;

  const side = (s) => {
    const k = IDX[s];
    const eyeW = Math.abs(u(k.eyeOuter) - u(k.eyeInner)) || 1e-3;
    const v0 = (v(k.eyeOuter) + v(k.eyeInner)) / 2;
    const browLine = k.browUpper.map((iu, j) => [(u(iu) + u(k.browLower[j])) / 2, (v(iu) + v(k.browLower[j])) / 2]);
    const inner = avgV(k.browUpper[4], k.browLower[4]) - v(k.eyeInner);
    const outer = avgV(k.browUpper[0], k.browLower[0]) - v(k.eyeOuter);
    return {
      browInner: inner,
      browMid: avgV(k.browUpper[2], k.browLower[2]) - v(k.eyeTop),
      browOuter: outer,
      browSlope: inner - outer,
      // Positivo = sopracciglio ad arco (∩), negativo = piatto o a V.
      browArch: -quadCurvature(browLine.map((p) => p[0]), browLine.map((p) => p[1])),
      eyeOpen: (v(k.eyeTop) - v(k.eyeBottom)) / eyeW,
      upperLid: (v(k.eyeTop) - v0) / eyeW,
      lowerLid: (v0 - v(k.eyeBottom)) / eyeW,
      upperLidCurve: -quadCurvature(k.upperLid.map(u), k.upperLid.map((i) => (v(i) - v0) / eyeW)),
      lowerLidCurve: quadCurvature(k.lowerLid.map(u), k.lowerLid.map((i) => (v(i) - v0) / eyeW)),
      noseWing: v(k.eyeInner) - v(k.noseWing),
      corner: v(k.mouthCorner),
    };
  };
  const r = side('R'), l = side('L');
  const avg = (key) => (r[key] + l[key]) / 2;
  const mouthMid = (v(LIP_UPPER_IN) + v(LIP_LOWER_IN)) / 2;

  const f = {
    browInner: avg('browInner'),
    browMid: avg('browMid'),
    browOuter: avg('browOuter'),
    browSlope: avg('browSlope'),
    browArch: avg('browArch'),
    browGap: u(IDX.L.browLower[4]) - u(IDX.R.browLower[4]),
    eyeOpen: avg('eyeOpen'),
    upperLid: avg('upperLid'),
    lowerLid: avg('lowerLid'),
    upperLidCurve: avg('upperLidCurve'),
    lowerLidCurve: avg('lowerLidCurve'),
    noseWing: avg('noseWing'),
    philtrum: v(SUBNASALE) - v(LIP_UPPER_TOP),
    mouthWidth: u(IDX.L.mouthCorner) - u(IDX.R.mouthCorner),
    mouthOpen: v(LIP_UPPER_IN) - v(LIP_LOWER_IN),
    // Positivo = angoli della bocca sopra il centro delle labbra (sorriso).
    mouthCorners: (r.corner + l.corner) / 2 - mouthMid,
    upperLipCurve: -quadCurvature(UPPER_LIP.map(u), UPPER_LIP.map(v)),
    lowerLipCurve: quadCurvature(LOWER_LIP.map(u), LOWER_LIP.map(v)),
    lipThickness: (v(LIP_UPPER_TOP) - v(LIP_UPPER_IN)) + (v(LIP_LOWER_IN) - v(LIP_LOWER_BOTTOM)),
    chin: v(LIP_LOWER_BOTTOM) - v(CHIN),
    browInnerAsym: Math.abs(r.browInner - l.browInner),
    browOuterAsym: Math.abs(r.browOuter - l.browOuter),
    eyeOpenAsym: Math.abs(r.eyeOpen - l.eyeOpen),
    mouthCornerAsym: Math.abs(r.corner - l.corner),
  };
  void NOSE_TIP;
  return SHAPE_NAMES.map((n) => f[n]);
}

// Misure compensate per l'inclinazione su/giù della testa: guardando in basso
// o in alto le palpebre cambiano apparenza anche a viso neutro.
export function shapeFeatures(landmarks, width, height) {
  const raw = shapeFeaturesRaw(landmarks, width, height);
  const pitch = poseFromLandmarks(landmarks, width, height).pitch;
  const { pitchSlope, pitchRef } = SHAPE_DATA;
  return raw.map((v, j) => v - pitchSlope[j] * (pitch - pitchRef));
}

// Scarto dal neutro in unità di "espressione marcata" (circa -1..1).
// `baseline` = valori neutri della persona (calibrazione) o, se manca, la
// mediana dei volti neutri del dataset di taratura.
export function shapeDeltas(shape, baseline = null) {
  const ref = baseline || SHAPE_DATA.neutralMedian;
  const out = {};
  SHAPE_NAMES.forEach((n, j) => { out[n] = (shape[j] - ref[j]) / SHAPE_DATA.scale[j]; });
  return out;
}

// Senza calibrazione il riferimento è un viso "medio": ogni persona se ne
// discosta per anatomia di circa `spread` unità anche a viso neutro. Per non
// scambiare l'anatomia per un'espressione, si scarta quella parte.
export function shrinkDeltas(d, k = 1.5) {
  const out = {};
  SHAPE_NAMES.forEach((n, j) => {
    const m = k * (SHAPE_DATA.spread?.[j] ?? 0);
    const v = d[n];
    out[n] = Math.sign(v) * Math.max(0, Math.abs(v) - m);
  });
  return out;
}

export function shapeObject(arr) {
  return Object.fromEntries(SHAPE_NAMES.map((n, i) => [n, arr[i]]));
}
