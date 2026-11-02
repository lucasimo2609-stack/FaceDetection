// Inizializzazione di MediaPipe Face Landmarker. Libreria WebAssembly e
// modello sono serviti da questo stesso sito (cartelle vendor/ e models/):
// nessuna CDN, nessuna richiesta verso server esterni.

import { FilesetResolver, FaceLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

const WASM_DIR = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
const MODEL_URL = new URL('../models/face_landmarker.task', import.meta.url).href;

export async function createLandmarker({ preferGpu = true, onStatus = () => {} } = {}) {
  onStatus('Caricamento runtime WebAssembly…');
  const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
  if (preferGpu) {
    try {
      onStatus('Caricamento modello (GPU)…');
      const lm = await FaceLandmarker.createFromOptions(fileset, options('GPU'));
      return { landmarker: lm, delegate: 'GPU' };
    } catch (err) {
      console.warn('GPU non disponibile, uso la CPU', err);
    }
  }
  onStatus('Caricamento modello (CPU)…');
  const lm = await FaceLandmarker.createFromOptions(fileset, options('CPU'));
  return { landmarker: lm, delegate: 'CPU' };
}
