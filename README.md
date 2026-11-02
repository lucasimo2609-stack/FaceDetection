# Lettore di Espressioni FACS

Applicazione web che legge le espressioni del viso dalla **webcam del PC** o dalla
**fotocamera di telefono/iPad**, usando **MediaPipe Face Landmarker** di Google e il
**Facial Action Coding System (FACS)**. I dati vengono combinati in
**8 emozioni di base** e **12 stati più sottili**.

**Nessuna immagine esce dal dispositivo**: l'analisi gira interamente nel browser
(WebAssembly + WebGL), i fotogrammi non vengono salvati né trasmessi, e la pagina
è configurata in modo da *non poter* contattare altri server.

---

## Avvio rapido

### Sul PC
```bash
python3 -m http.server 8000
```
Poi apri <http://localhost:8000> e premi **Avvia fotocamera**.

**Per una buona precisione sul tuo viso** premi **🧑‍🏫 Addestra sul tuo viso**: l'app
ti chiede di fare, una alla volta, le 8 espressioni (circa 40 secondi in tutto) e
impara come le fai *tu*. Include anche la calibrazione del viso neutro. Se hai
poco tempo, almeno **🎯 Calibra** (3 secondi con il viso rilassato). Entrambi
vengono salvati nel browser solo come numeri e restano per le volte successive.

> Non aprire `index.html` con doppio clic (`file://`): i moduli JavaScript e la
> fotocamera richiedono un server, anche locale.

### Su iPad / telefono
Il browser concede la fotocamera solo su **HTTPS**. Due possibilità:

1. **GitHub Pages (consigliato)** — il workflow `.github/workflows/pages.yml`
   pubblica l'app a ogni push sul ramo `main`. Una tantum: *Settings → Pages →
   Build and deployment → Source: GitHub Actions*. L'indirizzo sarà
   `https://<utente>.github.io/<repository>/`. Da Safari si può poi fare
   *Condividi → Aggiungi alla schermata Home*: l'app si installa e funziona anche
   offline. (Pages gratuito richiede un repository pubblico.)
2. **Rete locale** — sul PC:
   ```bash
   python3 scripts/serve_https.py
   ```
   e apri sul tablet l'indirizzo `https://192.168.x.x:8443/` stampato a schermo
   (stessa rete Wi-Fi). Il certificato è autofirmato: Safari mostra un avviso,
   tocca *Mostra dettagli → visita il sito web*.

Anche in questi casi le immagini restano sul dispositivo che apre la pagina: il
server fornisce solo i file dell'app.

---

## Privacy: come è garantita

| Misura | Dettaglio |
| --- | --- |
| Elaborazione locale | MediaPipe gira nel browser; i fotogrammi passano solo dalla fotocamera all'elemento `<video>` e al modello in memoria. |
| Nessuna CDN | Libreria (`vendor/mediapipe`) e modello (`models/`) sono serviti dallo stesso sito dell'app. |
| Content-Security-Policy | `connect-src 'self'`, `script-src 'self'`: il browser **blocca** qualsiasi richiesta verso altri domini, anche accidentale. |
| Monitor in tempo reale | Il badge **🔒 100% locale** conta le richieste verso altre origini e le violazioni della CSP: se ne comparisse una diventerebbe ⚠️. |
| Niente telemetria | Si usa MediaPipe **0.10.32**: le versioni 1.x includono un endpoint che invia a Google metriche d'uso (`odml.pa.googleapis.com/v1/log`), la 0.10.32 non contiene URL di rete. Gli hash dei file sono verificati in CI. |
| Dati salvati | Solo numeri: la calibrazione e le preferenze in `localStorage`. La registrazione della sessione (AU, emozioni, stati) resta in memoria e si scarica come CSV/JSON solo su richiesta. |
| Test automatico | `tests/e2e/privacy-smoke.mjs` avvia l'app in Chromium e fallisce se parte anche una sola richiesta esterna. |

---

## Come funziona

```
fotocamera ─► MediaPipe Face Landmarker ─► 478 landmark 3D + 52 blendshape + matrice di posa
                                │                       │
                                │                       ▼
                                │     Codifica FACS: 24 Action Unit (intensità A–E)
                                │                       │
                                ▼                       ▼
     modello appreso (globale + personale)    regole FACS (prototipi EMFACS)
                                └──────────┬────────────┘
                                           ▼
                                  8 emozioni di base ──┐
     analisi temporale (ammiccamenti, PERCLOS,         ├──► 12 stati sottili
     sbadigli, movimento, parlato) + posa e sguardo ───┘
```

### 1. Action Unit FACS
I 52 blendshape di MediaPipe (convenzione ARKit) vengono normalizzati rispetto al
valore a riposo (dalla calibrazione) e al massimo tipico di ciascuno, poi
convertiti in AU:

| AU | Nome | Fonte principale |
| --- | --- | --- |
| AU1 / AU2 | Sollevatore interno / esterno sopracciglio | `browInnerUp`, `browOuterUp*` |
| AU4 | Abbassatore sopracciglio | `browDown*` (meno la parte dovuta al sorriso) |
| AU5 | Sollevatore palpebra superiore | `eyeWide*` + apertura palpebrale geometrica |
| AU6 / AU7 | Sollevatore guance / tensore palpebre | `cheekSquint*`, `eyeSquint*` ripartiti in base al sorriso |
| AU9 / AU10 | Arricciatore naso / sollevatore labbro sup. | `noseSneer*`, `mouthUpperUp*` |
| AU12 / AU14 / AU15 | Sorriso / fossette / angoli in giù | `mouthSmile*`, `mouthDimple*`, `mouthFrown*` |
| AU16 / AU17 / AU18 / AU20 / AU22 | Labbro inf. giù / mento / increspatura / stiramento / imbuto | `mouthLowerDown*`, `mouthShrugLower`, `mouthPucker`, `mouthStretch*`, `mouthFunnel` |
| AU23 / AU24 / AU28 | Tensione / compressione / risucchio labbra | `mouthRoll*`, `mouthPress*`, spessore labbra |
| AU25 / AU26 / AU27 | Labbra dischiuse / mandibola / bocca spalancata | distanza tra le labbra, `jawOpen` |
| AU34 / AU43 | Guance gonfie / occhi chiusi | `cheekPuff`, `eyeBlink*` (compensato per lo sguardo in basso) |
| AU51–56 | Rotazioni della testa | matrice di trasformazione facciale |

### 2. Le 8 emozioni di base
Insieme di AffectNet: le 6 universali di Ekman + disprezzo + neutralità.

| Emozione | AU (EMFACS) |
| --- | --- |
| 😐 Neutralità | assenza di configurazioni attive |
| 😄 Gioia | 6 + 12 (sorriso di Duchenne se c'è AU6) |
| 😢 Tristezza | 1 + 4 + 15, oppure 1/15 + 17 |
| 😮 Sorpresa | 1 + 2 + 5 + 26 |
| 😨 Paura | 1 + 2 + 4 + 5 + 7 + 20 + 26 |
| 😠 Rabbia | 4 + 5 + 7 + 23/24 |
| 🤢 Disgusto | 9 / 10 (+15, 16, 17) |
| 😏 Disprezzo | 12 + 14 **unilaterali** |

Le probabilità finali combinano tre fonti (media geometrica pesata):

1. **Regole FACS** qui sopra: affidabili sulle espressioni nette e in posa.
2. **Modello globale appreso**: regressione logistica sui blendshape, addestrata
   su ~3.500 volti etichettati (dettagli e numeri in
   [`tools/model/README.md`](tools/model/README.md)). Pesa 0,7 per
   neutralità/gioia/sorpresa e 0,2 per le altre emozioni.
3. **Modello personale** (se hai fatto l'addestramento): un "prototipo" per
   ciascuna delle tue espressioni; pesa metà del totale e dà anche l'intensità
   rispetto alla tua espressione piena.

Se due emozioni sono forti insieme viene mostrata l'**emozione composta**
(gioia + sorpresa = *meraviglia*, paura + disgusto = *orrore*, tristezza +
sorpresa = *delusione*, ecc.).

### 3. I 12 stati sottili
Non hanno un prototipo FACS universale: combinano AU deboli, posa, sguardo e
dinamiche temporali.

| Stato | Indizi |
| --- | --- |
| 🎯 Concentrazione | AU4 lieve + AU7, ammiccamenti ridotti, testa ferma, sguardo sullo schermo |
| 👀 Interesse | AU1+AU2 lievi, AU5, avvicinamento allo schermo, testa inclinata |
| 😕 Confusione | AU4 + AU7 con testa inclinata, sopracciglia asimmetriche o bocca di lato |
| 🤨 Scetticismo | un solo sopracciglio alzato, AU14 unilaterale, AU24/AU17 |
| 🥱 Noia | volto inespressivo a lungo, palpebre pesanti, sguardo che vaga, sbadigli |
| 😴 Stanchezza | PERCLOS, chiusure lunghe degli occhi, ammiccamenti lenti, sbadigli |
| 😰 Ansia | AU1+AU4, AU20, labbra strette/risucchiate, ammiccamenti frequenti, irrequietezza |
| 😤 Frustrazione | AU4 + AU24/AU23 + AU17, AU14, sbuffi, scuotere la testa |
| 😳 Imbarazzo | sorriso trattenuto + sguardo/testa verso il basso o di lato |
| 🙂 Sorriso di cortesia | AU12 senza AU6 (sorriso non-Duchenne) |
| 🤔 Riflessione | sguardo in alto/di lato, bocca spostata, testa ferma |
| 😌 Orgoglio | testa inclinata all'indietro + piccolo sorriso a labbra chiuse |

Riferimenti: Ekman & Friesen (FACS, EMFACS); D'Mello & Graesser (stati
cognitivo-affettivi); Keltner 1995 (imbarazzo); Tracy & Robins 2004 (orgoglio);
Harrigan & O'Connell 1996 (ansia); Wierwille 1994 (PERCLOS); Du, Tao & Martinez
2014 (emozioni composte); Russell 1980 (modello circonflesso).

---

## Precisione misurata

Sono stati usati due set di prova: circa 3.500 foto prese dal web ed
etichettate (validazione incrociata con persone diverse fra addestramento e
test) e 12 espressioni in posa.

| Versione | Foto dal web | Media recall 6 classi | In posa |
| --- | --- | --- | --- |
| Prima versione (solo regole) | 49,4% | 30,5% | 10/12 |
| Attuale, senza addestramento personale | 57,3% | 39,3% | 10/12 |

Le foto dal web sono molto difficili (luce, angolazioni, etichette rumorose):
anche i migliori sistemi commerciali restano sotto il 70% su dati simili. Per
l'uso con la propria webcam la differenza la fa l'**addestramento personale**.

## Miglioramenti aggiunti rispetto alla richiesta

- **Addestramento sul tuo viso** (40 s, guidato) e **modello globale** tarato su
  dati reali, combinati con le regole FACS.
- **Intervalli dei blendshape misurati su dati reali**: ad esempio MediaPipe
  non attiva quasi mai `noseSneer`/`cheekSquint`, e gli occhi spalancati si
  leggono dal calo di `eyeSquint` più che da `eyeWide`.
- **Calibrazione del viso neutro**: ogni volto ha un'espressione a riposo diversa
  (sopracciglia alte, angoli della bocca bassi…); 3 secondi di calibrazione la
  sottraggono. Salvata solo come numeri nel browser.
- **Compensazione dei "cross-talk" di MediaPipe**: in un sorriso ampio MediaPipe
  attiva anche `browDown` e `mouthUpperUp`, che sembrerebbero rabbia/disgusto;
  AU4, AU10 e AU20 vengono corretti di conseguenza, e lo strizzare gli occhi viene
  attribuito ad AU6 (sorriso) o AU7 (tensione) a seconda del contesto, come
  prescrive FACS.
- **Sorriso di Duchenne** (genuino) vs sorriso sociale.
- **Micro-espressioni**: picchi di un'emozione più brevi di 0,5 s, elencati con
  durata e intensità.
- **Emozioni composte** (13 combinazioni con nome).
- **Rilevamento del parlato**: quando la mandibola oscilla come nel parlato, le AU
  della bocca pesano meno, riducendo i falsi positivi.
- **Indicatori**: valenza/attivazione (grafico circolare di Russell), attenzione,
  ammiccamenti al minuto, PERCLOS, sbadigli, posa della testa, sguardo.
- **Grafico temporale** degli ultimi 60 secondi.
- **Registrazione della sessione** con riepilogo ed esportazione CSV/JSON (solo numeri).
- **Sovrapposizione** sul video: contorni, mesh, etichette delle AU attive nel
  punto anatomico corrispondente, direzione della testa; opzione **"nascondi il
  video"** per vedere solo la maschera.
- **Reattività** regolabile (rapida / normale / stabile).
- **PWA**: installabile su iPad/telefono, funziona offline, schermo sempre acceso
  durante l'analisi.
- **Ripiego automatico GPU → CPU** se la GPU non è disponibile o fallisce.

---

## Limiti e uso responsabile

- Un'espressione **non è** ciò che una persona prova: il sistema descrive i
  movimenti del volto e li interpreta con regole e modelli statistici. Vedi
  *Precisione misurata*: considera i risultati indicativi.
- Precisione ridotta con luce scarsa, volto di profilo, occhiali spessi,
  mascherine, barba folta o mentre si parla.
- Gli stati lenti (noia, stanchezza, frequenza degli ammiccamenti) richiedono
  15–60 secondi di osservazione.
- Strumento sperimentale per uso personale, didattico o di ricerca. Non usarlo
  per prendere decisioni su altre persone. Nell'Unione Europea l'AI Act (art. 5,
  par. 1, lett. f) vieta i sistemi di riconoscimento delle emozioni sul luogo di
  lavoro e negli istituti di istruzione, salvo motivi medici o di sicurezza.

---

## Struttura del progetto

```
index.html              interfaccia (con Content-Security-Policy)
css/style.css           stile, tema chiaro/scuro, layout responsive
js/main.js              avvio, fotocamera, ciclo di analisi, calibrazione, registrazione
js/landmarker.js        inizializzazione MediaPipe (GPU con ripiego CPU)
js/facs.js              blendshape → Action Unit FACS, calibrazione
js/emotions.js          8 emozioni (regole FACS), emozioni composte, valenza/attivazione, micro-espressioni
js/features.js          vettore di feature per i modelli appresi
js/model.js             modello globale e modello personale
js/model-data.js        pesi del modello globale (generati da tools/model)
js/states.js            12 stati sottili, attenzione
js/temporal.js          ammiccamenti, PERCLOS, sbadigli, movimento, sguardo, parlato
js/headpose.js          posa della testa (yaw/pitch/roll)
js/analyzer.js          pipeline completa (senza DOM, testabile in Node)
js/overlay.js           disegno sul video
js/charts.js            grafico temporale e circonflesso
js/ui.js                pannelli
js/session.js           registrazione ed esportazione (solo numeri)
js/privacy.js           monitor delle connessioni
sw.js                   service worker (offline)
vendor/mediapipe/       MediaPipe Tasks Vision 0.10.32 (Apache 2.0)
models/                 face_landmarker.task
scripts/serve_https.py  server HTTPS per provare da iPad/telefono in rete locale
tests/unit/             test Node (nessuna dipendenza)
tests/e2e/              test di privacy in Chromium (Playwright)
tools/model/            estrazione feature e addestramento del modello globale
```

## Test

```bash
npm test                                   # 39 test unitari, nessuna dipendenza
python3 -m http.server 8000 &
node tests/e2e/privacy-smoke.mjs           # richiede Playwright + Chromium
```

I test unitari verificano i prototipi FACS di tutte le 8 emozioni, che ciascuno
dei 12 stati sia raggiungibile nel proprio scenario, la compensazione del sorriso,
le convenzioni della posa della testa, ammiccamenti/PERCLOS, micro-espressioni e
la pipeline completa con calibrazione ed esportazione, il modello globale
(coerenza dei pesi, casi tipici) e il modello personale con la cattura guidata.

## Licenze

MediaPipe Tasks Vision e il modello Face Landmarker sono © Google LLC, licenza
Apache 2.0 (`vendor/mediapipe/LICENSE`).
