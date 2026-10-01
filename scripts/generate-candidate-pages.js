// Génère les pages statiques (référencement) à partir des données déjà
// présentes dans index.html (CANDIDATES, TOPICS, CATEGORY_META,
// CATEGORY_ICON_PATHS) : rien n'est ressaisi à la main, un seul lancement
// régénère tout :
//   - candidats/<id>/index.html : une page par candidat + candidats/index.html ;
//   - sujets/<slug>/index.html : une page par sujet (« que proposent les
//     candidats ? ») + sujets/index.html ;
//   - comparer/index.html (comparateur), methode/index.html (page Méthode) et
//     journal/index.html (journal de la campagne) ;
//   - sitemap.xml, entièrement réécrit.
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
const HEAD_ICONS = `<link rel="icon" type="image/png" sizes="48x48" href="/assets/ui/favicon-48.png?v=2" />
<link rel="icon" type="image/png" sizes="192x192" href="/assets/ui/favicon-192.png?v=2" />
<link rel="icon" href="/favicon.ico?v=2" sizes="32x32 48x48" />
<link rel="apple-touch-icon" sizes="180x180" href="/assets/ui/apple-touch-icon.png?v=2" />
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

// FAQ de l'app (FAQ_ITEMS d'index.html) : affichée sur la page « FAQ et méthode ».
function loadFaqItems(html) {
  const start = html.indexOf("var FAQ_ITEMS = [");
  const end = start === -1 ? -1 : html.indexOf("\n];", start);
  if (start === -1 || end === -1) throw new Error("FAQ_ITEMS introuvable dans index.html");
  // eslint-disable-next-line no-new-func
  return new Function(html.slice(start, end + 3) + "\nreturn FAQ_ITEMS;")();
}

function loadData() {
  const html = fs.readFileSync(SITE_HTML_PATH, "utf8");
  const block = extractDataBlock(html);
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  const fn = new Function(block + "\nreturn { CATEGORIES, TOPICS, CANDIDATES, CATEGORY_META, CATEGORY_ICON_PATHS, CAMPAIGN_LOG, buildCampaignJournal };");
  return Object.assign(fn.call(sandbox), { FAQ_ITEMS: loadFaqItems(html) });
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
const HEADER = '<header class="topbar"><a class="brand" href="/" title="Accueil Votona"><span class="mark"><img src="/assets/ui/logo-head.webp" alt="" width="40" height="32" /></span><span class="name">Votona</span><span class="year">PRÉSIDENTIELLE 2027</span></a><div class="topbar-actions"><a class="icon-btn" href="/?screen=account" title="Mon compte"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg></a><a class="icon-btn" href="/methode/" title="FAQ et méthode"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.3 9.2a2.7 2.7 0 1 1 3.9 2.4c-1 .5-1.7 1.1-1.7 2.4"/><line x1="12" y1="17.2" x2="12" y2="17.21"/></svg></a></div></header>';
const HEADER_INDEX = HEADER;

const SHARED_CSS = `
  :root{ color-scheme:light dark; --gutter:clamp(20px,4vw,40px); --bg:#fbfaf7; --surface:#ffffff; --ink:#191d2b; --ink-soft:#4d5468; --ink-faint:#8790a3; --line:#e4dfd0; --accent:#7C3AED; --accent-ink:#ffffff; --good:#2c9354; --bad:#d1453a; --neutral-bar:#b8b3a6; --none-bar:#ebe7de; --masthead-bg:#F6F2FE; --masthead-ink:#191d2b; --masthead-line:rgba(25,29,43,.14); }
  /* Mode sombre : même palette que l'app (index.html), qui suit le réglage de l'appareil. */
  @media (prefers-color-scheme: dark){
    :root{ --bg:#14171c; --surface:#1c2028; --ink:#f1ede4; --ink-soft:#aab0c0; --ink-faint:#727890; --line:#2d323f; --accent:#A78BFA; --accent-ink:#1c1230; --good:#7ad693; --bad:#ff6b57; --neutral-bar:#6b6557; --none-bar:#2a2e38; }
    .p-pour{ background:color-mix(in srgb, var(--good) 18%, transparent) !important; color:var(--good) !important; }
    .p-contre{ background:color-mix(in srgb, var(--bad) 18%, transparent) !important; color:var(--bad) !important; }
    .p-neutre{ background:var(--line) !important; color:var(--ink-soft) !important; }
    img.prop, .theme-h img, .crew, .hero-char{ filter:drop-shadow(0 4px 10px rgba(0,0,0,.45)); }
  }
  .social{ display:flex; justify-content:center; gap:10px; margin-top:14px; }
  /* Pied de page commun à toutes les pages (mêmes valeurs que footer.appfoot d'index.html). */
  .gfoot{ margin-top:48px; font-size:12px; color:var(--ink-faint); text-align:center; line-height:1.6; }
  .gfoot .flinks a{ color:var(--accent); font-weight:600; }
  .gfoot .social a{ display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:50%; border:1px solid var(--line); color:var(--accent); text-decoration:none; transition:border-color .15s; }
  .gfoot .social a:hover{ border-color:var(--accent); }
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
  .btn-accent{ background:var(--accent); color:var(--accent-ink); border-bottom:4px solid color-mix(in srgb, var(--accent) 70%, black); animation:softPulse 2.6s ease-in-out infinite; }
  .btn-accent:hover{ background:color-mix(in srgb, var(--accent) 90%, black); color:var(--accent-ink); }
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
// Ordre alphabétique du nom de famille (tout ce qui suit le prénom : « Le Pen »,
// « Dupont-Aignan »), sans tenir compte des accents ni des majuscules.
function byLastName(candidates) {
  const surname = (n) => String(n || "").split(" ").slice(1).join(" ");
  return candidates.slice().sort((a, b) => surname(a.name).localeCompare(surname(b.name), "fr", { sensitivity: "base" }) || a.name.localeCompare(b.name, "fr"));
}
function initialsOf(name) { return String(name || "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(); }

// Icônes des boutons : l'ourson Votona sur les appels à faire le test,
// pictogrammes au trait sur les boutons secondaires.
const BTN_MASCOT = '<img class="btn-mascot" src="/assets/ui/logo-head.webp" width="34" height="29" alt="" />';
const ICON_VS = '<svg class="btn-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><path d="M2 20c0-3 2.2-5 5-5s5 2 5 5"/><path d="M12 20c0-3 2.2-5 5-5s5 2 5 5"/></svg>';
const ICON_GRID = '<svg class="btn-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>';

// Liens vers les comptes Votona (mêmes que le pied de page de l'app).
const SOCIAL = `<div class="social">
    <a href="https://www.instagram.com/votona2027/" target="_blank" rel="noopener me" aria-label="Votona sur Instagram" title="Instagram"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg></a>
    <a href="https://www.tiktok.com/@votona2027" target="_blank" rel="noopener me" aria-label="Votona sur TikTok" title="TikTok"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.7a5.8 5.8 0 1 0 4.9 5.7V9.1a7.4 7.4 0 0 0 4.3 1.4V7.4a4.3 4.3 0 0 1-3.2-1.6z"/></svg></a>
    <a href="https://x.com/votona2027" target="_blank" rel="noopener me" aria-label="Votona sur X" title="X"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.2-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z"/></svg></a>
  </div>`;

// Pied de page identique sur toutes les pages (et sur l'app : footer.appfoot d'index.html).
const SITE_FOOTER = `<footer class="gfoot">Positions simplifiées à titre indicatif, établies à partir des déclarations publiques, ni exhaustives ni officielles.
    <div class="flinks"><a href="/">votona.fr</a> · <a href="/journal/">Journal de la campagne</a> · <a href="/methode/">FAQ et méthode</a> · <a href="/?screen=legal">Mentions légales</a> · <a href="/?screen=privacy">Confidentialité</a> · <a href="/?screen=contact">Contact</a></div>
    ${SOCIAL}
  </footer>`;

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
  main{ max-width:880px; margin:0 auto; padding:32px var(--gutter) 64px; }
  .cand-header{ display:flex; align-items:center; gap:16px; margin:24px 0 6px; padding:20px; border-radius:22px; background:linear-gradient(135deg, color-mix(in srgb, var(--cc) 20%, var(--surface)), color-mix(in srgb, var(--cc) 6%, var(--surface))); border:1px solid color-mix(in srgb, var(--cc) 28%, var(--surface)); }
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
  .toolbar{ position:sticky; top:0; z-index:5; margin:0 calc(-1 * var(--gutter)); padding:10px var(--gutter); background:color-mix(in srgb, var(--bg) 88%, transparent); -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px); border-bottom:1px solid var(--line); }
  .theme-nav{ display:flex; gap:6px; overflow-x:auto; scrollbar-width:none; padding-bottom:8px; }
  .theme-nav::-webkit-scrollbar{ display:none; }
  .theme-nav a{ flex:none; display:inline-flex; align-items:center; padding:6px 12px; border-radius:99px; border:1px solid var(--line); background:var(--surface); color:var(--ink-soft); font-size:13px; font-weight:600; text-decoration:none; white-space:nowrap; }
  .theme-nav a{ gap:6px; }
  .theme-nav a:hover, .theme-nav a.on{ border-color:var(--th); color:var(--ink); background:color-mix(in srgb, var(--th) 16%, var(--surface)); }
  .filters{ display:flex; gap:6px; overflow-x:auto; scrollbar-width:none; }
  .filters::-webkit-scrollbar{ display:none; }
  .chip{ flex:none; white-space:nowrap; appearance:none; cursor:pointer; padding:6px 12px; border-radius:99px; border:1px solid var(--line); background:transparent; color:var(--ink-soft); font:600 13px 'Work Sans',Arial,sans-serif; }
  .chip:hover{ border-color:var(--accent); color:var(--accent); }
  .chip.on{ background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
  .no-match{ display:none; color:var(--ink-faint); font-size:14px; padding:16px 0; }
  .pill{ display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:99px; font-size:12.5px; font-weight:800; }
  .p-pour{ background:#e3f4e9; color:#1f7a44; } .p-contre{ background:#fbe4e1; color:#b3372d; } .p-neutre{ background:#efece4; color:#5b6071; }
  .s-pour{ color:var(--good); } .s-contre{ color:var(--bad); } .s-neutre{ color:#6b7183; }
  .cand-header{ position:relative; overflow:hidden; }
  .cand-id{ position:relative; z-index:1; min-width:0; }
  .cand-stat{ margin:8px 0 0; display:inline-block; padding:3px 10px; border-radius:99px; background:var(--surface); font-size:12px; font-weight:700; color:var(--ink-soft); }
  .hero-props{ position:absolute; right:0; top:0; bottom:0; width:190px; pointer-events:none; }
  .hp{ position:absolute; filter:drop-shadow(0 4px 8px rgba(0,0,0,.15)); }
  .hp1{ right:26px; top:14px; transform:rotate(10deg); } .hp2{ right:92px; top:52px; transform:rotate(-12deg); }
  .hp3{ right:30px; bottom:12px; transform:rotate(-6deg); } .hp4{ right:120px; top:8px; transform:rotate(14deg); opacity:.9; }
  @media (max-width:640px){ .hero-props{ display:none; } }
  .glance{ margin:26px 0 8px; }
  .glance .subhead{ margin-top:0; }
  .gbar{ display:flex; gap:3px; height:12px; border-radius:99px; overflow:hidden; }
  .g-pour{ background:var(--good); } .g-contre{ background:var(--bad); } .g-neutre{ background:var(--neutral-bar); }
  .glegend{ font-size:13px; margin:8px 0 14px; color:var(--ink-faint); }
  .tiles{ display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; }
  .tile{ display:flex; flex-direction:column; align-items:flex-start; gap:6px; padding:12px 14px; border-radius:16px; text-decoration:none; color:var(--ink); background:linear-gradient(150deg, color-mix(in srgb, var(--th) 22%, var(--surface)), color-mix(in srgb, var(--th) 6%, var(--surface))); border:1px solid color-mix(in srgb, var(--th) 30%, var(--surface)); transition:transform .15s, box-shadow .15s; }
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
  ${SITE_FOOTER}
</main>
</body>
</html>
`;
}

function indexPageHtml(candidates, topics) {
  const canonical = `${SITE_URL}/candidats/`;
  const active = candidates.filter((c) => !c.withdrawn);
  const items = byLastName(candidates).map((c) => {
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
  main{ max-width:880px; margin:0 auto; padding:32px var(--gutter) 64px; }
  .hero{ position:relative; overflow:hidden; margin-top:6px; padding:28px 300px 28px 28px; border-radius:26px; background:linear-gradient(135deg, color-mix(in srgb, #7C3AED 16%, var(--surface)), var(--surface) 70%); border:1px solid color-mix(in srgb, #7C3AED 24%, var(--surface)); }
  .hero h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(26px,4vw,36px); line-height:1.12; margin:0 0 10px; }
  .hero p{ color:var(--ink-soft); line-height:1.6; margin:0; }
  .stats{ display:flex; flex-wrap:wrap; gap:8px; margin:16px 0 0; }
  .stats span{ padding:5px 12px; border-radius:99px; background:var(--surface); font-size:13px; font-weight:700; color:var(--ink-soft); }
  .stats b{ color:var(--accent); }
  .crew{ position:absolute; bottom:-30px; height:200px; width:auto; filter:drop-shadow(0 8px 14px rgba(0,0,0,.18)); }
  .c1{ right:170px; height:170px; transform:rotate(-6deg); } .c2{ right:88px; height:205px; z-index:1; } .c3{ right:10px; height:175px; transform:rotate(6deg); }
  @media (max-width:680px){ .hero{ padding:22px 20px 170px; } .c1{ right:auto; left:calc(50% - 150px); height:140px; } .c2{ right:auto; left:calc(50% - 60px); height:170px; } .c3{ right:auto; left:calc(50% + 40px); height:140px; } }
  .btn-pair{ display:flex; gap:8px; margin-top:18px; }
  .btn-pair .btn{ flex:1; padding:12px 14px; font-size:14px; }
  @media (max-width:520px){ .btn-pair{ flex-direction:column; } }
  input#q{ width:100%; padding:13px 16px; border-radius:14px; border:1px solid var(--line); font-size:14.5px; font-family:inherit; margin-top:18px; background:var(--surface); color:var(--ink); }
  input#q:focus{ outline:2px solid var(--accent); outline-offset:1px; }
  #list{ list-style:none; padding:0; margin:18px 0; display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; }
  #list li[hidden]{ display:none; }
  #list a{ display:flex; align-items:center; gap:14px; height:100%; padding:14px 16px; border-radius:18px; text-decoration:none; color:var(--ink); background:linear-gradient(150deg, color-mix(in srgb, var(--cc) 14%, var(--surface)), var(--surface) 75%); border:1px solid color-mix(in srgb, var(--cc) 24%, var(--line)); transition:transform .15s, box-shadow .15s, border-color .15s; }
  #list a:hover{ transform:translateY(-2px); border-color:var(--cc); box-shadow:0 8px 20px color-mix(in srgb, var(--cc) 22%, transparent); }
  #list .out a{ filter:grayscale(.8); opacity:.7; }
  .av{ flex:none; width:48px; height:48px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Baloo 2',sans-serif; font-weight:800; font-size:18px; box-shadow:0 4px 10px color-mix(in srgb, var(--cc) 35%, transparent); }
  .who{ display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; }
  .nm{ font-weight:800; font-size:15.5px; line-height:1.25; }
  .party{ color:var(--ink-faint); font-size:12.5px; }
  .mbar{ display:flex; gap:2px; height:6px; border-radius:99px; overflow:hidden; margin-top:7px; }
  .mbar i{ display:block; }
  .g-pour{ background:var(--good); } .g-contre{ background:var(--bad); } .g-neutre{ background:var(--neutral-bar); } .g-none{ background:var(--none-bar); }
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
  ${SITE_FOOTER}
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
  main{ max-width:880px; margin:0 auto; padding:32px var(--gutter) 64px; }
  .crumbs{ display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .hero{ position:relative; margin:22px 0 0; padding:22px 170px 24px 22px; border-radius:24px; overflow:hidden; background:linear-gradient(135deg, color-mix(in srgb, var(--th) 26%, var(--surface)), color-mix(in srgb, var(--th) 8%, var(--surface))); border:1px solid color-mix(in srgb, var(--th) 35%, var(--surface)); }
  .hero-char{ position:absolute; right:18px; bottom:-22px; height:190px; width:auto; filter:drop-shadow(0 8px 14px rgba(0,0,0,.18)); }
  .topic-pill{ display:inline-flex; align-items:center; gap:7px; padding:5px 12px 5px 6px; margin-bottom:12px; border-radius:99px; background:var(--surface); font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--ink); }
  @media (max-width:560px){ .hero{ padding:18px 18px 130px; } .hero-char{ height:150px; right:50%; transform:translateX(50%); bottom:-26px; } }
  h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(24px,3.6vw,32px); line-height:1.2; margin:0; }
  .context{ color:var(--ink-soft); line-height:1.6; margin:14px 0 0; }
  .cta{ margin:24px 0 8px; }
  .group{ margin-top:30px; }
  .group h2{ font-family:'Baloo 2',sans-serif; font-size:20px; margin:0 0 6px; display:flex; align-items:center; gap:8px; }
  .g-pour h2{ color:var(--good); } .g-contre h2{ color:var(--bad); } .g-nuance h2, .g-inconnu h2{ color:var(--ink-soft); }
  .count{ font-family:'IBM Plex Mono',monospace; font-size:12px; font-weight:500; color:var(--ink-soft); background:color-mix(in srgb, var(--accent) 14%, var(--surface)); padding:2px 8px; border-radius:99px; }
  .group ul{ list-style:none; padding:0; margin:0; }
  .cand{ padding:12px 0; border-top:1px solid var(--line); }
  .cand-name{ display:inline-flex; align-items:center; gap:10px; font-weight:700; color:var(--ink); text-decoration:none; }
  .cand-name:hover{ color:var(--accent); }
  .cand-dot{ width:10px; height:10px; border-radius:50%; flex:none; }
  .cand-party{ color:var(--ink-faint); font-size:13px; margin-left:8px; }
  .detail{ font-size:13.5px; line-height:1.55; color:var(--ink-soft); margin:6px 0 0 40px; }
  .names{ display:flex; flex-wrap:wrap; gap:8px; margin:10px 0 0; }
  .names a{ display:inline-flex; align-items:center; gap:7px; padding:6px 12px; border-radius:99px; background:var(--surface); border:1px solid var(--line); color:var(--ink-soft); font-size:13px; font-weight:600; text-decoration:none; }
  .names a:hover{ border-color:var(--accent); color:var(--accent); }
  .names .cand-dot{ width:8px; height:8px; }
  h2.subhead{ font-family:'Baloo 2',sans-serif; font-size:20px; margin:44px 0 12px; }
  ul.related{ list-style:none; padding:0; margin:0; display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
  ul.related a{ position:relative; display:flex; flex-direction:column; gap:8px; height:100%; box-sizing:border-box; padding:16px 38px 16px 18px; background:var(--surface); border:1px solid var(--line); border-radius:16px; color:var(--ink); text-decoration:none; transition:border-color .15s, transform .15s, box-shadow .15s; }
  ul.related{ --th:${themeColor(topic.cat)}; }
  ul.related a{ border-top:4px solid var(--th); }
  ul.related a:hover{ border-color:var(--th); transform:translateY(-2px); box-shadow:0 6px 18px rgba(124,58,237,.10); }
  .r-title{ font-weight:600; font-size:14.5px; line-height:1.4; }
  .r-meta{ font-size:12px; color:var(--ink-faint); }
  .r-meta .s-pour{ color:var(--good); font-weight:600; } .r-meta .s-contre{ color:var(--bad); font-weight:600; }
  .r-arrow{ position:absolute; right:16px; top:50%; transform:translateY(-50%); font-size:22px; color:var(--ink-faint); }
  ul.related a:hover .r-arrow{ color:var(--accent); }
  .all{ margin-top:26px; }
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
  ${SITE_FOOTER}
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
  <section class="cat" id="theme-${escapeHtml(meta.slug || slugify(cat))}" style="--th:${themeColor(cat)}">
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
  main{ max-width:880px; margin:0 auto; padding:32px var(--gutter) 64px; }
  .hero{ position:relative; overflow:hidden; margin-top:18px; padding:26px 270px 26px 26px; border-radius:26px; background:linear-gradient(135deg, color-mix(in srgb, #06D6A0 18%, var(--surface)), var(--surface) 70%); border:1px solid color-mix(in srgb, #06D6A0 30%, var(--surface)); }
  .hero h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(26px,4vw,34px); line-height:1.12; margin:0 0 10px; }
  .hero p{ color:var(--ink-soft); line-height:1.6; margin:0; }
  .stats{ display:flex; flex-wrap:wrap; gap:8px; margin:16px 0 0; }
  .stats span{ padding:5px 12px; border-radius:99px; background:var(--surface); font-size:13px; font-weight:700; color:var(--ink-soft); }
  .stats b{ color:var(--good); }
  .crew{ position:absolute; bottom:-30px; width:auto; filter:drop-shadow(0 8px 14px rgba(0,0,0,.18)); }
  .c1{ right:160px; height:165px; transform:rotate(-6deg); } .c2{ right:82px; height:200px; z-index:1; } .c3{ right:8px; height:170px; transform:rotate(6deg); }
  @media (max-width:680px){ .hero{ padding:22px 20px 170px; } .c1{ right:auto; left:calc(50% - 150px); height:140px; } .c2{ right:auto; left:calc(50% - 60px); height:170px; } .c3{ right:auto; left:calc(50% + 40px); height:140px; } }
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
  input#q{ width:100%; padding:12px 16px; border-radius:14px; border:1px solid var(--line); font-size:14px; font-family:inherit; margin-top:22px; background:var(--surface); color:var(--ink); }
  input#q:focus{ outline:2px solid var(--accent); outline-offset:1px; }
  #empty{ display:none; color:var(--ink-faint); font-size:13.5px; padding:14px 0; }
  .divisive ul{ display:grid; gap:10px; }
  .divisive li{ padding:0; border:0; }
  .divisive li a{ display:flex; flex-direction:column; gap:8px; padding:14px 16px; background:var(--surface); border:1px solid var(--line); border-radius:16px; }
  .divisive li a:hover{ border-color:var(--accent); }
  .d-title{ font-weight:600; font-size:15px; line-height:1.4; color:var(--ink); }
  .d-bar{ display:flex; gap:3px; height:8px; border-radius:99px; overflow:hidden; }
  .d-bar span:first-child{ background:var(--good); } .d-bar span:last-child{ background:var(--bad); }
  .d-meta{ font-size:12.5px; font-weight:700; }
  .s-pour{ color:var(--good); } .s-contre{ color:var(--bad); }
</style>
</head>
<body>
${HEADER_INDEX}
<main>
  <nav class="crumbs"><a class="crumb" href="/candidats/">Tous les candidats ›</a></nav>
  <section class="hero">
    <h1>Les ${topics.length} sujets de la présidentielle 2027</h1>
    <p>Pour chaque grand sujet de la campagne, découvre qui est pour, qui est contre et qui ne s'est pas encore prononcé parmi les candidats déclarés.</p>
    <div class="stats"><span><b>${topics.length}</b> sujets suivis</span><span><b>${categories.length}</b> thèmes</span><span><b>${candidates.filter((c) => !c.withdrawn).length}</b> candidats comparés</span></div>
    ${["Société", "Europe & institutions", "Protection sociale"].map((cat, i) => charSrc(cat) ? `<img class="crew c${i + 1}" src="${charSrc(cat)}" width="339" height="577" alt="" />` : "").join("")}
  </section>
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
  ${SITE_FOOTER}
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
    c: byLastName(candidates).map((c) => ({ id: c.id, n: c.name, p: c.party, col: c.color || "#7C3AED", i: initials(c.name), w: c.withdrawn ? 1 : 0 })),
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
  main{ max-width:880px; margin:0 auto; padding:32px var(--gutter) 64px; }
  h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(26px,4vw,34px); margin:28px 0 8px; line-height:1.15; }
  p.intro{ color:var(--ink-soft); line-height:1.6; margin:0; }
  .duel{ display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:10px; margin:26px 0 12px; }
  .slot{ appearance:none; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; padding:16px 10px; border-radius:18px; border:2px solid color-mix(in srgb, var(--accent) 20%, var(--line)); background:var(--surface); font-family:inherit; color:var(--ink); min-width:0; }
  .slot:hover, .slot.open{ border-color:var(--accent); }
  .slot.picked{ background:linear-gradient(160deg, color-mix(in srgb, var(--cc) 20%, var(--surface)), color-mix(in srgb, var(--cc) 5%, var(--surface))); border-color:color-mix(in srgb, var(--cc) 40%, var(--surface)); }
  .slot.picked:hover, .slot.picked.open{ border-color:var(--cc); }
  .slot .av{ width:60px; height:60px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Baloo 2',sans-serif; font-weight:800; font-size:22px; }
  .slot .av.empty{ background:transparent; border:2px dashed var(--ink-faint); color:var(--ink-faint); font-size:28px; font-family:'Work Sans',sans-serif; }
  .slot .nm{ font-weight:800; font-size:15px; line-height:1.25; text-align:center; overflow-wrap:anywhere; }
  .slot .pt{ font-size:12.5px; color:var(--ink-faint); text-align:center; }
  .slot .chg{ font-size:12px; font-weight:700; color:var(--accent); }
  .vs{ font-family:'IBM Plex Mono',monospace; font-weight:600; color:var(--ink-faint); font-size:14px; }
  .picker{ display:none; margin:0 0 18px; padding:14px; border:1px solid var(--line); border-radius:18px; background:var(--surface); }
  .picker.show{ display:block; }
  .picker input{ width:100%; padding:12px 14px; border-radius:12px; border:1px solid var(--line); font:14px 'Work Sans',Arial,sans-serif; color:var(--ink); background:var(--bg); }
  .picker input:focus{ outline:2px solid var(--accent); outline-offset:1px; }
  .picker ul{ list-style:none; padding:0; margin:8px 0 0; max-height:320px; overflow-y:auto; }
  .picker li button{ width:100%; display:flex; align-items:center; gap:10px; padding:10px 8px; border:0; border-radius:10px; background:transparent; cursor:pointer; font:600 14.5px 'Work Sans',Arial,sans-serif; color:var(--ink); text-align:left; }
  .picker li button:hover, .picker li button:focus-visible{ background:color-mix(in srgb, var(--accent) 14%, var(--surface)); outline:none; }
  .picker li button[disabled]{ opacity:.35; cursor:default; }
  .picker .dot{ width:10px; height:10px; border-radius:50%; flex:none; }
  .picker .pt{ color:var(--ink-faint); font-weight:400; font-size:13px; }
  .hint{ text-align:center; color:var(--ink-faint); font-size:14px; padding:28px 10px; border:1px dashed var(--line); border-radius:18px; }
  .score{ display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:6px 0 14px; }
  .score div{ background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:12px 8px; text-align:center; }
  .score b{ display:block; font-family:'Baloo 2',sans-serif; font-size:26px; line-height:1.1; }
  .score span{ font-size:12px; color:var(--ink-soft); font-weight:600; }
  .score .ok b{ color:var(--good); } .score .ko b{ color:var(--bad); } .score .nd b{ color:var(--ink-faint); }
  .filters{ display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px; }
  .chip{ flex:none; appearance:none; cursor:pointer; padding:6px 12px; border-radius:99px; border:1px solid var(--line); background:transparent; color:var(--ink-soft); font:600 13px 'Work Sans',Arial,sans-serif; white-space:nowrap; }
  .chip:hover{ border-color:var(--accent); color:var(--accent); }
  .chip.on{ background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
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
  .st.pour{ color:var(--good); } .st.contre{ color:var(--bad); } .st.neutre{ color:var(--ink-soft); } .st.none{ color:var(--ink-faint); font-weight:600; }
  details.row.ko summary{ background:linear-gradient(90deg, rgba(209,69,58,.06), transparent 70%); }
  .why{ padding:0 0 14px; display:grid; gap:8px; }
  .why p{ margin:0; font-size:13.5px; line-height:1.55; color:var(--ink-soft); }
  .why b{ color:var(--ink); }
  .why a{ color:var(--accent); font-weight:600; font-size:13px; }
  #none{ display:none; color:var(--ink-faint); font-size:14px; padding:16px 0; }
  .legend{ font-size:12.5px; color:var(--ink-faint); margin:18px 0 0; line-height:1.6; }
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
  ${SITE_FOOTER}
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

// Page « FAQ et méthode » (/methode/) : FAQ complète de l'app (FAQ_ITEMS d'index.html,
// qui n'a plus d'écran FAQ à elle) puis la méthode : comment les positions sont établies, comment
// le classement est calculé, neutralité, données, signalement d'erreur. Contenu
// propre (l'accueil vise « test présidentielle / pour qui voter », cette page
// la confiance et la transparence) ; FAQ en données structurées FAQPage.
// Le calcul décrit ici est celui de matchScore()/computeResults() d'index.html :
// si l'un change, mettre ce texte à jour.
const METHODE_FAQ = [
  ["Que se passe-t-il quand la position d'un candidat n'est pas connue ?", "Elle est affichée « non précisée » et compte comme neutre dans le calcul : un demi-point, quelle que soit ta réponse. Elle ne te rapproche ni ne t'éloigne fortement de ce candidat."],
  ["Les sondages influencent-ils mon classement ?", "Non. Les sondages affichés dans ton tableau de bord sont une information à part : ton classement dépend uniquement de tes réponses et des positions des candidats."],
  ["Votona est-il lié à un parti ou à un candidat ?", "Non. Votona est un projet personnel et indépendant, sans lien avec aucun parti ni aucun candidat. Le site n'affiche jamais de publicité politique."],
  ["J'ai repéré une erreur sur une position, que faire ?", "Signale-la depuis le formulaire de contact, idéalement avec un lien vers la source (déclaration, vote, programme). Chaque signalement est vérifié et la position corrigée si besoin."]
];

function methodePageHtml(candidates, topics, categories, faqItems) {
  const canonical = `${SITE_URL}/methode/`;
  const active = candidates.filter((c) => !c.withdrawn);
  // FAQ complète : celle de l'app (FAQ_ITEMS) puis les questions propres à la méthode.
  const seen = new Set();
  const allFaq = faqItems.map((it) => [it.q, it.a]).concat(METHODE_FAQ).filter(([q]) => !seen.has(q) && seen.add(q));
  const faqLd = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", "mainEntity": allFaq.map(([q, a]) => ({ "@type": "Question", "name": q, "acceptedAnswer": { "@type": "Answer", "text": a } })) });
  const faq = allFaq.map(([q, a]) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`).join("");
  const title = "FAQ et méthode du test Votona : questions fréquentes, sources, calcul du classement | Votona";
  const description = "Les réponses aux questions fréquentes sur Votona, le test de la présidentielle 2027 : fonctionnement, calcul du classement, sources des positions des candidats, neutralité, données personnelles.";
  const toc = [["sources", "Les positions"], ["calcul", "Le calcul"], ["sujets", "Les sujets"], ["candidats", "Les candidats"], ["neutralite", "Neutralité"], ["donnees", "Tes données"], ["erreur", "Signaler une erreur"], ["faq", "Questions fréquentes"]]
    .map(([id, label]) => `<a href="#${id}">${label}</a>`).join("");

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
<meta property="og:title" content="FAQ et méthode du test Votona" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${SITE_URL}/assets/ui/og-home.jpg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:locale" content="fr_FR" />
<meta name="twitter:card" content="summary_large_image" />
<script type="application/ld+json">${breadcrumbLd([{ name: "Votona", url: SITE_URL + "/" }, { name: "FAQ et méthode", url: canonical }])}</script>
<script type="application/ld+json">${faqLd}</script>
${HEAD_ICONS}
<style>${SHARED_CSS}
  main{ max-width:880px; margin:0 auto; padding:32px var(--gutter) 64px; line-height:1.65; }
  .hero{ display:flex; align-items:center; gap:22px; padding:26px 28px; border-radius:26px; background:linear-gradient(135deg, color-mix(in srgb, #7C3AED 16%, var(--surface)), var(--surface) 70%); border:1px solid color-mix(in srgb, #7C3AED 24%, var(--surface)); }
  .hero img{ width:104px; height:auto; flex:none; filter:drop-shadow(0 6px 12px rgba(0,0,0,.18)); }
  .hero h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(26px,4vw,36px); line-height:1.12; margin:0 0 8px; }
  .hero p{ color:var(--ink-soft); margin:0; }
  @media (max-width:560px){ .hero{ flex-direction:column; text-align:center; } .hero img{ width:88px; } }
  .toc{ display:flex; flex-wrap:wrap; gap:8px; margin:18px 0 0; }
  .toc a{ padding:6px 13px; border-radius:99px; border:1px solid var(--line); background:var(--surface); color:var(--ink-soft); font-size:13px; font-weight:700; text-decoration:none; }
  .toc a:hover{ color:var(--accent); border-color:var(--accent); }
  h2{ font-family:'Baloo 2',sans-serif; font-size:24px; line-height:1.2; margin:42px 0 10px; scroll-margin-top:16px; display:flex; align-items:center; gap:10px; }
  h2 .n{ flex:none; width:32px; height:32px; border-radius:50%; background:var(--accent); color:var(--accent-ink); font:800 15px 'Work Sans',Arial,sans-serif; display:flex; align-items:center; justify-content:center; }
  p, li{ color:var(--ink-soft); }
  b, strong{ color:var(--ink); }
  main a:not(.btn):not(.toc a):not(.gfoot a){ color:var(--accent); font-weight:600; }
  ul.rules{ padding-left:20px; margin:10px 0; }
  ul.rules li{ margin:4px 0; }
  .card{ padding:16px 18px; border-radius:18px; background:var(--surface); border:1px solid var(--line); margin-top:14px; }
  .card h3{ margin:0 0 8px; font-size:15.5px; color:var(--ink); }
  table{ width:100%; border-collapse:collapse; font-size:14px; }
  th, td{ text-align:left; padding:8px 6px; border-bottom:1px solid var(--line); color:var(--ink-soft); }
  th{ color:var(--ink); font-size:12.5px; text-transform:uppercase; letter-spacing:.04em; }
  td.num, th.num{ text-align:right; white-space:nowrap; }
  tfoot td{ font-weight:800; color:var(--ink); border-bottom:none; }
  .ok{ color:var(--good); font-weight:700; } .ko{ color:var(--bad); font-weight:700; } .mid{ color:var(--ink-faint); font-weight:700; }
  details{ border:1px solid var(--line); border-radius:16px; background:var(--surface); padding:0 16px; margin-top:10px; }
  summary{ cursor:pointer; padding:14px 0; font-weight:700; color:var(--ink); }
  details p{ margin:0 0 14px; }
  /* Bandeau « Toujours une question ? » figé en bas d'écran (comme l'ancien écran FAQ de l'app). */
  main{ padding-bottom:130px; }
  .contact-dock{ position:fixed; left:0; right:0; bottom:0; z-index:30; max-width:880px; margin:0 auto; padding:10px var(--gutter) calc(10px + env(safe-area-inset-bottom)); background:color-mix(in srgb, var(--bg) 62%, transparent); -webkit-backdrop-filter:blur(14px) saturate(1.4); backdrop-filter:blur(14px) saturate(1.4); border-top:1px solid var(--line); }
  .contact-card{ display:flex; align-items:center; gap:14px; padding:12px 16px; border-radius:18px; background:color-mix(in srgb, var(--accent) 12%, transparent); }
  .contact-card img{ width:44px; height:auto; flex:none; }
  .contact-card .ct{ flex-grow:1; min-width:0; }
  .contact-card .t{ font-family:'Baloo 2',sans-serif; font-size:15px; font-weight:700; color:var(--ink); line-height:1.2; }
  .contact-card .s{ font-size:12.5px; color:var(--ink-faint); margin-top:2px; line-height:1.3; }
  .contact-card .btn{ width:auto; flex:none; white-space:nowrap; padding:11px 18px; font-size:14px; animation:none; }
  @media (max-width:480px){ .contact-card{ gap:10px; padding:10px 12px; } .contact-card img{ width:34px; } .contact-card .t{ font-size:14px; } .contact-card .btn{ padding:10px 14px; } }
  h2.part{ font-size:28px; margin-top:54px; padding-top:22px; border-top:2px dashed var(--line); }
  .links{ display:flex; gap:8px; margin-top:16px; }
  .links .btn{ flex:1; padding:12px 14px; font-size:14px; }
  @media (max-width:520px){ .links{ flex-direction:column; } }
</style>
</head>
<body>
${HEADER}
<main>
  <section class="hero">
    <img src="/assets/ui/methode.webp" width="104" height="104" alt="Illustration : bloc-notes coché et loupe" />
    <div>
      <h1>Méthode et questions fréquentes</h1>
      <p>D'où viennent les positions des candidats, comment ton classement est calculé, comment Votona reste neutre, puis les réponses aux questions les plus posées : tout est expliqué ici, sans zone d'ombre.</p>
    </div>
  </section>
  <nav class="toc" aria-label="Sommaire">${toc}</nav>


  <h2 id="sources"><span class="n">1</span>D'où viennent les positions des candidats ?</h2>
  <p>Chaque position est établie à partir de sources publiques : <b>déclarations</b> (interviews, discours, réseaux sociaux officiels), <b>votes</b> au Parlement et <b>programmes</b>. Elle est résumée en trois choix possibles, <b>d'accord</b>, <b>pas d'accord</b> ou <b>neutre</b>, accompagnés d'une phrase qui précise la nuance, visible sur la fiche de chaque candidat.</p>
  <p>Une <b>veille quotidienne</b>, assistée par des outils d'intelligence artificielle, repère dans l'actualité de la campagne les nouvelles déclarations, candidatures et retraits. Une information n'est intégrée que si elle s'appuie sur une source fiable et datée. Quand un candidat ne s'est pas exprimé sur un sujet, sa position est affichée « non précisée » plutôt que devinée.</p>

  <h2 id="calcul"><span class="n">2</span>Comment ton classement est calculé</h2>
  <p>Pour chaque sujet, tu donnes ta position puis son importance pour toi : <b>peu important</b> (poids 1), <b>important</b> (poids 2) ou <b>très important</b> (poids 3). Ta position est ensuite comparée à celle de chaque candidat :</p>
  <ul class="rules">
    <li><span class="ok">1 point</span> si vous avez la même position ;</li>
    <li><span class="mid">½ point</span> si l'un de vous deux est neutre (ou si la position du candidat n'est pas précisée) ;</li>
    <li><span class="ko">0 point</span> si vos positions sont opposées.</li>
  </ul>
  <p>Ton affinité avec un candidat est la <b>moyenne de ces points, pondérée par l'importance</b> que tu as donnée à chaque sujet, exprimée en pourcentage. Les sujets que tu passes ne comptent pas, et les candidats retirés de la course sortent du classement.</p>
  <div class="card">
    <h3>Exemple avec trois sujets</h3>
    <table>
      <thead><tr><th>Sujet</th><th>Accord</th><th class="num">Poids</th><th class="num">Points</th></tr></thead>
      <tbody>
        <tr><td>Sujet A, très important</td><td class="ok">même position</td><td class="num">3</td><td class="num">3 × 1 = 3</td></tr>
        <tr><td>Sujet B, peu important</td><td class="ko">opposés</td><td class="num">1</td><td class="num">1 × 0 = 0</td></tr>
        <tr><td>Sujet C, important</td><td class="mid">candidat neutre</td><td class="num">2</td><td class="num">2 × ½ = 1</td></tr>
      </tbody>
      <tfoot><tr><td colspan="2">Affinité : 4 points sur 6</td><td class="num"></td><td class="num">67 %</td></tr></tfoot>
    </table>
  </div>

  <h2 id="sujets"><span class="n">3</span>Comment les sujets sont choisis</h2>
  <p>Le test compte aujourd'hui <b>${topics.length} sujets</b> répartis en <b>${categories.length} thèmes</b> (économie, protection sociale, sécurité, écologie, Europe, société, défense et numérique). Chaque sujet est formulé comme une proposition concrète, à laquelle on peut être favorable ou opposé, et accompagné d'un court contexte neutre. De nouveaux sujets sont ajoutés quand un débat structurant émerge dans la campagne.</p>
  <p><a href="/sujets/">Voir tous les sujets et la position de chaque candidat</a></p>

  <h2 id="candidats"><span class="n">4</span>Quels candidats sont comparés ?</h2>
  <p><b>Toutes les candidatures officiellement déclarées</b> sont intégrées dès leur annonce, sans tri par notoriété ni par score dans les sondages : <b>${active.length} candidats</b> sont en course aujourd'hui. Un candidat qui se retire est marqué comme tel et sort du classement, mais ses positions restent consultables. Dans les listes, les candidats sont classés par ordre alphabétique.</p>
  <div class="links"><a class="btn btn-ghost" href="/candidats/">${ICON_GRID}Toutes les fiches candidats</a><a class="btn btn-ghost" href="/comparer/">${ICON_VS}Comparer deux candidats</a></div>

  <h2 id="neutralite"><span class="n">5</span>Neutralité et indépendance</h2>
  <p>Votona est un <b>projet personnel et indépendant</b>, sans lien avec aucun parti ni aucun candidat. Les positions sont décrites sans jugement, aucun candidat n'est mis en avant, et ton classement dépend uniquement de tes réponses. Les sondages affichés dans le tableau de bord sont une information à part : <b>ils n'entrent pas dans le calcul</b>. Le site n'affiche jamais de publicité politique.</p>

  <h2 id="donnees"><span class="n">6</span>Tes données</h2>
  <p>Le test se fait <b>sans inscription</b> : tes réponses restent dans ton navigateur, sur ton appareil. Un compte, facultatif, sert uniquement à les retrouver sur un autre appareil, et tu peux tout supprimer à tout moment. <a href="/?screen=privacy">Politique de confidentialité</a></p>

  <h2 id="erreur"><span class="n">7</span>Signaler une erreur</h2>
  <p>Une position te semble inexacte ou dépassée ? Écris-nous depuis le <a href="/?screen=contact">formulaire de contact</a>, idéalement avec un lien vers la source. Chaque signalement est vérifié et la position corrigée si besoin.</p>

  <h2>Prêt à te lancer ?</h2>
  <p>Quelques minutes suffisent pour découvrir de quels candidats tu es le plus proche.</p>
  <div class="btn-row"><a class="btn btn-accent" href="/">${BTN_MASCOT}Faire le test gratuitement</a></div>

  <h2 id="faq" class="part">Questions fréquentes</h2>
  ${faq}

  ${SITE_FOOTER}
</main>
<div class="contact-dock"><div class="contact-card"><img src="/assets/ui/logo-head.webp" width="44" height="37" alt="" /><div class="ct"><div class="t">Toujours une question ?</div><div class="s">On répond en général sous 24 h.</div></div><a class="btn btn-accent" href="/?screen=contact">Nous écrire</a></div></div>
</body>
</html>
`;
}

// Journal de la campagne (/journal/) : tout ce qui a changé dans Votona, du
// plus récent au plus ancien (buildCampaignJournal() d'index.html : ajouts de
// candidats et de sujets + CAMPAIGN_LOG tenu par la veille quotidienne).
const JOURNAL_TYPES = {
  candidat: { label: "Candidature", plural: "Candidatures", color: "#3A86FF" },
  retrait: { label: "Retrait", plural: "Retraits", color: "#d1453a" },
  position: { label: "Position", plural: "Positions", color: "#7C3AED" },
  sujet: { label: "Nouveau sujet", plural: "Sujets", color: "#06A77D" },
  sondage: { label: "Sondages", plural: "Sondages", color: "#E09F00" }
};
const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function frDate(iso) { const [y, m, d] = iso.split("-").map(Number); return `${d === 1 ? "1er" : d} ${MONTHS_FR[m - 1]} ${y}`; }

function journalPageHtml(journal, candidates, topics, slugs) {
  const canonical = `${SITE_URL}/journal/`;
  const cById = {}; candidates.forEach((c) => { cById[c.id] = c; });
  const tById = {}; topics.forEach((t) => { tById[t.id] = t; });
  const candLink = (id) => cById[id] ? `<a href="/candidats/${id}/">${escapeHtml(cById[id].name)}</a>` : "";
  const topicLink = (id) => tById[id] ? `<a href="/sujets/${slugs[id]}/">${escapeHtml(tById[id].statement)}</a>` : "";
  const entryHtml = (e) => {
    let body = "";
    if (e.type === "candidat") body = `${candLink(e.cand)}${cById[e.cand] ? ` <span class="muted">(${escapeHtml(cById[e.cand].party)})</span>` : ""} rejoint le comparateur.`;
    else if (e.type === "sujet") body = `Nouvelle question : ${topicLink(e.topic)}.`;
    else body = escapeHtml(e.text || "");
    const links = [];
    if (e.type !== "candidat" && e.cand && cById[e.cand]) links.push(`<a href="/candidats/${e.cand}/">Fiche de ${escapeHtml(cById[e.cand].name)}</a>`);
    if (e.type !== "sujet" && e.topic && tById[e.topic]) links.push(`<a href="/sujets/${slugs[e.topic]}/">Le sujet</a>`);
    const t = JOURNAL_TYPES[e.type] || { label: "Mise à jour", color: "#7C3AED" };
    return `<li data-type="${escapeHtml(e.type)}" style="--tc:${t.color}"><span class="tag">${t.label}</span><div class="txt">${body}${links.length ? `<div class="more">${links.join(" · ")}</div>` : ""}</div></li>`;
  };
  const byDate = [];
  journal.forEach((e) => { const last = byDate[byDate.length - 1]; if (last && last.date === e.date) last.items.push(e); else byDate.push({ date: e.date, items: [e] }); });
  const days = byDate.map((g) => `<section class="day" data-types="${[...new Set(g.items.map((e) => e.type))].join(" ")}"><h2><time datetime="${g.date}">${frDate(g.date)}</time></h2><ul>${g.items.map(entryHtml).join("")}</ul></section>`).join("\n  ");
  const counts = {}; journal.forEach((e) => { counts[e.type] = (counts[e.type] || 0) + 1; });
  const chips = `<button class="chip on" data-f="">Tout · ${journal.length}</button>` + Object.keys(JOURNAL_TYPES).filter((k) => counts[k]).map((k) => `<button class="chip" data-f="${k}" style="--tc:${JOURNAL_TYPES[k].color}">${JOURNAL_TYPES[k].plural} · ${counts[k]}</button>`).join("");
  const last = journal.length ? frDate(journal[0].date) : "";
  const title = "Journal de la campagne présidentielle 2027 : candidatures, positions, sondages | Votona";
  const description = `Toutes les évolutions de la campagne présidentielle 2027 suivies par Votona : nouvelles candidatures, retraits, positions précisées, nouveaux sujets et sondages.${last ? " Dernière mise à jour le " + last + "." : ""}`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="${escapeHtml(description)}" />
<link rel="canonical" href="${canonical}" />
<meta name="robots" content="index, follow" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Votona" />
<meta property="og:url" content="${canonical}" />
<meta property="og:title" content="Journal de la campagne présidentielle 2027" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${SITE_URL}/assets/ui/og-home.jpg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:locale" content="fr_FR" />
<meta name="twitter:card" content="summary_large_image" />
<script type="application/ld+json">${breadcrumbLd([{ name: "Votona", url: SITE_URL + "/" }, { name: "Journal de la campagne", url: canonical }])}</script>
${HEAD_ICONS}
<style>${SHARED_CSS}
  main{ max-width:880px; margin:0 auto; padding:32px var(--gutter) 64px; line-height:1.6; }
  .hero{ display:flex; align-items:center; gap:22px; padding:26px 28px; border-radius:26px; background:linear-gradient(135deg, color-mix(in srgb, #7C3AED 16%, var(--surface)), var(--surface) 70%); border:1px solid color-mix(in srgb, #7C3AED 24%, var(--surface)); }
  .hero img{ width:104px; height:auto; flex:none; filter:drop-shadow(0 6px 12px rgba(0,0,0,.18)); }
  .hero h1{ font-family:'Baloo 2',sans-serif; font-size:clamp(26px,4vw,36px); line-height:1.12; margin:0 0 8px; }
  .hero p{ color:var(--ink-soft); margin:0; }
  .hero .upd{ margin-top:10px; font-size:13px; font-weight:700; color:var(--accent); }
  @media (max-width:560px){ .hero{ flex-direction:column; text-align:center; } .hero img{ width:88px; } }
  .chips{ display:flex; flex-wrap:wrap; gap:8px; margin:20px 0 4px; }
  .chip{ padding:6px 13px; border-radius:99px; border:1px solid var(--line); background:var(--surface); color:var(--ink-soft); font:700 13px 'Work Sans',Arial,sans-serif; cursor:pointer; }
  .chip:hover{ border-color:var(--tc, var(--accent)); color:var(--ink); }
  .chip.on{ background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
  .day h2{ font-family:'Baloo 2',sans-serif; font-size:19px; margin:30px 0 10px; color:var(--ink); }
  .day ul{ list-style:none; padding:0; margin:0; display:grid; gap:8px; }
  .day li{ display:flex; gap:12px; align-items:flex-start; padding:12px 14px; border-radius:16px; background:var(--surface); border:1px solid var(--line); border-left:4px solid var(--tc); }
  .day li[hidden], .day[hidden]{ display:none; }
  .tag{ flex:none; margin-top:2px; padding:2px 9px; border-radius:99px; font-size:11px; font-weight:800; letter-spacing:.02em; color:var(--tc); background:color-mix(in srgb, var(--tc) 14%, transparent); white-space:nowrap; }
  @media (prefers-color-scheme: dark){ .tag{ color:color-mix(in srgb, var(--tc) 55%, white); background:color-mix(in srgb, var(--tc) 22%, transparent); } }
  .txt{ color:var(--ink-soft); font-size:14.5px; min-width:0; }
  .txt a{ color:var(--ink); font-weight:700; }
  .txt a:hover{ color:var(--accent); }
  .muted{ color:var(--ink-faint); }
  .more{ margin-top:4px; font-size:12.5px; }
  .more a{ color:var(--accent); font-weight:600; }
  @media (max-width:520px){ .day li{ flex-direction:column; gap:6px; } }
  .cta{ margin-top:36px; }
</style>
</head>
<body>
${HEADER}
<main>
  <section class="hero">
    <img src="/assets/ui/journal.webp" width="104" height="104" alt="Illustration : journal" />
    <div>
      <h1>Journal de la campagne</h1>
      <p>Tout ce qui a changé dans Votona au fil de la présidentielle 2027 : nouvelles candidatures, retraits, positions précisées, nouveaux sujets et sondages. Chaque changement peut faire bouger ton classement.</p>
      ${last ? `<div class="upd">Dernière mise à jour : ${last}</div>` : ""}
    </div>
  </section>
  <div class="chips" role="group" aria-label="Filtrer par type">${chips}</div>
  ${days}
  <div class="btn-row cta"><a class="btn btn-accent" href="/">${BTN_MASCOT}Faire le test ou voir mon classement</a></div>
  <script>
    (function(){
      var chips = document.querySelectorAll(".chip");
      chips.forEach(function(ch){ ch.addEventListener("click", function(){
        var f = ch.getAttribute("data-f");
        chips.forEach(function(c){ c.classList.toggle("on", c === ch); });
        document.querySelectorAll(".day").forEach(function(day){
          var any = false;
          day.querySelectorAll("li").forEach(function(li){ var ok = !f || li.getAttribute("data-type") === f; li.hidden = !ok; if(ok) any = true; });
          day.hidden = !any;
        });
      }); });
    })();
  </script>
  ${SITE_FOOTER}
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
    url(`${SITE_URL}/journal/`, "daily", "0.7"),
    url(`${SITE_URL}/methode/`, "weekly", "0.7"),
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
  const { CATEGORIES, TOPICS, CANDIDATES, CATEGORY_META, CATEGORY_ICON_PATHS, CAMPAIGN_LOG, buildCampaignJournal, FAQ_ITEMS } = loadData();
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

  fs.mkdirSync(path.join(ROOT, "journal"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "journal", "index.html"), "\uFEFF" + journalPageHtml(buildCampaignJournal(CANDIDATES, TOPICS, CAMPAIGN_LOG), CANDIDATES, TOPICS, slugs), "utf8");

  fs.mkdirSync(path.join(ROOT, "methode"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "methode", "index.html"), "\uFEFF" + methodePageHtml(CANDIDATES, TOPICS, CATEGORIES, FAQ_ITEMS), "utf8");

  fs.writeFileSync(path.join(ROOT, "sitemap.xml"), sitemapXml(CANDIDATES, TOPICS, slugs), "utf8");

  console.log(`Généré : ${CANDIDATES.length} pages candidats + ${TOPICS.length} pages sujets + 2 index + comparateur + page Méthode + journal + sitemap.xml`);
}

if (require.main === module) main();
module.exports = { loadData, topicSlugs, SITE_URL };
