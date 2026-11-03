// Le 8 emozioni di base (insieme usato da AffectNet: le 6 universali di Ekman
// + disprezzo + neutralità), stimate dalle combinazioni di Action Unit
// descritte in EMFACS (Friesen & Ekman, 1983) e nella FACS Investigator's
// Guide (Ekman, Friesen & Hager, 2002).

import { clamp01, soft, gmean, noisyOr, softmax } from './util.js';

export const EMOTIONS = [
  { id: 'neutral', label: 'Neutralità', emoji: '😐', color: '#94a3b8', va: [0, 0],
    aus: 'Nessuna AU significativa', desc: 'Viso rilassato, nessuna configurazione emotiva prevalente.' },
  { id: 'joy', label: 'Gioia', emoji: '😄', color: '#facc15', va: [0.8, 0.45],
    aus: 'AU6 + AU12', desc: 'Angoli della bocca tirati in su (zigomatico); nel sorriso genuino (Duchenne) si sollevano anche le guance (AU6).' },
  { id: 'sadness', label: 'Tristezza', emoji: '😢', color: '#60a5fa', va: [-0.7, -0.4],
    aus: 'AU1 + AU4 + AU15 (+AU17)', desc: 'Parte interna delle sopracciglia sollevata e avvicinata, angoli della bocca verso il basso.' },
  { id: 'surprise', label: 'Sorpresa', emoji: '😮', color: '#f472b6', va: [0.15, 0.8],
    aus: 'AU1 + AU2 + AU5 + AU26', desc: 'Sopracciglia alzate, occhi spalancati, mandibola che cade.' },
  { id: 'fear', label: 'Paura', emoji: '😨', color: '#a78bfa', va: [-0.5, 0.82],
    aus: 'AU1 + AU2 + AU4 + AU5 + AU7 + AU20 + AU26', desc: 'Sopracciglia alzate e corrugate, palpebre superiori sollevate, labbra stirate orizzontalmente.' },
  { id: 'anger', label: 'Rabbia', emoji: '😠', color: '#ef4444', va: [-0.78, 0.58],
    aus: 'AU4 + AU5 + AU7 + AU23/24', desc: 'Sopracciglia abbassate e ravvicinate, sguardo fisso, labbra serrate o tese.' },
  { id: 'disgust', label: 'Disgusto', emoji: '🤢', color: '#22c55e', va: [-0.7, 0.35],
    aus: 'AU9 + AU10 (+AU15, AU16, AU17)', desc: 'Naso arricciato, labbro superiore sollevato.' },
  { id: 'contempt', label: 'Disprezzo', emoji: '😏', color: '#fb923c', va: [-0.55, 0.25],
    aus: 'R12A + R14A (unilaterale)', desc: 'Un solo angolo della bocca tirato e teso: è l\'unica emozione di base asimmetrica.' },
];
export const EMOTION_IDS = EMOTIONS.map((e) => e.id);
export const EMOTION_BY_ID = Object.fromEntries(EMOTIONS.map((e) => [e.id, e]));

// Calcola l'intensità (0..1) di ciascuna emozione dalle AU.
// `f` = output di FacsEncoder.encode (contiene au, asym, smileSym, side).
// `ctx.talking` (0..1) riduce il peso delle AU della bocca durante il parlato.
export function scoreEmotions(f, ctx = {}) {
  const a = f.au;
  const talk = ctx.talking || 0;
  const mouthOpen = Math.max(0.5 * a.AU25, a.AU26) * (1 - 0.7 * talk);
  const AU20 = a.AU20 * (1 - 0.5 * talk);
  const smileL = f.side.AU12.l, smileR = f.side.AU12.r;
  const minSmile = Math.min(smileL, smileR);
  // Forma di sopracciglia e palpebre (se disponibile, vedi shape.js):
  // arch > 0 sopracciglio ad arco; slope > 0 obliquo con l'interno alzato,
  // < 0 "a V"; lidDown > 0 palpebra superiore abbassata.
  const d = f.shapeD;
  const arch = d ? soft(d.browArch, 0.8) : 0;
  const oblique = d ? soft(d.browSlope, 0.8) : 0;
  const vShape = d ? soft(-d.browSlope, 0.8) : 0;
  const lidDown = d ? soft(-d.upperLid, 0.8) : 0;
  // Sopracciglia ravvicinate (AU4 della paura) vs allontanate (sorpresa): è la
  // distanza fra le sopracciglia, non l'obliquità, a separare le due.
  const knit = d ? soft(0.2 - d.browGap, 0.6) : 0;

  // Gioia — AU12 (+ AU6 nel sorriso di Duchenne).
  let joy = soft(f.smileSym, 0.7) * (0.7 + 0.3 * soft(a.AU6, 0.45));
  joy *= 1 - 0.5 * soft(a.AU15, 0.5);
  joy *= 1 - 0.45 * soft(f.asym.AU12 - 0.1, 0.4);
  joy *= 1 - 0.4 * soft(a.AU1, 0.6); // sopracciglio interno alzato: smorfia, non gioia

  // Tristezza — AU1 + AU4 (sopracciglia "oblique") e/o AU15, oppure il
  // "broncio" AU17 accompagnato da AU1/AU15 (varianti EMFACS 1+15+17, 11+17).
  const sadBrow = a.AU1 * (0.4 + 0.6 * soft(a.AU4, 0.4));
  const pout = 0.7 * a.AU17 * (0.3 + 0.7 * soft(Math.max(a.AU15, a.AU1), 0.3));
  const sadMouth = Math.max(a.AU15, pout);
  // Palpebre "pesanti" contano solo insieme a un altro segno di tristezza.
  const sadEyes = 0.4 * lidDown * soft(Math.max(a.AU15, a.AU1, oblique), 0.3);
  let sadness = noisyOr(0.75 * soft(sadBrow, 0.55), 0.8 * soft(sadMouth, 0.5), sadEyes);
  sadness *= 1 - 0.85 * soft(a.AU12, 0.45);
  sadness *= 1 - 0.6 * soft(a.AU2, 0.5);
  sadness *= 1 - 0.4 * soft(a.AU5, 0.5);
  // AU4 + labbra serrate = rabbia, non tristezza.
  sadness *= 1 - 0.6 * soft(Math.max(a.AU23, a.AU24), 0.5) * soft(a.AU4, 0.3);

  // Bocca "a smorfia" (denti scoperti, labbra stirate) senza AU6: tipica della
  // paura; MediaPipe la legge come sorriso + labbro sollevato.
  const grimace = 0.7 * gmean(a.AU16, Math.max(a.AU10, AU20)) * (1 - soft(a.AU6, 0.4));

  // Sorpresa — AU1 + AU2 + AU5 + AU26. Le sole sopracciglia alzate
  // ("eyebrow flash") sono più spesso interesse/enfasi che sorpresa.
  const browUp = 0.6 * Math.min(a.AU1, a.AU2) + 0.4 * (a.AU1 + a.AU2) / 2;
  const jawDrop = Math.max(0.3 * a.AU25, a.AU26) * (1 - 0.7 * talk);
  // Nella sorpresa le sopracciglia si alzano formando un arco regolare.
  let surprise = clamp01(0.5 * soft(browUp, 0.55) + 0.25 * soft(a.AU5, 0.45) + 0.25 * soft(jawDrop, 0.5) +
    0.1 * arch * soft(browUp, 0.2));
  surprise *= soft(browUp + 0.5 * a.AU5, 0.35);
  surprise *= 0.45 + 0.55 * soft(Math.max(a.AU5, jawDrop), 0.3);
  surprise *= 1 - 0.75 * soft(a.AU4, 0.4);
  surprise *= 1 - 0.4 * soft(AU20, 0.45);
  surprise *= 1 - 0.3 * soft(a.AU9, 0.4);
  surprise *= 1 - 0.6 * soft(Math.max(a.AU7, a.AU43), 0.5); // occhi stretti: non è sorpresa
  surprise *= 1 - 0.5 * soft(grimace, 0.35);
  // Sopracciglia alzate MA ravvicinate (obliquità + AU4): è paura.
  surprise *= 1 - 0.5 * soft(oblique * knit - 0.2, 0.5);

  // Paura — AU1 + AU2 + AU4 + AU5 + AU7 + AU20 + AU26. MediaPipe tende a
  // leggere la bocca stirata della paura come sorriso + labbro sollevato:
  // per questo la "smorfia" a denti scoperti senza AU6 conta come AU20.
  const fearBrow = Math.max(gmean(Math.max(a.AU1, 0.8 * a.AU2), a.AU4), 0.8 * soft(a.AU1, 0.5));
  const fearMouth = Math.max(AU20, grimace);
  let fear = clamp01(0.35 * soft(fearBrow, 0.45) + 0.3 * soft(a.AU5, 0.4) + 0.25 * soft(fearMouth, 0.4) +
    0.1 * soft(mouthOpen, 0.5) + 0.1 * oblique * knit);
  fear *= soft(Math.max(a.AU5, fearMouth), 0.25) * soft(Math.max(a.AU1, 0.7 * a.AU2), 0.2);
  // AU4 e/o labbra stirate distinguono la paura dalla sorpresa.
  fear *= 0.35 + 0.65 * soft(Math.max(a.AU4, fearMouth, 0.6 * oblique * knit), 0.25);
  fear *= 1 - 0.7 * soft(a.AU12, 0.5) * (0.4 + 0.6 * soft(a.AU6, 0.3));
  fear *= 1 - 0.3 * soft(a.AU9, 0.4);
  fear *= 1 - 0.6 * soft(a.AU7, 0.5) * (1 - soft(a.AU5, 0.3));
  fear *= 1 - 0.5 * soft(Math.max(a.AU15, a.AU17), 0.4); // bocca "triste"

  // Rabbia — AU4 + AU5 + AU7 + AU23/AU24 (+AU17, AU10).
  const lips = Math.max(a.AU23, a.AU24);
  // Sopracciglia abbassate e a V (l'interno scende più dell'esterno).
  let anger = clamp01(0.4 * soft(a.AU4, 0.5) + 0.15 * soft(a.AU5, 0.4) + 0.15 * soft(a.AU7, 0.5) +
    0.2 * soft(lips, 0.5) + 0.1 * soft(Math.max(a.AU17, a.AU10), 0.5) + 0.1 * vShape);
  // Sopracciglia basse + occhi stretti da soli sono spesso un viso "serio" a
  // riposo: serve un secondo indizio (labbra serrate, occhi sgranati, bocca
  // aperta come nell'urlo).
  const shout = gmean(soft(a.AU4, 0.4), soft(Math.max(a.AU26, a.AU16), 0.4));
  anger *= soft(a.AU4 - 0.1, 0.3);
  // Un AU4 molto marcato (aggrottare con forza) basta anche da solo.
  anger *= 0.25 + 0.75 * Math.max(soft(Math.max(a.AU5, lips, shout, 0.5 * a.AU7, 0.6 * a.AU10, 0.5 * vShape), 0.35), soft(a.AU4 - 0.45, 0.35));
  anger *= 1 - 0.7 * soft(a.AU1, 0.5);
  anger *= 1 - 0.6 * soft(a.AU12, 0.5);

  // Disgusto — AU9 (naso) e/o AU10 (labbro superiore), +AU15/16/17.
  // Variante "avversione": occhi strizzati (AU7/AU43) con labbra stirate o
  // angoli in giù (AU20/AU15), utile perché noseSneer di MediaPipe è debole.
  const nose = Math.max(a.AU9, 0.85 * a.AU10);
  let disgust = clamp01(0.55 * soft(nose, 0.5) + 0.2 * soft(a.AU10, 0.5) + 0.15 * soft(a.AU15, 0.4) +
    0.1 * soft(Math.max(a.AU16, a.AU17), 0.5));
  disgust *= soft(nose, 0.2);
  const aversion = 0.6 * gmean(soft(Math.max(a.AU7, a.AU43), 0.5), soft(Math.max(AU20, a.AU15), 0.4)) *
    (1 - soft(a.AU5, 0.4)) * (1 - soft(a.AU4, 0.6) * 0.5);
  disgust = Math.max(disgust, aversion);
  disgust *= 1 - 0.6 * soft(a.AU12, 0.6);

  // Disprezzo — sollevamento/tensione unilaterale dell'angolo della bocca.
  // L'asimmetria delle fossette (AU14) è rumorosa: pesa la metà del sorriso.
  // asym.corner = un angolo della bocca più alto dell'altro (geometria).
  const asym = Math.max(f.asym.AU12, 0.5 * f.asym.AU14, 0.6 * f.asym.AU10, 0.8 * (f.asym.corner || 0));
  let contempt = soft(asym - 0.15, 0.3) *
    (0.6 + 0.4 * soft(Math.max(a.AU14, Math.max(smileL, smileR)), 0.4));
  contempt = Math.max(contempt, 0.45 * soft(a.AU14, 0.6) * (1 - soft(a.AU12, 0.4)));
  contempt *= 1 - 0.6 * soft(a.AU6, 0.4);
  contempt *= 1 - 0.7 * soft(minSmile, 0.45);

  const scores = { joy, sadness, surprise, fear, anger, disgust, contempt };
  for (const k in scores) scores[k] = clamp01(scores[k]);
  const maxE = Math.max(...Object.values(scores));
  return { neutral: clamp01(1 - 1.25 * maxE), ...scores };
}

export function emotionProbabilities(scores) {
  return softmax(scores, 6);
}

// Emozioni composte (Du, Tao & Martinez, 2014; diadi di Plutchik).
const COMPOUNDS = {
  'joy+surprise': 'Meraviglia',
  'fear+surprise': 'Spavento',
  'disgust+fear': 'Orrore',
  'anger+disgust': 'Indignazione',
  'anger+surprise': 'Oltraggio',
  'anger+sadness': 'Amarezza',
  'fear+sadness': 'Sconforto',
  'sadness+surprise': 'Delusione',
  'disgust+sadness': 'Rimorso',
  'disgust+surprise': 'Incredulità',
  'joy+sadness': 'Nostalgia',
  'contempt+joy': 'Compiacimento',
  'anger+contempt': 'Sdegno',
};

export function detectBlend(scores) {
  const ranked = EMOTION_IDS.filter((id) => id !== 'neutral')
    .map((id) => [id, scores[id]]).sort((x, y) => y[1] - x[1]);
  const [a, b] = ranked;
  if (!a || !b || a[1] < 0.3 || b[1] < 0.3 || b[1] < 0.55 * a[1]) return null;
  const key = [a[0], b[0]].sort().join('+');
  return {
    ids: [a[0], b[0]],
    name: COMPOUNDS[key] || `${EMOTION_BY_ID[a[0]].label} + ${EMOTION_BY_ID[b[0]].label}`,
    named: Boolean(COMPOUNDS[key]),
  };
}

// Modello circonflesso di Russell: valenza (piacevolezza) e attivazione.
export function valenceArousal(probs, states, T) {
  let v = 0, ar = 0;
  for (const e of EMOTIONS) {
    v += probs[e.id] * e.va[0];
    ar += probs[e.id] * e.va[1];
  }
  if (states) {
    ar += 0.35 * states.anxiety - 0.45 * Math.max(states.fatigue, states.boredom) + 0.15 * states.interest;
    v += 0.15 * states.pride - 0.2 * states.frustration - 0.1 * states.anxiety;
  }
  if (T) ar += 0.15 * T.motionLevel;
  return { valence: Math.max(-1, Math.min(1, v)), arousal: Math.max(-1, Math.min(1, ar)) };
}

// Mantiene stabile l'etichetta dominante: cambia solo se la nuova emozione
// supera l'attuale di un margine per almeno `holdMs`.
export class DominantTracker {
  constructor(margin = 0.08, holdMs = 300) {
    this.margin = margin;
    this.hold = holdMs;
    this.current = 'neutral';
    this.candidate = null;
    this.candidateSince = 0;
  }

  update(t, probs) {
    let best = this.current, bestP = probs[this.current] ?? 0;
    for (const id of EMOTION_IDS) if (probs[id] > bestP + this.margin) { best = id; bestP = probs[id]; }
    if (best === this.current) {
      this.candidate = null;
    } else if (this.candidate !== best) {
      this.candidate = best;
      this.candidateSince = t;
    } else if (t - this.candidateSince >= this.hold) {
      this.current = best;
      this.candidate = null;
    }
    return this.current;
  }
}

// Rilevatore di micro-espressioni: picchi brevi (≤ 500 ms) di un'emozione,
// preceduti e seguiti da un volto non espressivo.
export class MicroExpressionDetector {
  constructor({ low = 0.15, high = 0.42, maxMs = 500, minMs = 40, quietMs = 250 } = {}) {
    Object.assign(this, { low, high, maxMs, minMs, quietMs });
    this.st = {};
    for (const id of EMOTION_IDS) if (id !== 'neutral') this.st[id] = { phase: 'idle', quietSince: null, onset: 0, peak: 0 };
  }

  update(t, scores, { suppress = false } = {}) {
    const events = [];
    for (const id in this.st) {
      const s = this.st[id];
      const v = scores[id];
      if (suppress) { s.phase = 'idle'; s.quietSince = null; continue; }
      if (s.phase === 'idle') {
        if (v < this.low) {
          if (s.quietSince === null) s.quietSince = t;
        } else if (s.quietSince !== null && t - s.quietSince >= this.quietMs) {
          s.phase = 'rising';
          s.onset = t;
          s.peak = v;
        } else if (v >= this.low) {
          s.quietSince = null;
        }
      } else if (s.phase === 'rising') {
        s.peak = Math.max(s.peak, v);
        const d = t - s.onset;
        if (d > this.maxMs) {
          s.phase = 'macro';
        } else if (v < this.low) {
          if (s.peak >= this.high && d >= this.minMs) {
            events.push({ t, id, duration: Math.round(d), peak: s.peak });
          }
          s.phase = 'idle';
          s.quietSince = t;
        }
      } else if (s.phase === 'macro') {
        if (v < this.low) { s.phase = 'idle'; s.quietSince = t; }
      }
    }
    return events;
  }
}
