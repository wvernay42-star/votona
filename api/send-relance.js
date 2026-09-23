const SUPABASE_URL = "https://vvvlhxniiykbdssmadbs.supabase.co";
const ADMIN_EMAIL = "w.vernay42@gmail.com";

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
    res.status(401).json({ error: "Session invalide" });
    return;
  }
  const user = await userRes.json();
  if (!user || user.email !== ADMIN_EMAIL) {
    res.status(403).json({ error: "Réservé à l'admin" });
    return;
  }

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json"
  };

  // File unique d'actus, partagée entre les deux paliers.
  const queueRes = await fetch(
    SUPABASE_URL + "/rest/v1/relance_news_queue?consumed_at=is.null&order=created_at.asc&select=id,headline,body,image_url,cta_label,cta_url",
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

  const cardsHtml = queue.map(buildCardHtml).join("");
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

    const html = buildEmailHtml(p.name || "toi", cardsHtml);
    const ok = await sendBrevoEmail(BREVO_API_KEY, email, "Votona — on a gardé ta place", html);
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

  await sendBrevoEmail(BREVO_API_KEY, ADMIN_EMAIL, "[Copie admin] Votona — on a gardé ta place", buildEmailHtml("toi", cardsHtml));

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

function buildCardHtml(it) {
  const ctaUrl = it.cta_url || "https://votona.fr/?screen=dashboard";
  const ctaLabel = it.cta_label || (it.cta_url ? "Voir sur Votona" : "Voir mon tableau de bord");
  return (
    '<div style="margin:0 0 16px;border:1px solid #ece6d8;border-radius:16px;overflow:hidden;">' +
    (it.image_url
      ? '<img src="' + esc(it.image_url) + '" width="100%" style="display:block;width:100%;max-height:160px;object-fit:cover;" alt="" />'
      : "") +
    '<div style="padding:14px 16px;">' +
    '<p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#14121F;">' + esc(it.headline) + "</p>" +
    (it.body ? '<p style="margin:0 0 10px;font-size:13.5px;line-height:1.5;color:#4b4a55;">' + esc(it.body) + "</p>" : "") +
    '<a href="' + esc(ctaUrl) + '" style="display:inline-block;padding:9px 18px;font-size:13px;font-weight:700;color:#ffffff;background:#7C3AED;border-radius:99px;text-decoration:none;">' +
    esc(ctaLabel) +
    "</a>" +
    "</div>" +
    "</div>"
  );
}

function buildEmailHtml(name, cardsHtml) {
  const title = "On a gardé ta place, " + esc(name) + " !";
  const intro = "Ça fait un moment que tu n'es pas revenu sur Votona.";
  const ctaLabel = "Continuer mon profil →";
  return (
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3efe6;font-family:Arial,Helvetica,sans-serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3efe6;padding:32px 16px;"><tr><td align="center">' +
    '<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #ece6d8;">' +
    '<tr><td style="background:#7C3AED;padding:28px 32px;text-align:center;">' +
    '<img src="https://votona.fr/assets/ui/logo-head.png" width="48" height="48" alt="Votona" style="border-radius:50%;display:block;margin:0 auto 10px;" />' +
    '<span style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#ffffff;">Votona</span>' +
    "</td></tr>" +
    '<tr><td style="padding:32px 32px 28px;">' +
    '<p style="margin:0 0 14px;font-size:20px;font-weight:700;color:#14121F;">' + title + "</p>" +
    '<p style="margin:0 0 14px;font-size:14.5px;line-height:1.6;color:#4b4a55;">' + intro + "</p>" +
    cardsHtml +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#7C3AED;border-radius:99px;">' +
    '<a href="https://votona.fr/?screen=dashboard" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">' +
    ctaLabel +
    "</a>" +
    "</td></tr></table>" +
    "</td></tr>" +
    '<tr><td style="padding:0 32px 28px;border-top:1px solid #ece6d8;">' +
    '<p style="margin:18px 0 0;font-size:11.5px;line-height:1.6;color:#9a98a6;">Tu reçois cet email car tu as un compte sur Votona. Tu peux le supprimer à tout moment depuis « Mon compte » sur le site.</p>' +
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
