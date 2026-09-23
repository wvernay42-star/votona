// Génère une page statique par candidat (votona-web/candidats/<id>/index.html)
// à partir des données déjà présentes dans index.html (CANDIDATES, TOPICS,
// CATEGORY_META) : rien n'est ressaisi à la main, un seul lancement
// régénère tout. À relancer après chaque évolution notable des candidats
// ou sujets (ex. après une session où la veille quotidienne en a ajouté).
//
// Usage : node scripts/generate-candidate-pages.js

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
  const fn = new Function(block + "\nreturn { CATEGORIES, TOPICS, CANDIDATES, CATEGORY_META };");
  return fn.call(sandbox);
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

const STANCE_LABEL = { pour: "D'accord", contre: "Pas d'accord", neutre: "Neutre" };

function candidatePageHtml(cand, topics, categoryMeta) {
  const title = `${cand.name} (${cand.party}) — Positions à la présidentielle 2027 | Votona`;
  const description = `Découvre les positions de ${cand.name}, candidat${cand.withdrawn ? " (retiré)" : ""} ${cand.party} à la présidentielle 2027, sujet par sujet : retraites, immigration, écologie, Europe, et plus.`;
  const canonical = `${SITE_URL}/candidats/${cand.id}/`;

  const rows = topics.map((t) => {
    const pos = cand.positions && cand.positions[t.id];
    const stance = pos ? pos.stance : null;
    const label = stance ? (STANCE_LABEL[stance] || stance) : "Position non précisée publiquement";
    const detail = pos && pos.detail ? pos.detail : "";
    const meta = categoryMeta[t.cat] || {};
    return `
    <article class="topic-row stance-${escapeHtml(stance || "inconnu")}">
      <div class="topic-cat">${escapeHtml(meta.ic || "")} ${escapeHtml(t.cat)}</div>
      <h3>${escapeHtml(t.statement)}</h3>
      <p class="stance-label">${escapeHtml(label)}</p>
      ${detail ? `<p class="detail">${escapeHtml(detail)}</p>` : ""}
    </article>`;
  }).join("\n");

  const withdrawnBadge = cand.withdrawn
    ? `<p class="withdrawn-badge">Candidature retirée de la course</p>`
    : "";

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
<meta property="og:locale" content="fr_FR" />
<link rel="icon" type="image/png" href="/assets/ui/favicon.png" />
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Work+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{ --bg:#fbfaf7; --ink:#191d2b; --ink-soft:#4d5468; --ink-faint:#8790a3; --line:#e4dfd0; --accent:#7C3AED; }
  *{box-sizing:border-box;}
  body{ margin:0; background:var(--bg); color:var(--ink); font-family:'Work Sans',Arial,sans-serif; }
  main{ max-width:720px; margin:0 auto; padding:32px 20px 64px; }
  a.back{ display:inline-block; margin-bottom:20px; color:var(--ink-soft); text-decoration:none; font-size:14px; }
  a.back:hover{ color:var(--accent); }
  .cand-header{ display:flex; align-items:center; gap:16px; margin-bottom:6px; }
  .cand-avatar{ width:56px; height:56px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Baloo 2',sans-serif; font-weight:700; font-size:20px; flex:none; }
  h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(26px,4vw,34px); margin:0; }
  .party{ color:var(--ink-soft); font-size:15px; margin:2px 0 0; }
  .withdrawn-badge{ display:inline-block; margin-top:14px; padding:6px 14px; border-radius:99px; background:#fbe0dd; color:#a63a2e; font-size:13px; font-weight:700; }
  .cta{ display:block; margin:28px 0; padding:16px 24px; border-radius:16px; background:var(--accent); color:#fff; text-align:center; text-decoration:none; font-weight:700; }
  h2.subhead{ font-family:'Baloo 2',sans-serif; font-size:20px; margin:36px 0 16px; }
  .topic-row{ padding:16px 0; border-top:1px solid var(--line); }
  .topic-cat{ font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-faint); margin-bottom:6px; }
  .topic-row h3{ font-size:16px; margin:0 0 6px; }
  .stance-label{ font-weight:700; font-size:13.5px; margin:0 0 4px; }
  .stance-pour .stance-label{ color:#2c9354; }
  .stance-contre .stance-label{ color:#d1453a; }
  .stance-neutre .stance-label, .stance-inconnu .stance-label{ color:var(--ink-faint); }
  .detail{ font-size:13.5px; line-height:1.55; color:var(--ink-soft); margin:0; }
  footer{ margin-top:48px; font-size:12px; color:var(--ink-faint); text-align:center; }
  footer a{ color:inherit; }
</style>
</head>
<body>
<main>
  <a class="back" href="../../">← Retour à Votona</a>
  <div class="cand-header">
    <div class="cand-avatar" style="background:${escapeHtml(cand.color || "#7C3AED")};">${escapeHtml((cand.name || "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase())}</div>
    <div>
      <h1>${escapeHtml(cand.name)}</h1>
      <p class="party">${escapeHtml(cand.party)}</p>
    </div>
  </div>
  ${withdrawnBadge}
  <p style="color:var(--ink-soft); line-height:1.6; margin-top:18px;">Positions de ${escapeHtml(cand.name)} sur ${topics.length} sujets de la présidentielle 2027, établies à partir de déclarations, votes ou programmes publics.</p>
  <a class="cta" href="../../">Compare tes propres positions à celles de ${escapeHtml(cand.name)} sur Votona →</a>
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
    <li><a href="${c.id}/">${escapeHtml(c.name)} <span class="party">— ${escapeHtml(c.party)}</span>${c.withdrawn ? ' <span class="withdrawn-tag">(retiré)</span>' : ""}</a></li>`).join("\n");

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
<style>
  :root{ --bg:#fbfaf7; --ink:#191d2b; --ink-soft:#4d5468; --ink-faint:#8790a3; --line:#e4dfd0; --accent:#7C3AED; }
  *{box-sizing:border-box;}
  body{ margin:0; background:var(--bg); color:var(--ink); font-family:'Work Sans',Arial,sans-serif; }
  main{ max-width:640px; margin:0 auto; padding:32px 20px 64px; }
  a.back{ display:inline-block; margin-bottom:20px; color:var(--ink-soft); text-decoration:none; font-size:14px; }
  h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(26px,4vw,34px); margin:0 0 8px; }
  p.intro{ color:var(--ink-soft); line-height:1.6; }
  ul{ list-style:none; padding:0; margin:24px 0; }
  li{ padding:14px 0; border-top:1px solid var(--line); }
  li a{ color:var(--ink); text-decoration:none; font-weight:700; font-size:15.5px; }
  li a:hover{ color:var(--accent); }
  .party{ color:var(--ink-faint); font-weight:400; font-size:13.5px; }
  .withdrawn-tag{ color:var(--ink-faint); font-weight:400; font-size:12.5px; }
</style>
</head>
<body>
<main>
  <a class="back" href="../">← Retour à Votona</a>
  <h1>Tous les candidats à la présidentielle 2027</h1>
  <p class="intro">Chaque candidature officiellement déclarée, avec ses positions sourcées sujet par sujet — retraits de la course inclus.</p>
  <ul>
    ${items}
  </ul>
</main>
</body>
</html>
`;
}

function main() {
  const { TOPICS, CANDIDATES, CATEGORY_META } = loadData();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  CANDIDATES.forEach((cand) => {
    const dir = path.join(OUT_DIR, cand.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), candidatePageHtml(cand, TOPICS, CATEGORY_META), "utf8");
  });

  fs.writeFileSync(path.join(OUT_DIR, "index.html"), indexPageHtml(CANDIDATES), "utf8");

  console.log(`Généré : ${CANDIDATES.length} pages candidats + 1 index dans ${OUT_DIR}`);
}

main();
