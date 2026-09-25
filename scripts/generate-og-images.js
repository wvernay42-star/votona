// Crée les images de partage (1200×630) manquantes, à partir des données
// d'index.html :
//   - candidats/<id>/og.jpg : une par candidat ;
//   - assets/og/sujets/<slug>.jpg : une par sujet (hors du dossier sujets/,
//     que generate-candidate-pages.js efface et recrée à chaque passage).
// Les images existantes ne sont jamais réécrites (--force pour tout refaire).
// Les images de sujets dont l'adresse n'existe plus (intitulé modifié) sont
// supprimées.
//
// Lancé par .github/workflows/pages.yml après generate-candidate-pages.js.
// Demande Playwright + Chromium (installés par l'action GitHub) et l'accès
// à Google Fonts (Baloo 2, Work Sans).
//
// Usage : node scripts/generate-og-images.js [--force]
//         node scripts/generate-og-images.js --count-missing   (affiche le nombre d'images à créer)

const fs = require("fs");
const path = require("path");
const { loadData, topicSlugs } = require("./generate-candidate-pages.js");

const ROOT = path.join(__dirname, "..");
const CAND_DIR = path.join(ROOT, "candidats");
const TOPIC_OG_DIR = path.join(ROOT, "assets", "og", "sujets");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hex = (c, fallback) => (/^#[0-9a-fA-F]{3,8}$/.test(c || "") ? c : fallback);

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Work+Sans:wght@600;700&display=block" rel="stylesheet">`;
const BASE_CSS = `
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;overflow:hidden;position:relative;font-family:'Work Sans',sans-serif;color:#fff;}
.c{position:absolute;left:900px;top:-140px;width:440px;height:440px;border-radius:50%;background:rgba(255,255,255,.15)}
.brand{position:absolute;left:70px;top:62px;font-weight:700;font-size:28px;letter-spacing:.01em}
.sub{position:absolute;left:70px;top:104px;font-weight:700;font-size:19px;color:rgba(255,255,255,.72);letter-spacing:.02em}
.foot{position:absolute;left:70px;top:541px;font-weight:700;font-size:20px;color:rgba(255,255,255,.7)}`;

function candidateHtml(c) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${FONTS}
<style>${BASE_CSS}
body{background:linear-gradient(115deg, ${hex(c.color, "#7C3AED")} 0%, #14121F 100%);}
.name{position:absolute;left:70px;top:272px;right:70px;font-family:'Baloo 2',sans-serif;font-weight:800;font-size:62px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.party{position:absolute;left:70px;top:377px;right:70px;font-weight:700;font-size:24px;color:rgba(255,255,255,.85)}
</style></head><body><div class="c"></div>
<div class="brand">VOTONA</div><div class="sub">PRÉSIDENTIELLE 2027</div>
<div class="name">${esc(c.name)}</div><div class="party">${esc(c.party)}</div>
<div class="foot">Découvre toutes ses positions sur votona.fr</div></body></html>`;
}

// Sujet : fond violet Votona, pastille du thème à sa couleur, intitulé en
// grand (taille réduite automatiquement pour tenir en 3 lignes au plus).
function topicHtml(t, meta) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${FONTS}
<style>${BASE_CSS}
body{background:linear-gradient(115deg, #7C3AED 0%, #14121F 100%);}
.cat{position:absolute;left:70px;top:176px;display:flex;align-items:center;gap:12px;padding:9px 20px 9px 16px;border-radius:99px;background:rgba(255,255,255,.12);font-weight:700;font-size:19px;letter-spacing:.06em;text-transform:uppercase}
.dot{width:14px;height:14px;border-radius:50%;background:${hex(meta && meta.pop, "#FFB703")}}
.q{position:absolute;left:70px;right:150px;top:246px;height:262px;display:flex;align-items:center}
.q h1{font-family:'Baloo 2',sans-serif;font-weight:800;font-size:64px;line-height:1.08;text-wrap:balance}
</style></head><body><div class="c"></div>
<div class="brand">VOTONA</div><div class="sub">PRÉSIDENTIELLE 2027</div>
<div class="cat"><span class="dot"></span>${esc(t.cat)}</div>
<div class="q"><h1 id="q">${esc(t.statement)}</h1></div>
<div class="foot">Qui est pour, qui est contre ? La réponse sur votona.fr</div></body></html>`;
}

async function fitStatement(page) {
  await page.evaluate(() => {
    const h = document.getElementById("q");
    if (!h) return;
    let size = 64;
    while (h.scrollHeight > 262 && size > 34) { size -= 2; h.style.fontSize = size + "px"; }
  });
}

function jobs(force) {
  const { TOPICS, CANDIDATES, CATEGORY_META } = loadData();
  const slugs = topicSlugs(TOPICS);
  const list = [];
  CANDIDATES.forEach((c) => {
    const out = path.join(CAND_DIR, c.id, "og.jpg");
    if (force || !fs.existsSync(out)) list.push({ out, html: candidateHtml(c), label: `candidats/${c.id}/og.jpg` });
  });
  TOPICS.forEach((t) => {
    const out = path.join(TOPIC_OG_DIR, slugs[t.id] + ".jpg");
    if (force || !fs.existsSync(out)) list.push({ out, html: topicHtml(t, CATEGORY_META[t.cat]), label: `assets/og/sujets/${slugs[t.id]}.jpg`, topic: true });
  });
  const keep = new Set(TOPICS.map((t) => slugs[t.id] + ".jpg"));
  const orphans = fs.existsSync(TOPIC_OG_DIR) ? fs.readdirSync(TOPIC_OG_DIR).filter((f) => f.endsWith(".jpg") && !keep.has(f)) : [];
  return { list, orphans };
}

async function render(list, { beforeEach } = {}) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  if (beforeEach) await beforeEach(page);
  for (const job of list) {
    await page.setContent(job.html, { waitUntil: "networkidle" }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    if (job.topic) await fitStatement(page);
    fs.mkdirSync(path.dirname(job.out), { recursive: true });
    await page.screenshot({ path: job.out, type: "jpeg", quality: 88 });
    console.log(`Image de partage créée : ${job.label}`);
  }
  await browser.close();
}

async function main(options = {}) {
  const force = process.argv.includes("--force");
  const { list, orphans } = jobs(force);
  if (process.argv.includes("--count-missing")) { console.log(list.length + orphans.length); return; }
  orphans.forEach((f) => { fs.unlinkSync(path.join(TOPIC_OG_DIR, f)); console.log(`Image de sujet obsolète supprimée : assets/og/sujets/${f}`); });
  if (!list.length) { console.log("Images de partage : rien à créer."); return; }
  await render(list, options);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { main };
