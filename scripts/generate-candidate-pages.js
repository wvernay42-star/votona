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
  .prop{ object-fit:contain; flex:none; }
  .theme-h{ display:flex; align-items:center; gap:10px; font-family:'Baloo 2',sans-serif; font-size:19px; margin:30px 0 4px; padding-bottom:6px; color:var(--ink); border-bottom:3px solid var(--th, var(--accent)); }
  .av-sm{ display:inline-flex; align-items:center; justify-content:center; flex:none; width:34px; height:34px; border-radius:50%; color:#fff; font:800 12.5px 'Work Sans',Arial,sans-serif; }
  /* Boutons : mêmes valeurs que .btn / .btn-accent / .btn-ghost d'index.html. */
  .btn{ display:flex; align-items:center; justify-content:center; gap:8px; box-sizing:border-box; width:100%; border-radius:18px; padding:14px 22px; font-family:'Work Sans',Arial,sans-serif; font-size:15px; font-weight:800; line-height:1.25; text-align:center; text-decoration:none; cursor:pointer; transition:transform .1s ease, background .15s ease, color .15s ease, border-color .15s ease; }
  .btn:active{ transform:translateY(2px); }
  .btn-accent{ background:var(--accent); color:#fff; border-bottom:4px solid color-mix(in srgb, var(--accent) 70%, black); animation:softPulse 2.6s ease-in-out infinite; }
  .btn-accent:hover{ background:color-mix(in srgb, var(--accent) 90%, black); }
  .btn-accent:active{ border-bottom-width:1px; }
  .btn-ghost{ background:transparent; color:var(--ink-soft); border:2px solid color-mix(in srgb, var(--accent) 20%, var(--line)); }
  .btn-ghost:hover{ color:var(--accent); border-color:var(--accent); }
  .btn-row{ max-width:420px; margin-left:auto; margin-right:auto; }
  .btn-ic{ width:19px; height:19px; flex:none; }
  .btn-mascot{ width:34px; height:auto; flex:none; margin:-8px 2px -8px -4px; filter:drop-shadow(0 2px 4px rgba(0,0,0,.25)); transition:transform .35s cubic-bezier(.34,1.56,.64,1); }
  .btn:hover .btn-mascot{ transform:rotate(-10deg) scale(1.1); }
  @keyframes softPulse{ 0%,100%{ box-shadow:0 0 0 0 color-mix(in srgb, var(--accent) 35%, transparent); } 50%{ box-shadow:0 0 0 7px color-mix(in srgb, var(--accent) 0%, transparent); } }
  @media (prefers-reduced-motion: reduce){ .btn-accent{ animation:none; } }`;

// Couleur et illustrations de chaque thème (mêmes que l'app : CATEGORY_META
// .pop / .slug, accessoires assets/props, oursons assets/characters),
// renseignées par main() avant la génération.
const THEMES = {};
function themeColor(cat) { return (THEMES[cat] && THEMES[cat].pop) || "#7C3AED"; }
function propImg(cat, size, cls = "prop") {
  const t = THEMES[cat];
  return t && t.slug ? `<img class="${cls}" src="/assets/props/${t.slug}.webp" width="${size}" height="${size}" alt="" loading="lazy" />` : "";
}
function charSrc(cat) { const t = THEMES[cat]; return t && t.slug ? `/assets/characters/${t.slug}-n3.webp` : ""; }
function initialsOf(name) { return String(name || "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(); }

// Icônes des boutons : l'ourson Votona sur les appels à faire le test,
// pictogrammes au trait sur les boutons secondaires.
const BTN_MASCOT = '<img class="btn-mascot" src="/assets/ui/logo-head.webp" width="34" height="29" alt="" />';
const ICON_VS = '<svg class="btn-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><path d="M2 20c0-3 2.2-5 5-5s5 2 5 5"/><path d="M12 20c0-3 2.2-5 5-5s5 2 5 5"/></svg>';
const ICON_GRID = '<svg class="btn-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>';

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
  const catId = (cat) => "theme-" + ((categoryMeta[cat] && categoryMeta[cat].slug) || slugify(cat));
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
      <p class="stance-label"><span class="pill p-${escapeHtml(stance)}">${escapeHtml(icon)} ${escapeHtml(label)}</span></p>
      ${detail ? `<p class="detail">${escapeHtml(detail)}</p>` : ""}
    </article>`;
  };
  // Positions connues regroupées par thème (ordre des thèmes de l'app), avec
  // une ancre par thème pour le sommaire collant.
  const cats = Object.keys(categoryMeta).filter((cat) => known.some((t) => t.cat === cat));
  const rows = cats.map((cat) => `
  <section class="theme" id="${catId(cat)}" style="--th:${themeColor(cat)}">
    <h3 class="theme-h">${propImg(cat, 30)}${escapeHtml(cat)}</h3>${known.filter((t) => t.cat === cat).map(row).join("")}
  </section>`).join("");
  const count = (st) => known.filter((t) => cand.positions[t.id].stance === st).length;
  const filterChip = (st, label) => {
    const n = st ? count(st) : known.length;
    return n ? `<button type="button" class="chip${st ? "" : " on"}" data-filter="${st}">${label} · ${n}</button>` : "";
  };
  const toolbar = `
  <div class="toolbar" id="toolbar">
    ${cats.length > 1 ? `<nav class="theme-nav" aria-label="Aller à un thème">${cats.map((cat) => `<a href="#${catId(cat)}" data-target="${catId(cat)}" style="--th:${themeColor(cat)}">${propImg(cat, 18)}${escapeHtml(shortCat(cat))}</a>`).join("")}</nav>` : ""}
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

  // En-tête : accessoires des thèmes où le candidat a pris position, en décor.
  const heroProps = Object.keys(categoryMeta).filter((cat) => known.some((t) => t.cat === cat)).slice(0, 4)
    .map((cat, i) => propImg(cat, [58, 46, 40, 34][i], `hp hp${i + 1}`)).join("");
  // « Son profil en un coup d'œil » : barre d'ensemble + une tuile par thème.
  const nPour = known.filter((t) => cand.positions[t.id].stance === "pour").length;
  const nContre = known.filter((t) => cand.positions[t.id].stance === "contre").length;
  const nNeutre = known.length - nPour - nContre;
  const tiles = Object.keys(categoryMeta).map((cat) => {
    const list = topics.filter((t) => t.cat === cat);
    const k = list.filter((t) => isKnown(cand.positions && cand.positions[t.id]));
    const c = (st) => k.filter((t) => cand.positions[t.id].stance === st).length;
    const body = k.length
      ? `<span class="tl-n">${c("pour") ? `<b class="s-pour">✓${c("pour")}</b>` : ""}${c("contre") ? `<b class="s-contre">✕${c("contre")}</b>` : ""}${c("neutre") ? `<b class="s-neutre">–${c("neutre")}</b>` : ""}</span>`
      : `<span class="tl-n tl-none">pas encore</span>`;
    const inner = `${propImg(cat, 38)}<span class="tl-name">${escapeHtml(shortCat(cat))}</span>${body}`;
    return k.length
      ? `<a class="tile" href="#${catId(cat)}" style="--th:${themeColor(cat)}">${inner}</a>`
      : `<span class="tile off" style="--th:${themeColor(cat)}">${inner}</span>`;
  }).join("");
  const glance = indexable ? `
  <section class="glance">
    <h2 class="subhead">Son profil en un coup d'œil</h2>
    <div class="gbar" role="img" aria-label="${nPour} d'accord, ${nContre} pas d'accord, ${nNeutre} neutres">${nPour ? `<span class="g-pour" style="flex:${nPour}"></span>` : ""}${nContre ? `<span class="g-contre" style="flex:${nContre}"></span>` : ""}${nNeutre ? `<span class="g-neutre" style="flex:${nNeutre}"></span>` : ""}</div>
    <p class="glegend">${[nPour ? `<b class="s-pour">✓ ${nPour} d'accord</b>` : "", nContre ? `<b class="s-contre">✕ ${nContre} pas d'accord</b>` : "", nNeutre ? `<b class="s-neutre">– ${nNeutre} neutre${nNeutre > 1 ? "s" : ""}</b>` : "", unknown.length ? `<span>? ${unknown.length} non précisé${unknown.length > 1 ? "s" : ""}</span>` : ""].filter(Boolean).join(" · ")}</p>
    <div class="tiles">${tiles}</div>
  </section>` : "";

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
  .cand-header{ display:flex; align-items:center; gap:16px; margin:24px 0 6px; padding:20px; border-radius:22px; background:linear-gradient(135deg, color-mix(in srgb, var(--cc) 20%, #fff), color-mix(in srgb, var(--cc) 6%, #fff)); border:1px solid color-mix(in srgb, var(--cc) 28%, #fff); }
  .cand-avatar{ box-shadow:0 4px 14px color-mix(in srgb, var(--cc) 40%, transparent); }
  .cand-avatar{ width:56px; height:56px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Baloo 2',sans-serif; font-weight:700; font-size:20px; flex:none; }
  h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(26px,4vw,34px); margin:0; }
  .party{ color:var(--ink-soft); font-size:15px; margin:2px 0 0; }
  .withdrawn-badge{ display:inline-block; margin-top:14px; padding:6px 14px; border-radius:99px; background:#fbe0dd; color:#a63a2e; font-size:13px; font-weight:700; }
  .cta{ margin:28px 0 10px; }
  .cmp{ margin:0 0 28px; }
  h2.subhead{ font-family:'Baloo 2',sans-serif; font-size:20px; margin:36px 0 16px; }
  .topic-row{ padding:16px 0; border-top:1px solid var(--line); }
  .theme{ scroll-margin-top:100px; }
  .toolbar{ position:sticky; top:0; z-index:5; margin:0 -20px; padding:10px 20px; background:color-mix(in srgb, var(--bg) 88%, transparent); -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px); border-bottom:1px solid var(--line); }
  .theme-nav{ display:flex; gap:6px; overflow-x:auto; scrollbar-width:none; padding-bottom:8px; }
  .theme-nav::-webkit-scrollbar{ display:none; }
  .theme-nav a{ flex:none; display:inline-flex; align-items:center; padding:6px 12px; border-radius:99px; border:1px solid var(--line); background:#fff; color:var(--ink-soft); font-size:13px; font-weight:600; text-decoration:none; white-space:nowrap; }
  .theme-nav a{ gap:6px; }
  .theme-nav a:hover, .theme-nav a.on{ border-color:var(--th); color:var(--ink); background:color-mix(in srgb, var(--th) 16%, #fff); }
  .filters{ display:flex; gap:6px; overflow-x:auto; scrollbar-width:none; }
  .filters::-webkit-scrollbar{ display:none; }
  .chip{ flex:none; white-space:nowrap; appearance:none; cursor:pointer; padding:6px 12px; border-radius:99px; border:1px solid var(--line); background:transparent; color:var(--ink-soft); font:600 13px 'Work Sans',Arial,sans-serif; }
  .chip:hover{ border-color:var(--accent); color:var(--accent); }
  .chip.on{ background:var(--accent); border-color:var(--accent); color:#fff; }
  .no-match{ display:none; color:var(--ink-faint); font-size:14px; padding:16px 0; }
  .pill{ display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:99px; font-size:12.5px; font-weight:800; }
  .p-pour{ background:#e3f4e9; color:#1f7a44; } .p-contre{ background:#fbe4e1; color:#b3372d; } .p-neutre{ background:#efece4; color:#5b6071; }
  .s-pour{ color:#2c9354; } .s-contre{ color:#d1453a; } .s-neutre{ color:#6b7183; }
  .cand-header{ position:relative; overflow:hidden; }
  .cand-id{ position:relative; z-index:1; min-width:0; }
  .cand-stat{ margin:8px 0 0; display:inline-block; padding:3px 10px; border-radius:99px; background:#fff; font-size:12px; font-weight:700; color:var(--ink-soft); }
  .hero-props{ position:absolute; right:0; top:0; bottom:0; width:190px; pointer-events:none; }
  .hp{ position:absolute; filter:drop-shadow(0 4px 8px rgba(0,0,0,.15)); }
  .hp1{ right:26px; top:14px; transform:rotate(10deg); } .hp2{ right:92px; top:52px; transform:rotate(-12deg); }
  .hp3{ right:30px; bottom:12px; transform:rotate(-6deg); } .hp4{ right:120px; top:8px; transform:rotate(14deg); opacity:.9; }
  @media (max-width:640px){ .hero-props{ display:none; } }
  .glance{ margin:26px 0 8px; }
  .glance .subhead{ margin-top:0; }
  .gbar{ display:flex; gap:3px; height:12px; border-radius:99px; overflow:hidden; }
  .g-pour{ background:#2c9354; } .g-contre{ background:#d1453a; } .g-neutre{ background:#b8b3a6; }
  .glegend{ font-size:13px; margin:8px 0 14px; color:var(--ink-faint); }
  .tiles{ display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; }
  .tile{ display:flex; flex-direction:column; align-items:flex-start; gap:6px; padding:12px 14px; border-radius:16px; text-decoration:none; color:var(--ink); background:linear-gradient(150deg, color-mix(in srgb, var(--th) 22%, #fff), color-mix(in srgb, var(--th) 6%, #fff)); border:1px solid color-mix(in srgb, var(--th) 30%, #fff); transition:transform .15s, box-shadow .15s; }
  a.tile:hover{ transform:translateY(-2px); box-shadow:0 6px 16px color-mix(in srgb, var(--th) 25%, transparent); }
  .tile.off{ filter:grayscale(1); opacity:.55; }
  .tl-name{ font-weight:800; font-size:14px; }
  .tl-n{ display:flex; gap:8px; font-size:13px; }
  .tl-none{ color:var(--ink-faint); font-weight:600; }
  @media (min-width:700px){ .theme-nav, .filters{ flex-wrap:wrap; overflow:visible; gap:5px; } .theme-nav a{ padding:5px 9px; gap:5px; font-size:12.5px; } .theme-nav a .prop{ width:16px; height:16px; } }
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
  <div class="cand-header" style="--cc:${escapeHtml(cand.color || "#7C3AED")}">
    <div class="cand-avatar" style="background:${escapeHtml(cand.color || "#7C3AED")};">${escapeHtml(initials)}</div>
    <div class="cand-id">
      <h1>${escapeHtml(cand.name)}</h1>
      <p class="party">${escapeHtml(cand.party)}</p>
      <p class="cand-stat">${indexable ? `${known.length} position${known.length > 1 ? "s" : ""} connue${known.length > 1 ? "s" : ""} sur ${topics.length} sujets` : "Positions à venir"}</p>
    </div>
    <div class="hero-props" aria-hidden="true">${heroProps}</div>
  </div>
  ${withdrawnBadge}
  <p style="color:var(--ink-soft); line-height:1.6; margin-top:18px;">${indexable ? `Positions de ${escapeHtml(cand.name)} sur ${known.length === topics.length ? "" : `${known.length} des `}${topics.length} sujets de la présidentielle 2027 suivis par Votona, établies à partir de déclarations, votes ou programmes publics.` : `Votona suit ${topics.length} sujets de la présidentielle 2027 et y relève, pour chaque candidat, les positions tirées de déclarations, votes ou programmes publics.`}</p>
  <a class="btn btn-accent cta" href="../../?screen=results">${BTN_MASCOT}Compare tes propres positions à celles de ${escapeHtml(cand.name)}</a>
  ${indexable ? `<a class="btn btn-ghost cmp" href="/comparer/?a=${encodeURIComponent(cand.id)}">${ICON_VS}Comparer avec un autre candidat</a>` : ""}
  ${glance}
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

function indexPageHtml(candidates, topics) {
  const canonical = `${SITE_URL}/candidats/`;
  const active = candidates.filter((c) => !c.withdrawn);
  // Ordre alphabétique du nom de famille (tout ce qui suit le prénom : « Le Pen »,
  // « Dupont-Aignan »), sans tenir compte des accents ni des majuscules.
  const surname = (n) => String(n || "").split(" ").slice(1).join(" ");
  const sorted = candidates.slice().sort((a, b) => surname(a.name).localeCompare(surname(b.name), "fr", { sensitivity: "base" }) || a.name.localeCompare(b.name, "fr"));
  const items = sorted.map((c) => {
    const known = topics.filter((t) => isKnown(c.positions && c.positions[t.id]));
    const n = (st) => known.filter((t) => c.positions[t.id].stance === st).length;
    const pour = n("pour"), contre = n("contre"), neutre = known.length - pour - contre;
    const bar = known.length
      ? `<span class="mbar" aria-hidden="true">${pour ? `<i class="g-pour" style="flex:${pour}"></i>` : ""}${contre ? `<i class="g-contre" style="flex:${contre}"></i>` : ""}${neutre ? `<i class="g-neutre" style="flex:${neutre}"></i>` : ""}${topics.length - known.length ? `<i class="g-none" style="flex:${topics.length - known.length}"></i>` : ""}</span><span class="meta">${known.length}/${topics.length} positions connues</span>`
      : `<span class="meta">Positions à venir</span>`;
    return `
    <li data-search="${escapeHtml((c.name + " " + c.party))}"${c.withdrawn ? ' class="out"' : ""} style="--cc:${escapeHtml(c.color || "#7C3AED")}"><a href="${c.id}/"><span class="av" style="background:${escapeHtml(c.color || "#7C3AED")}">${escapeHtml(initialsOf(c.name))}</span><span class="who"><span class="nm">${escapeHtml(c.name)}</span><span class="party">${escapeHtml(c.party)}${c.withdrawn ? " · retiré de la course" : ""}</span>${bar}</span></a></li>`;
  }).join("");
  const crew = ["Économie & travail", "Écologie", "Sécurité & immigration"].map((cat, i) => charSrc(cat) ? `<img class="crew c${i + 1}" src="${charSrc(cat)}" width="339" height="577" alt="" />` : "").join("");

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
<meta property="og:image" content="${SITE_URL}/assets/ui/og-home.jpg" />
${HEAD_ICONS}
<style>${SHARED_CSS}
  main{ max-width:880px; margin:0 auto; padding:32px 20px 64px; }
  .hero{ position:relative; overflow:hidden; margin-top:6px; padding:28px 300px 28px 28px; border-radius:26px; background:linear-gradient(135deg, #ece3fd, #faf7ff 70%); border:1px solid #e0d3fb; }
  .hero h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(26px,4vw,36px); line-height:1.12; margin:0 0 10px; }
  .hero p{ color:var(--ink-soft); line-height:1.6; margin:0; }
  .stats{ display:flex; flex-wrap:wrap; gap:8px; margin:16px 0 0; }
  .stats span{ padding:5px 12px; border-radius:99px; background:#fff; font-size:13px; font-weight:700; color:var(--ink-soft); }
  .stats b{ color:var(--accent); }
  .crew{ position:absolute; bottom:-30px; height:200px; width:auto; filter:drop-shadow(0 8px 14px rgba(0,0,0,.18)); }
  .c1{ right:170px; height:170px; transform:rotate(-6deg); } .c2{ right:88px; height:205px; z-index:1; } .c3{ right:10px; height:175px; transform:rotate(6deg); }
  @media (max-width:680px){ .hero{ padding:22px 20px 170px; } .c1{ right:auto; left:calc(50% - 150px); height:140px; } .c2{ right:auto; left:calc(50% - 60px); height:170px; } .c3{ right:auto; left:calc(50% + 40px); height:140px; } }
  .btn-pair{ display:flex; gap:8px; margin-top:18px; }
  .btn-pair .btn{ flex:1; padding:12px 14px; font-size:14px; }
  @media (max-width:520px){ .btn-pair{ flex-direction:column; } }
  input#q{ width:100%; padding:13px 16px; border-radius:14px; border:1px solid var(--line); font-size:14.5px; font-family:inherit; margin-top:18px; background:#fff; color:var(--ink); }
  input#q:focus{ outline:2px solid var(--accent); outline-offset:1px; }
  #list{ list-style:none; padding:0; margin:18px 0; display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; }
  #list li[hidden]{ display:none; }
  #list a{ display:flex; align-items:center; gap:14px; height:100%; padding:14px 16px; border-radius:18px; text-decoration:none; color:var(--ink); background:linear-gradient(150deg, color-mix(in srgb, var(--cc) 14%, #fff), #fff 75%); border:1px solid color-mix(in srgb, var(--cc) 24%, var(--line)); transition:transform .15s, box-shadow .15s, border-color .15s; }
  #list a:hover{ transform:translateY(-2px); border-color:var(--cc); box-shadow:0 8px 20px color-mix(in srgb, var(--cc) 22%, transparent); }
  #list .out a{ filter:grayscale(.8); opacity:.7; }
  .av{ flex:none; width:48px; height:48px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Baloo 2',sans-serif; font-weight:800; font-size:18px; box-shadow:0 4px 10px color-mix(in srgb, var(--cc) 35%, transparent); }
  .who{ display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; }
  .nm{ font-weight:800; font-size:15.5px; line-height:1.25; }
  .party{ color:var(--ink-faint); font-size:12.5px; }
  .mbar{ display:flex; gap:2px; height:6px; border-radius:99px; overflow:hidden; margin-top:7px; }
  .mbar i{ display:block; }
  .g-pour{ background:#2c9354; } .g-contre{ background:#d1453a; } .g-neutre{ background:#b8b3a6; } .g-none{ background:#ebe7de; }
  .meta{ font-size:11.5px; font-weight:700; color:var(--ink-faint); margin-top:3px; }
  .legend{ font-size:12.5px; color:var(--ink-faint); margin:6px 0 0; }
  .legend i{ display:inline-block; width:9px; height:9px; border-radius:3px; margin:0 4px 0 8px; vertical-align:-1px; }
  #empty{ display:none; color:var(--ink-faint); font-size:13.5px; padding:14px 0; }
</style>
</head>
<body>
${HEADER_INDEX}
<main>
  <section class="hero">
    <h1>Tous les candidats à la présidentielle 2027</h1>
    <p>Chaque candidature officiellement déclarée, avec ses positions sourcées sujet par sujet, retraits de la course inclus.</p>
    <div class="stats"><span><b>${active.length}</b> candidats en course</span><span><b>${topics.length}</b> sujets suivis</span></div>
    ${crew}
  </section>
  <div class="btn-pair"><a class="btn btn-ghost" href="/comparer/">${ICON_VS}Comparer deux candidats</a><a class="btn btn-ghost" href="/sujets/">${ICON_GRID}Voir les candidats sujet par sujet</a></div>
  <input id="q" type="search" placeholder="Rechercher un candidat ou un parti…" aria-label="Rechercher un candidat ou un parti" />
  <p class="legend">Positions :<i class="g-pour"></i>d'accord<i class="g-contre"></i>pas d'accord<i class="g-neutre"></i>neutre<i class="g-none"></i>non précisée</p>
  <ul id="list">${items}
  </ul>
  <p id="empty">Aucun candidat ne correspond à cette recherche.</p>
  <script>
    (function(){
      var q = document.getElementById("q");
      var items = Array.prototype.slice.call(document.querySelectorAll("#list li"));
      var norm = function(s){ return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); };
      q.addEventListener("input", function(){
        var term = norm(q.value.trim()), visible = 0;
        items.forEach(function(li){ var ok = !term || norm(li.getAttribute("data-search")).indexOf(term) !== -1; li.hidden = !ok; if(ok) visible++; });
        document.getElementById("empty").style.display = visible ? "none" : "block";
      });
    })();
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
      <li class="cand"><a class="cand-name" href="/candidats/${c.id}/"><span class="av-sm" style="background:${escapeHtml(c.color || "#7C3AED")};width:30px;height:30px;font-size:11px;">${escapeHtml(initialsOf(c.name))}</span>${escapeHtml(c.name)}</a><span class="cand-party">${escapeHtml(c.party)}</span>${pos && pos.detail ? `<p class="detail">${escapeHtml(pos.detail)}</p>` : ""}</li>`;
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
  <h2 class="subhead" style="display:flex;align-items:center;gap:10px;">${propImg(topic.cat, 30)}Autres sujets : ${escapeHtml(topic.cat)}</h2>
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
  .hero{ position:relative; margin:22px 0 0; padding:22px 170px 24px 22px; border-radius:24px; overflow:hidden; background:linear-gradient(135deg, color-mix(in srgb, var(--th) 26%, #fff), color-mix(in srgb, var(--th) 8%, #fff)); border:1px solid color-mix(in srgb, var(--th) 35%, #fff); }
  .hero-char{ position:absolute; right:18px; bottom:-22px; height:190px; width:auto; filter:drop-shadow(0 8px 14px rgba(0,0,0,.18)); }
  .topic-pill{ display:inline-flex; align-items:center; gap:7px; padding:5px 12px 5px 6px; margin-bottom:12px; border-radius:99px; background:#fff; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--ink); }
  @media (max-width:560px){ .hero{ padding:18px 18px 130px; } .hero-char{ height:150px; right:50%; transform:translateX(50%); bottom:-26px; } }
  h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(24px,3.6vw,32px); line-height:1.2; margin:0; }
  .context{ color:var(--ink-soft); line-height:1.6; margin:14px 0 0; }
  .cta{ margin:24px 0 8px; }
  .group{ margin-top:30px; }
  .group h2{ font-family:'Baloo 2',sans-serif; font-size:20px; margin:0 0 6px; display:flex; align-items:center; gap:8px; }
  .g-pour h2{ color:#2c9354; } .g-contre h2{ color:#d1453a; } .g-nuance h2, .g-inconnu h2{ color:var(--ink-soft); }
  .count{ font-family:'IBM Plex Mono',monospace; font-size:12px; font-weight:500; color:var(--ink-faint); background:var(--masthead-bg); padding:2px 8px; border-radius:99px; }
  .group ul{ list-style:none; padding:0; margin:0; }
  .cand{ padding:12px 0; border-top:1px solid var(--line); }
  .cand-name{ display:inline-flex; align-items:center; gap:10px; font-weight:700; color:var(--ink); text-decoration:none; }
  .cand-name:hover{ color:var(--accent); }
  .cand-dot{ width:10px; height:10px; border-radius:50%; flex:none; }
  .cand-party{ color:var(--ink-faint); font-size:13px; margin-left:8px; }
  .detail{ font-size:13.5px; line-height:1.55; color:var(--ink-soft); margin:6px 0 0 40px; }
  .names{ display:flex; flex-wrap:wrap; gap:8px; margin:10px 0 0; }
  .names a{ display:inline-flex; align-items:center; gap:7px; padding:6px 12px; border-radius:99px; background:#fff; border:1px solid var(--line); color:var(--ink-soft); font-size:13px; font-weight:600; text-decoration:none; }
  .names a:hover{ border-color:var(--accent); color:var(--accent); }
  .names .cand-dot{ width:8px; height:8px; }
  h2.subhead{ font-family:'Baloo 2',sans-serif; font-size:20px; margin:44px 0 12px; }
  ul.related{ list-style:none; padding:0; margin:0; display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
  ul.related a{ position:relative; display:flex; flex-direction:column; gap:8px; height:100%; box-sizing:border-box; padding:16px 38px 16px 18px; background:#fff; border:1px solid var(--line); border-radius:16px; color:var(--ink); text-decoration:none; transition:border-color .15s, transform .15s, box-shadow .15s; }
  ul.related{ --th:${themeColor(topic.cat)}; }
  ul.related a{ border-top:4px solid var(--th); }
  ul.related a:hover{ border-color:var(--th); transform:translateY(-2px); box-shadow:0 6px 18px rgba(124,58,237,.10); }
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
  <div class="hero" style="--th:${themeColor(topic.cat)}">
    <div class="topic-pill">${propImg(topic.cat, 22)}${escapeHtml(topic.cat)}</div>
    <h1>${escapeHtml(topic.statement)} : que proposent les candidats ?</h1>
    ${charSrc(topic.cat) ? `<img class="hero-char" src="${charSrc(topic.cat)}" width="339" height="577" alt="" />` : ""}
  </div>
  ${topic.context ? `<p class="context">${escapeHtml(topic.context)}</p>` : ""}
  <a class="btn btn-accent cta" href="/">${BTN_MASCOT}Et toi, tu en penses quoi ? Découvre quel candidat te correspond</a>
  ${section("pour", "Pour", "✓")}
  ${section("contre", "Contre", "✕")}
  ${section("nuance", "Neutre ou nuancé", "≈")}
  ${unknown}
  ${siblingsHtml}
  <a class="btn btn-ghost btn-row all" href="/sujets/">${ICON_GRID}Voir les ${topics.length} sujets de la présidentielle 2027</a>
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
    <ul>${split.map(({ t, pour, contre }) => `<li><a href="${slugs[t.id]}/"><span class="d-title" style="display:flex;gap:10px;align-items:center;">${propImg(t.cat, 26)}${escapeHtml(t.statement)}</span><span class="d-bar" aria-hidden="true"><span style="flex:${pour}"></span><span style="flex:${contre}"></span></span><span class="d-meta"><span class="s-pour">${pour} pour</span> · <span class="s-contre">${contre} contre</span></span></a></li>`).join("")}
    </ul>
  </section>` : "";
  const blocks = categories.map((cat) => {
    const list = topics.filter((t) => t.cat === cat);
    if (!list.length) return "";
    const meta = categoryMeta[cat] || {};
    return `
  <section class="cat" style="--th:${themeColor(cat)}">
    <h2 class="theme-h">${propImg(cat, 34)}${escapeHtml(cat)}</h2>
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
  section.cat li a{ display:flex; gap:10px; align-items:baseline; }
  section.cat li a::before{ content:""; flex:none; width:8px; height:8px; border-radius:50%; background:var(--th); transform:translateY(-1px); }
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
  <a class="btn btn-accent cta" href="/">${BTN_MASCOT}Et toi ? Réponds aux questions et découvre quel candidat te correspond</a>
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

// Page /comparer/ : deux candidats côte à côte, sujet par sujet. Les données
// (positions connues seulement) sont embarquées en JSON ; le choix des deux
// candidats et l'affichage se font dans le navigateur, et l'adresse garde la
// paire choisie (/comparer/?a=<id>&b=<id>) pour pouvoir la partager.
function compareHtml(candidates, topics, categoryMeta, categoryIconPaths, slugs) {
  const canonical = `${SITE_URL}/comparer/`;
  const initials = (name) => String(name || "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const data = {
    c: candidates.map((c) => ({ id: c.id, n: c.name, p: c.party, col: c.color || "#7C3AED", i: initials(c.name), w: c.withdrawn ? 1 : 0 })),
    t: topics.map((t) => ({ id: t.id, s: t.statement, cat: t.cat, u: slugs[t.id] })),
    cats: Object.keys(categoryMeta).map((cat) => ({ n: cat, ic: propImg(cat, 30), col: themeColor(cat) })),
    pos: Object.fromEntries(candidates.map((c) => [c.id, Object.fromEntries(topics.filter((t) => isKnown(c.positions && c.positions[t.id])).map((t) => [t.id, [c.positions[t.id].stance, c.positions[t.id].detail || ""]]))]))
  };
  // "</" échappé pour ne jamais fermer la balise <script> par accident.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const noscript = candidates.filter((c) => !c.withdrawn).map((c) => `<a href="/candidats/${c.id}/">${escapeHtml(c.name)}</a>`).join(" · ");
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Comparer deux candidats à la présidentielle 2027, sujet par sujet | Votona</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="Choisis deux candidats à la présidentielle 2027 et compare leurs positions sur ${topics.length} sujets : où ils sont d'accord, où ils s'opposent. Positions sourcées." />
<link rel="canonical" href="${canonical}" />
<meta name="robots" content="index, follow" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Votona" />
<meta property="og:url" content="${canonical}" />
<meta property="og:title" content="Comparer deux candidats à la présidentielle 2027 | Votona" />
<meta property="og:description" content="Où sont-ils d'accord, où s'opposent-ils ? Compare deux candidats sujet par sujet." />
<meta property="og:image" content="${SITE_URL}/assets/ui/og-home.jpg" />
<meta property="og:locale" content="fr_FR" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${SITE_URL}/assets/ui/og-home.jpg" />
${HEAD_ICONS}
<script type="application/ld+json">${breadcrumbLd([{ name: "Votona", url: SITE_URL + "/" }, { name: "Candidats", url: SITE_URL + "/candidats/" }, { name: "Comparer deux candidats", url: canonical }])}</script>
<style>${SHARED_CSS}
  main{ max-width:720px; margin:0 auto; padding:32px 20px 64px; }
  h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(26px,4vw,34px); margin:28px 0 8px; line-height:1.15; }
  p.intro{ color:var(--ink-soft); line-height:1.6; margin:0; }
  .duel{ display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:10px; margin:26px 0 12px; }
  .slot{ appearance:none; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; padding:16px 10px; border-radius:18px; border:2px solid color-mix(in srgb, var(--accent) 20%, var(--line)); background:#fff; font-family:inherit; color:var(--ink); min-width:0; }
  .slot:hover, .slot.open{ border-color:var(--accent); }
  .slot.picked{ background:linear-gradient(160deg, color-mix(in srgb, var(--cc) 20%, #fff), color-mix(in srgb, var(--cc) 5%, #fff)); border-color:color-mix(in srgb, var(--cc) 40%, #fff); }
  .slot.picked:hover, .slot.picked.open{ border-color:var(--cc); }
  .slot .av{ width:60px; height:60px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Baloo 2',sans-serif; font-weight:800; font-size:22px; }
  .slot .av.empty{ background:transparent; border:2px dashed var(--ink-faint); color:var(--ink-faint); font-size:28px; font-family:'Work Sans',sans-serif; }
  .slot .nm{ font-weight:800; font-size:15px; line-height:1.25; text-align:center; overflow-wrap:anywhere; }
  .slot .pt{ font-size:12.5px; color:var(--ink-faint); text-align:center; }
  .slot .chg{ font-size:12px; font-weight:700; color:var(--accent); }
  .vs{ font-family:'IBM Plex Mono',monospace; font-weight:600; color:var(--ink-faint); font-size:14px; }
  .picker{ display:none; margin:0 0 18px; padding:14px; border:1px solid var(--line); border-radius:18px; background:#fff; }
  .picker.show{ display:block; }
  .picker input{ width:100%; padding:12px 14px; border-radius:12px; border:1px solid var(--line); font:14px 'Work Sans',Arial,sans-serif; color:var(--ink); background:var(--bg); }
  .picker input:focus{ outline:2px solid var(--accent); outline-offset:1px; }
  .picker ul{ list-style:none; padding:0; margin:8px 0 0; max-height:320px; overflow-y:auto; }
  .picker li button{ width:100%; display:flex; align-items:center; gap:10px; padding:10px 8px; border:0; border-radius:10px; background:transparent; cursor:pointer; font:600 14.5px 'Work Sans',Arial,sans-serif; color:var(--ink); text-align:left; }
  .picker li button:hover, .picker li button:focus-visible{ background:var(--masthead-bg); outline:none; }
  .picker li button[disabled]{ opacity:.35; cursor:default; }
  .picker .dot{ width:10px; height:10px; border-radius:50%; flex:none; }
  .picker .pt{ color:var(--ink-faint); font-weight:400; font-size:13px; }
  .hint{ text-align:center; color:var(--ink-faint); font-size:14px; padding:28px 10px; border:1px dashed var(--line); border-radius:18px; }
  .score{ display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:6px 0 14px; }
  .score div{ background:#fff; border:1px solid var(--line); border-radius:14px; padding:12px 8px; text-align:center; }
  .score b{ display:block; font-family:'Baloo 2',sans-serif; font-size:26px; line-height:1.1; }
  .score span{ font-size:12px; color:var(--ink-soft); font-weight:600; }
  .score .ok b{ color:#2c9354; } .score .ko b{ color:#d1453a; } .score .nd b{ color:var(--ink-faint); }
  .filters{ display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px; }
  .chip{ flex:none; appearance:none; cursor:pointer; padding:6px 12px; border-radius:99px; border:1px solid var(--line); background:transparent; color:var(--ink-soft); font:600 13px 'Work Sans',Arial,sans-serif; white-space:nowrap; }
  .chip:hover{ border-color:var(--accent); color:var(--accent); }
  .chip.on{ background:var(--accent); border-color:var(--accent); color:#fff; }
  .cols{ display:grid; grid-template-columns:1fr 52px 52px; gap:6px; font-size:11px; font-family:'IBM Plex Mono',monospace; color:var(--ink-faint); text-transform:uppercase; padding:4px 0; }
  .cols span{ text-align:center; }
  .mini{ display:inline-flex; width:26px; height:26px; border-radius:50%; align-items:center; justify-content:center; color:#fff; font:800 10.5px 'Work Sans',Arial,sans-serif; font-style:normal; }
  details.row{ border-top:1px solid var(--line); }
  details.row summary{ list-style:none; cursor:pointer; display:grid; grid-template-columns:1fr 52px 52px; gap:6px; align-items:center; padding:12px 0; }
  details.row summary::-webkit-details-marker{ display:none; }
  details.row .q{ font-weight:600; font-size:14.5px; line-height:1.4; }
  details.row .q::after{ content:" ▾"; color:var(--ink-faint); font-size:11px; }
  details.row[open] .q::after{ content:" ▴"; }
  .st{ text-align:center; font-weight:800; font-size:17px; }
  .st.pour{ color:#2c9354; } .st.contre{ color:#d1453a; } .st.neutre{ color:var(--ink-soft); } .st.none{ color:var(--ink-faint); font-weight:600; }
  details.row.ko summary{ background:linear-gradient(90deg, rgba(209,69,58,.06), transparent 70%); }
  .why{ padding:0 0 14px; display:grid; gap:8px; }
  .why p{ margin:0; font-size:13.5px; line-height:1.55; color:var(--ink-soft); }
  .why b{ color:var(--ink); }
  .why a{ color:var(--accent); font-weight:600; font-size:13px; }
  #none{ display:none; color:var(--ink-faint); font-size:14px; padding:16px 0; }
  .legend{ font-size:12.5px; color:var(--ink-faint); margin:18px 0 0; line-height:1.6; }
  footer{ margin-top:48px; font-size:12px; color:var(--ink-faint); text-align:center; }
  footer a{ color:inherit; }
</style>
</head>
<body>
${HEADER}
<main>
  <nav class="crumbs"><a class="crumb" href="/candidats/">‹ Tous les candidats</a><a class="crumb" href="/sujets/">Tous les sujets ›</a></nav>
  <h1>Comparer deux candidats</h1>
  <p class="intro">Choisis deux candidats à la présidentielle 2027 : Votona met leurs positions côte à côte sur les ${topics.length} sujets suivis, pour voir où ils sont d'accord et où ils s'opposent.</p>
  <div class="duel">
    <button type="button" class="slot" id="slot-a" data-slot="a"></button>
    <span class="vs">vs</span>
    <button type="button" class="slot" id="slot-b" data-slot="b"></button>
  </div>
  <div class="picker" id="picker">
    <input id="pick-q" type="search" placeholder="Rechercher un candidat ou un parti…" aria-label="Rechercher un candidat à comparer" autocomplete="off" />
    <ul id="pick-list"></ul>
  </div>
  <div id="result"></div>
  <noscript><p class="hint">Active JavaScript pour comparer deux candidats, ou consulte leurs fiches : ${noscript}</p></noscript>
  <a class="btn btn-accent cta" style="margin-top:30px;" href="/">${BTN_MASCOT}Et toi ? Réponds aux questions et découvre quel candidat te correspond</a>
  <footer>
    Positions simplifiées à titre indicatif, établies à partir des déclarations publiques, ni exhaustives ni officielles.<br />
    <a href="/">votona.fr</a>
  </footer>
</main>
<script>
(function(){
  var D = ${json};
  var byId = {}; D.c.forEach(function(c){ byId[c.id] = c; });
  var LABEL = { pour: "D'accord", contre: "Pas d'accord", neutre: "Neutre" };
  var ICON = { pour: "✓", contre: "✕", neutre: "–" };
  var sel = { a: null, b: null }, picking = null, filter = "";
  var params = new URLSearchParams(location.search);
  if (byId[params.get("a")]) sel.a = params.get("a");
  if (byId[params.get("b")] && params.get("b") !== sel.a) sel.b = params.get("b");
  function esc(s){ return String(s).replace(/[&<>"']/g, function(ch){ return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]; }); }
  function norm(s){ return String(s).toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, ""); }
  function mini(c){ return '<span title="' + esc(c.n) + '"><i class="mini" style="background:' + esc(c.col) + '">' + esc(c.i) + '</i></span>'; }
  function slotHtml(id){
    var c = byId[id];
    if (!c) return '<span class="av empty">+</span><span class="nm">Choisir</span><span class="pt">un candidat</span>';
    return '<span class="av" style="background:' + esc(c.col) + '">' + esc(c.i) + '</span><span class="nm">' + esc(c.n) + '</span><span class="pt">' + esc(c.p) + (c.w ? " · retiré" : "") + '</span><span class="chg">Changer</span>';
  }
  function syncUrl(){
    var q = [];
    if (sel.a) q.push("a=" + encodeURIComponent(sel.a));
    if (sel.b) q.push("b=" + encodeURIComponent(sel.b));
    history.replaceState(null, "", location.pathname + (q.length ? "?" + q.join("&") : ""));
    var a = byId[sel.a], b = byId[sel.b];
    document.title = (a && b ? a.n + " vs " + b.n + " : " : "") + "Comparer deux candidats à la présidentielle 2027 | Votona";
  }
  function renderPicker(){
    var p = document.getElementById("picker");
    p.classList.toggle("show", !!picking);
    document.getElementById("slot-a").classList.toggle("open", picking === "a");
    document.getElementById("slot-b").classList.toggle("open", picking === "b");
    if (!picking) return;
    var other = sel[picking === "a" ? "b" : "a"];
    var term = norm(document.getElementById("pick-q").value.trim());
    var list = D.c.filter(function(c){ return !term || norm(c.n + " " + c.p).indexOf(term) !== -1; });
    document.getElementById("pick-list").innerHTML = list.length ? list.map(function(c){
      return '<li><button type="button" data-id="' + esc(c.id) + '"' + (c.id === other ? " disabled" : "") + '><span class="dot" style="background:' + esc(c.col) + '"></span><span>' + esc(c.n) + ' <span class="pt">' + esc(c.p) + (c.w ? " · retiré" : "") + '</span></span></button></li>';
    }).join("") : '<li class="pt" style="padding:10px 8px">Aucun candidat ne correspond.</li>';
  }
  function cell(p){ return p ? '<span class="st ' + p[0] + '" title="' + LABEL[p[0]] + '">' + ICON[p[0]] + '</span>' : '<span class="st none" title="Position non précisée">?</span>'; }
  function renderResult(){
    var out = document.getElementById("result");
    var a = byId[sel.a], b = byId[sel.b];
    if (!a || !b) { out.innerHTML = '<p class="hint">' + (a || b ? "Choisis un second candidat pour voir leurs positions côte à côte." : "Choisis deux candidats pour comparer leurs positions.") + '</p>'; return; }
    var pa = D.pos[a.id] || {}, pb = D.pos[b.id] || {};
    var ok = 0, ko = 0, nd = 0;
    var rows = D.t.map(function(t){
      var x = pa[t.id], y = pb[t.id], k;
      if (!x || !y) { k = "nd"; nd++; }
      else if (x[0] === y[0]) { k = "ok"; ok++; }
      else if ((x[0] === "pour" && y[0] === "contre") || (x[0] === "contre" && y[0] === "pour")) { k = "ko"; ko++; }
      else { k = "nu"; nd++; }
      return { t: t, x: x, y: y, k: k };
    });
    var shown = rows.filter(function(r){ return !filter || r.k === filter; });
    var html = '<div class="score"><div class="ok"><b>' + ok + '</b><span>même position</span></div><div class="ko"><b>' + ko + '</b><span>positions opposées</span></div><div class="nd"><b>' + nd + '</b><span>nuancé ou non précisé</span></div></div>' +
      '<div class="filters">' + [["", "Tous les sujets · " + rows.length], ["ok", "Même position · " + ok], ["ko", "Opposés · " + ko]].map(function(f){ return '<button type="button" class="chip' + (filter === f[0] ? " on" : "") + '" data-filter="' + f[0] + '">' + f[1] + '</button>'; }).join("") + '</div>';
    D.cats.forEach(function(cat){
      var list = shown.filter(function(r){ return r.t.cat === cat.n; });
      if (!list.length) return;
      html += '<h2 class="theme-h" style="--th:' + esc(cat.col) + '">' + cat.ic + esc(cat.n) + '</h2><div class="cols"><span style="text-align:left">Sujet</span>' + mini(a) + mini(b) + '</div>';
      list.forEach(function(r){
        var why = function(c, p){ return '<p><b>' + esc(c.n) + ' : ' + (p ? LABEL[p[0]] : "position non précisée") + '.</b>' + (p && p[1] ? " " + esc(p[1]) : "") + '</p>'; };
        html += '<details class="row ' + r.k + '"><summary><span class="q">' + esc(r.t.s) + '</span>' + cell(r.x) + cell(r.y) + '</summary><div class="why">' + why(a, r.x) + why(b, r.y) + '<a href="/sujets/' + esc(r.t.u) + '/">Voir tous les candidats sur ce sujet ›</a></div></details>';
      });
    });
    if (!shown.length) html += '<p class="hint">Aucun sujet dans cette catégorie pour ces deux candidats.</p>';
    html += '<p class="legend">✓ d\\'accord · ✕ pas d\\'accord · – neutre ou nuancé · ? position non encore précisée. Touche un sujet pour lire le détail des deux positions.</p>';
    out.innerHTML = html;
  }
  function render(){
    ["a", "b"].forEach(function(k){
      var el = document.getElementById("slot-" + k), c = byId[sel[k]];
      el.innerHTML = slotHtml(sel[k]);
      el.style.setProperty("--cc", c ? c.col : "");
      el.classList.toggle("picked", !!c);
    });
    renderPicker(); renderResult(); syncUrl();
  }
  document.querySelectorAll(".slot").forEach(function(btn){
    btn.addEventListener("click", function(){
      var s = btn.getAttribute("data-slot");
      picking = picking === s ? null : s;
      document.getElementById("pick-q").value = "";
      renderPicker();
      if (picking) document.getElementById("pick-q").focus();
    });
  });
  document.getElementById("pick-q").addEventListener("input", renderPicker);
  document.getElementById("pick-list").addEventListener("click", function(e){
    var b = e.target.closest("button[data-id]");
    if (!b || b.disabled) return;
    sel[picking] = b.getAttribute("data-id");
    picking = !sel.a ? "a" : !sel.b ? "b" : null;
    document.getElementById("pick-q").value = "";
    render();
    if (picking) document.getElementById("pick-q").focus();
  });
  document.getElementById("result").addEventListener("click", function(e){
    var c = e.target.closest(".chip[data-filter]");
    if (!c) return;
    filter = c.getAttribute("data-filter");
    renderResult();
  });
  if (!sel.a) picking = "a"; else if (!sel.b) picking = "b";
  render();
})();
</script>
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
    url(`${SITE_URL}/comparer/`, "weekly", "0.8"),
    url(`${SITE_URL}/sujets/`, "weekly", "0.8"),
    ...topics.map((t) => url(`${SITE_URL}/sujets/${slugs[t.id]}/`, "weekly", "0.7"))
  ].join("\n")}
</urlset>
`;
}

function main() {
  const { CATEGORIES, TOPICS, CANDIDATES, CATEGORY_META, CATEGORY_ICON_PATHS } = loadData();
  const slugs = topicSlugs(TOPICS);
  Object.keys(CATEGORY_META).forEach((cat) => { THEMES[cat] = { slug: CATEGORY_META[cat].slug, pop: CATEGORY_META[cat].pop }; });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  CANDIDATES.forEach((cand) => {
    const dir = path.join(OUT_DIR, cand.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), "\uFEFF" + candidatePageHtml(cand, TOPICS, CATEGORY_META, CATEGORY_ICON_PATHS, slugs), "utf8");
  });

  fs.writeFileSync(path.join(OUT_DIR, "index.html"), "\uFEFF" + indexPageHtml(CANDIDATES, TOPICS), "utf8");

  // Pages sujets : on repart d'un dossier propre (un sujet renommé ne laisse pas d'ancienne page).
  fs.rmSync(TOPIC_DIR, { recursive: true, force: true });
  fs.mkdirSync(TOPIC_DIR, { recursive: true });
  TOPICS.forEach((t) => {
    const dir = path.join(TOPIC_DIR, slugs[t.id]);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), "\uFEFF" + topicPageHtml(t, CANDIDATES, TOPICS, CATEGORY_ICON_PATHS, slugs), "utf8");
  });
  fs.writeFileSync(path.join(TOPIC_DIR, "index.html"), "\uFEFF" + topicIndexHtml(TOPICS, CATEGORIES, CATEGORY_META, CATEGORY_ICON_PATHS, slugs, CANDIDATES), "utf8");

  fs.mkdirSync(path.join(ROOT, "comparer"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "comparer", "index.html"), "\uFEFF" + compareHtml(CANDIDATES, TOPICS, CATEGORY_META, CATEGORY_ICON_PATHS, slugs), "utf8");

  fs.writeFileSync(path.join(ROOT, "sitemap.xml"), sitemapXml(CANDIDATES, TOPICS, slugs), "utf8");

  console.log(`Généré : ${CANDIDATES.length} pages candidats + ${TOPICS.length} pages sujets + 2 index + comparateur + sitemap.xml`);
}

if (require.main === module) main();
module.exports = { loadData, topicSlugs, SITE_URL };
