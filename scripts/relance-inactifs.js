// Relance email des utilisateurs inactifs — exécution LOCALE (remplace la
// routine cloud "Votona - relance inactifs"). Même logique que le bouton
// Admin → "Relances email" (code partagé : api/_lib/relance.js), plus les
// notifications de parrainage.
//
// 1. Relances : s'il y a des actus en attente dans la file (Admin →
//    "Relances email"), envoie le digest aux comptes opt-in inactifs
//    depuis 7 jours (1er rappel) ou 30 jours (dernier rappel, puis
//    désinscription). File vide → rien n'est envoyé. Personne d'éligible
//    → la file est conservée pour le prochain passage.
// 2. Parrainages : prévient les parrains dont un filleul vient de répondre.
//
// Clés : variables d'environnement SUPABASE_SERVICE_ROLE_KEY et
// BREVO_API_KEY, ou fichier `.env.local` à la racine du dépôt (ignoré
// par git, jamais commité). Voir scripts/relance-inactifs.env.example.
//
// Usage :
//   node scripts/relance-inactifs.js            → envoie pour de vrai
//   node scripts/relance-inactifs.js --dry-run  → affiche le bilan sans rien envoyer
//
// Installation + planification quotidienne à 6h sous Windows, en une commande :
//   powershell -ExecutionPolicy Bypass -File scripts\installer-relance.ps1
// Nécessite Node.js 18 ou plus récent (fetch intégré).

const fs = require("fs");
const path = require("path");
const { runRelance, runReferralNotifications } = require("../api/_lib/relance");

const ROOT = path.join(__dirname, "..");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function log(msg) {
  const stamp = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
  console.log("[" + stamp + "] " + msg);
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("Node.js 18 ou plus récent requis (fetch introuvable). Version actuelle : " + process.version);
  }
  loadEnvFile(path.join(ROOT, ".env.local"));
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoKey = process.env.BREVO_API_KEY;
  if (!serviceKey || !brevoKey) {
    throw new Error("Clés manquantes : renseigne SUPABASE_SERVICE_ROLE_KEY et BREVO_API_KEY dans .env.local (voir scripts/relance-inactifs.env.example).");
  }

  const dryRun = process.argv.includes("--dry-run");
  log("Relance inactifs — " + (dryRun ? "MODE TEST (aucun envoi)" : "envoi réel"));

  const r = await runRelance({ serviceKey, brevoKey, dryRun, skipWhenNoRecipients: true });
  if (r.queueEmpty) {
    log("Relances : file d'actus vide → aucun email envoyé.");
  } else if (dryRun) {
    log("Relances : " + r.queued + " actu(s) en file ; éligibles : " + r.eligible1 + " en 1er rappel, " + r.eligible2 + " en dernier rappel.");
  } else if (r.skipped) {
    log("Relances : " + r.queued + " actu(s) en file mais aucun compte éligible → rien envoyé, file conservée.");
  } else {
    log("Relances : " + r.sent + " email(s) envoyé(s), " + r.failed + " échec(s) (" + r.eligible1 + " en 1er rappel, " + r.eligible2 + " en dernier rappel) + copie admin ; file consommée.");
  }

  const ref = await runReferralNotifications({ serviceKey, brevoKey, dryRun });
  if (!ref.pending) {
    log("Parrainages : rien à notifier.");
  } else if (dryRun) {
    log("Parrainages : " + ref.pending + " notification(s) en attente.");
  } else {
    log("Parrainages : " + ref.sent + " envoyée(s), " + ref.notEligible + " parrain(s) non éligible(s), " + ref.failed + " échec(s).");
  }
}

main().catch((e) => {
  log("ERREUR : " + e.message);
  process.exitCode = 1;
});
