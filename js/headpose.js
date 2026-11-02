// Stima della posa della testa (gradi).
// Convenzione restituita (immagine NON specchiata):
//   yaw   > 0  testa girata verso la destra dell'immagine (sinistra del soggetto)
//   pitch > 0  testa rivolta verso l'alto
//   roll  > 0  testa inclinata verso la destra dell'immagine (spalla sinistra del soggetto)
// Codici FACS: AU51/52 rotazione sx/dx, AU53/54 su/giù, AU55/56 inclinazione sx/dx.

const DEG = 180 / Math.PI;

// Dalla matrice di trasformazione facciale 4x4 (column-major) di MediaPipe.
export function poseFromMatrix(m) {
  const r00 = m[0], r10 = m[1], r20 = m[2];
  const r21 = m[6], r22 = m[10];
  const sy = Math.hypot(r00, r10);
  const pitchDown = Math.atan2(r21, r22);
  const yaw = Math.atan2(-r20, sy);
  const rollCCW = Math.atan2(r10, r00);
  return {
    yaw: yaw * DEG,
    pitch: -pitchDown * DEG,
    roll: -rollCCW * DEG,
    tz: m[14],
  };
}

// Stima alternativa dai landmark 3D (usata se la matrice non è disponibile).
export function poseFromLandmarks(lm, width, height) {
  const P = (i) => [lm[i].x * width, -lm[i].y * height, -lm[i].z * width];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const xAxis = norm(sub(P(263), P(33)));        // verso la destra dell'immagine
  const up = norm(sub(P(10), P(152)));           // dal mento alla fronte
  const zAxis = norm(cross(xAxis, up));          // verso la camera
  const yAxis = cross(zAxis, xAxis);
  // Matrice di rotazione con colonne x,y,z.
  const yaw = Math.atan2(zAxis[0], zAxis[2]);
  const pitch = Math.atan2(zAxis[1], Math.hypot(zAxis[0], zAxis[2]));
  const roll = Math.atan2(-xAxis[1], xAxis[0]);
  void yAxis;
  return { yaw: yaw * DEG, pitch: pitch * DEG, roll: roll * DEG, tz: 0 };
}

export function headPose(result, width, height) {
  const m = result.facialTransformationMatrixes?.[0]?.data;
  if (m && m.length === 16) return poseFromMatrix(m);
  return poseFromLandmarks(result.faceLandmarks[0], width, height);
}
