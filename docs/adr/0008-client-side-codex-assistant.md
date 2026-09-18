# ADR 0008 — Assistant Codex optionnel, exclusivement côté client

- Statut : accepté
- Date : 2026-08-16

## Contexte

Synapse refuse tout SaaS obligatoire et tout contenu de coffre en clair sur le
serveur de synchronisation. Un assistant d’écriture (rédiger, reformuler,
structurer une note) est néanmoins utile s’il reste un choix explicite de
l’utilisateur, avec sa propre clé ou son propre jeton.

L’utilisateur se connecte avec son abonnement ChatGPT/Codex (code d’appareil)
ou une clé Platform. Rien n’est créé ni facturé par Synapse.

## Décision

L’assistant est une fonctionnalité **optionnelle du client déverrouillé**.

- Le premier fournisseur est Codex, appelé **depuis le navigateur** vers
  `https://api.openai.com/v1/responses`. Aucun Markdown, titre, chemin, jeton
  ou clé n’atteint le serveur Synapse, PostgreSQL, les blobs, les logs ou la
  télémétrie.
- L’utilisateur se connecte **avec son abonnement ChatGPT/Codex** via le flux
  officiel à code d’appareil (`auth.openai.com/codex/device`), ou colle une
  clé API Platform. Rien n’est créé ni facturé par Synapse.
- Les appels d’abonnement partent vers `https://chatgpt.com/backend-api/codex/responses`
  (jeton ChatGPT). Les clés Platform restent sur `https://api.openai.com/v1/responses`
  avec `store: false`.
- Après connexion, le client lit le catalogue Codex OAuth (`/codex/models`) : modèles,
  `supported_reasoning_levels` et `service_tiers`. Le slider de profondeur et le
  switch Fast ne montrent que ce que le catalogue annonce pour le modèle choisi ;
  `reasoning.effort` et `service_tier` sont renvoyés tels quels, sans liste locale.
- Le jeton (et le refresh token ChatGPT) est enveloppé avec la clé de coffre
  déjà en mémoire (XChaCha20-Poly1305, AAD lié au coffre) et seul le
  ciphertext est persisté dans IndexedDB. Le clair est purgé au verrouillage
  et à la déconnexion. Pas de `localStorage`, d’URL, d’état Pinia persisté ni
  d’API Synapse.
- Les conversations sont organisées en fils : l’utilisateur peut en créer un,
  rouvrir un fil existant et reprendre son contexte. Messages, titres, note
  active et notes liées sont chiffrés avec la clé de coffre et un AAD dédié
  avant IndexedDB (web) ou SQLite local (desktop). Ils ne sont jamais envoyés
  au serveur Synapse et sont purgés de la mémoire au verrouillage.
- Ctrl+clic (ou ⌘+clic) sur une note de l’arborescence l’attache au fil actif ;
  seules les notes attachées quittent l’appareil vers Codex.
- Codex reçoit des outils locaux stricts, pas une convention de mots-clés :
  `create_note`, `replace_linked_note` et `append_to_linked_note`. Il choisit
  l’action selon la demande et le client l’exécute via `saveNote`.
- Une création ne reçoit aucun chemin ni identifiant de coffre : le client les
  génère localement. Une modification ou un ajout ne peut cibler que
  l’identifiant opaque d’une note explicitement attachée ; une tentative sur
  toute autre note est refusée par le client.
- Chaque tour doit produire une seule action d’écriture structurée. Le chat
  affiche l’action effectuée, sans répéter le Markdown généré et sans boutons
  manuels Créer / Remplacer / Ajouter.
- La CSP web autorise `https://api.openai.com`, `https://auth.openai.com` et
  `https://chatgpt.com` dans `connect-src`. Le login ChatGPT ouvre un onglet
  vers le code d’appareil ; aucun iframe.

## Conséquences

Envoyer une note à Codex **casse volontairement la confidentialité E2EE vis-à-vis
d’OpenAI** pour ce contenu. Le serveur Synapse reste hors du chemin. Un XSS
pourrait abuser de `connect-src` vers OpenAI ; la clé n’est disponible qu’après
déverrouillage. Les échecs CORS éventuels d’`auth.openai.com` ou de
`chatgpt.com` sont une limite connue du client web ; ils ne justifient pas
un proxy Synapse. Le code d’appareil doit être activé dans les paramètres
ChatGPT.

Les fournisseurs suivants devront implémenter la même frontière : appel
direct depuis le client, credential enveloppé localement, consentement
explicite, aucune persistance serveur.

L’utilisateur doit attacher une note avant de demander sa modification. Cela
constitue le consentement de transmettre son contenu à Codex et limite la
capacité d’écriture de l’assistant à la sélection explicite. Les mutations
restent des sauvegardes locales ordinaires : elles passent par la file de
synchronisation chiffrée, avec les mêmes révisions et règles de conflit qu’une
édition manuelle.

La persistance des fils augmente la quantité de contenu local chiffré, mais ne
crée ni synchronisation, ni sauvegarde serveur, ni restauration inter-appareil
de l’historique Codex. Effacer les données locales efface donc aussi ces fils.

## Alternatives rejetées

- Proxy HTTP sur le serveur de sync : incompatible avec l’E2EE MVP.
- Codex CLI / shell Tauri : élargit les capabilities desktop au-delà de
  l’allowlist actuelle.
- Stockage du jeton en `localStorage` ou Pinia persisté : interdit par le
  contrat de secrets.
- Activation par défaut ou compte Synapse lié à OpenAI : SaaS obligatoire.
