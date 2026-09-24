const { SUPABASE_URL, ADMIN_EMAIL, runRelance, runReferralNotifications } = require("./_lib/relance");

// Admin → "Relances email" : réservé à l'admin connecté. La logique d'envoi
// vit dans _lib/relance.js. Deux actions, toutes deux déclenchées à la main :
// - par défaut : relance des inactifs (digest de la file d'actus) ;
// - action "referrals" : notifications de parrainage en attente
//   (dryRun: true → renvoie seulement le nombre en attente, sans envoyer).
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

  if (body.action === "referrals") {
    try {
      const ref = await runReferralNotifications({
        serviceKey: SUPABASE_SERVICE_ROLE_KEY,
        brevoKey: BREVO_API_KEY,
        dryRun: !!body.dryRun
      });
      res.status(200).json(ref);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  let result;
  try {
    result = await runRelance({ serviceKey: SUPABASE_SERVICE_ROLE_KEY, brevoKey: BREVO_API_KEY });
  } catch (e) {
    res.status(500).json({ error: e.message });
    return;
  }
  if (result.queueEmpty) {
    res.status(400).json({ error: "La file est vide" });
    return;
  }

  res.status(200).json({
    sent: result.sent,
    failed: result.failed,
    eligible1: result.eligible1,
    eligible2: result.eligible2
  });
};
