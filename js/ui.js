// Pannelli dell'interfaccia: costruiti una volta, aggiornati ~10 volte al secondo.

import { EMOTIONS, EMOTION_BY_ID } from './emotions.js';
import { STATES } from './states.js';
import { AU_INFO, intensityLetter } from './facs.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const pct = (v) => `${Math.round(v * 100)}%`;

function barRow({ emoji, label, detail, color }) {
  const row = el('button', 'row');
  row.type = 'button';
  row.setAttribute('aria-expanded', 'false');
  const head = el('span', 'row-head');
  head.append(el('span', 'row-emoji', emoji), el('span', 'row-label', label));
  const value = el('span', 'row-value', '0%');
  head.append(value);
  const track = el('span', 'track');
  const fill = el('span', 'fill');
  if (color) fill.style.background = color;
  track.append(fill);
  const info = el('span', 'row-detail', detail);
  row.append(head, track, info);
  row.addEventListener('click', () => {
    const open = row.classList.toggle('open');
    row.setAttribute('aria-expanded', String(open));
  });
  return { row, fill, value };
}

export class Panels {
  constructor() {
    this.emoRows = {};
    this.stateRows = {};
    this.auRows = {};
    this.microList = $('#micro-list');
    this.buildEmotions();
    this.buildStates();
    this.buildAUs();
    this.ind = {
      blink: $('#ind-blink'), perclos: $('#ind-perclos'), attention: $('#ind-attention'),
      valence: $('#ind-valence'), arousal: $('#ind-arousal'), pose: $('#ind-pose'),
      gaze: $('#ind-gaze'), talking: $('#ind-talking'), motion: $('#ind-motion'), yawns: $('#ind-yawns'),
    };
    this.hero = {
      card: $('#hero'), emoji: $('#hero-emoji'), label: $('#hero-label'), conf: $('#hero-conf'),
      blend: $('#hero-blend'), smile: $('#hero-smile'), hint: $('#hero-hint'),
    };
    this.microT0 = null;
  }

  buildEmotions() {
    const box = $('#emotions');
    for (const e of EMOTIONS) {
      const r = barRow({ emoji: e.emoji, label: e.label, detail: `${e.aus} — ${e.desc}`, color: e.color });
      box.append(r.row);
      this.emoRows[e.id] = r;
    }
  }

  buildStates() {
    const box = $('#states');
    for (const s of STATES) {
      const r = barRow({ emoji: s.emoji, label: s.label, detail: s.cues });
      box.append(r.row);
      this.stateRows[s.id] = r;
    }
  }

  buildAUs() {
    const box = $('#aus');
    for (const a of AU_INFO) {
      const row = el('div', 'au-row');
      row.title = `${a.en} — ${a.muscle}`;
      const id = el('span', 'au-id', a.id);
      const name = el('span', 'au-name', a.name);
      const track = el('span', 'track');
      const fill = el('span', 'fill');
      track.append(fill);
      const letter = el('span', 'au-letter', '');
      row.append(id, name, track, letter);
      box.append(row);
      this.auRows[a.id] = { row, fill, letter };
    }
  }

  update(r) {
    if (!r.face) {
      this.hero.card.classList.add('dim');
      this.hero.label.textContent = 'Nessun volto';
      this.hero.emoji.textContent = '👤';
      this.hero.conf.textContent = 'Inquadra il viso, ben illuminato';
      this.hero.blend.textContent = '';
      this.hero.smile.hidden = true;
      return;
    }
    this.hero.card.classList.remove('dim');
    const dom = EMOTION_BY_ID[r.dominant];
    this.hero.emoji.textContent = dom.emoji;
    this.hero.label.textContent = dom.label;
    this.hero.card.style.setProperty('--hero', dom.color);
    this.hero.conf.textContent = `Probabilità ${pct(r.probs[r.dominant])}` +
      (r.dominant !== 'neutral' ? ` · intensità ${pct(r.emotions[r.dominant])}` : '');
    this.hero.blend.textContent = r.blend ? `Emozione composta: ${r.blend.name}` : '';
    if (r.duchenne !== null) {
      this.hero.smile.hidden = false;
      const genuine = r.duchenne >= 0.5;
      this.hero.smile.textContent = genuine ? 'Sorriso di Duchenne (AU6+AU12)' : 'Sorriso senza AU6 (sociale)';
      this.hero.smile.classList.toggle('good', genuine);
    } else {
      this.hero.smile.hidden = true;
    }
    this.hero.hint.hidden = r.calibrated;

    for (const e of EMOTIONS) {
      const row = this.emoRows[e.id];
      const p = r.probs[e.id];
      row.fill.style.transform = `scaleX(${p})`;
      row.value.textContent = pct(p);
      row.row.classList.toggle('top', e.id === r.dominant);
    }
    for (const s of STATES) {
      const row = this.stateRows[s.id];
      const v = r.states[s.id];
      row.fill.style.transform = `scaleX(${v})`;
      row.value.textContent = pct(v);
      row.row.classList.toggle('top', v >= 0.5);
    }
    for (const a of AU_INFO) {
      const row = this.auRows[a.id];
      const v = r.au[a.id];
      row.fill.style.transform = `scaleX(${v})`;
      row.letter.textContent = intensityLetter(v);
      row.row.classList.toggle('active', v >= 0.25);
    }
    this.updateIndicators(r);
  }

  updateIndicators(r) {
    const T = r.temporal;
    const b = T.blink;
    this.ind.blink.textContent = b.rate === null ? 'in raccolta…' : `${Math.round(b.rate)}/min`;
    this.ind.perclos.textContent = b.ready ? pct(b.perclos) : 'in raccolta…';
    this.ind.attention.textContent = pct(r.attention);
    this.ind.valence.textContent = signed(r.valence);
    this.ind.arousal.textContent = signed(r.arousal);
    this.ind.pose.textContent = `${headDir(r.pose)}`;
    this.ind.gaze.textContent = gazeDir(r.gaze);
    this.ind.talking.textContent = T.talking > 0.5 ? 'sì' : 'no';
    this.ind.motion.textContent = `${Math.round(T.motion)}°/s`;
    this.ind.yawns.textContent = String(T.yawns);
  }

  addMicro(events, t) {
    if (this.microT0 === null) this.microT0 = t;
    for (const m of events) {
      const e = EMOTION_BY_ID[m.id];
      const li = el('li');
      const secs = Math.max(0, Math.round((m.t - this.microT0) / 1000));
      const time = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
      li.append(el('span', 'micro-time', time), el('span', 'micro-emoji', e.emoji),
        el('span', 'micro-label', e.label), el('span', 'micro-meta', `${m.duration} ms · picco ${pct(m.peak)}`));
      this.microList.prepend(li);
      $('#micro-empty').hidden = true;
    }
    while (this.microList.children.length > 12) this.microList.lastChild.remove();
  }
}

function signed(v) {
  const s = v.toFixed(2);
  return v > 0 ? `+${s}` : s;
}

function headDir(p) {
  const parts = [];
  // Lato dal punto di vista della persona inquadrata.
  if (p.yaw > 12) parts.push('girata a sx'); else if (p.yaw < -12) parts.push('girata a dx');
  if (p.pitch > 10) parts.push('in alto'); else if (p.pitch < -10) parts.push('in basso');
  if (Math.abs(p.roll) > 8) parts.push('inclinata');
  const txt = parts.length ? parts.join(', ') : 'frontale';
  return `${txt} (${Math.round(p.yaw)}°, ${Math.round(p.pitch)}°, ${Math.round(p.roll)}°)`;
}

function gazeDir(g) {
  const v = g.y > 0.22 ? 'su' : g.y < -0.25 ? 'giù' : '';
  const h = Math.abs(g.x) > 0.3 ? 'di lato' : '';
  return [v, h].filter(Boolean).join(' e ') || 'al centro';
}
