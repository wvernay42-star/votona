# Votona — règles du dépôt

Site statique (HTML/CSS/JS vanilla, sans build) de comparaison de positions politiques pour la présidentielle française 2027. Déployé sur Vercel.

## Architecture — à lire avant de toucher au code

- **`index.html` (dans ce dépôt) est la SEULE source de vérité du site.** On l'édite directement, en local comme en session cloud. Git garde l'historique de chaque version.
- **`../boussole2027/app.html` est ABANDONNÉ** (ancienne copie de travail hors git, renommée `app.html.ancien` sur la machine locale). Ne le lis pas, ne le copie jamais vers `index.html`, ne le recrée pas, ne le resynchronise pas : une ancienne copie écraserait des correctifs publiés depuis.
- Workflow pour tout changement du site :
  1. Compter candidats et sujets AVANT : `grep -oE 'id:"[a-z0-9-]+", name:' index.html | wc -l` (candidats) et `grep -oE 'id:"t[0-9]+"' index.html | wc -l` (sujets).
  2. Éditer `index.html`.
  3. Recompter APRÈS : les chiffres doivent être identiques (sauf ajout/retrait voulu). Un écart inattendu signale une perte de données.
  4. Commit + push sur `draft` (test), jamais directement sur `main` — voir « Déploiement ».
- Les fichiers `api/*.js` sont les fonctions serverless Vercel (Node côté serveur).
- IndexNow (Bing & co) : `.github/workflows/indexnow.yml` signale automatiquement les pages modifiées (`index.html`, `candidats/`, `sitemap.xml`) après chaque push sur `main`, via `scripts/indexnow.py`. Le fichier `<clé>.txt` à la racine (32 caractères hexadécimaux) est la clé IndexNow : ne le supprime pas et ne le renomme pas. Lancement manuel possible depuis l'onglet Actions de GitHub pour signaler tout le sitemap.
- Référencement (SEO) : `<main id="app">` contient un contenu statique (titre, présentation, les 7 familles de sujets, liens) lisible sans JavaScript par les moteurs et les aperçus de liens ; l'app le remplace au chargement. Tiens-le cohérent si les familles de sujets ou le fonctionnement changent. Garde en tête du fichier `<!DOCTYPE html>`, `<html lang="fr">` et `<meta charset="utf-8">`, ainsi que les données structurées Organization/WebSite du `<head>`. Dans les titres de pages, utilise le tiret court « - », pas le tiret long.
- Les 34 pages `candidats/<id>/index.html` sont générées, pas éditées à la main (voir `scripts/generate-candidate-pages.js`). Ce script demande Node.js : absent de la machine locale, il se lance depuis une session cloud. Après une modification des candidats/sujets, relance-le et commite les pages régénérées avec le reste.
- Une session cloud (Claude Code web / appli mobile) n'a que ce dépôt, pas la machine locale : elle travaille sur sa propre branche `claude/...` et pousse sur `draft` pour test.

## Déploiement — deux environnements distincts, ne jamais les confondre

- Branche `draft` → domaine `votona.vercel.app` (test/preview).
- Branche `main` → domaine `votona.fr` (production réelle).
- **Toujours tester sur `draft` d'abord.** Ne fusionner `draft` → `main` que si l'utilisateur le demande explicitement ("pousse en production").
- Exceptions voulues, par des routines cloud planifiées : « Votona - veille quotidienne » (5h26 UTC) modifie les blocs `CANDIDATES_DATA` et `POLL_DATA` d'`index.html` et pousse **directement sur `main`** ; « Votona - revue kit mensuelle » pousse une branche `kit-revue-AAAA-MM` à valider. Avant de travailler, fais donc toujours `git pull` : `main` a pu bouger pendant la nuit.

## Contraintes de l'environnement local

- **Node.js n'est pas installé sur la machine locale (Windows) de l'utilisateur.** N'écris pas de script ni de tâche planifiée locale qui suppose `node`/`npm` ; utilise Bash/PowerShell + `curl`/`Invoke-RestMethod` pour les appels API directs. (Les sessions cloud, elles, ont Node : c'est là qu'on lance `scripts/generate-candidate-pages.js`.)
- Les fonctions `api/*.js` tournent sur Vercel (Node côté serveur) : cette contrainte ne les concerne pas.
- Backend : Supabase (`vvvlhxniiykbdssmadbs.supabase.co`) — utilise les clés au **nouveau format** (`sb_publishable_...` / `sb_secret_...`), les clés legacy sont désactivées pour ce projet.
- Emails transactionnels : Brevo.

## Relance email des utilisateurs inactifs

Deux mécanismes séparés, ne pas les confondre ni les dupliquer :
- **Envoi** : 100% manuel, uniquement via le bouton Admin → "Relances email" → "Envoyer aux utilisateurs inactifs" sur le site (`api/send-relance.js` + `api/_lib/relance.js`). N'ajoute jamais d'envoi automatique/planifié sans demande explicite de l'utilisateur.
- **Sourcing des actus** : automatisé via la routine cloud « Votona - relance inactifs » (tous les jours à 4h07 UTC ≈ 6h à Paris, visible sur claude.ai/code/routines) qui cherche l'actualité majeure de la campagne et l'ajoute à la file `relance_news_queue` — elle n'envoie jamais d'email et ne touche à aucun fichier du dépôt. La routine tourne dans l'environnement cloud « Votona », et la clé Supabase est un « identifiant API » de cet environnement (« Supabase Votona », injecté automatiquement en en-têtes `apikey` + `Authorization` vers `vvvlhxniiykbdssmadbs.supabase.co`) : elle n'est jamais écrite dans un prompt, une variable d'environnement ni ce dépôt. L'ancienne tâche locale Claude Desktop du même nom est abandonnée.
- **Notifications de parrainage** (table `referral_completions`, « X a répondu grâce à toi ») : envoi **automatique**, à la demande explicite de l'utilisateur. Dès qu'un filleul répond à sa première question, le site insère la ligne puis appelle `api/notify-referrals.js`, qui traite toutes les lignes en attente (`runReferralNotifications` dans `api/_lib/relance.js`). Chaque ligne est réservée (`notified_at` posé seulement s'il était null) avant l'envoi, pour éviter les doublons ; parrain non éligible (profil sans compte ou non opt-in) → marquée traitée sans email ; envoi Brevo en échec → réservation annulée, retentée au prochain parrainage. Aucun bouton admin.
- Le bouton "Retirer" dans l'admin ne supprime pas la ligne, il la marque `consumed_at` sans envoyer — pour que la tâche de sourcing garde un historique de ce qui a déjà été écarté et évite les doublons.

## Avant de pousser en production

Toujours prévenir l'utilisateur et attendre confirmation explicite avant tout `git push origin main` (ou merge `draft`→`main`).
