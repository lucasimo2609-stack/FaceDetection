// Pipeline di analisi: risultato MediaPipe → AU FACS → emozioni/stati.
// Non dipende dal DOM (testabile in Node): riceve solo numeri, non immagini.

import { FacsEncoder, toBlendshapeMap, geometry, buildCalibration, AU_IDS } from './facs.js';
import { headPose } from './headpose.js';
import { TemporalAnalyzer } from './temporal.js';
import {
  scoreEmotions, emotionProbabilities, detectBlend, valenceArousal,
  DominantTracker, MicroExpressionDetector, EMOTION_IDS,
} from './emotions.js';
import { scoreStates, attentionLevel } from './states.js';
import { featureVector } from './features.js';
import { predictGlobal, featureOffset, combineProbs, PersonalModel } from './model.js';
import { EmaVector, emaAlpha, clamp01, soft } from './util.js';

const CAL_KEY = 'facs-calibration-v1';
const PERSONAL_KEY = 'facs-personal-v1';

// Pesi della combinazione (media geometrica delle probabilità), per emozione.
// Il modello appreso è affidabile dove aveva molti dati puliti (neutralità,
// gioia, sorpresa); per le altre emozioni, poco rappresentate o con etichette
// rumorose, pesano di più le regole FACS. Scelti valutando sia foto "dal vivo"
// sia espressioni in posa (vedi tools/model/README.md).
export const GLOBAL_WEIGHT = {
  neutral: 0.7, joy: 0.7, surprise: 0.7,
  sadness: 0.2, fear: 0.2, anger: 0.2, disgust: 0.2, contempt: 0.2,
};
const RULE_WEIGHT = Object.fromEntries(Object.entries(GLOBAL_WEIGHT).map(([k, v]) => [k, 1 - v]));
// Con il modello personale questo vale metà; il resto si divide come sopra.
const PERSONAL_SHARE = 0.5;
const scaleW = (w, f) => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v * f]));

class ArrayEma {
  constructor() { this.value = null; }
  update(arr, dt, tau) {
    if (!this.value || this.value.length !== arr.length) { this.value = arr.slice(); return this.value; }
    const a = emaAlpha(dt, tau);
    for (let i = 0; i < arr.length; i++) this.value[i] += a * (arr[i] - this.value[i]);
    return this.value;
  }
}

export class Analyzer {
  constructor({ storage = null } = {}) {
    this.storage = storage;
    this.encoder = new FacsEncoder();
    this.temporal = new TemporalAnalyzer();
    this.dominant = new DominantTracker();
    this.micro = new MicroExpressionDetector();
    this.reactivity = 1; // moltiplicatore delle costanti di tempo (0.5 = più reattivo)
    this.resetFilters();
    this.lastT = null;
    this.calibration = null;
    this.calibrating = null;
    this.capturing = null;
    this.personal = null;
    this.loadCalibration();
    this.loadPersonal();
  }

  resetFilters() {
    this.auFast = new EmaVector(50);
    this.auSmooth = new EmaVector(140);
    this.emoSmooth = new EmaVector(250);
    this.stateSmooth = new EmaVector(1200);
    this.poseSmooth = new EmaVector(120);
    this.featSmooth = new ArrayEma();
    this.probSmooth = new EmaVector(250);
  }

  loadCalibration() {
    try {
      const raw = this.storage?.getItem(CAL_KEY);
      if (raw) this.applyCalibration(JSON.parse(raw), false);
    } catch { /* storage non disponibile */ }
  }

  applyCalibration(cal, persist = true) {
    this.calibration = cal;
    this.encoder.setCalibration(cal);
    if (persist) {
      try { this.storage?.setItem(CAL_KEY, JSON.stringify(cal)); } catch { /* ignora */ }
    }
  }

  clearCalibration() {
    this.calibration = null;
    this.encoder.setCalibration(null);
    try { this.storage?.removeItem(CAL_KEY); } catch { /* ignora */ }
  }

  // Costruisce la calibrazione (viso neutro) da campioni {b, geom, pose}.
  calibrateFrom(samples) {
    const cal = buildCalibration(samples);
    cal.featOffset = featureOffset(samples.map((s) => featureVector(s.b, s.geom)));
    this.applyCalibration(cal);
    this.temporal.reset();
    this.resetFilters();
    return cal;
  }

  // ---------- Modello personale ----------
  loadPersonal() {
    try {
      const raw = this.storage?.getItem(PERSONAL_KEY);
      if (raw) this.personal = new PersonalModel(JSON.parse(raw));
    } catch { this.personal = null; }
  }

  setPersonal(model, persist = true) {
    this.personal = model;
    if (persist) {
      try { this.storage?.setItem(PERSONAL_KEY, JSON.stringify(model.data)); } catch { /* ignora */ }
    }
  }

  clearPersonal() {
    this.personal = null;
    try { this.storage?.removeItem(PERSONAL_KEY); } catch { /* ignora */ }
  }

  // Registra per `durationMs` i fotogrammi con volto: {b, geom, pose, x}.
  // Usato dall'addestramento guidato (un'espressione alla volta).
  capture(durationMs = 2500) {
    return new Promise((resolve) => {
      this.capturing = { samples: [], start: null, durationMs, resolve };
    });
  }

  captureProgress(t) {
    const c = this.capturing;
    if (!c || c.start === null) return 0;
    return clamp01((t - c.start) / c.durationMs);
  }

  cancelCapture() {
    if (this.capturing) this.capturing.resolve(null);
    this.capturing = null;
  }

  feedCapture(t, sample) {
    const c = this.capturing;
    if (c.start === null) c.start = t;
    if (sample) c.samples.push(sample);
    if (t - c.start >= c.durationMs) {
      this.capturing = null;
      c.resolve(c.samples);
    }
  }

  // Avvia la raccolta di campioni con viso neutro. Restituisce una Promise
  // che si risolve con la calibrazione (o viene rifiutata se il volto manca).
  startCalibration(durationMs = 3000) {
    return new Promise((resolve, reject) => {
      this.calibrating = { samples: [], start: null, durationMs, resolve, reject, missing: 0 };
    });
  }

  cancelCalibration() {
    if (this.calibrating) this.calibrating.reject(new Error('annullata'));
    this.calibrating = null;
  }

  calibrationProgress(t) {
    const c = this.calibrating;
    if (!c || c.start === null) return 0;
    return clamp01((t - c.start) / c.durationMs);
  }

  feedCalibration(t, sample) {
    const c = this.calibrating;
    if (!c) return;
    if (c.start === null) c.start = t;
    if (sample) c.samples.push(sample);
    else c.missing++;
    if (t - c.start >= c.durationMs) {
      this.calibrating = null;
      if (c.samples.length < 10) {
        c.reject(new Error('Volto non rilevato a sufficienza durante la calibrazione'));
        return;
      }
      c.resolve(this.calibrateFrom(c.samples));
    }
  }

  // result: FaceLandmarkerResult; t: ms; width/height: dimensioni del frame.
  update(result, t, width, height) {
    const dt = this.lastT === null ? 33 : Math.max(1, Math.min(500, t - this.lastT));
    this.lastT = t;
    const k = this.reactivity;

    if (!result?.faceLandmarks?.length) {
      this.temporal.noFace(t);
      if (this.calibrating) this.feedCalibration(t, null);
      if (this.capturing) this.feedCapture(t, null);
      return { face: false, t };
    }

    const b = toBlendshapeMap(result.faceBlendshapes?.[0]?.categories);
    const lm = result.faceLandmarks[0];
    const geom = geometry(lm, width, height);
    const rawPose = headPose(result, width, height);

    const xRaw = featureVector(b, geom);
    if (this.calibrating) this.feedCalibration(t, { b, geom, pose: rawPose });
    if (this.capturing) this.feedCapture(t, { b, geom, pose: rawPose, x: xRaw });

    const p0 = this.calibration?.pose || { yaw: 0, pitch: 0, roll: 0 };
    const pose = this.poseSmooth.update({
      yaw: rawPose.yaw - p0.yaw,
      pitch: rawPose.pitch - p0.pitch,
      roll: rawPose.roll - p0.roll,
    }, dt);

    const facs = this.encoder.encode(b, geom);
    const scale0 = this.calibration?.geom?.faceScale;
    facs.leanIn = scale0 ? soft(geom.faceScale / scale0 - 1.06, 0.18) : 0;

    // Attività espressiva: energia media delle AU principali.
    const activity = (facs.au.AU1 + facs.au.AU2 + facs.au.AU4 + facs.au.AU6 + facs.au.AU9 +
      facs.au.AU12 + facs.au.AU15 + facs.au.AU20 + facs.au.AU24 + facs.au.AU26) / 10 * 2.5;

    const T = this.temporal.update(t, {
      closure: facs.eyeClosure,
      jaw: facs.jaw,
      eyesWide: facs.au.AU5,
      pose,
      gaze: facs.gaze,
      activity: clamp01(activity),
    });

    // Due livelli di filtraggio: veloce (micro-espressioni) e morbido (display).
    const fastAU = this.auFast.update(facs.au, dt, 50 * k);
    const smoothAU = this.auSmooth.update(facs.au, dt, 140 * k);
    const ctx = { talking: T.talking };
    const fastEmo = scoreEmotions({ ...facs, au: fastAU }, ctx);
    const ruleScores = scoreEmotions({ ...facs, au: smoothAU }, ctx);

    // Tre fonti: regole FACS, modello globale appreso, modello personale.
    const xs = this.featSmooth.update(xRaw, dt, 140 * k);
    const off = this.calibration?.featOffset;
    const pGlobal = predictGlobal(off ? xs.map((v, j) => v - off[j]) : xs);
    const pRules = emotionProbabilities(ruleScores);
    let pPersonal = null, personalIntensity = null;
    if (this.personal) {
      const pr = this.personal.predict(xs);
      pPersonal = this.personal.fullProbs(pr.probs, pGlobal);
      personalIntensity = pr.intensity;
    }
    const mixed = pPersonal
      ? combineProbs([
        { probs: pPersonal, weight: PERSONAL_SHARE },
        { probs: pGlobal, weight: scaleW(GLOBAL_WEIGHT, 1 - PERSONAL_SHARE) },
        { probs: pRules, weight: scaleW(RULE_WEIGHT, 1 - PERSONAL_SHARE) },
      ])
      : combineProbs([{ probs: pGlobal, weight: GLOBAL_WEIGHT }, { probs: pRules, weight: RULE_WEIGHT }]);
    const probs = this.probSmooth.update(mixed, dt, 250 * k);

    // Intensità (0..1) per barre, emozioni composte e stati: unisce la forza
    // delle AU (regole), la probabilità e, se c'è, quanto l'espressione si
    // avvicina a quella registrata dalla persona.
    const intensityRaw = { neutral: probs.neutral };
    for (const id of EMOTION_IDS) {
      if (id === 'neutral') continue;
      const pi = personalIntensity?.[id];
      intensityRaw[id] = pi === undefined
        ? clamp01(0.5 * ruleScores[id] + 0.5 * probs[id])
        : clamp01(0.3 * ruleScores[id] + 0.3 * probs[id] + 0.4 * pi * Math.sqrt(probs[id]));
    }
    const emotions = this.emoSmooth.update(intensityRaw, dt, 250 * k);
    const dominant = this.dominant.update(t, probs);
    const blend = detectBlend(emotions);

    const micro = this.micro.update(t, fastEmo, { suppress: T.talking > 0.6 || T.motion > 80 });

    const statesRaw = scoreStates({ ...facs, au: smoothAU }, emotions, T, pose);
    const states = this.stateSmooth.update(statesRaw, dt, 1200 * k);
    const va = valenceArousal(probs, states, T);
    const attention = attentionLevel(T, pose);

    const duchenne = smoothAU.AU12 > 0.3 ? clamp01(smoothAU.AU6 / 0.4) : null;

    return {
      face: true,
      t,
      landmarks: lm,
      blendshapes: b,
      au: smoothAU,
      auSide: facs.side,
      asym: facs.asym,
      pose,
      gaze: facs.gaze,
      geom,
      emotions,
      probs,
      sources: { rules: pRules, global: pGlobal, personal: pPersonal },
      dominant,
      blend,
      micro,
      states,
      valence: va.valence,
      arousal: va.arousal,
      attention,
      duchenne,
      temporal: T,
      calibrated: Boolean(this.calibration),
      personal: Boolean(this.personal),
    };
  }
}

// Rende piatto un risultato per l'esportazione (solo numeri, nessuna immagine).
export function flattenForExport(r, stateIds) {
  const row = { t_ms: Math.round(r.t), volto: r.face ? 1 : 0 };
  if (!r.face) return row;
  row.dominante = r.dominant;
  for (const id of EMOTION_IDS) row[`emo_${id}`] = +r.probs[id].toFixed(4);
  for (const id of stateIds) row[`stato_${id}`] = +r.states[id].toFixed(4);
  for (const id of AU_IDS) row[id] = +r.au[id].toFixed(4);
  row.valenza = +r.valence.toFixed(4);
  row.attivazione = +r.arousal.toFixed(4);
  row.attenzione = +r.attention.toFixed(4);
  row.yaw = +r.pose.yaw.toFixed(2);
  row.pitch = +r.pose.pitch.toFixed(2);
  row.roll = +r.pose.roll.toFixed(2);
  row.sguardo_x = +r.gaze.x.toFixed(3);
  row.sguardo_y = +r.gaze.y.toFixed(3);
  row.ammiccamenti_min = r.temporal.blink.rate === null ? '' : +r.temporal.blink.rate.toFixed(1);
  row.perclos = +r.temporal.blink.perclos.toFixed(4);
  row.parla = +r.temporal.talking.toFixed(3);
  return row;
}
