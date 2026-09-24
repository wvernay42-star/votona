// Logique de la relance email des inactifs, utilisée par
// api/send-relance.js (bouton Admin → "Relances email", envoi 100 % manuel).
// runReferralNotifications n'est appelée nulle part pour l'instant (voir CLAUDE.md).
// Aucune clé ici : elles sont passées en paramètre par l'appelant.

const SUPABASE_URL = "https://vvvlhxniiykbdssmadbs.supabase.co";
const ADMIN_EMAIL = "w.vernay42@gmail.com";

const CATEGORY_META = {
  "Économie & travail": { ic: "💼", pop: "#FFB703" },
  "Protection sociale": { ic: "🤝", pop: "#3A86FF" },
  "Sécurité & immigration": { ic: "🛡️", pop: "#FF6B6B" },
  "Écologie": { ic: "🌱", pop: "#06D6A0" },
  "Europe & institutions": { ic: "🇪🇺", pop: "#6C5CE7" },
  "Société": { ic: "👥", pop: "#FF5DA2" },
  "Défense & numérique": { ic: "🔐", pop: "#00B4D8" }
};
const NEUTRAL_COLOR = "#9a98a6";
const NEUTRAL_ICON = "🗳️";
const DASHBOARD_URL = "https://votona.fr/?screen=dashboard";

const REFERRAL_LOGO_URL = "https://votona.fr/assets/ui/logo-head.png";

function sbHeadersFor(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
    "Content-Type": "application/json"
  };
}

async function getUserEmail(sbHeaders, userId) {
  try {
    const r = await fetch(SUPABASE_URL + "/auth/v1/admin/users/" + userId, { headers: sbHeaders });
    const j = await r.json();
    return (j && j.email) || null;
  } catch (e) {
    return null;
  }
}

// Envoie le digest d'actus de la file aux comptes inactifs opt-in
// (1er rappel : inactif depuis 7 j ; dernier rappel : depuis 30 j, puis
// désinscription automatique). Options :
// - dryRun : n'envoie rien et n'écrit rien, renvoie seulement le bilan ;
// - skipWhenNoRecipients : si personne n'est éligible, ne consomme pas la
//   file et n'envoie pas la copie admin (les actus attendent le prochain
//   passage). Utile pour une exécution quotidienne automatique.
async function runRelance({ serviceKey, brevoKey, dryRun = false, skipWhenNoRecipients = false }) {
  const sbHeaders = sbHeadersFor(serviceKey);

  // File unique d'actus, partagée entre les deux paliers.
  const queueRes = await fetch(
    SUPABASE_URL + "/rest/v1/relance_news_queue?consumed_at=is.null&order=created_at.asc&select=id,category,headline,body,cta_url,created_at",
    { headers: sbHeaders }
  );
  if (!queueRes.ok) throw new Error("Lecture de la file impossible (" + queueRes.status + ")");
  const queue = await queueRes.json();
  if (!Array.isArray(queue) || queue.length === 0) {
    return { queueEmpty: true, queued: 0, sent: 0, failed: 0, eligible1: 0, eligible2: 0 };
  }

  const now = Date.now();
  const sevenDaysAgoDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgoDate = new Date(now - 30 * 24 * 60 * 60 * 1000);

  // Un compte peut avoir plusieurs profils (foyer). On ne veut envoyer
  // qu'UN SEUL email par compte : on récupère tous les profils liés à
  // un compte, on ne garde que le plus récemment actif par user_id, et
  // c'est SEULEMENT ce profil représentatif qui détermine l'éligibilité
  // (et qui sera marqué comme relancé, pour tout le compte).
  const allRes = await fetch(
    SUPABASE_URL + "/rest/v1/profiles?user_id=not.is.null&select=user_id,name,news_opt_in,reminder1_sent_at,reminder2_sent_at,last_seen_at",
    { headers: sbHeaders }
  );
  if (!allRes.ok) throw new Error("Lecture des profils impossible (" + allRes.status + ")");
  const all = await allRes.json();

  const byAccount = {};
  for (const p of Array.isArray(all) ? all : []) {
    if (!p.last_seen_at) continue;
    const existing = byAccount[p.user_id];
    if (!existing || new Date(p.last_seen_at) > new Date(existing.last_seen_at)) {
      byAccount[p.user_id] = p;
    }
  }

  const profiles1 = [];
  const profiles2 = [];
  for (const userId in byAccount) {
    const p = byAccount[userId];
    if (!p.news_opt_in) continue;
    const lastSeen = new Date(p.last_seen_at);
    if (!p.reminder1_sent_at && lastSeen < sevenDaysAgoDate) {
      profiles1.push(p);
    } else if (p.reminder1_sent_at && !p.reminder2_sent_at && lastSeen < thirtyDaysAgoDate) {
      profiles2.push(p);
    }
  }

  const result = { queueEmpty: false, queued: queue.length, sent: 0, failed: 0, eligible1: profiles1.length, eligible2: profiles2.length, skipped: false };
  if (dryRun) return result;
  if (skipWhenNoRecipients && profiles1.length + profiles2.length === 0) {
    result.skipped = true;
    return result;
  }

  const rowsHtml = queue.map(buildRowHtml).join("");
  const subject = queue.length === 1 ? "1 actu qui peut changer ton classement" : queue.length + " actus qui peuvent changer ton classement";

  async function sendToProfile(p, patchBody) {
    const email = await getUserEmail(sbHeaders, p.user_id);
    if (!email) { result.failed++; return; }

    const html = buildEmailHtml(p.name || "toi", rowsHtml, queue.length);
    const ok = await sendBrevoEmail(brevoKey, email, subject, html);
    if (!ok) { result.failed++; return; }
    result.sent++;

    await fetch(SUPABASE_URL + "/rest/v1/profiles?user_id=eq." + p.user_id, {
      method: "PATCH",
      headers: Object.assign({}, sbHeaders, { Prefer: "return=minimal" }),
      body: JSON.stringify(patchBody)
    });
  }

  for (const p of profiles1) {
    await sendToProfile(p, { reminder1_sent_at: new Date().toISOString() });
  }
  for (const p of profiles2) {
    await sendToProfile(p, { reminder2_sent_at: new Date().toISOString(), news_opt_in: false });
  }

  await sendBrevoEmail(
    brevoKey,
    ADMIN_EMAIL,
    "[Copie admin] " + subject,
    buildEmailHtml("toi", rowsHtml, queue.length)
  );

  const ids = queue.map((it) => it.id).join(",");
  await fetch(SUPABASE_URL + "/rest/v1/relance_news_queue?id=in.(" + ids + ")", {
    method: "PATCH",
    headers: Object.assign({}, sbHeaders, { Prefer: "return=minimal" }),
    body: JSON.stringify({ consumed_at: new Date().toISOString() })
  });

  return result;
}

// Prévient un parrain quand une personne arrivée par son lien de partage
// répond à sa première question (table referral_completions). Chaque
// ligne est marquée notifiée, même si le parrain n'est pas éligible
// (profil sans compte ou non opt-in) : on ne la retraitera pas.
async function runReferralNotifications({ serviceKey, brevoKey, dryRun = false }) {
  const sbHeaders = sbHeadersFor(serviceKey);
  const res = await fetch(
    SUPABASE_URL + "/rest/v1/referral_completions?notified_at=is.null&select=id,referrer_profile_id,referred_name",
    { headers: sbHeaders }
  );
  if (!res.ok) throw new Error("Lecture des parrainages impossible (" + res.status + ")");
  const rows = await res.json();
  const result = { pending: Array.isArray(rows) ? rows.length : 0, sent: 0, notEligible: 0, failed: 0 };
  if (dryRun || !result.pending) return result;

  for (const row of rows) {
    let referrer = null;
    try {
      const pr = await fetch(
        SUPABASE_URL + "/rest/v1/profiles?id=eq." + encodeURIComponent(row.referrer_profile_id) + "&select=user_id,name,news_opt_in",
        { headers: sbHeaders }
      );
      const list = await pr.json();
      referrer = Array.isArray(list) && list.length ? list[0] : null;
    } catch (e) {}

    if (!referrer || !referrer.user_id || !referrer.news_opt_in) {
      result.notEligible++;
    } else {
      const email = await getUserEmail(sbHeaders, referrer.user_id);
      const referredName = (row.referred_name || "").trim() || "Quelqu'un";
      const ok = email && await sendBrevoEmail(
        brevoKey,
        email,
        referredName + " a répondu grâce à toi",
        buildReferralEmailHtml(referredName)
      );
      if (!ok) { result.failed++; continue; } // non marquée : retentée au prochain passage
      result.sent++;
    }

    await fetch(SUPABASE_URL + "/rest/v1/referral_completions?id=eq." + row.id, {
      method: "PATCH",
      headers: Object.assign({}, sbHeaders, { Prefer: "return=minimal" }),
      body: JSON.stringify({ notified_at: new Date().toISOString() })
    });
  }
  return result;
}

function buildReferralEmailHtml(referredName) {
  const n = esc(referredName);
  return (
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3efe6;font-family:Arial,Helvetica,sans-serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3efe6;padding:32px 16px;"><tr><td align="center">' +
    '<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #ece6d8;">' +
    '<tr><td style="background:#7C3AED;padding:28px 32px;text-align:center;">' +
    '<img src="' + REFERRAL_LOGO_URL + '" width="48" height="48" alt="Votona" style="border-radius:50%;display:block;margin:0 auto 10px;" />' +
    '<span style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#ffffff;">Votona</span>' +
    "</td></tr>" +
    '<tr><td style="padding:32px 32px 28px;text-align:center;">' +
    '<p style="margin:0 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:#7C3AED;">Parrainage</p>' +
    '<p style="margin:0 0 14px;font-size:20px;font-weight:700;color:#14121F;">' + n + " a donné le ton !</p>" +
    '<p style="margin:0 0 22px;font-size:14.5px;line-height:1.6;color:#4b4a55;">Ton lien a fonctionné : ' + n + " vient de répondre à ses premières questions sur Votona. Va voir comment vous vous situez l'un par rapport à l'autre.</p>" +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#7C3AED;border-radius:99px;">' +
    '<a href="' + DASHBOARD_URL + '" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Voir mon classement →</a>' +
    "</td></tr></table>" +
    "</td></tr>" +
    '<tr><td style="padding:0 32px 28px;border-top:1px solid #ece6d8;">' +
    '<p style="margin:18px 0 0;font-size:11.5px;line-height:1.6;color:#9a98a6;">Tu reçois cet email car tu as un compte sur Votona. Tu peux désactiver ces notifications depuis « Mon compte » sur le site.</p>' +
    "</td></tr>" +
    "</table></td></tr></table></body></html>"
  );
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function relativeTime(createdAt) {
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.getHours() >= 18 ? "CE SOIR " + d.getHours() + "H" : "AUJOURD'HUI";
  }
  const diffDays = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (diffDays === 1) return "HIER";
  if (diffDays > 1 && diffDays < 7) return "IL Y A " + diffDays + " JOURS";
  const months = ["JANV.", "FÉVR.", "MARS", "AVR.", "MAI", "JUIN", "JUIL.", "AOÛT", "SEPT.", "OCT.", "NOV.", "DÉC."];
  return d.getDate() + " " + months[d.getMonth()];
}

function buildRowHtml(it) {
  const meta = CATEGORY_META[it.category];
  const color = meta ? meta.pop : NEUTRAL_COLOR;
  const icon = meta ? meta.ic : NEUTRAL_ICON;
  const label = (it.category ? it.category : "Actu").toUpperCase();
  const time = relativeTime(it.created_at);
  const link = it.cta_url || DASHBOARD_URL;
  return (
    '<tr><td style="padding:16px 0; border-top:1px solid #ece6d8;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td width="36" valign="top" style="padding-right:12px;">' +
    '<div style="width:32px;height:32px;border-radius:50%;background:' + color + ';text-align:center;line-height:32px;font-size:15px;">' + icon + "</div>" +
    "</td>" +
    '<td valign="top">' +
    '<a href="' + esc(link) + '" style="text-decoration:none;">' +
    '<p style="margin:0 0 3px;font-size:11px;font-weight:700;letter-spacing:.04em;color:' + color + ';">' + esc(label) + (time ? " · " + time : "") + "</p>" +
    '<p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#14121F;">' + esc(it.headline) + "</p>" +
    (it.body ? '<p style="margin:0;font-size:13.5px;line-height:1.5;color:#4b4a55;">' + esc(it.body) + "</p>" : "") +
    "</a>" +
    "</td>" +
    "</tr></table>" +
    "</td></tr>"
  );
}

function buildEmailHtml(name, rowsHtml, count) {
  const headline = count === 1 ? "1 actu qui peut changer ton classement" : count + " actus qui peuvent changer ton classement";
  return (
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3efe6;font-family:Verdana,Arial,Helvetica,sans-serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3efe6;padding:32px 16px;"><tr><td align="center">' +
    '<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #ece6d8;">' +
    '<tr><td style="padding:28px 32px 0;text-align:center;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>' +
    '<td style="width:22px;height:22px;background:#7C3AED;border-radius:6px;font-size:0;">&nbsp;</td>' +
    '<td style="padding-left:8px;font-family:Georgia,\'Times New Roman\',serif;font-size:17px;font-weight:700;color:#14121F;">VOTONA</td>' +
    "</tr></table>" +
    "</td></tr>" +
    '<tr><td style="padding:10px 32px 0;text-align:center;">' +
    '<p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.06em;color:#7C3AED;">RÉCAP ACTU</p>' +
    "</td></tr>" +
    '<tr><td style="padding:12px 32px 0;">' +
    '<p style="margin:0 0 4px;font-size:14.5px;color:#4b4a55;">Salut ' + esc(name) + ",</p>" +
    '<p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#14121F;line-height:1.3;">' + esc(headline) + "</p>" +
    '<p style="margin:0;font-size:13.5px;line-height:1.5;color:#4b4a55;">Voici ce qui a bougé dans la campagne depuis ta dernière visite.</p>' +
    "</td></tr>" +
    '<tr><td style="padding:6px 32px 4px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + rowsHtml + "</table>" +
    "</td></tr>" +
    '<tr><td style="padding:22px 32px 28px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td style="background:#7C3AED;border-radius:99px;text-align:center;">' +
    '<a href="' + DASHBOARD_URL + '" style="display:block;padding:14px 0;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Voir mon classement mis à jour</a>' +
    "</td></tr></table>" +
    "</td></tr>" +
    '<tr><td style="padding:0 32px 28px;border-top:1px solid #ece6d8;">' +
    '<p style="margin:18px 0 0;font-size:11.5px;line-height:1.6;color:#9a98a6;text-align:center;">Tu reçois cet email car tu as un compte sur Votona. <a href="https://votona.fr/?screen=faq" style="color:#9a98a6;">Aide</a> · <a href="https://votona.fr/?screen=privacy" style="color:#9a98a6;">Confidentialité</a> · <a href="https://votona.fr/?screen=account" style="color:#9a98a6;">Se désinscrire</a></p>' +
    "</td></tr>" +
    "</table></td></tr></table></body></html>"
  );
}

async function sendBrevoEmail(apiKey, toEmail, subject, htmlContent) {
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Votona", email: "w.vernay42@gmail.com" },
        to: [{ email: toEmail }],
        subject,
        htmlContent
      })
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

module.exports = { SUPABASE_URL, ADMIN_EMAIL, runRelance, runReferralNotifications };
