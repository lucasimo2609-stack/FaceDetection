#!/usr/bin/env python3
"""Addestra il classificatore globale delle emozioni (regressione logistica).

Input: la matrice prodotta da `export_matrix.mjs` (feature calcolate con lo
stesso codice JavaScript dell'app). Output: `js/model-data.js`.

Uso:
  python3 tools/model/train.py matrix.json legend.csv [--write]

`legend.csv` serve solo per raggruppare la validazione incrociata per
contributore (così le stesse persone non stanno sia in addestramento sia in test).
Richiede numpy e scikit-learn.
"""
import collections
import csv
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.preprocessing import StandardScaler

C = 0.03
ROOT = Path(__file__).resolve().parents[2]


def fit(X, y):
    cnt = collections.Counter(y)
    w = np.array([len(y) / (len(cnt) * cnt[v]) for v in y])  # classi bilanciate
    sc = StandardScaler().fit(X)
    # Feature quasi costanti (es. noseSneer, sempre ~0): scala minima per
    # evitare divisioni per ~0 e garantire parità fra Python e JavaScript.
    sc.scale_ = np.maximum(sc.scale_, 1e-3)
    lr = LogisticRegression(C=C, max_iter=5000).fit(sc.transform(X), y, sample_weight=w)
    return sc, lr


def predict(model, X, K):
    sc, lr = model
    p = lr.predict_proba(sc.transform(X))
    full = np.full((len(X), K), 1e-6)
    full[:, lr.classes_] = p
    return full / full.sum(1, keepdims=True)


def combine(P, R, w):
    E = np.exp(w * np.log(P + 1e-9) + (1 - w) * np.log(R + 1e-9))
    return E / E.sum(1, keepdims=True)


def scores(P, y, classes, reliable):
    pred = P.argmax(1)
    rec = {classes[k]: float((pred[y == k] == k).mean()) for k in range(len(classes)) if (y == k).any()}
    return {
        'accuratezza': float((pred == y).mean()),
        'recall_media_6': float(np.mean([rec[c] for c in reliable])),
        'recall': rec,
    }


def main():
    M = json.load(open(sys.argv[1]))
    uid = {r[1].strip(): r[0] for r in list(csv.reader(open(sys.argv[2])))[1:]}
    X, y, R = np.array(M['X']), np.array(M['y']), np.array(M['R'])
    classes = M['classes']
    K = len(classes)
    groups = np.array([uid.get(i, '?') for i in M['ids']])
    reliable = ['neutral', 'joy', 'sadness', 'surprise', 'fear', 'anger']

    P = np.zeros((len(y), K))
    for tr, te in StratifiedGroupKFold(min(5, len(set(groups))), shuffle=True, random_state=0).split(X, y, groups):
        P[te] = predict(fit(X[tr], y[tr]), X[te], K)
    report = {'regole': scores(R, y, classes, reliable), 'modello': scores(P, y, classes, reliable)}
    for w in (0.3, 0.5, 0.8):
        report[f'combinato_w{w}'] = scores(combine(P, R, w), y, classes, reliable)
    # Combinazione usata dall'app (js/analyzer.js, GLOBAL_WEIGHT).
    wv = np.array([0.7 if c in ('neutral', 'joy', 'surprise') else 0.2 for c in classes])
    report['combinato_app'] = scores(combine(P, R, wv), y, classes, reliable)
    for k, v in report.items():
        print(f"{k:16s} acc {v['accuratezza']*100:5.1f}%  recall media (6 classi) {v['recall_media_6']*100:5.1f}%  "
              + ' '.join(f"{c[:5]} {r*100:3.0f}" for c, r in v['recall'].items()))

    if '--write' not in sys.argv:
        return
    sc, lr = fit(X, y)
    neutral = X[y == classes.index('neutral')]
    data = {
        'version': 1,
        'features': M['features'],
        'classes': [classes[c] for c in lr.classes_],
        'mean': np.round(sc.mean_, 5).tolist(),
        'scale': np.round(sc.scale_, 5).tolist(),
        'coef': np.round(lr.coef_, 5).tolist(),
        'intercept': np.round(lr.intercept_, 5).tolist(),
        'neutralMedian': np.round(np.median(neutral, 0), 5).tolist(),
        'training': {
            'campioni': int(len(y)),
            'per_classe': {classes[k]: int((y == k).sum()) for k in range(K)},
            'validazione': {k: {'accuratezza': round(v['accuratezza'], 3), 'recall_media_6': round(v['recall_media_6'], 3)}
                            for k, v in report.items()},
        },
    }
    out = ROOT / 'js' / 'model-data.js'
    out.write_text(
        '// Generato da tools/model/train.py — non modificare a mano.\n'
        '// Regressione logistica sui blendshape di MediaPipe (vedi tools/model/README.md).\n'
        f'export const MODEL = {json.dumps(data, separators=(",", ":"))};\n'
    )
    print('scritto', out, out.stat().st_size, 'byte')


if __name__ == '__main__':
    main()
