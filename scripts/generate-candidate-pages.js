// Génère une page statique par candidat (votona-web/candidats/<id>/index.html)
// à partir des données déjà présentes dans index.html (CANDIDATES, TOPICS,
// CATEGORY_META, CATEGORY_ICON_PATHS) : rien n'est ressaisi à la main, un
// seul lancement régénère tout. À relancer après chaque évolution notable
// des candidats/sujets (ex. après une session où la veille quotidienne en
// a ajouté).
//
// Usage : node scripts/generate-candidate-pages.js
//
// Ne régénère PAS candidats/<id>/og.jpg (image de partage) : ces images
// sont produites via canvas dans le navigateur (voir session du
// 2026-09-25), pas encore automatisé ici faute de lib canvas en Node.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE_HTML_PATH = path.join(ROOT, "index.html");
const OUT_DIR = path.join(ROOT, "candidats");
const SITE_URL = "https://votona.fr";

function extractDataBlock(html) {
  const start = html.indexOf("// ==CANDIDATES_DATA_START==");
  const catMetaEnd = html.indexOf("\n};", html.indexOf("var CATEGORY_META = {")) + 3;
  if (start === -1 || catMetaEnd === -1) {
    throw new Error("Impossible de localiser le bloc de données dans index.html");
  }
  return html.slice(start, catMetaEnd);
}

function loadData() {
  const html = fs.readFileSync(SITE_HTML_PATH, "utf8");
  const block = extractDataBlock(html);
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  const fn = new Function(block + "\nreturn { CATEGORIES, TOPICS, CANDIDATES, CATEGORY_META, CATEGORY_ICON_PATHS };");
  return fn.call(sandbox);
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

const STANCE_LABEL = { pour: "D'accord", contre: "Pas d'accord", neutre: "Neutre" };
const STANCE_ICON = { pour: "✓", contre: "✕", neutre: "–" };

const HEADER = '<a class="brand" href="../../"><img src="/assets/ui/logo-head.png" width="28" height="28" alt="" /><span>Votona</span></a>';
const HEADER_INDEX = '<a class="brand" href="../"><img src="/assets/ui/logo-head.png" width="28" height="28" alt="" /><span>Votona</span></a>';

const SHARED_CSS = `
  :root{ --bg:#fbfaf7; --ink:#191d2b; --ink-soft:#4d5468; --ink-faint:#8790a3; --line:#e4dfd0; --accent:#7C3AED; }
  *{box-sizing:border-box;}
  body{ margin:0; background:var(--bg); color:var(--ink); font-family:'Work Sans',Arial,sans-serif; }
  header.top{ display:flex; align-items:center; padding:16px clamp(20px,4vw,40px); border-bottom:3px solid var(--accent); background:#f3eefd; }
  .brand{ display:flex; align-items:center; gap:9px; text-decoration:none; color:var(--ink); }
  .brand img{ border-radius:50%; display:block; }
  .brand span{ font-family:'Baloo 2',sans-serif; font-weight:700; font-size:18px; }
`;

function catIconSvg(cat, categoryIconPaths, size) {
  const iconPath = categoryIconPaths[cat];
  if (!iconPath) return "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:5px;">${iconPath}</svg>`;
}

function candidatePageHtml(cand, topics, categoryMeta, categoryIconPaths) {
  const title = `${cand.name} (${cand.party}) — Positions à la présidentielle 2027 | Votona`;
  const description = `Découvre les positions de ${cand.name}, candidat${cand.withdrawn ? " (retiré)" : ""} ${cand.party} à la présidentielle 2027, sujet par sujet : retraites, immigration, écologie, Europe, et plus.`;
  const canonical = `${SITE_URL}/candidats/${cand.id}/`;
  const ogImage = `${SITE_URL}/candidats/${cand.id}/og.jpg`;

  const rows = topics.map((t) => {
    const pos = cand.positions && cand.positions[t.id];
    const stance = pos ? pos.stance : null;
    const label = stance ? (STANCE_LABEL[stance] || stance) : "Position non précisée publiquement";
    const icon = stance ? (STANCE_ICON[stance] || "") : "–";
    const detail = pos && pos.detail ? pos.detail : "";
    return `
    <article class="topic-row">
      <div class="topic-cat">${catIconSvg(t.cat, categoryIconPaths, 13)}${escapeHtml(t.cat)}</div>
      <h3>${escapeHtml(t.statement)}</h3>
      <p class="stance-label">${escapeHtml(icon)} ${escapeHtml(label)}</p>
      ${detail ? `<p class="detail">${escapeHtml(detail)}</p>` : ""}
    </article>`;
  }).join("\n");

  const withdrawnBadge = cand.withdrawn
    ? `<p class="withdrawn-badge">Candidature retirée de la course</p>`
    : "";
  const initials = (cand.name || "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  const personLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Person",
    name: cand.name,
    jobTitle: "Candidat à l'élection présidentielle française 2027",
    affiliation: { "@type": "Organization", name: cand.party },
    url: canonical
  });

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="${escapeHtml(description)}" />
<link rel="canonical" href="${canonical}" />
<meta name="robots" content="index, follow" />
<meta property="og:type" content="profile" />
<meta property="og:site_name" content="Votona" />
<meta property="og:url" content="${canonical}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${ogImage}" />
<meta property="og:locale" content="fr_FR" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${ogImage}" />
<link rel="icon" type="image/png" href="/assets/ui/favicon.png" />
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Work+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<script type="application/ld+json">${personLd}</script>
<style>${SHARED_CSS}
  main{ max-width:720px; margin:0 auto; padding:32px 20px 64px; }
  .cand-header{ display:flex; align-items:center; gap:16px; margin:28px 0 6px; }
  .cand-avatar{ width:56px; height:56px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Baloo 2',sans-serif; font-weight:700; font-size:20px; flex:none; }
  h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(26px,4vw,34px); margin:0; }
  .party{ color:var(--ink-soft); font-size:15px; margin:2px 0 0; }
  .withdrawn-badge{ display:inline-block; margin-top:14px; padding:6px 14px; border-radius:99px; background:#fbe0dd; color:#a63a2e; font-size:13px; font-weight:700; }
  .cta{ display:block; margin:28px 0; padding:16px 24px; border-radius:16px; background:var(--accent); color:#fff; text-align:center; text-decoration:none; font-weight:700; }
  h2.subhead{ font-family:'Baloo 2',sans-serif; font-size:20px; margin:36px 0 16px; }
  .topic-row{ padding:16px 0; border-top:1px solid var(--line); }
  .topic-cat{ display:flex; align-items:center; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-faint); margin-bottom:6px; }
  .topic-row h3{ font-size:16px; margin:0 0 6px; }
  .stance-label{ font-weight:700; font-size:13.5px; margin:0 0 4px; color:var(--ink); }
  .detail{ font-size:13.5px; line-height:1.55; color:var(--ink-soft); margin:0; }
  footer{ margin-top:48px; font-size:12px; color:var(--ink-faint); text-align:center; }
  footer a{ color:inherit; }
</style>
</head>
<body>
<header class="top">${HEADER}</header>
<main>
  <div class="cand-header">
    <div class="cand-avatar" style="background:${escapeHtml(cand.color || "#7C3AED")};">${escapeHtml(initials)}</div>
    <div>
      <h1>${escapeHtml(cand.name)}</h1>
      <p class="party">${escapeHtml(cand.party)}</p>
    </div>
  </div>
  ${withdrawnBadge}
  <p style="color:var(--ink-soft); line-height:1.6; margin-top:18px;">Positions de ${escapeHtml(cand.name)} sur ${topics.length} sujets de la présidentielle 2027, établies à partir de déclarations, votes ou programmes publics.</p>
  <a class="cta" href="../../?screen=results">Compare tes propres positions à celles de ${escapeHtml(cand.name)} sur Votona →</a>
  <h2 class="subhead">Toutes ses positions</h2>
  ${rows}
  <footer>
    Positions simplifiées à titre indicatif, établies à partir des déclarations publiques — ni exhaustives ni officielles.<br />
    <a href="../../">votona.fr</a>
  </footer>
</main>
</body>
</html>
`;
}

function indexPageHtml(candidates) {
  const canonical = `${SITE_URL}/candidats/`;
  const items = candidates.map((c) => `
    <li data-search="${escapeHtml((c.name + " " + c.party).toLowerCase())}"><a href="${c.id}/">${escapeHtml(c.name)} <span class="party">— ${escapeHtml(c.party)}</span>${c.withdrawn ? ' <span class="withdrawn-tag">(retiré)</span>' : ""}</a></li>`).join("\n");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Tous les candidats à la présidentielle 2027 | Votona</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="La liste complète des candidats déclarés à l'élection présidentielle française de 2027, avec le détail de leurs positions sujet par sujet sur Votona." />
<link rel="canonical" href="${canonical}" />
<meta name="robots" content="index, follow" />
<link rel="icon" type="image/png" href="/assets/ui/favicon.png" />
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Work+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${SHARED_CSS}
  main{ max-width:640px; margin:0 auto; padding:32px 20px 64px; }
  h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(26px,4vw,34px); margin:28px 0 8px; }
  p.intro{ color:var(--ink-soft); line-height:1.6; }
  input#q{ width:100%; padding:12px 16px; border-radius:14px; border:1px solid var(--line); font-size:14px; font-family:inherit; margin-top:18px; background:#fff; color:var(--ink); }
  input#q:focus{ outline:2px solid var(--accent); outline-offset:1px; }
  ul{ list-style:none; padding:0; margin:20px 0; }
  li{ padding:14px 0; border-top:1px solid var(--line); }
  li.hidden{ display:none; }
  li a{ color:var(--ink); text-decoration:none; font-weight:700; font-size:15.5px; }
  li a:hover{ color:var(--accent); }
  .party{ color:var(--ink-faint); font-weight:400; font-size:13.5px; }
  .withdrawn-tag{ color:var(--ink-faint); font-weight:400; font-size:12.5px; }
  #empty{ display:none; color:var(--ink-faint); font-size:13.5px; padding:14px 0; }
</style>
</head>
<body>
<header class="top">${HEADER_INDEX}</header>
<main>
  <h1>Tous les candidats à la présidentielle 2027</h1>
  <p class="intro">Chaque candidature officiellement déclarée, avec ses positions sourcées sujet par sujet — retraits de la course inclus.</p>
  <input id="q" type="text" placeholder="Rechercher un candidat ou un parti…" />
  <ul id="list">${items}
  </ul>
  <p id="empty">Aucun candidat ne correspond à cette recherche.</p>
  <script>
    var q = document.getElementById("q");
    var items = Array.prototype.slice.call(document.querySelectorAll("#list li"));
    q.addEventListener("input", function(){
      var term = q.value.trim().toLowerCase();
      var visible = 0;
      items.forEach(function(li){
        var match = !term || li.getAttribute("data-search").indexOf(term) !== -1;
        li.classList.toggle("hidden", !match);
        if(match) visible++;
      });
      document.getElementById("empty").style.display = visible ? "none" : "block";
    });
  </script>
</main>
</body>
</html>
`;
}

function main() {
  const { TOPICS, CANDIDATES, CATEGORY_META, CATEGORY_ICON_PATHS } = loadData();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  CANDIDATES.forEach((cand) => {
    const dir = path.join(OUT_DIR, cand.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), candidatePageHtml(cand, TOPICS, CATEGORY_META, CATEGORY_ICON_PATHS), "utf8");
  });

  fs.writeFileSync(path.join(OUT_DIR, "index.html"), indexPageHtml(CANDIDATES), "utf8");

  console.log(`Généré : ${CANDIDATES.length} pages candidats + 1 index dans ${OUT_DIR} (og.jpg non régénéré, voir commentaire en tête de fichier)`);
}

main();
