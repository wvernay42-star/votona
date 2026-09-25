const { runReferralNotifications } = require("./_lib/relance");

// Notifications de parrainage, envoyées automatiquement : le site appelle
// cette fonction juste après avoir enregistré qu'un filleul a répondu à sa
// première question (table referral_completions). Pas d'authentification :
// elle ne fait que traiter les lignes déjà en attente en base (une ligne =
// au plus un email, voir la réservation dans _lib/relance.js) et ne renvoie
// aucune donnée personnelle.
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!SUPABASE_SERVICE_ROLE_KEY || !BREVO_API_KEY) {
    res.status(500).json({ error: "Configuration serveur incomplète" });
    return;
  }
  try {
    const r = await runReferralNotifications({ serviceKey: SUPABASE_SERVICE_ROLE_KEY, brevoKey: BREVO_API_KEY });
    res.status(200).json({ sent: r.sent });
  } catch (e) {
    res.status(500).json({ error: "Échec du traitement" });
  }
};
