// Classificatori appresi:
//  - globale: regressione logistica addestrata su ~3.500 volti etichettati
//    (pesi in model-data.js, generati da tools/model/train.py);
//  - personale: centroidi delle espressioni della persona, registrati con
//    l'addestramento guidato nell'app (solo numeri, salvati nel browser).
// Entrambi lavorano sullo stesso vettore di feature (features.js).

import { MODEL } from './model-data.js';
import { FEATURE_NAMES } from './features.js';
import { EMOTION_IDS } from './emotions.js';
import { median } from './util.js';

if (MODEL.features.join() !== FEATURE_NAMES.join()) {
  throw new Error('model-data.js non corrisponde alle feature attuali: riaddestra il modello');
}

const D = FEATURE_NAMES.length;

// Probabilità delle 8 emozioni secondo il modello globale.
export function predictGlobal(x) {
  const z = new Array(D);
  for (let j = 0; j < D; j++) z[j] = (x[j] - MODEL.mean[j]) / MODEL.scale[j];
  const logits = MODEL.coef.map((w, k) => {
    let s = MODEL.intercept[k];
    for (let j = 0; j < D; j++) s += w[j] * z[j];
    return s;
  });
  const m = Math.max(...logits);
  const e = logits.map((v) => Math.exp(v - m));
  const sum = e.reduce((a, b) => a + b, 0);
  const out = {};
  for (const id of EMOTION_IDS) out[id] = 1e-4;
  MODEL.classes.forEach((c, k) => { out[c] = e[k] / sum; });
  return out;
}

// Differenza fra il viso a riposo di questa persona e il viso neutro medio
// del dataset: sottratta alle feature, rende la persona "neutra" per il modello.
export function featureOffset(vectors) {
  const off = new Array(D);
  for (let j = 0; j < D; j++) off[j] = median(vectors.map((v) => v[j])) - MODEL.neutralMedian[j];
  return off;
}

// Combina più distribuzioni di probabilità con una media geometrica pesata.
// `weight` può essere un numero o un oggetto {emozione: peso}.
export function combineProbs(parts) {
  const out = {};
  let sum = 0;
  for (const id of EMOTION_IDS) {
    let log = 0, wsum = 0;
    for (const { probs, weight } of parts) {
      const w = typeof weight === 'number' ? weight : (weight?.[id] ?? 0);
      if (!probs || w <= 0) continue;
      log += w * Math.log(Math.max(1e-6, probs[id]));
      wsum += w;
    }
    out[id] = Math.exp(log / (wsum || 1));
    sum += out[id];
  }
  for (const id of EMOTION_IDS) out[id] /= sum;
  return out;
}

// ---------------------------------------------------------------------------
// Modello personale: un centroide per ogni espressione registrata.
// Distanza pesata (peso alto alle feature che distinguono le espressioni di
// QUESTA persona), probabilità ∝ exp(-distanza / temperatura), intensità come
// proiezione dal centroide neutro verso quello dell'emozione.
// ---------------------------------------------------------------------------
export class PersonalModel {
  constructor(data) {
    this.data = data; // { version, created, centroids: {id: number[]}, counts, weights, temperature }
    this.ids = Object.keys(data.centroids);
  }

  static train(samplesByClass) {
    const ids = Object.keys(samplesByClass).filter((id) => samplesByClass[id].length >= 5);
    if (!ids.includes('neutral') || ids.length < 3) {
      throw new Error('Servono almeno l\'espressione neutra e altre due espressioni');
    }
    const std = (x) => x.map((v, j) => v / MODEL.scale[j]);
    const centroids = {}, counts = {};
    const within = new Array(D).fill(0);
    let nWithin = 0;
    for (const id of ids) {
      const zs = samplesByClass[id].map(std);
      const c = new Array(D).fill(0);
      for (const z of zs) for (let j = 0; j < D; j++) c[j] += z[j] / zs.length;
      for (const z of zs) for (let j = 0; j < D; j++) within[j] += (z[j] - c[j]) ** 2;
      nWithin += zs.length;
      centroids[id] = c;
      counts[id] = zs.length;
    }
    // Pesi di Fisher: varianza fra i centroidi / (varianza interna + rumore).
    const weights = new Array(D);
    for (let j = 0; j < D; j++) {
      const vals = ids.map((id) => centroids[id][j]);
      const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
      const between = vals.reduce((a, v) => a + (v - mu) ** 2, 0) / vals.length;
      weights[j] = Math.min(10, between / (within[j] / nWithin + 0.05));
    }
    const wsum = weights.reduce((a, b) => a + b, 0) || 1;
    for (let j = 0; j < D; j++) weights[j] /= wsum;
    // Temperatura: un quarto della distanza tipica fra due espressioni.
    const pair = [];
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) pair.push(dist2(centroids[ids[a]], centroids[ids[b]], weights));
    }
    const temperature = Math.max(1e-4, 0.25 * median(pair));
    return new PersonalModel({ version: 1, created: Date.now(), centroids, counts, weights, temperature });
  }

  predict(x) {
    const { centroids, weights, temperature } = this.data;
    const z = x.map((v, j) => v / MODEL.scale[j]);
    const d = {};
    let min = Infinity;
    for (const id of this.ids) { d[id] = dist2(z, centroids[id], weights); min = Math.min(min, d[id]); }
    const probs = {};
    let sum = 0;
    for (const id of this.ids) { probs[id] = Math.exp(-(d[id] - min) / temperature); sum += probs[id]; }
    for (const id of this.ids) probs[id] /= sum;
    // Intensità: quanto il viso si è spostato dal neutro verso ciascuna espressione.
    const n = centroids.neutral;
    const intensity = {};
    for (const id of this.ids) {
      if (id === 'neutral') continue;
      let num = 0, den = 0;
      for (let j = 0; j < z.length; j++) {
        const dir = centroids[id][j] - n[j];
        num += weights[j] * (z[j] - n[j]) * dir;
        den += weights[j] * dir * dir;
      }
      intensity[id] = den > 0 ? Math.max(0, Math.min(1, num / den)) : 0;
    }
    return { probs, intensity, trained: this.ids };
  }

  // Probabilità su tutte le 8 emozioni: per quelle non registrate si usa il
  // modello globale, riscalato sulla parte di probabilità che gli spetta.
  fullProbs(personal, globalProbs) {
    const out = {};
    const missing = EMOTION_IDS.filter((id) => !(id in personal));
    const missingMass = missing.reduce((s, id) => s + globalProbs[id], 0);
    for (const id of EMOTION_IDS) {
      out[id] = id in personal ? personal[id] * (1 - missingMass) : globalProbs[id];
    }
    return out;
  }
}

function dist2(a, b, w) {
  let s = 0;
  for (let j = 0; j < a.length; j++) s += w[j] * (a[j] - b[j]) ** 2;
  return s;
}
