// Disegno sovrapposto al video: mesh del volto, contorni, etichette delle AU
// attive nel punto anatomico corrispondente, direzione della testa.

import { FaceLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';
import { AU_INFO, intensityLetter } from './facs.js';

const CONTOUR_SETS = [
  FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
  FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
  FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
  FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
  FaceLandmarker.FACE_LANDMARKS_LIPS,
];
const IRIS_SETS = [FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS];
const TESSELATION = FaceLandmarker.FACE_LANDMARKS_TESSELATION;

export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = 'au';      // 'mesh' | 'contours' | 'au' | 'none'
    this.mirror = true;
    this.hideVideo = false;
    this.accent = '#38bdf8';
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  clear() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  draw(r, color) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    this.clear();
    if (!r?.face || this.mode === 'none') return;
    const lm = r.landmarks;
    const X = this.mirror ? (i) => (1 - lm[i].x) * W : (i) => lm[i].x * W;
    const Y = (i) => lm[i].y * H;
    const scale = r.geom.interOcular / 120; // spessori proporzionali alla dimensione del volto
    const lw = Math.max(0.6, Math.min(2.5, scale));
    const accent = color || this.accent;

    const lines = (conns, style, width) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const c of conns) {
        ctx.moveTo(X(c.start), Y(c.start));
        ctx.lineTo(X(c.end), Y(c.end));
      }
      ctx.stroke();
    };

    if (this.mode === 'mesh' || this.hideVideo) {
      lines(TESSELATION, this.hideVideo ? 'rgba(148,163,184,0.45)' : 'rgba(226,232,240,0.28)', lw * 0.6);
    }
    for (const set of CONTOUR_SETS) lines(set, accent, lw * 1.2);
    for (const set of IRIS_SETS) lines(set, 'rgba(250,250,250,0.85)', lw);

    if (this.mode === 'au') this.drawAuTags(r, X, Y, scale, accent);
    this.drawHeadAxis(r, X, Y, scale);
  }

  drawHeadAxis(r, X, Y, scale) {
    const { ctx } = this;
    const len = 60 * scale;
    const yawRad = (r.pose.yaw * Math.PI) / 180;
    const pitchRad = (r.pose.pitch * Math.PI) / 180;
    const sx = X(1), sy = Y(1);
    const dx = Math.sin(yawRad) * len * (this.mirror ? -1 : 1);
    const dy = -Math.sin(pitchRad) * len;
    ctx.strokeStyle = 'rgba(250,204,21,0.9)';
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + dx, sy + dy);
    ctx.stroke();
    ctx.fillStyle = 'rgba(250,204,21,0.95)';
    ctx.beginPath();
    ctx.arc(sx + dx, sy + dy, Math.max(2, 3 * scale), 0, Math.PI * 2);
    ctx.fill();
  }

  drawAuTags(r, X, Y, scale, accent) {
    const { ctx } = this;
    const active = AU_INFO
      .filter((a) => a.id !== 'AU25' && a.id !== 'AU43' && r.au[a.id] >= 0.3)
      .sort((p, q) => r.au[q.id] - r.au[p.id])
      .slice(0, 6);
    const fs = Math.round(Math.max(10, Math.min(18, 13 * scale)));
    ctx.font = `600 ${fs}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.textBaseline = 'middle';
    const placed = [];
    const cx = X(1), cy = Y(1); // punta del naso: centro del volto
    const push = 0.35 * r.geom.interOcular;
    active.forEach((a, k) => {
      // AU bilaterali: un'etichetta sola, alternando il lato; poi spostata
      // verso l'esterno del volto per non coprire occhi e bocca.
      const i = a.anchor[a.anchor.length > 1 ? k % 2 : 0];
      let x = X(i), y = Y(i);
      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > 4) { x += (dx / d) * push; y += (dy / d) * push * 0.6; }
      const label = `${a.id}${intensityLetter(r.au[a.id])}`;
      const w = ctx.measureText(label).width + fs * 0.7;
      const h = fs * 1.5;
      let bx = x - w / 2, by = y - h / 2;
      // Evita sovrapposizioni semplici spostando verso il basso.
      for (const p of placed) {
        if (Math.abs(p.x - bx) < w && Math.abs(p.y - by) < h) by = p.y + h + 2;
      }
      placed.push({ x: bx, y: by });
      ctx.fillStyle = 'rgba(15,23,42,0.78)';
      roundRect(ctx, bx, by, w, h, h / 2);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(label, bx + fs * 0.35, by + h / 2 + 1);
    });
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
