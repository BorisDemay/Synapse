# ADR 0009 — Parité UX desktop / web, fichiers locaux canoniques

- Statut : remplacé par ADR 0011
- Date : 2026-08-17

## Contexte

Le client web offre login, déverrouillage, éditeur Vditor, conflits, paramètres
de compte et assistant Codex. Le client Tauri n’exposait qu’une ouverture de
dossier et un formulaire de création. L’ADR 0003 exige que le dossier Markdown
local reste la source de vérité desktop ; copier le modèle IndexedDB du web
contredirait cette décision.

## Décision

Le desktop reprend **l’expérience** du web via `@synapse/ui`, pas le stockage
web. Les vues restent dans `apps/desktop` : les vues web sont trop liées à
IndexedDB.

- L’édition locale fonctionne **sans compte** dans un dossier choisi par
  l’utilisateur. Un dossier local et un coffre distant sont deux coffres
  distincts : se connecter à une instance ne rattache jamais, ni ne copie, le
  dossier local déjà ouvert.
- Le choix « Coffre en ligne » ouvre un coffre distant éphémère. Ses notes
  déchiffrées, sa clé et sa file d’envoi vivent uniquement en mémoire du
  processus ; aucun fichier Markdown, SQLite, cache, secret ou brouillon n’est
  créé dans le répertoire de données de l’application. Ce mode exige le réseau
  pour une synchronisation durable et perd les modifications non acquittées à
  la fermeture ou à la déconnexion.
- Tout HTTP Synapse passe par des commandes Rust allowlistées vers une URL
  d’instance configurée. Cookie `session` en mémoire côté Rust. En-tête
  `Origin` égal à l’origine de cette URL (alignée sur `SYNAPSE_ALLOWED_ORIGIN`).
  Pas de plugin HTTP Vue, pas de `fetch` webview vers Synapse : l’origine
  `tauri://` et `SameSite=Strict` casseraient les cookies.
- L’appareil de confiance (ADR 0006) reste **web seulement**. Desktop passe
  `deviceSupported: false`.
- L’export ZIP Markdown reste **web seulement**. Desktop passe
  `exportSupported: false` : les fichiers sont déjà sur disque.
- Codex s’appelle **depuis le webview** (comme le navigateur), jamais via un
  shell Tauri. La CSP desktop autorise `connect-src` vers OpenAI et ChatGPT.
  Le jeton est enveloppé avec la clé de coffre et persisté dans SQLite local,
  pas dans IndexedDB.
- Verrouiller ou déconnecter le coffre distant zéroise la clé, les notes et le
  jeton d’assistant en mémoire. Les fichiers `.md` restent visibles seulement
  pour le coffre local, dont ils sont la source canonique.

## Conséquences

Le coffre local peut éditer hors ligne sans serveur. Le coffre distant ne
persiste aucune donnée locale et envoie uniquement des ciphertexts. Les
capabilities Tauri restent minimales : pas de filesystem Vue, pas de shell,
pas de HTTP générique.

Un coffre distant fraîchement ouvert ne possède aucun curseur durable. Le
protocole doit donc fournir un snapshot opaque, authentifié et paginé des
dernières versions chiffrées par note avant que ce mode soit annoncé comme
fiable : rejouer seulement le journal retenu ne suffit pas après une purge de
rétention. Ce snapshot ne contient ni titre, ni chemin, ni Markdown en clair.

Le cache historique `app_data_dir()/vault` créé par les versions précédentes
ne doit jamais être supprimé implicitement. Une migration explicite doit
d’abord permettre à l’utilisateur de le conserver comme coffre de dossier, de
le synchroniser puis confirmer sa suppression, ou de le supprimer en
connaissance de la perte éventuelle de brouillons.

## Alternatives rejetées

- Réutiliser le SPA web dans le webview Tauri : IndexedDB deviendrait la
  source de vérité et casserait l’ADR 0003.
- `tauri-plugin-http` ou `fetch` webview vers Synapse : cookies CSRF
  SameSite et surface HTTP trop large.
- Enveloppe d’appareil de confiance IndexedDB dans Tauri : hors ADR 0006 et
  redondant avec des fichiers locaux en clair.
