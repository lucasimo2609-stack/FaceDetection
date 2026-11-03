// Calcola da volti etichettati (output di extract.mjs, con landmark):
//  - la dipendenza di ogni misura di forma dall'inclinazione della testa
//    (pendenza robusta, stimata sui volti neutri) per poterla compensare;
//  - il valore neutro di riferimento (mediana dei volti neutri, già corretto);
//  - la scala tipica di un'espressione marcata (90° percentile dello scarto
//    dal neutro sui volti espressivi).
// Scrive js/shape-data.js. Uso: node tools/model/shape_stats.mjs features_con_landmark.json
import fs from 'node:fs';
import { shapeFeaturesRaw, shapeContours, SHAPE_NAMES } from '../../js/shape.js';
import { poseFromLandmarks } from '../../js/headpose.js';

const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).filter((d) => d.face && d.lm);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
for (const d of data) {
  const lm = d.lm.map(([x, y, z]) => ({ x, y, z }));
  d.raw = shapeFeaturesRaw(lm, d.w, d.h);
  d.pitch = poseFromLandmarks(lm, d.w, d.h).pitch;
}
const neutral = data.filter((d) => d.label === 'neutral');
const expressive = data.filter((d) => d.label !== 'neutral');
const pitchRef = med(neutral.map((d) => d.pitch));

// Pendenza di Theil-Sen (campionata, seme fisso per riproducibilità).
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const slope = SHAPE_NAMES.map((_, j) => {
  const s = [];
  for (let k = 0; k < 20000; k++) {
    const a = neutral[(rnd() * neutral.length) | 0], b = neutral[(rnd() * neutral.length) | 0];
    if (Math.abs(a.pitch - b.pitch) > 3) s.push((a.raw[j] - b.raw[j]) / (a.pitch - b.pitch));
  }
  const m = med(s);
  return Math.abs(m) > 0.0004 ? m : 0; // trascura dipendenze irrilevanti
});
const corr = (d) => d.raw.map((v, j) => v - slope[j] * (d.pitch - pitchRef));
const neutralMedian = SHAPE_NAMES.map((_, j) => med(neutral.map((d) => corr(d)[j])));
const scale = SHAPE_NAMES.map((_, j) => Math.max(1e-3, q(expressive.map((d) => Math.abs(corr(d)[j] - neutralMedian[j])), 0.9)));
// Variabilità naturale fra persone a viso neutro (MAD robusta), in unità di
// "scala": misure molto legate all'anatomia (es. filtro labiale) hanno
// valori alti e, senza calibrazione, vanno usate con un margine.
const spread = SHAPE_NAMES.map((_, j) => {
  const vals = neutral.map((d) => corr(d)[j]);
  const m = med(vals);
  return (1.4826 * med(vals.map((v) => Math.abs(v - m)))) / scale[j];
});

// Contorni medi del viso neutro (riferimento disegnato nell'app finché la
// persona non si calibra).
const contours = {};
for (const d of neutral) {
  const c = shapeContours(d.lm.map(([x, y, z]) => ({ x, y, z })), d.w, d.h);
  for (const [k, pts] of Object.entries(c)) {
    contours[k] ||= pts.map(() => [[], []]);
    pts.forEach(([u, v], i) => { contours[k][i][0].push(u); contours[k][i][1].push(v); });
  }
}
const neutralContours = Object.fromEntries(Object.entries(contours).map(([k, pts]) => [k, pts.map(([us, vs]) => [+med(us).toFixed(4), +med(vs).toFixed(4)])]));

// "Viso medio" 3D (mediana dei volti neutri allineati) per i test automatici:
// non corrisponde a nessuna persona reale.
const tmpl = Array.from({ length: 478 }, () => [[], [], []]);
for (const d of neutral) {
  const P = (i) => [d.lm[i][0] * d.w, d.lm[i][1] * d.h, d.lm[i][2] * d.w];
  const R = P(33), L = P(263);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const nrm = (a) => { const l = Math.hypot(...a) || 1; return a.map((c) => c / l); };
  const iod = Math.hypot(...sub(L, R));
  const O = R.map((c, k) => (c + L[k]) / 2);
  const ex = nrm(sub(L, R));
  const up = sub(P(168), P(2));
  const ey = nrm(sub(up, ex.map((c) => c * dot(up, ex))));
  const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  for (let i = 0; i < 478; i++) {
    const q = sub(P(i), O);
    tmpl[i][0].push(dot(q, ex) / iod); tmpl[i][1].push(dot(q, ey) / iod); tmpl[i][2].push(dot(q, ez) / iod);
  }
}
const face = tmpl.map(([us, vs, ws]) => {
  const u = med(us), v = med(vs), w = med(ws);
  // Immagine quadrata, distanza fra gli occhi = 30% della larghezza.
  return [+(0.5 + 0.3 * u).toFixed(5), +(0.42 - 0.3 * v).toFixed(5), +(0.3 * w).toFixed(5)];
});
fs.mkdirSync(new URL('../../tests/unit/fixtures/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../../tests/unit/fixtures/average-face.json', import.meta.url), JSON.stringify(face));

const r5 = (a) => a.map((v) => +v.toFixed(5));
const out = `// Generato da tools/model/shape_stats.mjs — non modificare a mano.
// Misurato su ${data.length} volti etichettati (${neutral.length} neutri).
export const SHAPE_DATA = ${JSON.stringify({ names: SHAPE_NAMES, pitchRef: +pitchRef.toFixed(2), pitchSlope: r5(slope), neutralMedian: r5(neutralMedian), scale: r5(scale), spread: r5(spread), neutralContours })};
`;
fs.writeFileSync(new URL('../../js/shape-data.js', import.meta.url), out);
console.log('scritto js/shape-data.js');
SHAPE_NAMES.forEach((n, j) => console.log(n.padEnd(16), 'neutro', neutralMedian[j].toFixed(3), 'scala', scale[j].toFixed(3), 'variab.', spread[j].toFixed(2), slope[j] ? `pendenza/grado ${slope[j].toFixed(5)}` : ''));
