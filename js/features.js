// Vettore di feature per il classificatore appreso: 51 blendshape grezzi,
// asimmetrie sinistra/destra e 4 misure geometriche. La stessa funzione è
// usata sia nell'app sia nello script di addestramento, così non possono
// divergere.

import { BLENDSHAPE_NAMES } from './facs.js';

const BS = BLENDSHAPE_NAMES.filter((n) => n !== '_neutral');
const PAIRS = [
  'browDown', 'browOuterUp', 'cheekSquint', 'eyeBlink', 'eyeSquint', 'eyeWide',
  'mouthDimple', 'mouthFrown', 'mouthLowerDown', 'mouthPress', 'mouthSmile',
  'mouthStretch', 'mouthUpperUp', 'noseSneer',
];

export const FEATURE_NAMES = [
  ...BS,
  ...PAIRS.map((p) => `asym_${p}`),
  'geom_ear', 'geom_lipGap', 'geom_mouthWidth', 'geom_lipThickness',
];

// `offset` (facoltativo): differenza tra il viso a riposo di questa persona e
// il viso neutro medio, misurata con la calibrazione. Sottrarla rende la
// persona "neutra" per il modello anche se ha, ad es., sopracciglia alte.
export function featureVector(b, geom, offset = null) {
  const x = new Array(FEATURE_NAMES.length);
  let i = 0;
  for (const n of BS) x[i++] = b[n] ?? 0;
  for (const p of PAIRS) x[i++] = Math.abs((b[`${p}Left`] ?? 0) - (b[`${p}Right`] ?? 0));
  x[i++] = geom.ear;
  x[i++] = geom.lipGapRatio;
  x[i++] = geom.mouthWidthRatio;
  x[i++] = geom.lipThickness;
  if (offset) for (let k = 0; k < x.length; k++) x[k] -= offset[k] ?? 0;
  return x;
}
