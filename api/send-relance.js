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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!SUPABASE_SERVICE_ROLE_KEY || !BREVO_API_KEY) {
    res.status(500).json({ error: "Configuration serveur incomplète (variables d'environnement manquantes)" });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (e) {
    res.status(400).json({ error: "JSON invalide" });
    return;
  }

  const accessToken = body && body.accessToken;
  if (!accessToken) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }

  const userRes = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + accessToken }
  });
  if (!userRes.ok) {
    const errBody = await userRes.text().catch(() => "");
    res.status(401).json({ error: "Session invalide (" + userRes.status + ") : " + errBody });
    return;
  }
  const user = await userRes.json();
  if (!user || !user.email || user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    res.status(403).json({ error: "Réservé à l'admin (connecté avec : " + (user && user.email) + ")" });
    return;
  }

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json"
  };

  // File unique d'actus, partagée entre les deux paliers.
  const queueRes = await fetch(
    SUPABASE_URL + "/rest/v1/relance_news_queue?consumed_at=is.null&order=created_at.asc&select=id,category,headline,body,cta_url,created_at",
    { headers: sbHeaders }
  );
  const queue = await queueRes.json();
  if (!Array.isArray(queue) || queue.length === 0) {
    res.status(400).json({ error: "La file est vide" });
    return;
  }

  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Palier 1 : inactifs 7j+, aucun rappel déjà reçu.
  const profiles1Res = await fetch(
    SUPABASE_URL +
      "/rest/v1/profiles?news_opt_in=eq.true&reminder1_sent_at=is.null&last_seen_at=lt." +
      sevenDaysAgo +
      "&select=user_id,name",
    { headers: sbHeaders }
  );
  const profiles1 = await profiles1Res.json();

  // Palier 2 : inactifs 30j+, ont déjà reçu le 1er rappel, pas encore le 2e.
  const profiles2Res = await fetch(
    SUPABASE_URL +
      "/rest/v1/profiles?news_opt_in=eq.true&reminder1_sent_at=not.is.null&reminder2_sent_at=is.null&last_seen_at=lt." +
      thirtyDaysAgo +
      "&select=user_id,name",
    { headers: sbHeaders }
  );
  const profiles2 = await profiles2Res.json();

  const rowsHtml = queue.map(buildRowHtml).join("");
  const subject = queue.length === 1 ? "1 actu qui peut changer ton classement" : queue.length + " actus qui peuvent changer ton classement";
  let sent = 0;
  let failed = 0;

  async function sendToProfile(p, patchBody) {
    let email = null;
    try {
      const uRes = await fetch(SUPABASE_URL + "/auth/v1/admin/users/" + p.user_id, { headers: sbHeaders });
      const uJson = await uRes.json();
      email = uJson && uJson.email;
    } catch (e) {}
    if (!email) { failed++; return; }

    const html = buildEmailHtml(p.name || "toi", rowsHtml, queue.length);
    const ok = await sendBrevoEmail(BREVO_API_KEY, email, subject, html);
    if (!ok) { failed++; return; }
    sent++;

    await fetch(SUPABASE_URL + "/rest/v1/profiles?user_id=eq." + p.user_id, {
      method: "PATCH",
      headers: Object.assign({}, sbHeaders, { Prefer: "return=minimal" }),
      body: JSON.stringify(patchBody)
    });
  }

  for (const p of Array.isArray(profiles1) ? profiles1 : []) {
    await sendToProfile(p, { reminder1_sent_at: new Date().toISOString() });
  }
  for (const p of Array.isArray(profiles2) ? profiles2 : []) {
    await sendToProfile(p, { reminder2_sent_at: new Date().toISOString(), news_opt_in: false });
  }

  await sendBrevoEmail(
    BREVO_API_KEY,
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

  res.status(200).json({
    sent,
    failed,
    eligible1: Array.isArray(profiles1) ? profiles1.length : 0,
    eligible2: Array.isArray(profiles2) ? profiles2.length : 0
  });
};

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
