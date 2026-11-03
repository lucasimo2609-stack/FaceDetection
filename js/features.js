// Vettori di feature per i classificatori appresi. La stessa funzione è usata
// sia nell'app sia negli script di addestramento, così non possono divergere.
//  - featureVector: 51 blendshape grezzi, asimmetrie sinistra/destra e 4
//    misure geometriche (modello globale);
//  - personalVector: in più le 24 misure di forma di shape.js (curvatura e
//    inclinazione di sopracciglia, palpebre, labbra), usate dal modello
//    personale, dove il riferimento è il viso della persona stessa.

import { BLENDSHAPE_NAMES } from './facs.js';
import { SHAPE_NAMES } from './shape.js';
import { SHAPE_DATA } from './shape-data.js';

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
export const PERSONAL_FEATURE_NAMES = [...FEATURE_NAMES, ...SHAPE_NAMES.map((n) => `shape_${n}`)];
// Scala tipica di ogni misura di forma (per renderle confrontabili).
export const SHAPE_SCALE = SHAPE_DATA.scale;

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

// `shape` = output di shapeFeatures (forma di sopracciglia, occhi, bocca).
export function personalVector(b, geom, shape) {
  return [...featureVector(b, geom), ...shape];
}
