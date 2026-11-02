// Grafici su canvas: andamento nel tempo delle emozioni e piano
// valenza/attivazione (modello circonflesso di Russell).

import { EMOTIONS } from './emotions.js';

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function fitCanvas(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, dpr };
}

export class Timeline {
  constructor(canvas, windowMs = 60000) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.windowMs = windowMs;
    this.points = [];
    this.hidden = new Set(['neutral']);
  }

  push(t, probs) {
    this.points.push({ t, p: probs ? { ...probs } : null });
    const limit = t - this.windowMs;
    while (this.points.length && this.points[0].t < limit) this.points.shift();
  }

  toggle(id) {
    if (this.hidden.has(id)) this.hidden.delete(id); else this.hidden.add(id);
  }

  draw(now) {
    const { ctx } = this;
    const { w, h, dpr } = fitCanvas(this.canvas);
    ctx.clearRect(0, 0, w, h);
    const padL = 30 * dpr, padB = 16 * dpr, padT = 6 * dpr, padR = 6 * dpr;
    const gw = w - padL - padR, gh = h - padT - padB;
    const grid = cssVar('--grid', 'rgba(148,163,184,0.18)');
    const muted = cssVar('--muted', '#94a3b8');
    ctx.font = `${10 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = muted;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (const v of [0, 0.5, 1]) {
      const y = padT + gh * (1 - v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(v * 100)}%`, padL - 4 * dpr, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let s = 0; s < this.windowMs / 1000; s += 15) {
      const x = padL + gw * (1 - (s * 1000) / this.windowMs);
      ctx.fillText(s === 0 ? 'ora' : `-${s}s`, x, h - padB + 3 * dpr);
    }
    const X = (t) => padL + gw * (1 - (now - t) / this.windowMs);
    const Y = (v) => padT + gh * (1 - v);
    for (const e of EMOTIONS) {
      if (this.hidden.has(e.id)) continue;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 2 * dpr;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let pen = false;
      for (const pt of this.points) {
        if (!pt.p) { pen = false; continue; }
        const x = X(pt.t), y = Y(pt.p[e.id]);
        if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}

export class Circumplex {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.trail = [];
  }

  push(t, v, a) {
    this.trail.push({ t, v, a });
    while (this.trail.length && this.trail[0].t < t - 8000) this.trail.shift();
  }

  draw() {
    const { ctx } = this;
    const { w, h, dpr } = fitCanvas(this.canvas);
    ctx.clearRect(0, 0, w, h);
    const size = Math.min(w, h);
    const cx = w / 2, cy = h / 2, R = size / 2 - 22 * dpr;
    const grid = cssVar('--grid', 'rgba(148,163,184,0.18)');
    const muted = cssVar('--muted', '#94a3b8');
    const text = cssVar('--text', '#e2e8f0');
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    ctx.fillStyle = muted;
    ctx.font = `${10 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom'; ctx.fillText('attivazione +', cx, cy - R - 3 * dpr);
    ctx.textBaseline = 'top'; ctx.fillText('calma', cx, cy + R + 3 * dpr);
    ctx.save();
    ctx.translate(cx + R + 4 * dpr, cy); ctx.rotate(Math.PI / 2);
    ctx.textBaseline = 'bottom'; ctx.fillText('piacevole', 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(cx - R - 4 * dpr, cy); ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'bottom'; ctx.fillText('spiacevole', 0, 0);
    ctx.restore();
    // Posizione delle emozioni di base sul piano.
    ctx.font = `${13 * dpr}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.55;
    for (const e of EMOTIONS) {
      if (e.id === 'neutral') continue;
      ctx.fillText(e.emoji, cx + e.va[0] * R, cy - e.va[1] * R);
    }
    ctx.globalAlpha = 1;
    // Scia e punto attuale.
    const n = this.trail.length;
    for (let i = 1; i < n; i++) {
      const p = this.trail[i - 1], q = this.trail[i];
      ctx.strokeStyle = `rgba(56,189,248,${(i / n) * 0.8})`;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(cx + p.v * R, cy - p.a * R);
      ctx.lineTo(cx + q.v * R, cy - q.a * R);
      ctx.stroke();
    }
    if (n) {
      const last = this.trail[n - 1];
      ctx.fillStyle = text;
      ctx.beginPath(); ctx.arc(cx + last.v * R, cy - last.a * R, 5 * dpr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2 * dpr; ctx.stroke();
    }
  }
}
