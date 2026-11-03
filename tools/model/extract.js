// Estrae blendshape e geometria con MediaPipe per una lista di immagini.
// Aperta da extract.mjs tramite Playwright; usa gli stessi moduli dell'app.
import { FilesetResolver, FaceLandmarker } from '../../vendor/mediapipe/vision_bundle.mjs';
import { toBlendshapeMap, geometry } from '../../js/facs.js';

const listUrl = new URLSearchParams(location.search).get('list');
const list = await (await fetch(listUrl)).json(); // [{img: 'url relativa', label}]
const fileset = await FilesetResolver.forVisionTasks(new URL('../../vendor/mediapipe/wasm', import.meta.url).href);
const fl = await FaceLandmarker.createFromOptions(fileset, {
  baseOptions: { modelAssetPath: new URL('../../models/face_landmarker.task', import.meta.url).href, delegate: 'CPU' },
  runningMode: 'IMAGE', numFaces: 1, outputFaceBlendshapes: true,
});
const out = [];
window.progress = 0;
for (const it of list) {
  try {
    const img = new Image();
    img.src = it.img;
    await img.decode();
    const r = fl.detect(img);
    out.push(r.faceLandmarks.length
      ? {
        ...it, face: true, w: img.naturalWidth, h: img.naturalHeight,
        b: toBlendshapeMap(r.faceBlendshapes[0].categories),
        geom: geometry(r.faceLandmarks[0], img.naturalWidth, img.naturalHeight),
        // Landmark arrotondati: servono per calcolare la forma (shape.js) offline.
        lm: r.faceLandmarks[0].map((p) => [+p.x.toFixed(5), +p.y.toFixed(5), +p.z.toFixed(5)]),
      }
      : { ...it, face: false });
  } catch (e) {
    out.push({ ...it, face: false, err: String(e) });
  }
  window.progress++;
}
document.querySelector('#s').textContent = 'Fatto';
window.result = out;
