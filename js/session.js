// Registrazione della sessione: SOLO dati numerici (nessun fotogramma),
// tenuti in memoria ed esportabili come CSV/JSON scaricati in locale.

import { flattenForExport } from './analyzer.js';
import { EMOTION_IDS } from './emotions.js';
import { STATE_IDS } from './states.js';

export class SessionRecorder {
  constructor(intervalMs = 200) {
    this.interval = intervalMs;
    this.rows = [];
    this.micro = [];
    this.recording = false;
    this.start = 0;
    this.lastPush = -Infinity;
  }

  begin(t) {
    this.rows = [];
    this.micro = [];
    this.recording = true;
    this.start = t;
    this.lastPush = -Infinity;
  }

  end() { this.recording = false; }

  elapsed(t) { return this.recording ? t - this.start : 0; }

  push(r) {
    if (!this.recording) return;
    if (r.micro?.length) {
      for (const m of r.micro) this.micro.push({ t_ms: Math.round(m.t - this.start), emozione: m.id, durata_ms: m.duration, picco: +m.peak.toFixed(3) });
    }
    if (r.t - this.lastPush < this.interval) return;
    this.lastPush = r.t;
    const row = flattenForExport(r, STATE_IDS);
    row.t_ms = Math.round(r.t - this.start);
    this.rows.push(row);
  }

  summary() {
    const rows = this.rows;
    const withFace = rows.filter((r) => r.volto);
    const durationS = rows.length ? (rows[rows.length - 1].t_ms - rows[0].t_ms) / 1000 : 0;
    const dominantShare = {};
    for (const id of EMOTION_IDS) dominantShare[id] = 0;
    for (const r of withFace) dominantShare[r.dominante] += 1;
    for (const id of EMOTION_IDS) dominantShare[id] = withFace.length ? dominantShare[id] / withFace.length : 0;
    const avg = (key) => (withFace.length ? withFace.reduce((s, r) => s + (Number(r[key]) || 0), 0) / withFace.length : 0);
    const states = {};
    for (const id of STATE_IDS) states[id] = avg(`stato_${id}`);
    const blinkRows = withFace.filter((r) => r.ammiccamenti_min !== '');
    return {
      durationS,
      samples: rows.length,
      facePresence: rows.length ? withFace.length / rows.length : 0,
      dominantShare,
      states,
      valence: avg('valenza'),
      arousal: avg('attivazione'),
      attention: avg('attenzione'),
      blinkRate: blinkRows.length ? blinkRows.reduce((s, r) => s + r.ammiccamenti_min, 0) / blinkRows.length : null,
      microCount: this.micro.length,
    };
  }

  toCSV() {
    const keys = [];
    const seen = new Set();
    for (const r of this.rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
    const esc = (v) => {
      if (v === undefined || v === null) return '';
      const s = String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [keys.join(','), ...this.rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n');
  }

  toJSON() {
    return JSON.stringify({
      generato: new Date().toISOString(),
      nota: 'Solo dati numerici derivati: nessuna immagine è stata salvata.',
      riepilogo: this.summary(),
      micro_espressioni: this.micro,
      campioni: this.rows,
    }, null, 2);
  }
}

export function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
