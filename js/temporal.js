// Analisi temporale: ammiccamenti, PERCLOS, sbadigli, movimento della testa,
// sguardo, attività espressiva, parlato. Sono gli indizi che permettono di
// stimare gli stati "lenti" (stanchezza, noia, concentrazione, ansia...).

import { TimeBuffer, clamp01, mean, std } from './util.js';

const BLINK_CLOSE = 0.55; // chiusura normalizzata oltre cui l'occhio è "chiuso"
const BLINK_OPEN = 0.35;  // isteresi per la riapertura

export class BlinkDetector {
  constructor() {
    this.closed = false;
    this.closedAt = 0;
    this.blinks = new TimeBuffer(60000);     // durate degli ammiccamenti (ms)
    this.longClosures = new TimeBuffer(120000);
    this.closure = new TimeBuffer(60000);    // per il PERCLOS
    this.start = null;
  }

  update(t, closure) {
    if (this.start === null) this.start = t;
    this.closure.push(t, closure);
    let event = null;
    if (!this.closed && closure > BLINK_CLOSE) {
      this.closed = true;
      this.closedAt = t;
    } else if (this.closed && closure < BLINK_OPEN) {
      this.closed = false;
      const d = t - this.closedAt;
      if (d >= 40 && d <= 500) {
        this.blinks.push(t, d);
        event = { type: 'blink', duration: d };
      } else if (d > 500) {
        this.longClosures.push(t, d);
        event = { type: 'long', duration: d };
      }
    }
    return event;
  }

  stats(t) {
    const elapsed = t - (this.start ?? t);
    const win = Math.min(60000, elapsed);
    const blinks = this.blinks.since(t - win);
    const rate = win > 5000 ? (blinks.length * 60000) / win : null;
    const closures = this.closure.values(t - 60000);
    // PERCLOS: % di tempo con occhi chiusi oltre l'80% (indice di sonnolenza).
    const perclos = closures.length > 30 ? closures.filter((c) => c > 0.8).length / closures.length : 0;
    const longCount = this.longClosures.since(t - 120000).length;
    const meanDur = blinks.length ? mean(blinks.map((b) => b.v)) : null;
    const currentClosed = this.closed ? t - this.closedAt : 0;
    return { rate, perclos, longCount, meanDur, currentClosed, ready: elapsed > 15000 };
  }

  reset() {
    this.closed = false;
    this.blinks.clear();
    this.longClosures.clear();
    this.closure.clear();
    this.start = null;
  }
}

export class YawnDetector {
  constructor() {
    this.openSince = null;
    this.counted = false;
    this.yawns = new TimeBuffer(180000);
  }

  // jaw = jawOpen normalizzato; talking = probabilità che stia parlando;
  // eyesWide = AU5. Una bocca spalancata con occhi sgranati è sorpresa, non
  // uno sbadiglio (che di solito socchiude gli occhi).
  update(t, jaw, talking, eyesWide = 0) {
    let event = null;
    if (jaw > 0.55) {
      if (this.openSince === null) { this.openSince = t; this.counted = false; }
      if (eyesWide > 0.35) this.counted = true;
      if (!this.counted && t - this.openSince > 1500 && talking < 0.5) {
        this.counted = true;
        this.yawns.push(t, 1);
        event = { type: 'yawn' };
      }
    } else if (jaw < 0.35) {
      this.openSince = null;
    }
    return event;
  }

  count(t) { return this.yawns.since(t - 180000).length; }

  lastAgo(t) {
    const all = this.yawns.since(t - 180000);
    return all.length ? t - all[all.length - 1].t : Infinity;
  }

  reset() { this.openSince = null; this.yawns.clear(); }
}

export class TemporalAnalyzer {
  constructor() {
    this.blink = new BlinkDetector();
    this.yawn = new YawnDetector();
    this.pose = new TimeBuffer(10000);
    this.motion = new TimeBuffer(10000);
    this.gaze = new TimeBuffer(15000);
    this.activity = new TimeBuffer(20000);
    this.jaw = new TimeBuffer(2000);
    this.presence = new TimeBuffer(30000);
    this.lastPose = null;
    this.lastT = null;
    this.start = null;
  }

  reset() {
    this.blink.reset();
    this.yawn.reset();
    for (const b of [this.pose, this.motion, this.gaze, this.activity, this.jaw, this.presence]) b.clear();
    this.lastPose = null;
    this.lastT = null;
    this.start = null;
  }

  noFace(t) {
    this.presence.push(t, 0);
    this.lastPose = null;
  }

  // f = { closure, jaw, eyesWide, pose:{yaw,pitch,roll}, gaze:{x,y}, activity }
  update(t, f) {
    if (this.start === null) this.start = t;
    const events = [];
    this.presence.push(t, 1);

    // Parlato: oscillazione rapida della mandibola nell'ultimo secondo.
    this.jaw.push(t, f.jaw);
    const jawVals = this.jaw.values(t - 1000);
    const jawStd = std(jawVals);
    let crossings = 0;
    if (jawVals.length > 4) {
      const m = mean(jawVals);
      for (let i = 1; i < jawVals.length; i++) {
        if ((jawVals[i - 1] - m) * (jawVals[i] - m) < 0) crossings++;
      }
    }
    const talking = clamp01((jawStd - 0.025) / 0.05) * clamp01((crossings - 1) / 3);

    const b = this.blink.update(t, f.closure);
    if (b) events.push(b);
    const y = this.yawn.update(t, f.jaw, talking, f.eyesWide ?? 0);
    if (y) events.push(y);

    // Velocità angolare della testa (gradi/s).
    let speed = 0;
    if (this.lastPose && this.lastT !== null && t > this.lastT) {
      const dt = (t - this.lastT) / 1000;
      const d = Math.hypot(f.pose.yaw - this.lastPose.yaw, f.pose.pitch - this.lastPose.pitch,
        f.pose.roll - this.lastPose.roll);
      speed = Math.min(400, d / dt);
    }
    this.lastPose = { ...f.pose };
    this.lastT = t;
    this.motion.push(t, speed);
    this.pose.push(t, { ...f.pose });

    // Sguardo: fuori schermo se testa ruotata o occhi molto laterali.
    const away = Math.abs(f.pose.yaw) > 22 || Math.abs(f.pose.pitch) > 20 ||
      Math.abs(f.gaze.x) > 0.45 || Math.abs(f.gaze.y) > 0.4;
    this.gaze.push(t, { x: f.gaze.x, y: f.gaze.y, away, pitch: f.pose.pitch, yaw: f.pose.yaw });
    this.activity.push(t, f.activity);

    const mot3 = this.motion.values(t - 3000);
    const motion = mean(mot3);
    const g5items = this.gaze.since(t - 5000);
    const g5 = g5items.map((it) => it.v);
    const gazeAwayFrac = g5.length ? g5.filter((g) => g.away).length / g5.length : 0;
    // Spostamenti di sguardo (saccadi ampie) al secondo.
    let shifts = 0;
    for (let i = 1; i < g5.length; i++) {
      if (Math.hypot(g5[i].x - g5[i - 1].x, g5[i].y - g5[i - 1].y) > 0.18) shifts++;
    }
    const span5 = g5items.length > 1 ? (g5items[g5items.length - 1].t - g5items[0].t) / 1000 : 0;
    const gazeShiftRate = span5 > 1 ? shifts / span5 : 0;
    // Sguardo in alto/di lato (tipico della riflessione) e in basso.
    const g4 = this.gaze.values(t - 4000);
    const lookUpSideFrac = g4.length
      ? g4.filter((g) => g.y > 0.22 || (Math.abs(g.x) > 0.3 && g.y > -0.1) || g.pitch > 12).length / g4.length : 0;
    const lookDownFrac = g4.length ? g4.filter((g) => g.y < -0.25 || g.pitch < -12).length / g4.length : 0;
    const act10 = this.activity.values(t - 10000);
    const activity = mean(act10);
    const activityVar = std(act10);
    const poses = this.pose.values(t - 2000);
    const meanPose = {
      yaw: mean(poses.map((p) => p.yaw)),
      pitch: mean(poses.map((p) => p.pitch)),
      roll: mean(poses.map((p) => p.roll)),
    };
    // Scuotimento della testa (oscillazioni di yaw) negli ultimi 3 s.
    const yaw3 = this.pose.values(t - 3000).map((p) => p.yaw);
    let headShake = 0;
    if (yaw3.length > 6) {
      const m = mean(yaw3);
      let c = 0;
      for (let i = 1; i < yaw3.length; i++) if ((yaw3[i - 1] - m) * (yaw3[i] - m) < 0) c++;
      headShake = clamp01((std(yaw3) - 3) / 6) * clamp01((c - 2) / 3);
    }
    const pres = this.presence.values(t - 30000);
    const presence = pres.length ? mean(pres) : 1;

    return {
      events,
      blink: this.blink.stats(t),
      yawns: this.yawn.count(t),
      yawnAgo: this.yawn.lastAgo(t),
      talking,
      motion,
      motionLevel: clamp01(motion / 40),
      gazeAwayFrac,
      gazeShiftRate,
      lookUpSideFrac,
      lookDownFrac,
      activity,
      activityVar,
      meanPose,
      headShake,
      presence,
      elapsed: t - this.start,
    };
  }
}
