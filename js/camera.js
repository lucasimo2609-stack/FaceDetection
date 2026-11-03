// Gestione della fotocamera (webcam, fotocamera frontale/posteriore di
// telefono e iPad). Il flusso video resta nell'elemento <video> locale.

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.facingMode = 'user';
    this.deviceId = null;
  }

  get active() { return Boolean(this.stream); }

  // Il sistema ha chiuso la fotocamera (es. app in secondo piano su iPad).
  get ended() {
    const track = this.stream?.getVideoTracks()[0];
    return Boolean(track) && track.readyState === 'ended';
  }

  async start({ deviceId = this.deviceId, facingMode = this.facingMode, hd = false } = {}) {
    this.stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(window.isSecureContext
        ? 'Questo browser non supporta l\'accesso alla fotocamera.'
        : 'La fotocamera richiede HTTPS (o localhost). Apri la pagina da un indirizzo https://');
    }
    const size = hd ? { width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 640 }, height: { ideal: 480 } };
    const video = deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode, ...size };
    video.frameRate = { ideal: 30, max: 30 };
    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    const track = this.stream.getVideoTracks()[0];
    const settings = track.getSettings?.() || {};
    this.deviceId = settings.deviceId || deviceId || null;
    if (settings.facingMode) this.facingMode = settings.facingMode;
    else if (!deviceId) this.facingMode = facingMode;
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.setAttribute('playsinline', '');
    await this.video.play();
    await new Promise((resolve) => {
      if (this.video.videoWidth) resolve();
      else this.video.addEventListener('loadedmetadata', resolve, { once: true });
    });
    return { label: track.label, settings };
  }

  // La fotocamera frontale va mostrata a specchio (come uno specchio vero).
  get shouldMirror() { return this.facingMode !== 'environment'; }

  async listDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'videoinput');
    } catch {
      return [];
    }
  }

  async switchFacing() {
    this.deviceId = null;
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    return this.start({ facingMode: this.facingMode });
  }

  stop() {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.video.srcObject = null;
  }
}
