// Funzioni numeriche di supporto (nessuna dipendenza dal DOM: testabili in Node).

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x) => (Number.isFinite(x) ? clamp(x, 0, 1) : 0);

// Raggiunge 1 quando x arriva alla soglia t.
export const soft = (x, t) => clamp01(x / t);

// Triangolare: 0 sotto lo, 1 al picco, 0 sopra hi.
export function bell(x, lo, peak, hi) {
  if (x <= lo || x >= hi) return 0;
  return x < peak ? (x - lo) / (peak - lo) : (hi - x) / (hi - peak);
}

// "OR" probabilistico: combina indizi indipendenti.
export const noisyOr = (...xs) => 1 - xs.reduce((p, x) => p * (1 - clamp01(x)), 1);

// Media geometrica: alta solo se tutti i fattori sono presenti ("AND" morbido).
export function gmean(...xs) {
  let p = 1;
  for (const x of xs) p *= clamp01(x);
  return Math.pow(p, 1 / xs.length);
}

export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Deviazione assoluta mediana (stima robusta del rumore).
export function mad(arr) {
  const m = median(arr);
  return median(arr.map((v) => Math.abs(v - m)));
}

export function mean(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

export function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let s = 0;
  for (const v of arr) s += (v - m) * (v - m);
  return Math.sqrt(s / (arr.length - 1));
}

export function softmax(obj, k = 6) {
  const keys = Object.keys(obj);
  const max = Math.max(...keys.map((key) => obj[key]));
  let sum = 0;
  const out = {};
  for (const key of keys) {
    out[key] = Math.exp(k * (obj[key] - max));
    sum += out[key];
  }
  for (const key of keys) out[key] /= sum;
  return out;
}

// Media mobile esponenziale indipendente dal frame rate.
export function emaAlpha(dtMs, tauMs) {
  if (tauMs <= 0) return 1;
  return 1 - Math.exp(-dtMs / tauMs);
}

export class EmaVector {
  constructor(tauMs) {
    this.tau = tauMs;
    this.value = null;
  }

  update(obj, dtMs, tauMs = this.tau) {
    if (!this.value) {
      this.value = { ...obj };
      return this.value;
    }
    const a = emaAlpha(dtMs, tauMs);
    for (const k in obj) {
      const prev = this.value[k] ?? obj[k];
      this.value[k] = prev + a * (obj[k] - prev);
    }
    return this.value;
  }

  reset() { this.value = null; }
}

// Buffer temporale: conserva campioni {t, v} più recenti di maxAgeMs.
export class TimeBuffer {
  constructor(maxAgeMs) {
    this.maxAge = maxAgeMs;
    this.items = [];
    this.head = 0;
  }

  push(t, v) {
    this.items.push({ t, v });
    const limit = t - this.maxAge;
    while (this.head < this.items.length && this.items[this.head].t < limit) this.head++;
    if (this.head > 512 && this.head > this.items.length / 2) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
  }

  since(t0) {
    const out = [];
    for (let i = this.items.length - 1; i >= this.head; i--) {
      const it = this.items[i];
      if (it.t < t0) break;
      out.push(it);
    }
    return out.reverse();
  }

  values(t0) { return this.since(t0).map((it) => it.v); }

  span() {
    if (this.items.length - this.head < 2) return 0;
    return this.items[this.items.length - 1].t - this.items[this.head].t;
  }

  clear() { this.items = []; this.head = 0; }
}
