# MediaPipe Tasks Vision (copia locale)

File copiati senza modifiche dal pacchetto npm
[`@mediapipe/tasks-vision@0.10.32`](https://www.npmjs.com/package/@mediapipe/tasks-vision/v/0.10.32)
(Google LLC, licenza Apache 2.0 — vedi `LICENSE`). Il modello
`models/face_landmarker.task` (float16, versione 1) proviene da
`storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/`
ed è distribuito da Google con la stessa licenza.

Sono serviti dallo stesso sito dell'app perché:

- **nessuna richiesta a CDN o server esterni** (la Content-Security-Policy della pagina le blocca);
- l'app funziona anche **offline** (service worker);
- la versione resta fissa e verificabile.

Perché proprio la 0.10.32: le versioni 1.x del pacchetto includono un endpoint
di telemetria (`odml.pa.googleapis.com/v1/log`) per inviare a Google metriche
d'uso; la 0.10.32 non contiene alcun URL di rete.

| File | SHA-256 |
| --- | --- |
| `vision_bundle.mjs` | `de83c48ff329717a27aeb528d5ef5f47f077c628a5302dc483aca5b513e7464b` |
| `wasm/vision_wasm_internal.js` | `6f6b86509cf9e163ea1cfec7edc8cf53732699c04781e4c21c557c1ba402310e` |
| `wasm/vision_wasm_internal.wasm` | `cb3ec20026a9aecc2a81a93c25630ceb5389297ddb7a5f0bd61dd09cde606b9b` |
| `wasm/vision_wasm_nosimd_internal.js` | `9f8fc960e363f0fb2f42f7937b97ae9cf9a5630490f71031fa90caa9bb121938` |
| `wasm/vision_wasm_nosimd_internal.wasm` | `924274fcd5ac8985f6570a8573e7971b7bd2d580ba1b8f3beb0ba8f95db6347c` |
| `../../models/face_landmarker.task` | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |

Per verificarli: `sha256sum vendor/mediapipe/vision_bundle.mjs vendor/mediapipe/wasm/* models/face_landmarker.task`
