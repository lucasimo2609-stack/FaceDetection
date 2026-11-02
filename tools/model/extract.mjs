// Uso: node tools/model/extract.mjs http://localhost:8000/tools/model/extract.html?list=/percorso/lista.json out.json
// La lista è un JSON [{img, label}] con URL delle immagini servite dallo stesso server.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const { chromium } = createRequire(import.meta.url)('playwright');
const [,, url, outPath] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url);
for (;;) {
  await page.waitForTimeout(5000);
  console.log('immagini elaborate:', await page.evaluate(() => window.progress));
  if (await page.evaluate(() => Boolean(window.result))) break;
}
fs.writeFileSync(outPath, JSON.stringify(await page.evaluate(() => window.result)));
await browser.close();
