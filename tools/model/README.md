# Modello globale delle emozioni

`js/model-data.js` contiene una regressione logistica (8 classi × 69 feature)
che l'app combina con le regole FACS. Qui c'è tutto il necessario per
riprodurla o riaddestrarla. **Nessuna immagine è inclusa nel repository.**

## Dati usati

- Dataset pubblico [`muxspace/facial_expressions`](https://github.com/muxspace/facial_expressions)
  (immagini raccolte dal web, etichettate con le stesse 8 classi dell'app).
- Campione usato: tutte le immagini di tristezza, sorpresa, rabbia, disgusto,
  paura e disprezzo + 1.250 neutre + 1.250 di gioia → 3.482 volti rilevati da
  MediaPipe (escluse 4 foto in posa tenute da parte per la verifica).
- Le etichette di disgusto e disprezzo sono poche e rumorose (fotogrammi di film
  sfocati): per queste emozioni l'app si affida soprattutto alle regole FACS.

## Cosa abbiamo imparato dai dati

Misurando i blendshape di MediaPipe su volti reali:

- `noseSneer*` e `cheekSquint*` restano praticamente a 0 → il "naso arricciato"
  (AU9) non è osservabile; il disgusto si legge da AU10/AU15/AU16.
- `eyeWide*` supera di rado 0,15; gli occhi spalancati (AU5) si vedono meglio
  come **calo di `eyeSquint*`** sotto il valore a riposo (~0,36) e come
  aumento dell'apertura palpebrale.
- `mouthFrown*` arriva a ~0,25, `mouthDimple*` a ~0,1.

Gli intervalli `DEFAULT_RANGE` in `js/facs.js` derivano da queste misure
(mediana dei volti neutri, 97° percentile di tutti i volti).

## Validazione

Validazione incrociata **per contributore** (le stesse persone non sono mai
sia in addestramento sia in test), più un piccolo set di 12 espressioni in posa.

| | Foto dal web: accuratezza | Media recall 6 classi* | In posa (12) |
| --- | --- | --- | --- |
| Solo regole FACS | 49,7% | 31,0% | 10/12 |
| Solo modello | 59,0% | 48,2% | 6/12 |
| **Combinazione usata dall'app** | **57,3%** | **39,3%** | **10/12** |

\* neutralità, gioia, tristezza, sorpresa, paura, rabbia (le classi con etichette affidabili).

Il modello da solo è migliore sulle foto dal web, ma lì "rabbia" vuol dire
spesso urlo e "tristezza" sguardo basso; sulle espressioni in posa (quello che
si fa davanti alla webcam) le regole FACS sono più affidabili. Per questo l'app
dà al modello peso 0,7 per neutralità/gioia/sorpresa (molti dati puliti) e 0,2
per le altre emozioni (`GLOBAL_WEIGHT` in `js/analyzer.js`).

Il guadagno più grande per una singola persona viene comunque
dall'**addestramento personale** nell'app (🧑‍🏫 *Addestra sul tuo viso*).

## Riprodurre

```bash
# 1. scarica le immagini in una cartella servita dal server dell'app
#    e prepara una lista JSON [{"img": "/dati/xxx.jpg", "label": "anger"}, ...]
python3 -m http.server 8000 &
# 2. estrai blendshape e geometria con MediaPipe (Playwright + Chromium)
node tools/model/extract.mjs "http://localhost:8000/tools/model/extract.html?list=/dati/lista.json" features.json
# 3. calcola le feature con il codice dell'app
node tools/model/export_matrix.mjs features.json matrix.json
# 4. valida e scrivi js/model-data.js (richiede numpy e scikit-learn)
python3 tools/model/train.py matrix.json legend.csv --write
```
