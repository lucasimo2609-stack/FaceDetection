// Monitor della privacy: conta in tempo reale le connessioni verso origini
// diverse da questo sito. La Content-Security-Policy della pagina
// (connect-src 'self') le blocca comunque; qui le rendiamo visibili.

export function startPrivacyMonitor(badge, detail) {
  let external = 0;
  let blocked = 0;
  const seen = new Set();

  const render = () => {
    const clean = external === 0 && blocked === 0;
    badge.classList.toggle('ok', clean);
    badge.classList.toggle('warn', !clean);
    badge.textContent = clean ? '🔒 100% locale' : `⚠️ ${external + blocked} richieste esterne`;
    if (detail) {
      detail.textContent = clean
        ? 'Nessuna connessione verso altri server da quando la pagina è aperta. I fotogrammi della fotocamera restano nella memoria del browser.'
        : `Rilevate ${external} risorse esterne e ${blocked} tentativi bloccati dalla Content-Security-Policy.`;
    }
  };

  const check = (url) => {
    try {
      const u = new URL(url, location.href);
      if (u.protocol === 'data:' || u.protocol === 'blob:') return;
      if (u.origin !== location.origin && !seen.has(u.href)) {
        seen.add(u.href);
        external++;
        console.warn('Richiesta esterna rilevata:', u.href);
        render();
      }
    } catch { /* URL non valida */ }
  };

  for (const e of performance.getEntriesByType('resource')) check(e.name);
  if ('PerformanceObserver' in window) {
    try {
      const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) check(e.name); });
      po.observe({ type: 'resource', buffered: true });
    } catch { /* non supportato */ }
  }
  document.addEventListener('securitypolicyviolation', (e) => {
    blocked++;
    console.warn('Bloccato dalla CSP:', e.violatedDirective, e.blockedURI);
    render();
  });
  render();
}
