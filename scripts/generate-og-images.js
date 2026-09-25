// Crée l'image de partage (1200×630) candidats/<id>/og.jpg de chaque candidat
// qui n'en a pas encore, à partir des données d'index.html. Les images
// existantes ne sont jamais réécrites (--force pour tout refaire).
//
// Lancé par .github/workflows/pages.yml après generate-candidate-pages.js.
// Demande Playwright + Chromium (installés par l'action GitHub) et l'accès
// à Google Fonts (Baloo 2, Work Sans).
//
// Usage : node scripts/generate-og-images.js [--force]

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { loadData } = require("./generate-candidate-pages.js");

const OUT_DIR = path.join(__dirname, "..", "candidats");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function ogHtml(c) {
  const color = /^#[0-9a-fA-F]{3,8}$/.test(c.color || "") ? c.color : "#7C3AED";
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Work+Sans:wght@600;700&display=block" rel="stylesheet">
<style>
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;overflow:hidden;position:relative;font-family:'Work Sans',sans-serif;color:#fff;
 background:linear-gradient(115deg, ${color} 0%, #14121F 100%);}
.c{position:absolute;left:900px;top:-140px;width:440px;height:440px;border-radius:50%;background:rgba(255,255,255,.15)}
.brand{position:absolute;left:70px;top:62px;font-weight:700;font-size:28px;letter-spacing:.01em}
.sub{position:absolute;left:70px;top:104px;font-weight:700;font-size:19px;color:rgba(255,255,255,.72);letter-spacing:.02em}
.name{position:absolute;left:70px;top:272px;right:70px;font-family:'Baloo 2',sans-serif;font-weight:800;font-size:62px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.party{position:absolute;left:70px;top:377px;right:70px;font-weight:700;font-size:24px;color:rgba(255,255,255,.85)}
.foot{position:absolute;left:70px;top:541px;font-weight:700;font-size:20px;color:rgba(255,255,255,.7)}
</style></head><body><div class="c"></div>
<div class="brand">VOTONA</div><div class="sub">PRÉSIDENTIELLE 2027</div>
<div class="name">${esc(c.name)}</div><div class="party">${esc(c.party)}</div>
<div class="foot">Découvre toutes ses positions sur votona.fr</div></body></html>`;
}

async function main() {
  const force = process.argv.includes("--force");
  const { CANDIDATES } = loadData();
  const todo = CANDIDATES.filter((c) => force || !fs.existsSync(path.join(OUT_DIR, c.id, "og.jpg")));
  if (!todo.length) { console.log("Images de partage : rien à créer."); return; }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  for (const c of todo) {
    await page.setContent(ogHtml(c), { waitUntil: "networkidle" }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    fs.mkdirSync(path.join(OUT_DIR, c.id), { recursive: true });
    await page.screenshot({ path: path.join(OUT_DIR, c.id, "og.jpg"), type: "jpeg", quality: 88 });
    console.log(`Image de partage créée : candidats/${c.id}/og.jpg`);
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
