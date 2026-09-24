# Votona — règles du dépôt

Site statique (HTML/CSS/JS vanilla, sans build) de comparaison de positions politiques pour la présidentielle française 2027. Déployé sur Vercel.

## Architecture — à lire avant de toucher au code

- **`index.html` n'est JAMAIS la source de vérité — ne l'édite jamais directement.** La source de vérité est `../boussole2027/app.html` (un dossier frère, hors de ce dépôt git). `index.html` en est toujours une copie mirroir.
- Workflow correct pour tout changement du site (pas des fichiers `api/`) :
  1. Éditer `../boussole2027/app.html`
  2. Copier vers `index.html` : `cp ../boussole2027/app.html index.html`
  3. Vérifier avant/après que les comptes de candidats et de sujets sont identiques entre les deux fichiers (`grep -oE 'id:"[a-z0-9-]+", name:' | wc -l` pour les candidats, `grep -oE 'id:"t[0-9]+"' | wc -l` pour les sujets) — un écart signale une perte de données.
  4. Commit + push sur la branche `draft`, jamais directement sur `main`.
- Si `index.html` a divergé de `app.html` (ex. un autre agent/session a édité `index.html` directement) : NE PAS écraser `index.html` avec `app.html` sans vérifier. Inspecter le diff, resynchroniser `app.html` DEPUIS `index.html` si besoin (sens inverse), puis repartir de ce nouveau `app.html`.
- Les fichiers `votona-web/api/*.js` (fonctions serverless Vercel) sont propres à ce dépôt — ils ne sont PAS mirrorés depuis `app.html`.
- Les 34 pages `candidats/<id>/index.html` sont générées, pas éditées à la main (voir `scripts/generate-candidate-pages.js`). Ce script demande Node.js : absent de la machine locale, il se lance depuis une session cloud (voir plus bas). Après une modification des candidats/sujets, relance-le et commite les pages régénérées avec le reste.

### Session cloud (Claude Code web / appli mobile) — pas d'accès à `app.html`

Une session qui tourne dans un conteneur cloud n'a que ce dépôt : `../boussole2027/app.html` n'existe pas pour elle. Dans ce cas, et seulement dans ce cas :
- Édite `index.html` directement, c'est la seule option — mais **dis-le explicitement à l'utilisateur à la fin de chaque changement** : `app.html` doit être resynchronisé depuis `index.html` avant la prochaine modification locale (la règle « si `index.html` a divergé » ci-dessus s'applique alors côté local).
- Vérifie quand même les comptes candidats/sujets avant/après avec les mêmes `grep` (ils doivent rester identiques).
- Ne crée pas de copie de `app.html` dans ce dépôt pour « contourner » la règle.
- Une session cloud travaille sur sa propre branche `claude/...` : elle pousse sur `draft` pour test, jamais sur `main` sans le « pousse en production » explicite de l'utilisateur.

## Déploiement — deux environnements distincts, ne jamais les confondre

- Branche `draft` → domaine `votona.vercel.app` (test/preview).
- Branche `main` → domaine `votona.fr` (production réelle).
- **Toujours tester sur `draft` d'abord.** Ne fusionner `draft` → `main` que si l'utilisateur le demande explicitement ("pousse en production").

## Contraintes de l'environnement local

- **Node.js n'est pas installé sur la machine locale (Windows) de l'utilisateur.** N'écris pas de script ni de tâche planifiée locale qui suppose `node`/`npm` ; utilise Bash/PowerShell + `curl`/`Invoke-RestMethod` pour les appels API directs. (Les sessions cloud, elles, ont Node : c'est là qu'on lance `scripts/generate-candidate-pages.js`.)
- Les fonctions `api/*.js` tournent sur Vercel (Node côté serveur) : cette contrainte ne les concerne pas.
- Backend : Supabase (`vvvlhxniiykbdssmadbs.supabase.co`) — utilise les clés au **nouveau format** (`sb_publishable_...` / `sb_secret_...`), les clés legacy sont désactivées pour ce projet.
- Emails transactionnels : Brevo.

## Relance email des utilisateurs inactifs

Deux mécanismes séparés, ne pas les confondre ni les dupliquer :
- **Envoi** : 100% manuel, uniquement via le bouton Admin → "Relances email" → "Envoyer aux utilisateurs inactifs" sur le site (`api/send-relance.js` + `api/_lib/relance.js`). N'ajoute jamais d'envoi automatique/planifié sans demande explicite de l'utilisateur.
- **Sourcing des actus** : automatisé via une tâche locale Claude Code Desktop (`votona-relance-inactifs`, tous les jours à 6h) qui cherche l'actualité de la campagne et l'ajoute à la file `relance_news_queue` — elle n'envoie jamais d'email elle-même. Son prompt vit dans `C:\Users\willi\.claude\scheduled-tasks\votona-relance-inactifs\SKILL.md`, hors de ce dépôt.
- **Notifications de parrainage** (table `referral_completions`, « X a répondu grâce à toi ») : plus aucun mécanisme ne les envoie depuis la suppression de l'ancienne routine cloud. La fonction `runReferralNotifications` existe dans `api/_lib/relance.js` mais n'est appelée nulle part ; les lignes s'accumulent avec `notified_at` à null. Ne la rebranche (bouton admin ou autre) que sur demande de l'utilisateur.
- Le bouton "Retirer" dans l'admin ne supprime pas la ligne, il la marque `consumed_at` sans envoyer — pour que la tâche de sourcing garde un historique de ce qui a déjà été écarté et évite les doublons.

## Avant de pousser en production

Toujours prévenir l'utilisateur et attendre confirmation explicite avant tout `git push origin main` (ou merge `draft`→`main`).
