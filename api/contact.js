// Formulaire de contact du site (écran « Contact ») : envoie le message à
// contact@votona.fr via Brevo (redirigé vers la boîte de l'auteur), avec
// l'email de la personne en « Répondre à ». Rien n'est stocké en base.
//
// Anti-spam léger, sans service tiers :
//   - champ piège « website » invisible pour les humains (rempli = robot) ;
//   - délai minimum entre l'affichage du formulaire et l'envoi ;
//   - longueurs bornées et email valide obligatoire ;
//   - limite par adresse IP (en mémoire, par instance serverless).
const CONTACT_TO = "contact@votona.fr";
const MIN_FILL_MS = 3000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const hits = new Map();

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clean = (s, max) => String(s == null ? "" : s).replace(/\r/g, "").trim().slice(0, max);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    res.status(500).json({ error: "Configuration serveur incomplète" });
    return;
  }

  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }

  // Robot probable : on répond « ok » sans rien envoyer.
  if (body.website || (Number(body.elapsed) || 0) < MIN_FILL_MS) {
    res.status(200).json({ ok: true });
    return;
  }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "inconnue";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    res.status(429).json({ error: "Trop de messages envoyés, réessaie dans quelques minutes." });
    return;
  }

  const name = clean(body.name, 80);
  const email = clean(body.email, 160);
  const topic = clean(body.topic, 60) || "Autre";
  const message = clean(body.message, 5000);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    res.status(400).json({ error: "Adresse email invalide." });
    return;
  }
  if (message.length < 10) {
    res.status(400).json({ error: "Ton message est un peu court." });
    return;
  }

  recent.push(now);
  hits.set(ip, recent);

  const subject = `[Contact Votona] ${topic}${name ? " · " + name : ""}`;
  const htmlContent =
    `<p><strong>Sujet :</strong> ${esc(topic)}<br><strong>De :</strong> ${esc(name || "(sans nom)")} &lt;${esc(email)}&gt;</p>` +
    `<p style="white-space:pre-wrap">${esc(message)}</p>` +
    `<p style="color:#888;font-size:12px">Envoyé depuis le formulaire de contact de votona.fr. Réponds directement à cet email pour répondre à la personne.</p>`;

  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Votona - Contact", email: CONTACT_TO },
        to: [{ email: CONTACT_TO }],
        replyTo: { email, name: name || email },
        subject,
        htmlContent
      })
    });
    if (!r.ok) {
      res.status(502).json({ error: "L'envoi a échoué, réessaie plus tard." });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: "L'envoi a échoué, réessaie plus tard." });
  }
};
