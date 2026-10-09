# ADR 0021 — Frontière de transport IA multi-fournisseur

- Statut : accepté
- Date : 2026-10-04
- Complète : ADR 0008
- Références : `docs/security/csp-ai-evidence-matrix.md`,
  `docs/security/hardening.md`

## Contexte

L’ADR 0008 accepte un assistant Codex optionnel : depuis un client déverrouillé,
celui-ci contacte directement OpenAI après consentement explicite, conserve son
credential chiffré localement et ne fait jamais transiter un contenu de coffre
par Synapse.

L’inspection R03.1 montre cependant trois états distincts qui ne doivent pas être
confondus :

1. le runtime partagé annonce Codex/ChatGPT, GLM, DeepSeek, Mistral, OpenRouter
   et un endpoint compatible OpenAI personnalisé ;
2. la CSP Tauri n’autorise explicitement que les trois origines Codex
   (`api.openai.com`, `auth.openai.com`, `chatgpt.com`) ;
3. les trois sources CSP du déploiement web — meta `apps/web/index.html`,
   en-têtes `apps/web/nginx.conf` et `infra/caddy/Caddyfile` — emploient
   actuellement `connect-src 'self' https:`, qui n’est pas une allowlist.

Une capacité affichée par le runtime ne constitue ni une destination autorisée
par une CSP, ni une promesse de connectivité (CORS, DNS, TLS et contrat
fournisseur), ni une validation de sécurité observée en exécution. À l’inverse,
une CSP ne donne pas le consentement de transmettre un contenu et ne remplace pas
la validation du credential ou du protocole fournisseur. Le présent ADR tranche
la politique à implémenter ultérieurement ; il ne modifie pas les états observés
ci-dessus.

## Décision proposée

### Invariants non négociables

Toute intégration IA reste un flux direct **client déverrouillé → fournisseur**.
Elle ne passe ni par le serveur, ni par PostgreSQL, ni par les blobs, ni par les
logs, métriques, traces ou opérations Synapse. Le serveur Synapse ne devient pas
un proxy, un relais CORS, une passerelle de clés ni un validateur de destinations.

Un credential, access token ou refresh token est enveloppé avec la clé de coffre
uniquement dans le stockage local chiffré. Il n’est jamais placé dans
`localStorage`, une URL, un état Pinia persisté, une erreur ou une télémétrie, et
son clair est purgé au verrouillage et à la déconnexion. Le choix d’un
fournisseur reste facultatif ; aucun compte, abonnement ou SaaS externe n’est
requis pour Synapse ni pour le fonctionnement hors ligne du coffre.

Avant chaque envoi de contexte de coffre en clair, l’interface doit identifier le
fournisseur et la destination, énumérer le contexte explicitement lié, expliquer
que ce contenu quitte l’E2EE vis-à-vis de ce fournisseur, puis recueillir le
consentement explicite défini par ADR 0008. Une destination autorisée ne permet
jamais l’envoi silencieux d’une note, d’un titre, d’un chemin, d’un tag ou d’une
pièce jointe.

### Politique de destinations, fermée par défaut

La future implémentation doit tenir un registre versionné de destinations par
plateforme. Toute requête IA doit être refusée localement avant construction du
payload si son fournisseur, son origine ou sa route n’est pas autorisé par ce
registre **et** par la CSP effective de la plateforme. L’absence de preuve vaut
refus ; il n’existe pas de repli vers `https:`, un proxy Synapse ou une URL
arbitraire.

| Catégorie                               | Capacité actuellement annoncée | Politique proposée web                                                                                                                                    | Politique proposée WebView Tauri                                                                                                      |
| --------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Codex Platform et abonnement ChatGPT    | Oui                            | Autorisé uniquement vers `https://api.openai.com`, `https://auth.openai.com` et `https://chatgpt.com`, selon les routes ADR 0008.                         | Même allowlist et mêmes routes ; le pont Rust Synapse fermé reste hors de ce flux.                                                    |
| GLM, DeepSeek, Mistral, OpenRouter      | Oui dans le runtime partagé    | Non pris en charge tant qu’une tranche dédiée n’a pas inscrit chaque origine et route dans le registre, la CSP web et les validations exigées ci-dessous. | Non pris en charge. Une extension Tauri exige une décision d’architecture distincte, même si le web fixe ultérieurement des origines. |
| Endpoint compatible OpenAI personnalisé | Oui dans le runtime partagé    | Non pris en charge. Une URL saisie par l’utilisateur ne peut pas étendre `connect-src`.                                                                   | Non pris en charge, pour la même raison et en raison de la surface WebView supplémentaire.                                            |

Codex est le seul ensemble de destinations proposé comme disponible sur les deux
plateformes, car ses trois origines précises sont déjà décidées dans ADR 0008 et
encadrées dans Tauri. Les fournisseurs fixes ne deviennent pas des capacités
supportées parce qu’ils apparaissent dans un sélecteur ou que la CSP web actuelle
est large. Cette décision conserve la possibilité d’intégrations directes
ultérieures, mais impose qu’elles soient explicites, minimales et vérifiables.

Le présent ADR recommande de ne pas concevoir de mode « URL libre » tant qu’une
architecture distincte n’aura pas défini une liste locale administrée, son modèle
de menace, son encodage et sa validation sur chaque plateforme. Cette
recommandation ne crée pas une telle capacité et ne suppose aucun protocole de
configuration ou de cryptographie.

### CSP web et séparation des preuves

Lors d’une future tranche, les trois sources web actives doivent exprimer la même
allowlist `connect-src` précise :

- la meta CSP livrée par `apps/web/index.html` ;
- les en-têtes et emplacements Nginx dans `apps/web/nginx.conf` ;
- l’en-tête Caddy dans `infra/caddy/Caddyfile`.

La politique finale ne doit pas contenir le schéma générique `https:` pour le
trafic de connexion IA. Elle doit également préserver `'self'` pour les appels
Synapse à l’origine de l’application et ne doit pas introduire `ws:` ou `wss:`
génériques. Le WebView Tauri conserve son CSP propre, avec l’allowlist Codex
minimale, plutôt que d’hériter implicitement d’une décision de déploiement web.

Pour chaque fournisseur, les quatre affirmations suivantes doivent demeurer
séparées dans l’UX, la documentation et les tests :

1. **Capacité annoncée** : le client peut afficher ou stocker un choix de
   fournisseur ; ce fait ne permet aucun appel.
2. **Destination autorisée** : le registre et la CSP autorisent exactement une
   origine et les routes prévues ; ce fait ne prouve pas qu’un fournisseur est
   joignable ou compatible.
3. **Validation locale** : l’URL, le schéma HTTPS, l’origine et la route sont
   validés avant toute requête ; cela ne transmet aucun contenu.
4. **Validation live** : une intégration contrôlée confirme ultérieurement les
   en-têtes effectifs et les comportements de plateforme. Elle n’emploie ni
   contenu de coffre, ni credential réel, ni appel fournisseur en production.

### Compatibilité, migration et UX de refus

Une préférence ou un credential local chiffré existant pour une destination qui
devient non autorisée n’est ni envoyé, ni déchiffré pour réécriture, ni supprimé
automatiquement. Au prochain déverrouillage, le client doit le classer comme
« fournisseur non disponible sur cette plateforme » et proposer seulement de
choisir une destination autorisée ou de supprimer explicitement le credential
local. Aucune liste de modèles, renouvellement de jeton, `/models`,
`/chat/completions`, `responses` ou autre requête préparatoire ne doit être
émise pour cette configuration.

Avant toute tentative d’envoi, l’UX doit afficher un refus clair et local : la
destination n’est pas autorisée sur cette plateforme, aucune donnée de coffre
n’a été transmise. Le brouillon de l’utilisateur et le contexte local restent
sur l’appareil. Le client ne doit pas dégrader ce refus en message distant, en
journal contenant le prompt, ni en tentative de contournement via l’instance
Synapse. Hors ligne, l’assistant conserve ce même refus local et le coffre reste
éditable ; l’assistant n’ajoute aucune opération à la file de synchronisation.

Toute migration future doit être explicite, atomique dans le stockage local
chiffré, testée avec une configuration historique et réversible par suppression
volontaire du credential. Elle ne crée ni sauvegarde serveur, ni synchronisation
inter-appareil des secrets ou conversations, ni compatibilité implicite entre le
web et le desktop.

## Préconditions de la tranche d’implémentation ultérieure

Aucune de ces préconditions n’est satisfaite ou appliquée par le présent ADR. Une
tranche TDD séparée ne peut commencer qu’après acceptation de cet ADR et doit :

1. écrire des tests RED couvrant le refus avant `fetch` d’un fournisseur fixe ou
   personnalisé non autorisé, sur web et desktop, avec preuve que le payload, le
   token et le contenu de coffre ne quittent pas le client ;
2. définir le registre typé de destinations, son mapping fournisseur/origine/route
   et son comportement de migration, sans exposer un HTTP générique au pont
   Tauri ;
3. remplacer de manière coordonnée la CSP web large dans les trois sources
   actives, conserver la CSP Tauri minimale et ajouter une vérification statique
   de parité de leurs valeurs attendues ;
4. couvrir les chemins Codex et le refus local UX pour une configuration
   historique non autorisée, y compris sans consentement et hors ligne ;
5. exécuter une vérification d’intégration locale des en-têtes réellement servis
   par Nginx et Caddy, sans credential ni appel IA, puis une vérification
   WebView Tauri proportionnée ;
6. documenter la matrice capacité/destination/validation live et mettre à jour
   les affirmations de sécurité devenues inexactes uniquement dans cette tranche.

L’implémentation doit suivre RED → GREEN → refactor sur ces tests. R03.2 est
uniquement une décision documentaire : il ne contient ni test produit RED, ni
modification comportementale GREEN, ni preuve live. Ajouter un test qui simule
une politique non encore implémentée serait trompeur et hors périmètre.

## Conséquences

La disponibilité apparente des fournisseurs non-Codex peut être réduite sur une
future version jusqu’à ce qu’ils satisfassent la politique. C’est une
incompatibilité volontaire, conservatrice et visible plutôt qu’une transmission
imprévisible de contenu chiffré déverrouillé. Les utilisateurs gardent un coffre
entièrement fonctionnel, local-first et hors ligne sans assistant.

La CSP web devra devenir plus restrictive et toute nouvelle intégration demandera
une revue d’architecture, des modifications coordonnées et des preuves par
plateforme. Cela augmente le coût d’ajout d’un fournisseur, mais évite qu’une
liste runtime ou une URL personnalisée élargisse silencieusement une frontière de
confiance. La décision ne promet pas que le navigateur peut joindre chaque
fournisseur : CORS et les contrats externes restent des limites à valider sans
proxy Synapse.

## Alternatives rejetées

- Conserver `connect-src https:` sur le web : autorise indistinctement toute
  origine HTTPS et ne constitue pas une politique de fournisseurs.
- Étendre automatiquement la CSP Tauri à chaque fournisseur affiché : transforme
  un détail d’interface en élargissement de la surface WebView.
- Accepter toute URL compatible OpenAI : une saisie utilisateur ne doit pas
  contourner une allowlist CSP ni rendre l’exfiltration de contenu configurable.
- Introduire un proxy ou un relais CORS Synapse : incompatible avec l’E2EE, le
  modèle local-first et l’absence de contenu de coffre en clair côté serveur.
- Déclarer un fournisseur « validé » à partir d’un test unitaire ou d’une CSP :
  cela confond capacité, autorisation et comportement observé.
