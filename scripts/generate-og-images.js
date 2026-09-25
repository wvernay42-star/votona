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

// Illustrations de l'app (mêmes fichiers que le kit), embarquées en data: URI.
const img = (rel, type = "webp") => `data:image/${type};base64,` + fs.readFileSync(path.join(ROOT, "assets", rel)).toString("base64");
const LOGO = img("ui/logo-head.png", "png");
const PROP_SLUGS = ["economie", "ecologie", "europe", "protection-sociale", "securite", "defense", "societe"];
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Work+Sans:wght@600;700&display=block" rel="stylesheet">`;
const BASE_CSS = `
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;overflow:hidden;position:relative;font-family:'Work Sans',sans-serif;color:#fff;}
.head{position:absolute;left:70px;top:56px;display:flex;align-items:center;gap:14px}
.head img{width:58px;height:auto;filter:drop-shadow(0 4px 10px rgba(0,0,0,.25))}
.brand{font-family:'Baloo 2',sans-serif;font-weight:800;font-size:32px;line-height:1}
.sub{font-weight:700;font-size:16px;color:rgba(255,255,255,.72);letter-spacing:.08em;margin-top:4px}
.foot{position:absolute;left:70px;top:548px;font-weight:700;font-size:20px;color:rgba(255,255,255,.72)}
.art{position:absolute;filter:drop-shadow(0 12px 22px rgba(0,0,0,.35))}`;
const HEAD = `<div class="head"><img src="${LOGO}" alt=""><div><div class="brand">Votona</div><div class="sub">PRÉSIDENTIELLE 2027</div></div></div>`;

function initials(name) {
  return String(name || "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

// Candidat : fond à sa couleur, pastille d'initiales, et à droite les 7
// accessoires des thèmes en grappe de stickers (« ses positions sur tous les sujets »).
const PROP_LAYOUT = [
  ["economie", 800, 150, 150, -9], ["ecologie", 968, 118, 132, 14], ["europe", 1092, 214, 104, -12],
  ["protection-sociale", 846, 316, 128, -5], ["securite", 998, 330, 122, 9],
  ["defense", 800, 452, 108, 6], ["societe", 942, 470, 170, -8]
];
function candidateHtml(c) {
  const color = hex(c.color, "#7C3AED");
  const props = PROP_LAYOUT.map(([slug, x, y, w, r]) => `<img class="art" src="${img("props/" + slug + ".webp")}" style="left:${x}px;top:${y}px;width:${w}px;transform:rotate(${r}deg)" alt="">`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${FONTS}
<style>${BASE_CSS}
body{background:linear-gradient(115deg, ${color} 0%, #14121F 100%);}
.who{position:absolute;left:70px;top:210px;width:660px;height:260px;display:flex;align-items:center;gap:28px}
.av{flex:none;width:112px;height:112px;border-radius:50%;background:#fff;color:${color};display:flex;align-items:center;justify-content:center;font-family:'Baloo 2',sans-serif;font-weight:800;font-size:44px;box-shadow:0 6px 24px rgba(0,0,0,.2)}
.name{font-family:'Baloo 2',sans-serif;font-weight:800;font-size:62px;line-height:1.02}
.party{margin-top:10px;font-weight:700;font-size:24px;color:rgba(255,255,255,.85)}
</style></head><body>${HEAD}${props}
<div class="who"><div class="av">${esc(initials(c.name))}</div><div><div class="name">${esc(c.name)}</div><div class="party">${esc(c.party)}</div></div></div>
<div class="foot">Découvre toutes ses positions sur votona.fr</div></body></html>`;
}

// Sujet : fond teinté par la couleur du thème (assombrie pour garder le texte
// blanc lisible), pastille du thème, intitulé en grand (taille réduite
// automatiquement si besoin), et à droite l'ourson habillé du thème avec son
// accessoire.
function topicHtml(t, meta) {
  const theme = hex(meta && meta.pop, "#7C3AED");
  const slug = meta && PROP_SLUGS.includes(meta.slug) ? meta.slug : null;
  const art = slug ? `<img class="art" src="${img("characters/" + slug + "-n3.webp")}" style="left:842px;top:150px;height:450px" alt="">
<img class="art" src="${img("props/" + slug + ".webp")}" style="left:1040px;top:96px;width:120px;transform:rotate(12deg)" alt="">` : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${FONTS}
<style>${BASE_CSS}
body{background:linear-gradient(115deg, color-mix(in srgb, ${theme} 72%, #14121F) 0%, #14121F 100%);}
.cat{position:absolute;left:70px;top:176px;display:flex;align-items:center;gap:12px;padding:9px 20px 9px 16px;border-radius:99px;background:#fff;color:#191d2b;font-weight:700;font-size:19px;letter-spacing:.06em;text-transform:uppercase}
.dot{width:14px;height:14px;border-radius:50%;background:${theme}}
.q{position:absolute;left:70px;width:720px;top:246px;height:270px;display:flex;align-items:center}
.q h1{font-family:'Baloo 2',sans-serif;font-weight:800;font-size:62px;line-height:1.08;text-wrap:balance}
</style></head><body>${HEAD}${art}
<div class="cat"><span class="dot"></span>${esc(t.cat)}</div>
<div class="q"><h1 id="q">${esc(t.statement)}</h1></div>
<div class="foot">Qui est pour, qui est contre ? La réponse sur votona.fr</div></body></html>`;
}

async function fitStatement(page) {
  await page.evaluate(() => {
    const h = document.getElementById("q");
    if (!h) return;
    let size = 62;
    while (h.scrollHeight > 270 && size > 34) { size -= 2; h.style.fontSize = size + "px"; }
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
module.exports = { main, candidateHtml, topicHtml, fitStatement };
