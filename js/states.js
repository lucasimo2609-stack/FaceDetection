// 12 stati affettivi/cognitivi "sottili". A differenza delle emozioni di base
// non hanno un prototipo FACS universale: si stimano combinando AU deboli,
// posa della testa, sguardo e dinamiche nel tempo (ammiccamenti, movimento,
// durata). Riferimenti principali:
//  - D'Mello, Craig & Graesser (2008-2009); Grafsgaard et al. (2013):
//    confusione (AU4, AU7), frustrazione (AU1/2, AU14), noia (AU43, inattività).
//  - Keltner (1995): imbarazzo (sguardo basso, sorriso controllato, testa che si gira).
//  - Ekman, Davidson & Friesen (1990): sorriso di Duchenne vs sorriso sociale.
//  - Tracy & Robins (2004): orgoglio (testa inclinata indietro, piccolo sorriso).
//  - Harrigan & O'Connell (1996): ansia (AU1+4, AU20, ammiccamenti frequenti).
//  - Wierwille (1994): PERCLOS come indice di sonnolenza.
//  - Glenberg et al. (1998): distogliere lo sguardo durante il pensiero.

import { clamp01, soft, bell, noisyOr, gmean } from './util.js';

export const STATES = [
  { id: 'concentration', label: 'Concentrazione', emoji: '🎯',
    cues: 'AU4 lieve + AU7, ammiccamenti ridotti, testa ferma, sguardo sullo schermo' },
  { id: 'interest', label: 'Interesse', emoji: '👀',
    cues: 'AU1+AU2 lievi, AU5, sguardo fisso, avvicinamento allo schermo, testa inclinata' },
  { id: 'confusion', label: 'Confusione', emoji: '😕',
    cues: 'AU4 + AU7, testa inclinata o sopracciglia asimmetriche, bocca di lato/AU14' },
  { id: 'skepticism', label: 'Scetticismo', emoji: '🤨',
    cues: 'Un solo sopracciglio alzato, AU14 unilaterale, labbra compresse (AU24) o AU17' },
  { id: 'boredom', label: 'Noia', emoji: '🥱',
    cues: 'Volto poco espressivo a lungo, palpebre pesanti, sguardo che vaga, testa appoggiata/inclinata' },
  { id: 'fatigue', label: 'Stanchezza', emoji: '😴',
    cues: 'PERCLOS alto, ammiccamenti lunghi, sbadigli, palpebre cadenti' },
  { id: 'anxiety', label: 'Ansia', emoji: '😰',
    cues: 'AU1+AU4 (sopracciglia "preoccupate"), AU20, labbra strette/risucchiate, ammiccamenti frequenti, irrequietezza' },
  { id: 'frustration', label: 'Frustrazione', emoji: '😤',
    cues: 'AU4 + AU24/AU23 + AU17, AU14, sbuffi (guance gonfie), scuotere la testa' },
  { id: 'embarrassment', label: 'Imbarazzo', emoji: '😳',
    cues: 'Sorriso trattenuto (AU12 + AU24/AU14), sguardo e testa verso il basso o di lato' },
  { id: 'politeSmile', label: 'Sorriso di cortesia', emoji: '🙂',
    cues: 'AU12 senza AU6: sorriso "sociale", non di Duchenne' },
  { id: 'contemplation', label: 'Riflessione', emoji: '🤔',
    cues: 'Sguardo in alto o di lato, bocca spostata/AU17/AU28, testa ferma' },
  { id: 'pride', label: 'Orgoglio', emoji: '😌',
    cues: 'Testa inclinata all\'indietro, piccolo sorriso a labbra chiuse, sguardo verso il basso sulla camera' },
];
export const STATE_IDS = STATES.map((s) => s.id);
export const STATE_BY_ID = Object.fromEntries(STATES.map((s) => [s.id, s]));

// f = output FACS, emo = intensità emozioni, T = feature temporali,
// pose = posa relativa alla calibrazione.
export function scoreStates(f, emo, T, pose) {
  const a = f.au;
  const talk = T.talking;
  const still = 1 - T.motionLevel;
  const onScreen = 1 - T.gazeAwayFrac;
  const strongEmotion = Math.max(emo.anger, emo.fear, emo.disgust, emo.surprise, emo.sadness, emo.joy);
  const rate = T.blink.rate;           // ammiccamenti/min (null finché non ci sono dati)
  const lowBlink = rate === null ? 0.4 : clamp01((16 - rate) / 10);
  const highBlink = rate === null ? 0 : clamp01((rate - 24) / 16);
  const absRoll = Math.abs(T.meanPose.roll);
  const tilt = soft(absRoll - 6, 10);
  const lidDroop = bell(a.AU43, 0.15, 0.45, 0.85); // palpebre "pesanti", non chiuse
  const warm = clamp01(T.elapsed / 8000);           // gli stati lenti richiedono qualche secondo

  // Concentrazione.
  let concentration = 0.3 * bell(a.AU4, 0.05, 0.35, 0.8) + 0.2 * soft(a.AU7, 0.4) +
    0.25 * still + 0.15 * lowBlink + 0.1 * onScreen;
  concentration *= onScreen * (1 - 0.7 * soft(a.AU12, 0.5)) * (1 - 0.6 * soft(a.AU26, 0.5)) *
    (1 - 0.6 * talk) * (1 - 0.6 * strongEmotion);
  concentration *= 0.6 + 0.4 * soft(a.AU4 + a.AU7, 0.15);

  // Interesse.
  const browFlash = bell((a.AU1 + a.AU2) / 2, 0.05, 0.3, 0.75);
  const lean = f.leanIn ?? 0;
  let interest = 0.3 * browFlash + 0.15 * bell(a.AU5, 0.05, 0.3, 0.7) + 0.2 * lean +
    0.2 * onScreen + 0.1 * soft(absRoll - 4, 10) + 0.05 * bell(a.AU12, 0.05, 0.3, 0.6);
  interest *= onScreen * (1 - 0.6 * soft(a.AU4, 0.5)) * (1 - 0.6 * emo.fear) * (1 - 0.5 * emo.surprise);
  interest *= 0.5 + 0.5 * soft(browFlash + lean + a.AU5, 0.3);

  // Confusione.
  const knit = soft(a.AU4, 0.4);
  const cueSide = Math.max(tilt, soft(f.asym.brow - 0.1, 0.3), soft(f.mouthSideways, 0.4),
    soft(a.AU14, 0.5), soft(a.AU24, 0.5));
  let confusion = 0.45 * knit + 0.15 * soft(a.AU7, 0.4) + 0.3 * cueSide + 0.1 * soft(T.gazeShiftRate, 1);
  confusion *= soft(a.AU4, 0.15) * (1 - 0.6 * soft(a.AU12, 0.45)) * (1 - 0.5 * emo.anger) * (1 - 0.4 * talk);

  // Scetticismo / dubbio.
  const browAsym = soft(f.asym.brow - 0.12, 0.3);
  const doubtMouth = Math.max(soft(f.asym.AU14, 0.35), soft(a.AU24, 0.5), soft(a.AU17, 0.5));
  const oneBrow = 0.55 * browAsym + 0.25 * doubtMouth + 0.2 * soft(a.AU7, 0.4);
  const shrug = 0.8 * gmean(soft(a.AU17, 0.4), soft(Math.max(a.AU15, a.AU24), 0.35),
    0.3 + 0.7 * soft((a.AU1 + a.AU2) / 2, 0.3));
  let skepticism = Math.max(oneBrow * (0.4 + 0.6 * browAsym), shrug);
  skepticism *= (1 - 0.6 * soft(f.smileSym, 0.5)) * (1 - 0.5 * talk);

  // Noia.
  const lowActivity = clamp01(1 - T.activity / 0.25);
  let boredom = 0.35 * lowActivity + 0.2 * lidDroop + 0.2 * T.gazeAwayFrac +
    0.1 * Math.max(tilt, soft(-T.meanPose.pitch - 6, 12)) + 0.15 * (T.yawnAgo < 60000 ? 1 : 0);
  boredom *= (1 - 0.7 * strongEmotion) * (1 - 0.5 * talk) * (1 - 0.6 * soft(a.AU4, 0.4)) * warm;
  boredom *= 0.4 + 0.6 * clamp01(T.elapsed / 20000);

  // Stanchezza / sonnolenza.
  const b = T.blink;
  const perclosF = soft(b.perclos - 0.04, 0.2);
  const longF = soft(b.longCount, 3);
  const yawnF = soft(T.yawns, 2);
  const slowBlink = b.meanDur ? soft(b.meanDur - 180, 220) : 0;
  const closedNow = soft(b.currentClosed - 400, 1200);
  let fatigue = noisyOr(0.75 * perclosF, 0.5 * longF, 0.6 * yawnF, 0.3 * slowBlink, 0.25 * lidDroop, 0.8 * closedNow);
  fatigue *= 1 - 0.5 * Math.max(emo.surprise, emo.fear);

  // Ansia / nervosismo.
  const worryBrow = gmean(soft(a.AU1, 0.35), soft(a.AU4, 0.3));
  const lipTension = Math.max(soft(a.AU24, 0.45), soft(a.AU28, 0.4), soft(a.AU20, 0.4));
  const fidget = soft(T.motion - 15, 35);
  let anxiety = 0.3 * worryBrow + 0.2 * lipTension + 0.2 * highBlink + 0.15 * fidget +
    0.15 * soft(T.gazeShiftRate - 0.5, 1.5);
  anxiety *= (1 - 0.6 * soft(f.smileSym, 0.45)) * (1 - 0.3 * talk);
  anxiety = Math.max(anxiety, 0.6 * emo.fear);

  // Frustrazione.
  const press = Math.max(soft(a.AU24, 0.45), soft(a.AU23, 0.45));
  let frustration = 0.3 * soft(a.AU4, 0.45) + 0.25 * press + 0.2 * soft(a.AU17, 0.45) +
    0.1 * soft(a.AU14, 0.45) + 0.15 * Math.max(soft(a.AU34, 0.4), T.headShake);
  frustration *= soft(a.AU4 + press + a.AU14 + a.AU34, 0.35);
  frustration *= (1 - 0.6 * soft(a.AU12, 0.45)) * (1 - 0.3 * emo.fear) * (1 - 0.4 * talk);

  // Imbarazzo.
  const smileish = soft(a.AU12, 0.25);
  const smileControl = Math.max(soft(a.AU24, 0.4), soft(a.AU14, 0.4), soft(a.AU15, 0.35), soft(a.AU28, 0.4));
  const avert = Math.max(T.lookDownFrac, soft(-pose.pitch - 8, 12), soft(Math.abs(pose.yaw) - 12, 15), T.gazeAwayFrac);
  let embarrassment = (0.3 * smileish + 0.25 * smileControl + 0.45 * avert) * smileish * soft(avert, 0.35);
  embarrassment *= 1 - 0.4 * talk;

  // Sorriso di cortesia (non-Duchenne).
  let politeSmile = soft(f.smileSym - 0.1, 0.35) * (1 - soft(a.AU6, 0.4)) * (1 - 0.5 * soft(f.asym.AU12 - 0.1, 0.3));
  politeSmile *= 1 - 0.5 * talk;

  // Riflessione.
  const mouthThink = Math.max(soft(f.mouthSideways, 0.35), soft(a.AU28, 0.4), soft(a.AU17, 0.45), soft(a.AU18, 0.5));
  let contemplation = 0.4 * T.lookUpSideFrac + 0.2 * mouthThink + 0.2 * still +
    0.1 * bell(a.AU4, 0.02, 0.25, 0.6) + 0.1 * (1 - soft(a.AU12, 0.4));
  contemplation *= soft(T.lookUpSideFrac + 0.6 * mouthThink, 0.4) * (1 - 0.6 * talk) * (1 - 0.6 * strongEmotion);

  // Orgoglio / soddisfazione.
  const headUp = soft(pose.pitch - 6, 14);
  const smallSmile = bell(a.AU12, 0.05, 0.35, 0.85) * (1 - 0.6 * soft(a.AU25, 0.5));
  let pride = gmean(headUp, smallSmile) * (1 - 0.5 * talk) * (1 - 0.6 * Math.max(emo.surprise, emo.fear));

  const out = {
    concentration, interest, confusion, skepticism, boredom, fatigue,
    anxiety, frustration, embarrassment, politeSmile, contemplation, pride,
  };
  for (const k in out) out[k] = clamp01(out[k]);
  return out;
}

// Attenzione verso lo schermo (0..1): volto presente, sguardo e testa rivolti.
export function attentionLevel(T, pose) {
  const facing = 1 - soft(Math.abs(pose.yaw) - 10, 25) * 0.7 - soft(Math.abs(pose.pitch) - 10, 25) * 0.5;
  const eyesOpen = 1 - soft(T.blink.perclos, 0.3);
  return clamp01((1 - T.gazeAwayFrac) * 0.5 + clamp01(facing) * 0.3 + eyesOpen * 0.2) * T.presence;
}
