// Génère les pages statiques (référencement) à partir des données déjà
// présentes dans index.html (CANDIDATES, TOPICS, CATEGORY_META,
// CATEGORY_ICON_PATHS) : rien n'est ressaisi à la main, un seul lancement
// régénère tout :
//   - candidats/<id>/index.html : une page par candidat + candidats/index.html ;
//   - sujets/<slug>/index.html : une page par sujet (« que proposent les
//     candidats ? ») + sujets/index.html ;
//   - sitemap.xml, entièrement réécrit (accueil, candidats, sujets).
// À relancer après chaque évolution des candidats/sujets.
//
// Usage : node scripts/generate-candidate-pages.js
//
// Ne génère PAS candidats/<id>/og.jpg (image de partage) : c'est le rôle de
// scripts/generate-og-images.js (Playwright), lancé comme ce script par
// l'action GitHub .github/workflows/pages.yml à chaque push sur main.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE_HTML_PATH = path.join(ROOT, "index.html");
const OUT_DIR = path.join(ROOT, "candidats");
const TOPIC_DIR = path.join(ROOT, "sujets");
const DEFAULT_NEUTRAL = "Position non encore précisée publiquement sur ce sujet.";

// Adresse lisible et stable d'un sujet, tirée de son intitulé.
// Position réellement connue (pas le « neutre » par défaut posé quand rien n'est sourcé).
function isKnown(pos) {
  return !!pos && !(pos.stance === "neutre" && (!pos.detail || pos.detail === DEFAULT_NEUTRAL));
}

// Fiche sans aucune position connue : on ne la propose pas aux moteurs (noindex + hors sitemap)
// tant que la veille ne l'a pas complétée ; elle revient automatiquement dès la première position.
function hasKnownPositions(cand, topics) {
  return topics.some((t) => isKnown(cand.positions && cand.positions[t.id]));
}

function slugify(text, maxLen = 60) {
  let slug = String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/['’"]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length > maxLen) slug = slug.slice(0, maxLen).replace(/-[^-]*$/, "");
  return slug;
}
function topicSlugs(topics) {
  const used = new Set();
  const map = {};
  topics.forEach((t) => {
    let slug = slugify(t.statement);
    if (used.has(slug)) slug += "-" + t.id;
    used.add(slug);
    map[t.id] = slug;
  });
  return map;
}
function breadcrumbLd(items) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url }))
  });
}
// Balises communes du <head> (favicons, polices).
const HEAD_ICONS = `<link rel="icon" type="image/png" sizes="48x48" href="/assets/ui/favicon-48.png" />
<link rel="icon" type="image/png" sizes="192x192" href="/assets/ui/favicon-192.png" />
<link rel="icon" href="/favicon.ico" sizes="32x32 48x48" />
<link rel="apple-touch-icon" sizes="180x180" href="/assets/ui/apple-touch-icon.png" />
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Work+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">`;
const SITE_URL = "https://votona.fr";

function extractDataBlock(html) {
  const start = html.indexOf("// ==CANDIDATES_DATA_START==");
  // Le bloc s'arrête après CATEGORY_ICON_PATHS, défini juste après
  // CATEGORY_META : couper à la fin de CATEGORY_META le laissait de côté.
  const iconPathsStart = html.indexOf("var CATEGORY_ICON_PATHS = {");
  const iconPathsEnd = iconPathsStart === -1 ? -1 : html.indexOf("\n};", iconPathsStart);
  if (start === -1 || iconPathsEnd === -1) {
    throw new Error("Impossible de localiser le bloc de données dans index.html");
  }
  return html.slice(start, iconPathsEnd + 3);
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

// En-tête commun aux pages statiques : même bandeau que l'accueil de l'appli
// (mascotte + « Votona » + « PRÉSIDENTIELLE 2027 », clic = retour à l'accueil),
// avec les boutons Mon compte / FAQ. Liens absolus : valables à toute profondeur.
const HEADER = '<header class="topbar"><a class="brand" href="/" title="Accueil Votona"><span class="mark"><img src="/assets/ui/logo-head.webp" alt="" width="40" height="32" /></span><span class="name">Votona</span><span class="year">PRÉSIDENTIELLE 2027</span></a><div class="topbar-actions"><a class="icon-btn" href="/?screen=account" title="Mon compte"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg></a><a class="icon-btn" href="/?screen=faq" title="Questions fréquentes"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.3 9.2a2.7 2.7 0 1 1 3.9 2.4c-1 .5-1.7 1.1-1.7 2.4"/><line x1="12" y1="17.2" x2="12" y2="17.21"/></svg></a></div></header>';
const HEADER_INDEX = HEADER;

const SHARED_CSS = `
  :root{ --bg:#fbfaf7; --ink:#191d2b; --ink-soft:#4d5468; --ink-faint:#8790a3; --line:#e4dfd0; --accent:#7C3AED; --masthead-bg:#F6F2FE; --masthead-ink:#191d2b; --masthead-line:rgba(25,29,43,.14); }
  *{box-sizing:border-box;}
  body{ margin:0; background:var(--bg); color:var(--ink); font-family:'Work Sans',Arial,sans-serif; }
  header.topbar{ display:flex; align-items:center; justify-content:space-between; max-width:1180px; margin:0 auto; padding:16px clamp(20px,4vw,40px); border-bottom:3px solid var(--accent); background:var(--masthead-bg); }
  .brand{ display:flex; align-items:center; gap:9px; text-decoration:none; color:var(--masthead-ink); min-width:0; }
  .brand .mark{ width:40px; height:32px; flex:none; transition:transform .45s cubic-bezier(.34,1.56,.64,1); }
  .brand:hover .mark{ transform:rotate(-8deg) scale(1.08); }
  .brand .mark img{ display:block; width:100%; height:100%; object-fit:contain; }
  .brand .name{ font-family:'Baloo 2',sans-serif; font-weight:700; font-size:18px; letter-spacing:.2px; white-space:nowrap; transition:color .15s ease; }
  .brand:hover .name{ color:var(--accent); }
  .brand .year{ font-family:'IBM Plex Mono',ui-monospace,monospace; font-size:11px; color:var(--accent); letter-spacing:.06em; white-space:nowrap; }
  @media (max-width:420px){ .brand .year{ display:none; } }
  .crumb{ display:inline-flex; align-items:center; gap:4px; font-size:13.5px; font-weight:600; color:var(--ink-soft); text-decoration:none; }
  .crumb:hover{ color:var(--accent); }
  .crumbs{ display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .topbar-actions{ display:flex; align-items:center; gap:6px; }
  .icon-btn{ width:34px; height:34px; border-radius:50%; border:1px solid var(--masthead-line); background:transparent; color:var(--masthead-ink); display:flex; align-items:center; justify-content:center; text-decoration:none; }
  .icon-btn:hover{ color:var(--accent); border-color:var(--accent); }
  /* Boutons : mêmes valeurs que .btn / .btn-accent / .btn-ghost d'index.html. */
  .btn{ display:flex; align-items:center; justify-content:center; gap:8px; box-sizing:border-box; width:100%; border-radius:18px; padding:14px 22px; font-family:'Work Sans',Arial,sans-serif; font-size:15px; font-weight:800; line-height:1.25; text-align:center; text-decoration:none; cursor:pointer; transition:transform .1s ease, background .15s ease, color .15s ease, border-color .15s ease; }
  .btn:active{ transform:translateY(2px); }
  .btn-accent{ background:var(--accent); color:#fff; border-bottom:4px solid color-mix(in srgb, var(--accent) 70%, black); animation:softPulse 2.6s ease-in-out infinite; }
  .btn-accent:hover{ background:color-mix(in srgb, var(--accent) 90%, black); }
  .btn-accent:active{ border-bottom-width:1px; }
  .btn-ghost{ background:transparent; color:var(--ink-soft); border:2px solid color-mix(in srgb, var(--accent) 20%, var(--line)); }
  .btn-ghost:hover{ color:var(--accent); border-color:var(--accent); }
  .btn-row{ max-width:420px; margin-left:auto; margin-right:auto; }
  @keyframes softPulse{ 0%,100%{ box-shadow:0 0 0 0 color-mix(in srgb, var(--accent) 35%, transparent); } 50%{ box-shadow:0 0 0 7px color-mix(in srgb, var(--accent) 0%, transparent); } }
  @media (prefers-reduced-motion: reduce){ .btn-accent{ animation:none; } }`;

// Nom court d'un thème, pour les pastilles du sommaire.
function shortCat(cat) {
  return cat === "Protection sociale" ? "Social" : cat.split(" ")[0];
}

function catIconSvg(cat, categoryIconPaths, size) {
  const iconPath = categoryIconPaths[cat];
  if (!iconPath) return "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:5px;">${iconPath}</svg>`;
}

function candidatePageHtml(cand, topics, categoryMeta, categoryIconPaths, slugs) {
  const title = `${cand.name} (${cand.party}) - Positions à la présidentielle 2027 | Votona`;
  const description = `Découvre les positions de ${cand.name}, candidat${cand.withdrawn ? " (retiré)" : ""} ${cand.party} à la présidentielle 2027, sujet par sujet : retraites, immigration, écologie, Europe, et plus.`;
  const canonical = `${SITE_URL}/candidats/${cand.id}/`;
  const ogImage = `${SITE_URL}/candidats/${cand.id}/og.jpg`;

  const known = topics.filter((t) => isKnown(cand.positions && cand.positions[t.id]));
  const unknown = topics.filter((t) => !isKnown(cand.positions && cand.positions[t.id]));
  const indexable = known.length > 0;

  const row = (t) => {
    const pos = cand.positions[t.id];
    const stance = pos.stance;
    const label = STANCE_LABEL[stance] || stance;
    const icon = STANCE_ICON[stance] || "";
    const detail = pos.detail || "";
    return `
    <article class="topic-row" data-stance="${escapeHtml(stance)}">
      <h4><a href="/sujets/${slugs[t.id]}/">${escapeHtml(t.statement)}</a></h4>
      <p class="stance-label s-${escapeHtml(stance)}">${escapeHtml(icon)} ${escapeHtml(label)}</p>
      ${detail ? `<p class="detail">${escapeHtml(detail)}</p>` : ""}
    </article>`;
  };
  // Positions connues regroupées par thème (ordre des thèmes de l'app), avec
  // une ancre par thème pour le sommaire collant.
  const cats = Object.keys(categoryMeta).filter((cat) => known.some((t) => t.cat === cat));
  const catId = (cat) => "theme-" + ((categoryMeta[cat] && categoryMeta[cat].slug) || slugify(cat));
  const rows = cats.map((cat) => `
  <section class="theme" id="${catId(cat)}">
    <h3 class="theme-h">${catIconSvg(cat, categoryIconPaths, 16)}${escapeHtml(cat)}</h3>${known.filter((t) => t.cat === cat).map(row).join("")}
  </section>`).join("");
  const count = (st) => known.filter((t) => cand.positions[t.id].stance === st).length;
  const filterChip = (st, label) => {
    const n = st ? count(st) : known.length;
    return n ? `<button type="button" class="chip${st ? "" : " on"}" data-filter="${st}">${label} · ${n}</button>` : "";
  };
  const toolbar = `
  <div class="toolbar" id="toolbar">
    ${cats.length > 1 ? `<nav class="theme-nav" aria-label="Aller à un thème">${cats.map((cat) => `<a href="#${catId(cat)}" data-target="${catId(cat)}">${catIconSvg(cat, categoryIconPaths, 14)}${escapeHtml(shortCat(cat))}</a>`).join("")}</nav>` : ""}
    <div class="filters" role="group" aria-label="Filtrer ses positions">${filterChip("", "Tout")}${filterChip("pour", "✓ D'accord")}${filterChip("contre", "✕ Pas d'accord")}${filterChip("neutre", "– Neutre")}</div>
  </div>
  <p class="no-match" id="no-match">Aucune position de ce type.</p>`;
  const toolbarJs = `
  <script>
    (function(){
      var chips = document.querySelectorAll(".filters .chip");
      var rows = document.querySelectorAll(".topic-row");
      var themes = document.querySelectorAll("section.theme");
      chips.forEach(function(chip){
        chip.addEventListener("click", function(){
          var f = chip.getAttribute("data-filter");
          chips.forEach(function(c){ c.classList.toggle("on", c === chip); });
          var shown = 0;
          rows.forEach(function(r){ var ok = !f || r.getAttribute("data-stance") === f; r.hidden = !ok; if(ok) shown++; });
          themes.forEach(function(s){ s.hidden = !s.querySelector(".topic-row:not([hidden])"); });
          document.querySelectorAll(".theme-nav a").forEach(function(a){ var sec = document.getElementById(a.getAttribute("data-target")); a.hidden = !sec || sec.hidden; });
          document.getElementById("no-match").style.display = shown ? "none" : "block";
        });
      });
      var links = document.querySelectorAll(".theme-nav a");
      if(links.length && "IntersectionObserver" in window){
        var obs = new IntersectionObserver(function(entries){
          entries.forEach(function(e){
            if(!e.isIntersecting) return;
            links.forEach(function(a){
              var on = a.getAttribute("data-target") === e.target.id;
              a.classList.toggle("on", on);
              var nav = a.parentNode; if(on && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: a.offsetLeft - nav.offsetLeft - 16, behavior: "smooth" });
            });
          });
        }, { rootMargin: "-40% 0px -55% 0px" });
        themes.forEach(function(s){ obs.observe(s); });
      }
    })();
  </script>`;

  const unknownLinks = unknown.map((t) => `<li><a href="/sujets/${slugs[t.id]}/">${escapeHtml(t.statement)}</a></li>`).join("");
  const positionsHtml = indexable
    ? `<h2 class="subhead">Ses positions connues <span class="count">${known.length}</span></h2>${toolbar}
  ${rows}${toolbarJs}${unknown.length ? `
  <details class="unknown">
    <summary>Pas encore de position connue sur ${unknown.length} sujet${unknown.length > 1 ? "s" : ""}</summary>
    <ul>${unknownLinks}</ul>
  </details>` : ""}`
    : `<div class="empty-note">
    <p><strong>Aucune position publique connue pour l'instant.</strong></p>
    <p>Aucune déclaration, aucun vote ni programme de ${escapeHtml(cand.name)} n'a encore été relevé sur les ${topics.length} sujets suivis par Votona. Les fiches sont complétées au fil de la campagne : reviens bientôt.</p>
    <p><a href="/sujets/">Voir ce que proposent les autres candidats, sujet par sujet ›</a></p>
  </div>`;

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
<meta name="robots" content="${indexable ? "index, follow" : "noindex, follow"}" />
<meta property="og:type" content="profile" />
<meta property="og:site_name" content="Votona" />
<meta property="og:url" content="${canonical}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${ogImage}" />
<meta property="og:locale" content="fr_FR" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${ogImage}" />
${HEAD_ICONS}
<script type="application/ld+json">${personLd}</script>
<script type="application/ld+json">${breadcrumbLd([{ name: "Votona", url: SITE_URL + "/" }, { name: "Candidats", url: SITE_URL + "/candidats/" }, { name: cand.name, url: canonical }])}</script>
<style>${SHARED_CSS}
  main{ max-width:720px; margin:0 auto; padding:32px 20px 64px; }
  .cand-header{ display:flex; align-items:center; gap:16px; margin:28px 0 6px; }
  .cand-avatar{ width:56px; height:56px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Baloo 2',sans-serif; font-weight:700; font-size:20px; flex:none; }
  h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(26px,4vw,34px); margin:0; }
  .party{ color:var(--ink-soft); font-size:15px; margin:2px 0 0; }
  .withdrawn-badge{ display:inline-block; margin-top:14px; padding:6px 14px; border-radius:99px; background:#fbe0dd; color:#a63a2e; font-size:13px; font-weight:700; }
  .cta{ margin:28px 0; }
  h2.subhead{ font-family:'Baloo 2',sans-serif; font-size:20px; margin:36px 0 16px; }
  .topic-row{ padding:16px 0; border-top:1px solid var(--line); }
  .theme{ scroll-margin-top:100px; }
  .theme-h{ display:flex; align-items:center; gap:2px; font-family:'Baloo 2',sans-serif; font-size:18px; margin:26px 0 4px; color:var(--ink); }
  .toolbar{ position:sticky; top:0; z-index:5; margin:0 -20px; padding:10px 20px; background:color-mix(in srgb, var(--bg) 88%, transparent); -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px); border-bottom:1px solid var(--line); }
  .theme-nav{ display:flex; gap:6px; overflow-x:auto; scrollbar-width:none; padding-bottom:8px; }
  .theme-nav::-webkit-scrollbar{ display:none; }
  .theme-nav a{ flex:none; display:inline-flex; align-items:center; padding:6px 12px; border-radius:99px; border:1px solid var(--line); background:#fff; color:var(--ink-soft); font-size:13px; font-weight:600; text-decoration:none; white-space:nowrap; }
  .theme-nav a svg{ margin-right:5px !important; }
  .theme-nav a:hover, .theme-nav a.on{ border-color:var(--accent); color:var(--accent); }
  .filters{ display:flex; gap:6px; overflow-x:auto; scrollbar-width:none; }
  .filters::-webkit-scrollbar{ display:none; }
  .chip{ flex:none; white-space:nowrap; appearance:none; cursor:pointer; padding:6px 12px; border-radius:99px; border:1px solid var(--line); background:transparent; color:var(--ink-soft); font:600 13px 'Work Sans',Arial,sans-serif; }
  .chip:hover{ border-color:var(--accent); color:var(--accent); }
  .chip.on{ background:var(--accent); border-color:var(--accent); color:#fff; }
  .no-match{ display:none; color:var(--ink-faint); font-size:14px; padding:16px 0; }
  .stance-label.s-pour{ color:#2c9354; } .stance-label.s-contre{ color:#d1453a; }
  @media (min-width:700px){ .theme-nav, .filters{ flex-wrap:wrap; overflow:visible; gap:5px; } .theme-nav a{ padding:6px 10px; } }
  .topic-cat{ display:flex; align-items:center; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-faint); margin-bottom:6px; }
  .topic-row h4{ font-size:16px; margin:0 0 6px; }
  .topic-row h4 a{ color:inherit; text-decoration:none; }
  .topic-row h4 a:hover{ color:var(--accent); text-decoration:underline; }
  .stance-label{ font-weight:700; font-size:13.5px; margin:0 0 4px; color:var(--ink); }
  .detail{ font-size:13.5px; line-height:1.55; color:var(--ink-soft); margin:0; }
  .count{ display:inline-block; min-width:22px; padding:1px 8px; margin-left:4px; border-radius:99px; background:var(--line); color:var(--ink-soft); font-size:12px; font-family:inherit; font-weight:700; text-align:center; vertical-align:middle; }
  .unknown{ margin-top:28px; border-top:1px solid var(--line); padding-top:16px; }
  .unknown summary{ cursor:pointer; font-weight:700; font-size:14.5px; color:var(--ink-soft); padding:6px 0; }
  .unknown summary:hover{ color:var(--accent); }
  .unknown ul{ list-style:none; padding:0; margin:8px 0 0; }
  .unknown li{ padding:8px 0; border-top:1px solid var(--line); font-size:13.5px; line-height:1.45; }
  .unknown li a{ color:var(--ink-soft); text-decoration:none; }
  .unknown li a:hover{ color:var(--accent); text-decoration:underline; }
  .empty-note{ margin:32px 0; padding:22px 24px; border:1px dashed var(--line); border-radius:16px; color:var(--ink-soft); line-height:1.6; font-size:14.5px; }
  .empty-note p{ margin:0 0 10px; } .empty-note p:last-child{ margin:0; }
  .empty-note strong{ color:var(--ink); }
  .empty-note a{ color:var(--accent); font-weight:600; }
  footer{ margin-top:48px; font-size:12px; color:var(--ink-faint); text-align:center; }
  footer a{ color:inherit; }
</style>
</head>
<body>
${HEADER}
<main>
  <nav class="crumbs"><a class="crumb" href="/candidats/">‹ Tous les candidats</a><a class="crumb" href="/sujets/">Tous les sujets ›</a></nav>
  <div class="cand-header">
    <div class="cand-avatar" style="background:${escapeHtml(cand.color || "#7C3AED")};">${escapeHtml(initials)}</div>
    <div>
      <h1>${escapeHtml(cand.name)}</h1>
      <p class="party">${escapeHtml(cand.party)}</p>
    </div>
  </div>
  ${withdrawnBadge}
  <p style="color:var(--ink-soft); line-height:1.6; margin-top:18px;">${indexable ? `Positions de ${escapeHtml(cand.name)} sur ${known.length === topics.length ? "" : `${known.length} des `}${topics.length} sujets de la présidentielle 2027 suivis par Votona, établies à partir de déclarations, votes ou programmes publics.` : `Votona suit ${topics.length} sujets de la présidentielle 2027 et y relève, pour chaque candidat, les positions tirées de déclarations, votes ou programmes publics.`}</p>
  <a class="btn btn-accent cta" href="../../?screen=results">Compare tes propres positions à celles de ${escapeHtml(cand.name)}</a>
  ${positionsHtml}
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
    <li data-search="${escapeHtml((c.name + " " + c.party).toLowerCase())}"><a href="${c.id}/"><span class="cand-dot" style="background:${escapeHtml(c.color || "#7C3AED")}"></span>${escapeHtml(c.name)} <span class="party">— ${escapeHtml(c.party)}</span>${c.withdrawn ? ' <span class="withdrawn-tag">(retiré)</span>' : ""}</a></li>`).join("\n");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Tous les candidats à la présidentielle 2027 | Votona</title>
<script type="application/ld+json">${breadcrumbLd([{ name: "Votona", url: SITE_URL + "/" }, { name: "Candidats", url: canonical }])}</script>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="La liste complète des candidats déclarés à l'élection présidentielle française de 2027, avec le détail de leurs positions sujet par sujet sur Votona." />
<link rel="canonical" href="${canonical}" />
<meta name="robots" content="index, follow" />
${HEAD_ICONS}
<style>${SHARED_CSS}
  main{ max-width:640px; margin:0 auto; padding:32px 20px 64px; }
  h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(26px,4vw,34px); margin:28px 0 8px; }
  p.intro{ color:var(--ink-soft); line-height:1.6; }
  .btn-sujets{ margin-top:6px; }
  input#q{ width:100%; padding:12px 16px; border-radius:14px; border:1px solid var(--line); font-size:14px; font-family:inherit; margin-top:18px; background:#fff; color:var(--ink); }
  input#q:focus{ outline:2px solid var(--accent); outline-offset:1px; }
  ul{ list-style:none; padding:0; margin:20px 0; }
  li{ padding:14px 0; border-top:1px solid var(--line); }
  li.hidden{ display:none; }
  li a{ display:flex; align-items:center; gap:9px; color:var(--ink); text-decoration:none; font-weight:700; font-size:15.5px; }
  li a:hover{ color:var(--accent); }
  .cand-dot{ width:10px; height:10px; border-radius:50%; flex:none; }
  .party{ color:var(--ink-faint); font-weight:400; font-size:13.5px; }
  .withdrawn-tag{ color:var(--ink-faint); font-weight:400; font-size:12.5px; }
  #empty{ display:none; color:var(--ink-faint); font-size:13.5px; padding:14px 0; }
</style>
</head>
<body>
${HEADER_INDEX}
<main>
  <h1>Tous les candidats à la présidentielle 2027</h1>
  <p class="intro">Chaque candidature officiellement déclarée, avec ses positions sourcées sujet par sujet, retraits de la course inclus.</p>
  <a class="btn btn-ghost btn-sujets" href="/sujets/">Comparer les candidats sujet par sujet</a>
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

function topicPageHtml(topic, candidates, topics, categoryIconPaths, slugs) {
  const slug = slugs[topic.id];
  const canonical = `${SITE_URL}/sujets/${slug}/`;
  const active = candidates.filter((c) => !c.withdrawn);
  const groups = { pour: [], contre: [], nuance: [], inconnu: [] };
  active.forEach((c) => {
    const pos = c.positions && c.positions[topic.id];
    if (!isKnown(pos)) groups.inconnu.push({ c, pos });
    else if (pos.stance === "pour") groups.pour.push({ c, pos });
    else if (pos.stance === "contre") groups.contre.push({ c, pos });
    else groups.nuance.push({ c, pos });
  });
  const title = `${topic.statement} : que proposent les candidats ? | Votona`;
  const description = `Pour, contre ou sans position : ce que disent les ${active.length} candidats à la présidentielle 2027 sur « ${topic.statement} ». Positions sourcées, candidat par candidat.`;
  const card = ({ c, pos }) => `
      <li class="cand"><a class="cand-name" href="/candidats/${c.id}/"><span class="cand-dot" style="background:${escapeHtml(c.color || "#7C3AED")}"></span>${escapeHtml(c.name)}</a><span class="cand-party">${escapeHtml(c.party)}</span>${pos && pos.detail ? `<p class="detail">${escapeHtml(pos.detail)}</p>` : ""}</li>`;
  const section = (key, label, icon) => groups[key].length ? `
  <section class="group g-${key}">
    <h2>${icon} ${label} <span class="count">${groups[key].length}</span></h2>
    <ul>${groups[key].map(card).join("")}
    </ul>
  </section>` : "";
  const unknown = groups.inconnu.length ? `
  <section class="group g-inconnu">
    <h2>– Position non encore précisée <span class="count">${groups.inconnu.length}</span></h2>
    <p class="names">${groups.inconnu.map(({ c }) => `<a href="/candidats/${c.id}/"><span class="cand-dot" style="background:${escapeHtml(c.color || "#7C3AED")}"></span>${escapeHtml(c.name)}</a>`).join("")}</p>
  </section>` : "";
  const siblings = topics.filter((t) => t.cat === topic.cat && t.id !== topic.id);
  const stanceSummary = (t) => {
    const n = { pour: 0, contre: 0, nuance: 0 };
    active.forEach((c) => {
      const pos = c.positions && c.positions[t.id];
      if (isKnown(pos)) n[pos.stance === "pour" || pos.stance === "contre" ? pos.stance : "nuance"]++;
    });
    const parts = [];
    if (n.pour) parts.push(`<span class="s-pour">${n.pour} pour</span>`);
    if (n.contre) parts.push(`<span class="s-contre">${n.contre} contre</span>`);
    if (n.nuance) parts.push(`<span>${n.nuance} nuancé${n.nuance > 1 ? "s" : ""}</span>`);
    return parts.length ? parts.join(" · ") : "<span>Positions à venir</span>";
  };
  const siblingsHtml = siblings.length ? `
  <h2 class="subhead">Autres sujets : ${escapeHtml(topic.cat)}</h2>
  <ul class="related">${siblings.map((t) => `
    <li><a href="/sujets/${slugs[t.id]}/"><span class="r-title">${escapeHtml(t.statement)}</span><span class="r-meta">${stanceSummary(t)}</span><span class="r-arrow" aria-hidden="true">›</span></a></li>`).join("")}
  </ul>` : "";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="${escapeHtml(description)}" />
<link rel="canonical" href="${canonical}" />
<meta name="robots" content="index, follow" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Votona" />
<meta property="og:url" content="${canonical}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${SITE_URL}/assets/og/sujets/${slug}.jpg" />
<meta property="og:locale" content="fr_FR" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${SITE_URL}/assets/og/sujets/${slug}.jpg" />
${HEAD_ICONS}
<script type="application/ld+json">${breadcrumbLd([{ name: "Votona", url: SITE_URL + "/" }, { name: "Sujets", url: SITE_URL + "/sujets/" }, { name: topic.statement, url: canonical }])}</script>
<style>${SHARED_CSS}
  main{ max-width:720px; margin:0 auto; padding:32px 20px 64px; }
  .crumbs{ display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .topic-cat{ display:flex; align-items:center; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-faint); margin:28px 0 8px; }
  h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(24px,3.6vw,32px); line-height:1.2; margin:0; }
  .context{ color:var(--ink-soft); line-height:1.6; margin:14px 0 0; }
  .cta{ margin:24px 0 8px; }
  .group{ margin-top:30px; }
  .group h2{ font-family:'Baloo 2',sans-serif; font-size:20px; margin:0 0 6px; display:flex; align-items:center; gap:8px; }
  .g-pour h2{ color:#2c9354; } .g-contre h2{ color:#d1453a; } .g-nuance h2, .g-inconnu h2{ color:var(--ink-soft); }
  .count{ font-family:'IBM Plex Mono',monospace; font-size:12px; font-weight:500; color:var(--ink-faint); background:var(--masthead-bg); padding:2px 8px; border-radius:99px; }
  .group ul{ list-style:none; padding:0; margin:0; }
  .cand{ padding:12px 0; border-top:1px solid var(--line); }
  .cand-name{ display:inline-flex; align-items:center; gap:8px; font-weight:700; color:var(--ink); text-decoration:none; }
  .cand-name:hover{ color:var(--accent); }
  .cand-dot{ width:10px; height:10px; border-radius:50%; flex:none; }
  .cand-party{ color:var(--ink-faint); font-size:13px; margin-left:8px; }
  .detail{ font-size:13.5px; line-height:1.55; color:var(--ink-soft); margin:6px 0 0; }
  .names{ display:flex; flex-wrap:wrap; gap:8px; margin:10px 0 0; }
  .names a{ display:inline-flex; align-items:center; gap:7px; padding:6px 12px; border-radius:99px; background:#fff; border:1px solid var(--line); color:var(--ink-soft); font-size:13px; font-weight:600; text-decoration:none; }
  .names a:hover{ border-color:var(--accent); color:var(--accent); }
  .names .cand-dot{ width:8px; height:8px; }
  h2.subhead{ font-family:'Baloo 2',sans-serif; font-size:20px; margin:44px 0 12px; }
  ul.related{ list-style:none; padding:0; margin:0; display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
  ul.related a{ position:relative; display:flex; flex-direction:column; gap:8px; height:100%; box-sizing:border-box; padding:16px 38px 16px 18px; background:#fff; border:1px solid var(--line); border-radius:16px; color:var(--ink); text-decoration:none; transition:border-color .15s, transform .15s, box-shadow .15s; }
  ul.related a:hover{ border-color:var(--accent); transform:translateY(-2px); box-shadow:0 6px 18px rgba(124,58,237,.10); }
  .r-title{ font-weight:600; font-size:14.5px; line-height:1.4; }
  .r-meta{ font-size:12px; color:var(--ink-faint); }
  .r-meta .s-pour{ color:#2c9354; font-weight:600; } .r-meta .s-contre{ color:#d1453a; font-weight:600; }
  .r-arrow{ position:absolute; right:16px; top:50%; transform:translateY(-50%); font-size:22px; color:var(--ink-faint); }
  ul.related a:hover .r-arrow{ color:var(--accent); }
  .all{ margin-top:26px; }
  footer{ margin-top:48px; font-size:12px; color:var(--ink-faint); text-align:center; }
  footer a{ color:inherit; }
</style>
</head>
<body>
${HEADER}
<main>
  <nav class="crumbs"><a class="crumb" href="/sujets/">‹ Tous les sujets</a><a class="crumb" href="/candidats/">Tous les candidats ›</a></nav>
  <div class="topic-cat">${catIconSvg(topic.cat, categoryIconPaths, 13)}${escapeHtml(topic.cat)}</div>
  <h1>${escapeHtml(topic.statement)} : que proposent les candidats ?</h1>
  ${topic.context ? `<p class="context">${escapeHtml(topic.context)}</p>` : ""}
  <a class="btn btn-accent cta" href="/">Et toi, tu en penses quoi ? Découvre quel candidat te correspond</a>
  ${section("pour", "Pour", "✓")}
  ${section("contre", "Contre", "✕")}
  ${section("nuance", "Neutre ou nuancé", "≈")}
  ${unknown}
  ${siblingsHtml}
  <a class="btn btn-ghost btn-row all" href="/sujets/">Voir les ${topics.length} sujets de la présidentielle 2027</a>
  <footer>
    Positions simplifiées à titre indicatif, établies à partir des déclarations publiques, ni exhaustives ni officielles.<br />
    <a href="/">votona.fr</a>
  </footer>
</main>
</body>
</html>
`;
}

function topicIndexHtml(topics, categories, categoryMeta, categoryIconPaths, slugs, candidates) {
  const canonical = `${SITE_URL}/sujets/`;
  // Sujets qui divisent le plus les candidats : le plus d'avis tranchés des
  // deux côtés à la fois (min pour/contre), départagés par le total.
  const active = candidates.filter((c) => !c.withdrawn);
  const split = topics.map((t) => {
    let pour = 0, contre = 0;
    active.forEach((c) => { const pos = c.positions && c.positions[t.id]; if (isKnown(pos)) { if (pos.stance === "pour") pour++; else if (pos.stance === "contre") contre++; } });
    return { t, pour, contre, score: Math.min(pour, contre) };
  }).filter((x) => x.score >= 3).sort((a, b) => b.score - a.score || (b.pour + b.contre) - (a.pour + a.contre)).slice(0, 3);
  const divisive = split.length ? `
  <section class="divisive" id="divisive">
    <h2>Les sujets qui divisent le plus les candidats</h2>
    <ul>${split.map(({ t, pour, contre }) => `<li><a href="${slugs[t.id]}/"><span class="d-title">${escapeHtml(t.statement)}</span><span class="d-bar" aria-hidden="true"><span style="flex:${pour}"></span><span style="flex:${contre}"></span></span><span class="d-meta"><span class="s-pour">${pour} pour</span> · <span class="s-contre">${contre} contre</span></span></a></li>`).join("")}
    </ul>
  </section>` : "";
  const blocks = categories.map((cat) => {
    const list = topics.filter((t) => t.cat === cat);
    if (!list.length) return "";
    const meta = categoryMeta[cat] || {};
    return `
  <section class="cat">
    <h2>${catIconSvg(cat, categoryIconPaths, 18)}${escapeHtml(cat)}</h2>
    ${meta.d ? `<p class="cat-d">${escapeHtml(meta.d)}</p>` : ""}
    <ul>${list.map((t) => `<li data-search="${escapeHtml((t.statement + " " + t.cat).toLowerCase())}"><a href="${slugs[t.id]}/">${escapeHtml(t.statement)}</a></li>`).join("")}</ul>
  </section>`;
  }).join("");
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Les ${topics.length} sujets de la présidentielle 2027 : positions des candidats | Votona</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="Retraites, immigration, nucléaire, Europe, école… Les ${topics.length} grands sujets de la présidentielle 2027 et ce qu'en disent les candidats, sujet par sujet." />
<link rel="canonical" href="${canonical}" />
<meta name="robots" content="index, follow" />
<meta property="og:image" content="${SITE_URL}/assets/ui/og-home.jpg" />
${HEAD_ICONS}
<script type="application/ld+json">${breadcrumbLd([{ name: "Votona", url: SITE_URL + "/" }, { name: "Sujets", url: canonical }])}</script>
<style>${SHARED_CSS}
  main{ max-width:720px; margin:0 auto; padding:32px 20px 64px; }
  h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(26px,4vw,34px); margin:28px 0 8px; }
  p.intro{ color:var(--ink-soft); line-height:1.6; }
  section{ margin-top:30px; }
  section h2{ font-family:'Baloo 2',sans-serif; font-size:20px; margin:0 0 2px; display:flex; align-items:center; }
  .cat-d{ color:var(--ink-faint); font-size:13px; margin:0 0 8px; }
  section ul{ list-style:none; padding:0; margin:0; }
  section li{ padding:11px 0; border-top:1px solid var(--line); }
  section li a{ color:var(--ink); text-decoration:none; font-weight:600; font-size:15px; line-height:1.4; }
  section li a:hover{ color:var(--accent); }
  section li[hidden], section[hidden]{ display:none; }
  .cta{ margin:24px 0 8px; }
  input#q{ width:100%; padding:12px 16px; border-radius:14px; border:1px solid var(--line); font-size:14px; font-family:inherit; margin-top:22px; background:#fff; color:var(--ink); }
  input#q:focus{ outline:2px solid var(--accent); outline-offset:1px; }
  #empty{ display:none; color:var(--ink-faint); font-size:13.5px; padding:14px 0; }
  .divisive ul{ display:grid; gap:10px; }
  .divisive li{ padding:0; border:0; }
  .divisive li a{ display:flex; flex-direction:column; gap:8px; padding:14px 16px; background:#fff; border:1px solid var(--line); border-radius:16px; }
  .divisive li a:hover{ border-color:var(--accent); }
  .d-title{ font-weight:600; font-size:15px; line-height:1.4; color:var(--ink); }
  .d-bar{ display:flex; gap:3px; height:8px; border-radius:99px; overflow:hidden; }
  .d-bar span:first-child{ background:#2c9354; } .d-bar span:last-child{ background:#d1453a; }
  .d-meta{ font-size:12.5px; font-weight:700; }
  .s-pour{ color:#2c9354; } .s-contre{ color:#d1453a; }
</style>
</head>
<body>
${HEADER_INDEX}
<main>
  <nav class="crumbs"><a class="crumb" href="/candidats/">Tous les candidats ›</a></nav>
  <h1>Les ${topics.length} sujets de la présidentielle 2027</h1>
  <p class="intro">Pour chaque grand sujet de la campagne, découvre qui est pour, qui est contre et qui ne s'est pas encore prononcé parmi les candidats déclarés.</p>
  <a class="btn btn-accent cta" href="/">Et toi ? Réponds aux questions et découvre quel candidat te correspond</a>
  <input id="q" type="search" placeholder="Rechercher un sujet (retraite, nucléaire, SMIC…)" aria-label="Rechercher un sujet" />${divisive}${blocks}
  <p id="empty">Aucun sujet ne correspond à cette recherche.</p>
  <script>
    (function(){
      var q = document.getElementById("q");
      var items = Array.prototype.slice.call(document.querySelectorAll("section.cat li"));
      var norm = function(s){ return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); };
      q.addEventListener("input", function(){
        var term = norm(q.value.trim()), visible = 0;
        items.forEach(function(li){ var ok = !term || norm(li.getAttribute("data-search")).indexOf(term) !== -1; li.hidden = !ok; if(ok) visible++; });
        document.querySelectorAll("section.cat").forEach(function(s){ s.hidden = !s.querySelector("li:not([hidden])"); });
        var d = document.getElementById("divisive"); if(d) d.hidden = !!term;
        document.getElementById("empty").style.display = visible ? "none" : "block";
      });
    })();
  </script>
</main>
</body>
</html>
`;
}

function sitemapXml(candidates, topics, slugs) {
  const url = (loc, freq, prio) => `  <url>\n    <loc>${loc}</loc>\n    <changefreq>${freq}</changefreq>\n    <priority>${prio}</priority>\n  </url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[
    url(`${SITE_URL}/`, "daily", "1.0"),
    url(`${SITE_URL}/candidats/`, "weekly", "0.8"),
    ...candidates.filter((c) => hasKnownPositions(c, topics)).map((c) => url(`${SITE_URL}/candidats/${c.id}/`, "weekly", "0.7")),
    url(`${SITE_URL}/sujets/`, "weekly", "0.8"),
    ...topics.map((t) => url(`${SITE_URL}/sujets/${slugs[t.id]}/`, "weekly", "0.7"))
  ].join("\n")}
</urlset>
`;
}

function main() {
  const { CATEGORIES, TOPICS, CANDIDATES, CATEGORY_META, CATEGORY_ICON_PATHS } = loadData();
  const slugs = topicSlugs(TOPICS);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  CANDIDATES.forEach((cand) => {
    const dir = path.join(OUT_DIR, cand.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), "\uFEFF" + candidatePageHtml(cand, TOPICS, CATEGORY_META, CATEGORY_ICON_PATHS, slugs), "utf8");
  });

  fs.writeFileSync(path.join(OUT_DIR, "index.html"), "\uFEFF" + indexPageHtml(CANDIDATES), "utf8");

  // Pages sujets : on repart d'un dossier propre (un sujet renommé ne laisse pas d'ancienne page).
  fs.rmSync(TOPIC_DIR, { recursive: true, force: true });
  fs.mkdirSync(TOPIC_DIR, { recursive: true });
  TOPICS.forEach((t) => {
    const dir = path.join(TOPIC_DIR, slugs[t.id]);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), "\uFEFF" + topicPageHtml(t, CANDIDATES, TOPICS, CATEGORY_ICON_PATHS, slugs), "utf8");
  });
  fs.writeFileSync(path.join(TOPIC_DIR, "index.html"), "\uFEFF" + topicIndexHtml(TOPICS, CATEGORIES, CATEGORY_META, CATEGORY_ICON_PATHS, slugs, CANDIDATES), "utf8");

  fs.writeFileSync(path.join(ROOT, "sitemap.xml"), sitemapXml(CANDIDATES, TOPICS, slugs), "utf8");

  console.log(`Généré : ${CANDIDATES.length} pages candidats + ${TOPICS.length} pages sujets + 2 index + sitemap.xml`);
}

if (require.main === module) main();
module.exports = { loadData, topicSlugs, SITE_URL };
