#!/usr/bin/env python3
"""Server HTTPS locale per provare l'app da telefono o iPad sulla stessa rete Wi-Fi.

I browser concedono la fotocamera solo su HTTPS (o su localhost). Questo script
crea un certificato autofirmato (con `openssl`) e serve la cartella del progetto.
Sul telefono/iPad comparirà un avviso di sicurezza: è normale per un
certificato autofirmato, si può proseguire ("Mostra dettagli" → "visita il sito").

Le immagini restano comunque sul dispositivo che apre la pagina: questo server
fornisce solo i file dell'app.

Uso:  python3 scripts/serve_https.py [porta]   (predefinita 8443)
"""

import http.server
import os
import socket
import ssl
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CERT_DIR = ROOT / "scripts" / ".cert"
CERT = CERT_DIR / "cert.pem"
KEY = CERT_DIR / "key.pem"


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # nessun pacchetto viene inviato
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def ensure_cert(ip: str) -> None:
    if CERT.exists() and KEY.exists():
        return
    CERT_DIR.mkdir(parents=True, exist_ok=True)
    print("Creo un certificato autofirmato…")
    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", str(KEY), "-out", str(CERT), "-days", "825",
            "-subj", "/CN=Lettore Espressioni (locale)",
            "-addext", f"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{ip}",
        ],
        check=True,
        capture_output=True,
    )


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".webmanifest": "application/manifest+json",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
    ip = lan_ip()
    ensure_cert(ip)
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT, KEY)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print(f"\nApri sul computer:        https://localhost:{port}/")
    print(f"Apri su telefono / iPad:  https://{ip}:{port}/   (stessa rete Wi-Fi)\n")
    print("Ctrl+C per fermare.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
