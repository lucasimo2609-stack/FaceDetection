// Converte le feature estratte in matrice per train.py, usando lo STESSO codice
// dell'app (features.js, facs.js, emotions.js).
// Uso: node tools/model/export_matrix.mjs features.json matrix.json
import fs from 'node:fs';
import { featureVector, FEATURE_NAMES } from '../../js/features.js';
import { FacsEncoder } from '../../js/facs.js';
import { scoreEmotions, emotionProbabilities, EMOTION_IDS } from '../../js/emotions.js';

const LABELS = { happiness: 'joy' };
const [,, inPath, outPath] = process.argv;
const data = JSON.parse(fs.readFileSync(inPath, 'utf8')).filter((d) => d.face);
const enc = new FacsEncoder();
const X = [], y = [], R = [], ids = [];
for (const d of data) {
  X.push(featureVector(d.b, d.geom));
  y.push(EMOTION_IDS.indexOf(LABELS[d.label] || d.label));
  const p = emotionProbabilities(scoreEmotions(enc.encode(d.b, d.geom)));
  R.push(EMOTION_IDS.map((e) => p[e]));
  ids.push(d.img.split('/').pop());
}
fs.writeFileSync(outPath, JSON.stringify({ features: FEATURE_NAMES, classes: EMOTION_IDS, X, y, R, ids }));
console.log('esportati', X.length, 'campioni ×', FEATURE_NAMES.length, 'feature');
