// Test end-to-end di privacy e funzionamento (Chromium headless + fotocamera finta).
//
// Verifica che: la pagina carichi il modello, la fotocamera si avvii,
// l'analisi giri, e che NESSUNA richiesta parta verso un'origine diversa da
// quella locale e nessuna violazione della Content-Security-Policy avvenga.
//
// Requisiti: Playwright con Chromium (`npm i -D playwright && npx playwright install chromium`).
// Uso:
//   python3 -m http.server 8000 &          # dalla cartella del progetto
//   node tests/e2e/privacy-smoke.mjs [http://localhost:8000/] [video.y4m]
// Con un video .y4m di un volto si verifica anche il rilevamento del viso.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright non trovato: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const url = process.argv[2] || 'http://localhost:8000/';
const video = process.argv[3];
const origin = new URL(url).origin;

const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
if (video) args.push(`--use-file-for-fake-video-capture=${video}`);

const browser = await chromium.launch({ args });
const context = await browser.newContext({ permissions: ['camera'] });
const page = await context.newPage();
const external = [];
const errors = [];
page.on('request', (r) => {
  const u = new URL(r.url());
  if (u.protocol === 'blob:' || u.protocol === 'data:') return;
  if (u.origin !== origin) external.push(r.url());
});
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/XNNPACK|TensorFlow Lite/.test(m.text())) errors.push(m.text());
});
await page.addInitScript(() => {
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
});

let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? '✔' : '✘'} ${msg}`);
  if (!ok) failed = true;
};

try {
  await page.goto(url);
  await page.waitForSelector('#btn-start-big:not([hidden])', { timeout: 120000 });
  check(true, 'modello caricato');
  await page.click('#btn-start');
  await page.waitForFunction(() => window.__facs?.last, null, { timeout: 30000 });
  await page.waitForTimeout(4000);
  const state = await page.evaluate(() => ({
    delegate: window.__facs.delegate,
    face: window.__facs.last.face,
    dominant: window.__facs.last.dominant,
    badge: document.querySelector('#privacy-badge').textContent,
    csp: window.__cspViolations,
  }));
  check(true, `analisi in esecuzione (delegate ${state.delegate})`);
  if (video) check(state.face, `volto rilevato (emozione dominante: ${state.dominant})`);
  check(external.length === 0, `nessuna richiesta esterna ${external.length ? JSON.stringify(external) : ''}`);
  check(state.csp.length === 0, `nessuna violazione CSP ${state.csp.length ? JSON.stringify(state.csp) : ''}`);
  check(state.badge.includes('100% locale'), `indicatore privacy: "${state.badge}"`);
  check(errors.length === 0, `nessun errore JavaScript ${errors.length ? JSON.stringify(errors) : ''}`);
} catch (err) {
  check(false, `eccezione: ${err.message}`);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
