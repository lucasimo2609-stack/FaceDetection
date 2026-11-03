// Installazione come app (PWA): icona sulla schermata Home, schermo intero,
// funzionamento offline. Su iPad/iPhone non esiste un pulsante "Installa"
// automatico, quindi mostriamo le istruzioni; su Android/Chrome usiamo il
// prompt nativo.

const DISMISS_KEY = 'facs-install-dismissed-v1';

// Aperta dall'icona sulla schermata Home (non dentro il browser)?
export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// iPadOS 13+ si presenta come "Macintosh": lo riconosciamo dallo schermo touch.
export function appleMobileDevice() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  return null;
}

export function setupInstallBanner({ storage }) {
  const banner = document.querySelector('#install');
  const title = document.querySelector('#install-title');
  const how = document.querySelector('#install-how');
  const btn = document.querySelector('#btn-install');
  const close = document.querySelector('#btn-install-close');
  if (!banner || isStandalone()) return;

  let dismissed = false;
  try { dismissed = storage?.getItem(DISMISS_KEY) === '1'; } catch { /* ignora */ }
  close.addEventListener('click', () => {
    banner.hidden = true;
    try { storage?.setItem(DISMISS_KEY, '1'); } catch { /* ignora */ }
  });
  if (dismissed) return;

  const device = appleMobileDevice();
  if (device) {
    title.textContent = `Installa l'app sul tuo ${device}`;
    // In Safari su iPhone il pulsante Condividi è nella barra in basso.
    if (device === 'iPhone') document.querySelector('#install-where').textContent = 'in basso';
    how.hidden = false;
    banner.hidden = false;
    return;
  }

  // Android / Chrome / Edge: prompt di installazione nativo.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    title.textContent = 'Installa l\'app su questo dispositivo';
    btn.hidden = false;
    banner.hidden = false;
    btn.addEventListener('click', async () => {
      banner.hidden = true;
      e.prompt();
      try { await e.userChoice; } catch { /* ignora */ }
    }, { once: true });
  });
  window.addEventListener('appinstalled', () => { banner.hidden = true; });
}

// La fotocamera è già stata autorizzata in precedenza?
export async function cameraAlreadyAllowed() {
  try {
    const st = await navigator.permissions?.query({ name: 'camera' });
    return st?.state === 'granted';
  } catch {
    return false;
  }
}
