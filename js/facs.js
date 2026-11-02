// Codifica FACS (Facial Action Coding System, Ekman & Friesen) a partire dai
// 52 blendshape di MediaPipe Face Landmarker + alcune misure geometriche
// ricavate dai 478 landmark del viso.
//
// I blendshape di MediaPipe seguono la convenzione ARKit e corrispondono in
// buona parte, ma non 1:1, alle Action Unit FACS. Qui ogni AU viene stimata
// come combinazione dei blendshape normalizzati (0..1) rispetto a una linea di
// base (calibrazione con viso neutro) e a un valore massimo tipico.

import { clamp01, median, mad } from './util.js';

export const BLENDSHAPE_NAMES = [
  '_neutral', 'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft',
  'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight',
  'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
  'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight',
  'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft',
  'mouthFrownRight', 'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft',
  'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker',
  'mouthRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower',
  'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft',
  'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft',
  'noseSneerRight',
];

// [valore a riposo tipico, valore a massima espressione tipico].
// Ricavati da ~3.500 volti etichettati: mediana dei volti neutri e 97° percentile
// di tutti i volti. I blendshape di MediaPipe hanno dinamiche molto diverse:
// eyeWide non supera quasi mai 0,15, eyeSquint vale già ~0,36 su un viso
// neutro, mouthFrown arriva a ~0,25, mentre mouthSmile arriva a 0,9; noseSneer e
// cheekSquint restano quasi sempre a zero. Questi intervalli li riportano su
// una scala comune. Dopo la calibrazione il valore a riposo è quello misurato.
const DEFAULT_RANGE = {
  browDownLeft: [0.12, 0.72], browDownRight: [0.12, 0.72],
  browInnerUp: [0.03, 0.75],
  browOuterUpLeft: [0.03, 0.7], browOuterUpRight: [0.03, 0.7],
  cheekPuff: [0.01, 0.4],
  cheekSquintLeft: [0.0, 0.25], cheekSquintRight: [0.0, 0.25],
  eyeBlinkLeft: [0.1, 0.75], eyeBlinkRight: [0.1, 0.75],
  eyeSquintLeft: [0.36, 0.8], eyeSquintRight: [0.36, 0.8],
  eyeWideLeft: [0.02, 0.2], eyeWideRight: [0.02, 0.2],
  jawForward: [0.0, 0.1], jawLeft: [0.002, 0.2], jawRight: [0.002, 0.2],
  jawOpen: [0.03, 0.55],
  mouthClose: [0.003, 0.1],
  mouthDimpleLeft: [0.005, 0.12], mouthDimpleRight: [0.005, 0.12],
  mouthFrownLeft: [0.003, 0.25], mouthFrownRight: [0.003, 0.25],
  mouthFunnel: [0.002, 0.15],
  mouthLeft: [0.002, 0.2], mouthRight: [0.002, 0.2],
  mouthLowerDownLeft: [0.005, 0.75], mouthLowerDownRight: [0.005, 0.75],
  mouthPressLeft: [0.03, 0.35], mouthPressRight: [0.03, 0.35],
  mouthPucker: [0.01, 0.6],
  mouthRollLower: [0.02, 0.3], mouthRollUpper: [0.035, 0.3],
  mouthShrugLower: [0.005, 0.35], mouthShrugUpper: [0.006, 0.18],
  mouthSmileLeft: [0.002, 0.85], mouthSmileRight: [0.002, 0.85],
  mouthStretchLeft: [0.005, 0.5], mouthStretchRight: [0.005, 0.5],
  mouthUpperUpLeft: [0.001, 0.65], mouthUpperUpRight: [0.001, 0.65],
  noseSneerLeft: [0.0, 0.25], noseSneerRight: [0.0, 0.25],
};
const GAZE_NAMES = new Set([
  'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight',
  'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight',
]);

// Descrizione delle Action Unit stimate. `anchor` = landmark MediaPipe su cui
// mostrare l'etichetta nella sovrapposizione video.
export const AU_INFO = [
  { id: 'AU1', name: 'Sollevatore interno sopracciglio', en: 'Inner Brow Raiser', muscle: 'Frontale (parte mediale)', anchor: [107, 336] },
  { id: 'AU2', name: 'Sollevatore esterno sopracciglio', en: 'Outer Brow Raiser', muscle: 'Frontale (parte laterale)', anchor: [70, 300] },
  { id: 'AU4', name: 'Abbassatore sopracciglio', en: 'Brow Lowerer', muscle: 'Corrugatore, depressore del sopracciglio, procero', anchor: [9] },
  { id: 'AU5', name: 'Sollevatore palpebra superiore', en: 'Upper Lid Raiser', muscle: 'Elevatore della palpebra', anchor: [159, 386] },
  { id: 'AU6', name: 'Sollevatore guance', en: 'Cheek Raiser', muscle: 'Orbicolare dell\'occhio (parte orbitale)', anchor: [116, 345] },
  { id: 'AU7', name: 'Tensore palpebre', en: 'Lid Tightener', muscle: 'Orbicolare dell\'occhio (parte palpebrale)', anchor: [145, 374] },
  { id: 'AU9', name: 'Arricciatore naso', en: 'Nose Wrinkler', muscle: 'Elevatore del labbro sup. e dell\'ala del naso', anchor: [5] },
  { id: 'AU10', name: 'Sollevatore labbro superiore', en: 'Upper Lip Raiser', muscle: 'Elevatore del labbro superiore', anchor: [0] },
  { id: 'AU12', name: 'Stiratore angoli bocca (sorriso)', en: 'Lip Corner Puller', muscle: 'Grande zigomatico', anchor: [61, 291] },
  { id: 'AU14', name: 'Fossette', en: 'Dimpler', muscle: 'Buccinatore', anchor: [61, 291] },
  { id: 'AU15', name: 'Depressore angoli bocca', en: 'Lip Corner Depressor', muscle: 'Depressore dell\'angolo della bocca', anchor: [61, 291] },
  { id: 'AU16', name: 'Depressore labbro inferiore', en: 'Lower Lip Depressor', muscle: 'Depressore del labbro inferiore', anchor: [17] },
  { id: 'AU17', name: 'Sollevatore mento', en: 'Chin Raiser', muscle: 'Mentale', anchor: [199] },
  { id: 'AU18', name: 'Increspatore labbra', en: 'Lip Pucker', muscle: 'Incisivi del labbro', anchor: [0] },
  { id: 'AU20', name: 'Stiratore labbra', en: 'Lip Stretcher', muscle: 'Risorio, platisma', anchor: [61, 291] },
  { id: 'AU22', name: 'Imbutitore labbra', en: 'Lip Funneler', muscle: 'Orbicolare della bocca', anchor: [0] },
  { id: 'AU23', name: 'Tensore labbra', en: 'Lip Tightener', muscle: 'Orbicolare della bocca', anchor: [13] },
  { id: 'AU24', name: 'Compressore labbra', en: 'Lip Pressor', muscle: 'Orbicolare della bocca', anchor: [14] },
  { id: 'AU25', name: 'Labbra dischiuse', en: 'Lips Part', muscle: 'Depressore labbro / rilassamento mentale', anchor: [13] },
  { id: 'AU26', name: 'Caduta mandibola', en: 'Jaw Drop', muscle: 'Massetere rilassato', anchor: [152] },
  { id: 'AU27', name: 'Bocca spalancata', en: 'Mouth Stretch', muscle: 'Pterigoidei, digastrico', anchor: [152] },
  { id: 'AU28', name: 'Risucchio labbra', en: 'Lip Suck', muscle: 'Orbicolare della bocca', anchor: [17] },
  { id: 'AU34', name: 'Gonfiamento guance', en: 'Cheek Puff', muscle: '(descrittore AD34)', anchor: [207, 427] },
  { id: 'AU43', name: 'Chiusura occhi', en: 'Eyes Closed', muscle: 'Rilassamento elevatore palpebra', anchor: [159, 386] },
];
export const AU_IDS = AU_INFO.map((a) => a.id);

// Scala di intensità FACS A–E.
export function intensityLetter(v) {
  if (v < 0.1) return '';
  if (v < 0.25) return 'A';
  if (v < 0.45) return 'B';
  if (v < 0.65) return 'C';
  if (v < 0.85) return 'D';
  return 'E';
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const soft01 = (x, t) => clamp01(x / t);

// Misure geometriche (in pixel, poi rese adimensionali) dai landmark.
export function geometry(landmarks, width, height) {
  const P = (i) => ({ x: landmarks[i].x * width, y: landmarks[i].y * height, z: landmarks[i].z * width });
  const eyeOuterR = P(33), eyeOuterL = P(263);
  const interOcular = Math.max(1, dist(eyeOuterR, eyeOuterL));
  const mouthW = Math.max(1, dist(P(61), P(291)));
  const lipGap = dist(P(13), P(14));
  const upperLip = dist(P(0), P(13));
  const lowerLip = dist(P(14), P(17));
  // Apertura palpebrale (simile all'Eye Aspect Ratio).
  const earR = dist(P(159), P(145)) / Math.max(1, dist(P(33), P(133)));
  const earL = dist(P(386), P(374)) / Math.max(1, dist(P(362), P(263)));
  const nose = P(1);
  return {
    interOcular,
    faceScale: interOcular / Math.max(width, height), // per stimare l'avvicinamento allo schermo
    lipGapRatio: lipGap / mouthW,
    lipThickness: (upperLip + lowerLip) / interOcular,
    mouthWidthRatio: mouthW / interOcular,
    ear: (earR + earL) / 2,
    center: { x: nose.x / width, y: nose.y / height },
  };
}

// Direzione dello sguardo dai blendshape: x>0 = verso la propria sinistra
// (secondo la convenzione dei blendshape), y>0 = verso l'alto. Range ~ -1..1.
export function gazeFromBlendshapes(b) {
  const x = ((b.eyeLookOutLeft - b.eyeLookInLeft) + (b.eyeLookInRight - b.eyeLookOutRight)) / 2;
  const y = ((b.eyeLookUpLeft + b.eyeLookUpRight) - (b.eyeLookDownLeft + b.eyeLookDownRight)) / 2;
  return { x, y };
}

export function toBlendshapeMap(categories) {
  const out = {};
  for (const name of BLENDSHAPE_NAMES) out[name] = 0;
  if (!categories) return out;
  for (const c of categories) out[c.categoryName] = c.score;
  return out;
}

export class FacsEncoder {
  constructor() {
    this.calibration = null; // { blend: {name: {median, mad}}, geom: {...}, gaze: {x,y} }
  }

  setCalibration(cal) { this.calibration = cal; }

  // Normalizza un blendshape su 0..1 rispetto a riposo e massimo.
  norm(name, v) {
    const r = DEFAULT_RANGE[name] || [0.02, 0.8];
    const span = r[1] - r[0];
    let rest = r[0];
    let dz = Math.min(0.02, 0.08 * span);
    let max = r[1];
    const c = this.calibration?.blend?.[name];
    if (c) {
      rest = c.median;
      dz = Math.min(0.02, 0.08 * span) + 1.5 * c.mad;
      max = Math.max(r[1], rest + 0.6 * span);
    }
    return clamp01((v - rest - dz) / Math.max(0.03, max - rest - dz));
  }

  encode(b, geom) {
    const n = {};
    for (const name of BLENDSHAPE_NAMES) {
      if (name === '_neutral' || GAZE_NAMES.has(name)) continue;
      n[name] = this.norm(name, b[name] ?? 0);
    }
    const gazeRaw = gazeFromBlendshapes(b);
    const g0 = this.calibration?.gaze || { x: 0, y: 0 };
    const gaze = { x: gazeRaw.x - g0.x, y: gazeRaw.y - g0.y };
    const lookDown = Math.max(0, -gaze.y);

    const avg = (l, r) => (l + r) / 2;
    const side = {};
    const pair = (id, l, r) => { side[id] = { l, r }; return avg(l, r); };

    const smileAvg = avg(n.mouthSmileLeft, n.mouthSmileRight);
    // Compensazione del "cross-talk": in un sorriso ampio MediaPipe attiva
    // anche browDown, mouthUpperUp e mouthStretch (le guance sollevate
    // spingono sopracciglia e labbro). FACS non codifica AU4/AU10/AU20 in quel
    // caso, quindi ne sottraiamo la parte spiegata dal sorriso.
    const xs = (v, s, k) => clamp01(v - k * s);

    const au = {};
    au.AU1 = n.browInnerUp;
    au.AU2 = pair('AU2', n.browOuterUpLeft, n.browOuterUpRight);
    au.AU4 = pair('AU4', xs(n.browDownLeft, n.mouthSmileLeft, 0.75), xs(n.browDownRight, n.mouthSmileRight, 0.75));

    // AU5: eyeWide di MediaPipe è poco sensibile, quindi lo integriamo con
    // l'apertura palpebrale geometrica (compensando lo sguardo verso l'alto,
    // che solleva la palpebra senza essere AU5).
    const lookUp = Math.max(0, gaze.y);
    const ear0 = this.calibration?.geom?.ear;
    const earWide = ear0
      ? soft01((geom.ear / ear0) - 1.12 - 0.4 * lookUp, 0.3)
      : 0.8 * soft01(geom.ear - 0.38 - 0.15 * lookUp, 0.12);
    // Negli occhi spalancati MediaPipe abbassa eyeSquint sotto il valore a
    // riposo (molto più affidabile di eyeWide): lo usiamo come indizio di AU5.
    const squintDeficit = (side) => {
      const cal = this.calibration?.blend?.[`eyeSquint${side}`]?.median;
      const rest = cal ?? DEFAULT_RANGE[`eyeSquint${side}`][0];
      const margin = cal === undefined ? 0.1 : 0.05; // senza calibrazione serve più margine
      return soft01(rest - (b[`eyeSquint${side}`] ?? rest) - margin, 0.2) * (1 - n[`eyeBlink${side}`]);
    };
    // Senza calibrazione un solo occhio "aperto" non basta (asimmetrie
    // naturali): l'indizio deve comparire su entrambi gli occhi.
    let defL = squintDeficit('Left'), defR = squintDeficit('Right');
    if (!this.calibration) defL = defR = Math.min(defL, defR);
    au.AU5 = pair('AU5',
      Math.max(n.eyeWideLeft, earWide, 0.9 * defL),
      Math.max(n.eyeWideRight, earWide, 0.9 * defR));

    // AU6 (marcatore del sorriso di Duchenne) vs AU7 (tensore palpebre):
    // cheekSquint di MediaPipe è quasi sempre debole; quando c'è un sorriso lo
    // strizzamento degli occhi (eyeSquint) è dovuto al sollevamento delle
    // guance (AU6), altrimenti alla tensione palpebrale (AU7).
    const sideAU6 = (cheek, squint, smile) => {
      const g = soft01(smile, 0.45);
      return {
        au6: clamp01(Math.max(0.9 * cheek, squint * g)),
        au7: clamp01(squint * (1 - 0.85 * g) - 0.3 * cheek),
      };
    };
    const eL = sideAU6(n.cheekSquintLeft, n.eyeSquintLeft, n.mouthSmileLeft);
    const eR = sideAU6(n.cheekSquintRight, n.eyeSquintRight, n.mouthSmileRight);
    au.AU6 = pair('AU6', eL.au6, eR.au6);
    au.AU7 = pair('AU7', eL.au7, eR.au7);
    au.AU9 = pair('AU9', n.noseSneerLeft, n.noseSneerRight);
    au.AU10 = pair('AU10', xs(n.mouthUpperUpLeft, n.mouthSmileLeft, 0.8), xs(n.mouthUpperUpRight, n.mouthSmileRight, 0.8));
    au.AU12 = pair('AU12', n.mouthSmileLeft, n.mouthSmileRight);
    au.AU14 = pair('AU14', n.mouthDimpleLeft, n.mouthDimpleRight);
    au.AU15 = pair('AU15', n.mouthFrownLeft, n.mouthFrownRight);
    au.AU16 = pair('AU16', n.mouthLowerDownLeft, n.mouthLowerDownRight);
    au.AU17 = n.mouthShrugLower;
    au.AU18 = n.mouthPucker;
    au.AU20 = pair('AU20', xs(n.mouthStretchLeft, n.mouthSmileLeft, 0.35), xs(n.mouthStretchRight, n.mouthSmileRight, 0.35));
    au.AU22 = n.mouthFunnel;
    const press = avg(n.mouthPressLeft, n.mouthPressRight);
    const rollMax = Math.max(n.mouthRollUpper, n.mouthRollLower);
    // Assottigliamento del rosso labiale rispetto alla calibrazione.
    const thick0 = this.calibration?.geom?.lipThickness;
    const thinning = thick0 ? clamp01((thick0 - geom.lipThickness) / (0.35 * thick0)) : 0;
    au.AU23 = clamp01(0.45 * rollMax + 0.3 * press + 0.4 * thinning);
    au.AU24 = press;
    au.AU28 = clamp01(1.2 * Math.min(n.mouthRollUpper, n.mouthRollLower) + 0.3 * rollMax);

    // AU25 (labbra dischiuse) dalla geometria, AU26/27 dall'apertura mandibolare.
    const gap0 = this.calibration?.geom?.lipGapRatio ?? 0.01;
    au.AU25 = clamp01((geom.lipGapRatio - Math.max(0.03, gap0 + 0.02)) / 0.12);
    au.AU26 = clamp01(n.jawOpen * 1.5);
    au.AU27 = clamp01((n.jawOpen - 0.6) / 0.35);
    au.AU34 = n.cheekPuff;

    // Chiusura palpebrale, compensando l'abbassamento delle palpebre quando
    // lo sguardo va verso il basso (non è un ammiccamento).
    const closeL = clamp01(n.eyeBlinkLeft - 0.6 * lookDown);
    const closeR = clamp01(n.eyeBlinkRight - 0.6 * lookDown);
    au.AU43 = pair('AU43', closeL, closeR);

    // Asimmetrie (contano per disprezzo, scetticismo).
    const asym = {
      AU12: Math.abs(side.AU12.l - side.AU12.r),
      AU14: Math.abs(side.AU14.l - side.AU14.r),
      AU10: Math.abs(side.AU10.l - side.AU10.r),
      brow: Math.abs(side.AU2.l - side.AU2.r) + 0.5 * Math.abs(side.AU4.l - side.AU4.r),
    };
    // Componente simmetrica del sorriso.
    const smileSym = 0.7 * Math.min(side.AU12.l, side.AU12.r) + 0.3 * smileAvg;

    return {
      n,
      au,
      side,
      asym,
      smileSym,
      gaze,
      eyeClosure: Math.max(closeL, closeR) * 0.5 + avg(closeL, closeR) * 0.5,
      mouthSideways: Math.max(n.mouthLeft, n.mouthRight, 0.7 * Math.max(n.jawLeft, n.jawRight)),
      jaw: n.jawOpen,
    };
  }
}

// Calcola la calibrazione dai campioni raccolti con viso neutro.
export function buildCalibration(samples) {
  const blend = {};
  for (const name of BLENDSHAPE_NAMES) {
    if (name === '_neutral' || GAZE_NAMES.has(name)) continue;
    const vals = samples.map((s) => s.b[name] ?? 0);
    blend[name] = { median: median(vals), mad: mad(vals) };
  }
  const gx = samples.map((s) => gazeFromBlendshapes(s.b).x);
  const gy = samples.map((s) => gazeFromBlendshapes(s.b).y);
  return {
    version: 1,
    created: Date.now(),
    blend,
    gaze: { x: median(gx), y: median(gy) },
    geom: {
      lipGapRatio: median(samples.map((s) => s.geom.lipGapRatio)),
      lipThickness: median(samples.map((s) => s.geom.lipThickness)),
      ear: median(samples.map((s) => s.geom.ear)),
      faceScale: median(samples.map((s) => s.geom.faceScale)),
    },
    pose: {
      yaw: median(samples.map((s) => s.pose.yaw)),
      pitch: median(samples.map((s) => s.pose.pitch)),
      roll: median(samples.map((s) => s.pose.roll)),
    },
  };
}
