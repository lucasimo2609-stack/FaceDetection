// Avvio dell'applicazione: collega fotocamera, MediaPipe, analisi e interfaccia.
// Tutto avviene nel browser: i fotogrammi non vengono salvati né trasmessi.

import { createLandmarker } from './landmarker.js';
import { Camera } from './camera.js';
import { Analyzer } from './analyzer.js';
import { Overlay } from './overlay.js';
import { Panels } from './ui.js';
import { Timeline, Circumplex, ShapeView } from './charts.js';
import { SessionRecorder, downloadText } from './session.js';
import { EMOTIONS, EMOTION_BY_ID } from './emotions.js';
import { STATES } from './states.js';
import { startPrivacyMonitor } from './privacy.js';
import { PersonalModel } from './model.js';
import { setupInstallBanner, isStandalone, cameraAlreadyAllowed } from './install.js';
import { SHAPE_DATA } from './shape-data.js';

const $ = (sel) => document.querySelector(sel);

const video = $('#video');
const stage = $('#stage');
const stageMsg = $('#stage-msg');
const stageText = $('#stage-text');
const btnStart = $('#btn-start');
const btnStartBig = $('#btn-start-big');
const btnSwitch = $('#btn-switch');
const selCamera = $('#sel-camera');
const btnCalibrate = $('#btn-calibrate');
const btnTrain = $('#btn-train');
const selOverlay = $('#sel-overlay');
const selReactivity = $('#sel-reactivity');
const chkHide = $('#chk-hide-video');
const btnRecord = $('#btn-record');
const perf = $('#perf');
const calib = $('#calib');
const calibText = $('#calib-text');
const calibBar = $('#calib-bar');

let storage = null;
try { storage = window.localStorage; } catch { storage = null; }

const camera = new Camera(video);
const analyzer = new Analyzer({ storage });
const overlay = new Overlay($('#overlay'));
const panels = new Panels();
const timeline = new Timeline($('#timeline'));
const circumplex = new Circumplex($('#circumplex'));
const shapeView = new ShapeView($('#shape-view'));
const recorder = new SessionRecorder();

let landmarker = null;
let delegate = '';
let loadingPromise = null;
let running = false;
let lastVideoTime = -1;
let lastUi = 0;
let lastChart = 0;
let fps = 0, inferMs = 0, lastFrameT = 0;
let wakeLock = null;
let lastResult = null;

// ---------- Preferenze (solo impostazioni, nessun dato personale) ----------
const PREF_KEY = 'facs-prefs-v1';
function loadPrefs() {
  try { return JSON.parse(storage?.getItem(PREF_KEY) || '{}'); } catch { return {}; }
}
function savePrefs() {
  try {
    storage?.setItem(PREF_KEY, JSON.stringify({
      overlay: selOverlay.value, reactivity: selReactivity.value, hide: chkHide.checked,
    }));
  } catch { /* ignora */ }
}
const prefs = loadPrefs();
if (prefs.overlay) selOverlay.value = prefs.overlay;
if (prefs.reactivity) selReactivity.value = prefs.reactivity;
chkHide.checked = Boolean(prefs.hide);
applySettings();

function applySettings() {
  overlay.mode = selOverlay.value;
  overlay.hideVideo = chkHide.checked;
  stage.classList.toggle('hide-video', chkHide.checked);
  analyzer.reactivity = Number(selReactivity.value) || 1;
}
selOverlay.addEventListener('change', () => { applySettings(); savePrefs(); });
selReactivity.addEventListener('change', () => { applySettings(); savePrefs(); });
chkHide.addEventListener('change', () => { applySettings(); savePrefs(); });

// ---------- Legenda del grafico temporale ----------
const legend = $('#timeline-legend');
for (const e of EMOTIONS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'legend-item';
  b.textContent = `${e.emoji} ${e.label}`;
  b.style.setProperty('--c', e.color);
  b.classList.toggle('off', timeline.hidden.has(e.id));
  b.addEventListener('click', () => {
    timeline.toggle(e.id);
    b.classList.toggle('off', timeline.hidden.has(e.id));
  });
  legend.append(b);
}

// ---------- Caricamento del modello ----------
function setStageMessage(text, { showButton = false, error = false } = {}) {
  stageMsg.hidden = !text && !showButton;
  stageText.textContent = text || '';
  stageMsg.classList.toggle('error', error);
  btnStartBig.hidden = !showButton;
}

function loadModel() {
  if (!loadingPromise) {
    loadingPromise = createLandmarker({ onStatus: (s) => { if (!running) setStageMessage(s); } })
      .then((res) => {
        landmarker = res.landmarker;
        delegate = res.delegate;
        if (!running) setStageMessage('Modello pronto. Avvia la fotocamera per iniziare.', { showButton: true });
        return res;
      })
      .catch((err) => {
        loadingPromise = null;
        console.error(err);
        setStageMessage(`Impossibile caricare il modello: ${err.message || err}`, { showButton: true, error: true });
        throw err;
      });
  }
  return loadingPromise;
}

// ---------- Fotocamera ----------
async function startCamera(opts = {}, { auto = false } = {}) {
  btnStart.disabled = true;
  btnStartBig.disabled = true;
  try {
    setStageMessage('Richiesta accesso alla fotocamera…');
    await camera.start(opts);
    await loadModel();
    setStageMessage('');
    onVideoResize();
    running = true;
    lastVideoTime = -1;
    btnStart.textContent = 'Ferma';
    btnStart.classList.remove('primary');
    btnSwitch.disabled = false;
    btnCalibrate.disabled = false;
    btnTrain.disabled = false;
    btnRecord.disabled = false;
    selCamera.disabled = false;
    await refreshDeviceList();
    requestWakeLock();
    schedule();
  } catch (err) {
    console.error(err);
    camera.stop();
    running = false;
    if (auto) {
      // Avvio automatico non riuscito (es. permesso da confermare): basta un tocco.
      setStageMessage('Tocca «Avvia fotocamera» per iniziare.', { showButton: true });
      return;
    }
    const msg = err?.name === 'NotAllowedError'
      ? 'Accesso alla fotocamera negato. Consentilo dalle impostazioni del browser e riprova.'
      : err?.name === 'NotFoundError'
        ? 'Nessuna fotocamera trovata.'
        : (err?.message || String(err));
    setStageMessage(msg, { showButton: true, error: true });
  } finally {
    btnStart.disabled = false;
    btnStartBig.disabled = false;
  }
}

function stopCamera() {
  running = false;
  camera.stop();
  overlay.clear();
  releaseWakeLock();
  if (recorder.recording) stopRecording();
  btnStart.textContent = 'Avvia fotocamera';
  btnStart.classList.add('primary');
  btnSwitch.disabled = true;
  btnCalibrate.disabled = true;
  btnTrain.disabled = true;
  btnRecord.disabled = true;
  selCamera.disabled = true;
  if (training) training.cancelled = true;
  setStageMessage('Fotocamera spenta.', { showButton: true });
  perf.textContent = delegate ? `${delegate} · in pausa` : '—';
}

async function refreshDeviceList() {
  const devices = await camera.listDevices();
  selCamera.innerHTML = '';
  devices.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || `Fotocamera ${i + 1}`;
    if (d.deviceId === camera.deviceId) o.selected = true;
    selCamera.append(o);
  });
  selCamera.hidden = devices.length < 2;
}

function onVideoResize() {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return;
  stage.style.aspectRatio = `${w} / ${h}`;
  overlay.resize(w, h);
  overlay.mirror = camera.shouldMirror;
  video.classList.toggle('mirror', camera.shouldMirror);
}
video.addEventListener('resize', onVideoResize);

btnStart.addEventListener('click', () => (running ? stopCamera() : startCamera()));
btnStartBig.addEventListener('click', () => startCamera());
btnSwitch.addEventListener('click', async () => {
  running = false;
  try {
    await camera.switchFacing();
    onVideoResize();
    running = true;
    lastVideoTime = -1;
    analyzer.temporal.reset();
    await refreshDeviceList();
    schedule();
  } catch (err) {
    setStageMessage(`Impossibile cambiare fotocamera: ${err.message}`, { showButton: true, error: true });
  }
});
selCamera.addEventListener('change', async () => {
  running = false;
  try {
    await camera.start({ deviceId: selCamera.value });
    onVideoResize();
    running = true;
    lastVideoTime = -1;
    analyzer.temporal.reset();
    schedule();
  } catch (err) {
    setStageMessage(`Impossibile usare questa fotocamera: ${err.message}`, { showButton: true, error: true });
  }
});

// ---------- Ciclo di analisi ----------
let rafId = 0;
function schedule() {
  if (!rafId) rafId = requestAnimationFrame(frame);
}
function frame() {
  rafId = 0;
  if (!running) return;
  processFrame();
  schedule();
}

// Alcuni dispositivi creano il modello su GPU ma poi falliscono durante
// l'inferenza: dopo alcuni errori consecutivi si ripiega sulla CPU.
let detectErrors = 0;
let fallingBack = false;
function fallbackToCpu() {
  if (fallingBack || delegate !== 'GPU') return;
  fallingBack = true;
  const old = landmarker;
  landmarker = null;
  try { old?.close(); } catch { /* ignora */ }
  createLandmarker({ preferGpu: false })
    .then((res) => {
      landmarker = res.landmarker;
      delegate = res.delegate;
      loadingPromise = Promise.resolve(res);
      detectErrors = 0;
      toast('GPU non disponibile: analisi su CPU');
    })
    .catch((err) => setStageMessage(`Errore del modello: ${err.message}`, { showButton: true, error: true }))
    .finally(() => { fallingBack = false; });
}

function processFrame() {
  const now = performance.now();
  if (landmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    let result = null;
    const t0 = performance.now();
    try {
      result = landmarker.detectForVideo(video, now);
      detectErrors = 0;
    } catch (err) {
      console.error(err);
      if (++detectErrors >= 5) fallbackToCpu();
    }
    const t1 = performance.now();
    inferMs = inferMs ? inferMs * 0.9 + (t1 - t0) * 0.1 : t1 - t0;
    if (lastFrameT) fps = fps ? fps * 0.9 + (1000 / (now - lastFrameT)) * 0.1 : 1000 / (now - lastFrameT);
    lastFrameT = now;

    const r = analyzer.update(result, now, video.videoWidth, video.videoHeight);
    lastResult = r;
    overlay.draw(r, r.face ? EMOTION_BY_ID[r.dominant].color : undefined);
    recorder.push(r);
    if (r.face && r.micro?.length) panels.addMicro(r.micro, now);
    if (r.face && r.temporal.events.length) handleEvents(r.temporal.events);

    if (analyzer.calibrating || calib.dataset.active === '1') updateCalibrationUi(now, r);
    if (analyzer.capturing) updateTrainingUi(now, r);

    if (now - lastUi > 100) {
      lastUi = now;
      panels.update(r);
      perf.textContent = `${delegate} · ${Math.round(fps)} fps · ${inferMs.toFixed(0)} ms`;
      if (recorder.recording) btnRecord.textContent = `■ Stop ${formatTime(recorder.elapsed(now))}`;
    }
    if (now - lastChart > 200) {
      lastChart = now;
      timeline.push(now, r.face ? r.probs : null);
      if (r.face) circumplex.push(now, r.valence, r.arousal);
      timeline.draw(now);
      circumplex.draw();
      if (r.face) {
        const cal = analyzer.calibration?.contours;
        $('#shape-ref').textContent = cal ? 'rispetto al tuo viso neutro' : 'rispetto a un viso medio · calibra per usare il tuo';
        shapeView.mirror = camera.shouldMirror;
        shapeView.draw(r.contours, cal || SHAPE_DATA.neutralContours, { amplify: cal ? 2 : 1, color: EMOTION_BY_ID[r.dominant].color });
      }
    }
  }
}

function handleEvents(events) {
  for (const ev of events) {
    if (ev.type === 'yawn') toast('🥱 Sbadiglio rilevato');
    if (ev.type === 'long') toast(`😴 Occhi chiusi per ${(ev.duration / 1000).toFixed(1)} s`);
  }
}

let toastTimer = null;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- Calibrazione con viso neutro ----------
function updateCalibrationUi(now, r) {
  if (!analyzer.calibrating) return;
  const p = analyzer.calibrationProgress(now);
  calibBar.style.transform = `scaleX(${p})`;
  calibText.textContent = r.face ? 'Viso rilassato, sguardo verso lo schermo…' : 'Volto non visibile!';
}

async function runCalibration() {
  if (!running) {
    toast('Avvia prima la fotocamera');
    return;
  }
  btnCalibrate.disabled = true;
  calib.hidden = false;
  calib.dataset.active = '1';
  calibBar.style.transform = 'scaleX(0)';
  for (const n of [3, 2, 1]) {
    calibText.textContent = `Rilassa il viso, guarda lo schermo… ${n}`;
    await new Promise((res) => setTimeout(res, 800));
  }
  try {
    await analyzer.startCalibration(3000);
    toast('✅ Calibrazione completata');
    updateCalibrationStatus();
  } catch (err) {
    toast(`⚠️ ${err.message}`);
  } finally {
    calib.hidden = true;
    calib.dataset.active = '0';
    btnCalibrate.disabled = false;
  }
}
btnCalibrate.addEventListener('click', runCalibration);
$('#btn-calib-hint').addEventListener('click', runCalibration);
$('#btn-calib-reset').addEventListener('click', () => {
  analyzer.clearCalibration();
  updateCalibrationStatus();
  toast('Calibrazione rimossa');
});

function updateCalibrationStatus() {
  const s = $('#calib-status');
  if (analyzer.calibration) {
    const d = new Date(analyzer.calibration.created);
    s.textContent = `Calibrato il ${d.toLocaleDateString('it-IT')} alle ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
    $('#btn-calib-reset').hidden = false;
  } else {
    s.textContent = 'Non calibrato: valori di riposo generici.';
    $('#btn-calib-reset').hidden = true;
  }
}
updateCalibrationStatus();

// ---------- Addestramento guidato sul viso della persona ----------
// Per ogni emozione: istruzioni, conto alla rovescia, 2,5 s di registrazione.
// Si salvano solo i vettori numerici medi (nessuna immagine).
const TRAIN_STEPS = [
  { id: 'neutral', text: 'Viso rilassato, bocca chiusa, sguardo verso lo schermo. Serve anche come calibrazione.' },
  { id: 'joy', text: 'Sorriso pieno, come quando vedi una persona cara: sorridono anche gli occhi.' },
  { id: 'surprise', text: 'Alza le sopracciglia, spalanca gli occhi e lascia cadere la mandibola.' },
  { id: 'sadness', text: 'Angoli della bocca in giù, parte interna delle sopracciglia in su, sguardo un po\' basso.' },
  { id: 'anger', text: 'Sopracciglia aggrottate e abbassate, sguardo fisso, labbra serrate.' },
  { id: 'fear', text: 'Sopracciglia alzate e avvicinate, occhi sgranati, labbra tirate indietro.' },
  { id: 'disgust', text: 'Arriccia il naso e solleva il labbro superiore, come davanti a un cattivo odore.' },
  { id: 'contempt', text: 'Solleva e stringi un solo angolo della bocca, in un mezzo sorriso sprezzante.' },
];
const trainBox = $('#train');
let training = null;

let captureTitle = '';
function updateTrainingUi(now, r) {
  $('#train-bar').style.transform = `scaleX(${analyzer.captureProgress(now)})`;
  $('#train-title').textContent = r.face ? captureTitle : 'Volto non visibile!';
}

function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }

async function runTraining() {
  if (!running) { toast('Avvia prima la fotocamera'); return; }
  if (training) return;
  training = { cancelled: false, skip: false };
  btnTrain.disabled = true;
  btnCalibrate.disabled = true;
  trainBox.hidden = false;
  const samples = {};
  try {
    for (let i = 0; i < TRAIN_STEPS.length; i++) {
      const step = TRAIN_STEPS[i];
      const e = EMOTION_BY_ID[step.id];
      training.skip = false;
      trainBox.classList.remove('capturing');
      $('#train-emoji').textContent = e.emoji;
      $('#train-text').textContent = step.text;
      $('#train-bar').style.transform = 'scaleX(0)';
      for (const n of [3, 2, 1]) {
        if (training.cancelled || training.skip) break;
        $('#train-title').textContent = `${i + 1}/${TRAIN_STEPS.length} · ${e.label} — preparati… ${n}`;
        await sleep(700);
      }
      if (training.cancelled) break;
      if (training.skip) continue;
      trainBox.classList.add('capturing');
      captureTitle = `${i + 1}/${TRAIN_STEPS.length} · ${e.label} — mantieni l'espressione!`;
      $('#train-title').textContent = captureTitle;
      const got = await analyzer.capture(2500);
      if (training.cancelled) break;
      if (training.skip || !got) continue;
      if (got.length < 8) {
        toast(`⚠️ ${e.label}: volto poco visibile, passo saltato`);
        continue;
      }
      // Scarta i primi fotogrammi (transizione verso l'espressione).
      const kept = got.slice(Math.floor(got.length * 0.25));
      samples[step.id] = kept.map((s) => s.x);
      if (step.id === 'neutral') {
        analyzer.calibrateFrom(kept);
        updateCalibrationStatus();
      }
    }
    if (!training.cancelled) {
      const model = PersonalModel.train(samples);
      analyzer.setPersonal(model);
      const similar = similarPairs(model);
      toast(similar ? `✅ Addestramento completato · ${similar} molto simili: puoi ripeterle più marcate`
        : '✅ Addestramento completato: ora riconosco le tue espressioni');
    }
  } catch (err) {
    toast(`⚠️ ${err.message}`);
  } finally {
    analyzer.cancelCapture();
    trainBox.hidden = true;
    training = null;
    btnTrain.disabled = !running;
    btnCalibrate.disabled = !running;
    updatePersonalStatus();
  }
}

// Coppie di espressioni registrate quasi uguali (difficili da distinguere).
function similarPairs(model) {
  const { centroids, weights, temperature } = model.data;
  const ids = Object.keys(centroids);
  const out = [];
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      let d = 0;
      for (let j = 0; j < weights.length; j++) d += weights[j] * (centroids[ids[a]][j] - centroids[ids[b]][j]) ** 2;
      if (d < 1.2 * temperature) out.push(`${EMOTION_BY_ID[ids[a]].label} e ${EMOTION_BY_ID[ids[b]].label}`);
    }
  }
  return out.slice(0, 2).join(', ');
}

btnTrain.addEventListener('click', runTraining);
$('#btn-train-hint').addEventListener('click', runTraining);
$('#btn-train-skip').addEventListener('click', () => { if (training) { training.skip = true; analyzer.cancelCapture(); } });
$('#btn-train-cancel').addEventListener('click', () => { if (training) { training.cancelled = true; analyzer.cancelCapture(); } });
$('#btn-personal-reset').addEventListener('click', () => {
  analyzer.clearPersonal();
  updatePersonalStatus();
  toast('Addestramento personale eliminato');
});

function updatePersonalStatus() {
  const s = $('#personal-status');
  const p = analyzer.personal;
  if (p) {
    const d = new Date(p.data.created);
    const names = p.ids.map((id) => EMOTION_BY_ID[id].emoji).join(' ');
    s.textContent = `Modello personale del ${d.toLocaleDateString('it-IT')} (${p.ids.length}/8: ${names})`;
    $('#btn-personal-reset').hidden = false;
  } else {
    s.textContent = 'Nessun addestramento personale: si usa il modello generico.';
    $('#btn-personal-reset').hidden = true;
  }
}
updatePersonalStatus();

// ---------- Registrazione della sessione (solo numeri) ----------
function startRecording() {
  recorder.begin(performance.now());
  btnRecord.classList.add('recording');
  btnRecord.textContent = '■ Stop 00:00';
}

function stopRecording() {
  recorder.end();
  btnRecord.classList.remove('recording');
  btnRecord.textContent = '● Registra';
  showSummary();
}
btnRecord.addEventListener('click', () => (recorder.recording ? stopRecording() : startRecording()));

function showSummary() {
  const s = recorder.summary();
  const box = $('#summary-body');
  box.innerHTML = '';
  const add = (label, value) => {
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value;
    box.append(dt, dd);
  };
  add('Durata', formatTime(s.durationS * 1000));
  add('Volto presente', `${Math.round(s.facePresence * 100)}% del tempo`);
  const dom = EMOTIONS.map((e) => [e, s.dominantShare[e.id]]).filter(([, v]) => v > 0.01).sort((a, b) => b[1] - a[1]);
  add('Emozioni prevalenti', dom.length ? dom.map(([e, v]) => `${e.emoji} ${e.label} ${Math.round(v * 100)}%`).join(' · ') : '—');
  const st = STATES.map((x) => [x, s.states[x.id]]).sort((a, b) => b[1] - a[1]).slice(0, 4);
  add('Stati più presenti (media)', st.map(([x, v]) => `${x.emoji} ${x.label} ${Math.round(v * 100)}%`).join(' · '));
  add('Valenza / attivazione medie', `${s.valence.toFixed(2)} / ${s.arousal.toFixed(2)}`);
  add('Attenzione media', `${Math.round(s.attention * 100)}%`);
  add('Ammiccamenti', s.blinkRate === null ? '—' : `${Math.round(s.blinkRate)}/min`);
  add('Micro-espressioni', String(s.microCount));
  $('#dlg-summary').showModal();
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
$('#btn-export-csv').addEventListener('click', () => downloadText(`sessione-facs-${stamp()}.csv`, recorder.toCSV(), 'text/csv'));
$('#btn-export-json').addEventListener('click', () => downloadText(`sessione-facs-${stamp()}.json`, recorder.toJSON(), 'application/json'));

// ---------- Finestre di dialogo ----------
for (const btn of document.querySelectorAll('[data-close]')) {
  btn.addEventListener('click', () => btn.closest('dialog').close());
}
$('#btn-help').addEventListener('click', () => $('#dlg-help').showModal());

// ---------- Schermo sempre acceso durante l'analisi (tablet/telefono) ----------
async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch { /* ignora */ }
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && running) {
    // Su iPad/iPhone il sistema spegne la fotocamera quando l'app va in
    // secondo piano: al ritorno la riaccendiamo.
    if (camera.ended) {
      running = false;
      startCamera({}, { auto: true });
      return;
    }
    requestWakeLock();
    schedule();
  }
});

window.addEventListener('resize', () => {
  if (lastResult) { timeline.draw(performance.now()); circumplex.draw(); }
});

// ---------- Avvio ----------
startPrivacyMonitor($('#privacy-badge'), $('#privacy-detail'));
timeline.draw(performance.now());
circumplex.draw();
panels.update({ face: false });
setStageMessage('Caricamento del modello…');
setupInstallBanner({ storage });

// Aperta come app dalla schermata Home (o con la fotocamera già autorizzata):
// la fotocamera parte da sola, senza dover premere nulla.
(async () => {
  try { await loadModel(); } catch { return; }
  if (running) return;
  if (isStandalone() || await cameraAlreadyAllowed()) startCamera({}, { auto: true });
})();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker non registrato', err));
  // Avvisa una volta quando modello e runtime sono salvati: da lì in poi l'app
  // funziona anche senza internet.
  navigator.serviceWorker.ready.then(async () => {
    try {
      if (storage?.getItem('facs-offline-ready')) return;
      const key = (await caches.keys()).find((k) => k.includes('assets'));
      if (!key) return;
      const c = await caches.open(key);
      if (await c.match('vendor/mediapipe/wasm/vision_wasm_internal.wasm') && await c.match('models/face_landmarker.task')) {
        storage?.setItem('facs-offline-ready', '1');
        toast('✅ Pronta: da ora funziona anche senza internet');
      }
    } catch { /* ignora */ }
  });
}

// Esposto per i test automatici (solo lettura dei numeri).
window.__facs = { get last() { return lastResult; }, get delegate() { return delegate; }, analyzer };
