# Durcissement réseau et client

## Serveur HTTP

- En-têtes systématiques : `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, CSP API
  `default-src 'none'; frame-ancestors 'none'; base-uri 'none'`.
- `Strict-Transport-Security` uniquement lorsque `SYNAPSE_ENV=production`.
- CORS allowlist : `SYNAPSE_ALLOWED_ORIGIN` est le seul `Origin` accepté pour
  les réponses CORS et pour les mutations cookie-authentifiées (CSRF).
- Corps de push plafonné (`DefaultBodyLimit` sur `/operations`).
- Rate limiting Tower Governor sur `POST /auth/signup`, `POST /auth/login`,
  `POST /auth/activate`, `POST /auth/password` et `POST /auth/account/delete`.
  La clé utilise l’adresse de transport ; `X-Forwarded-For` n’est pris en
  compte que lorsque cette adresse appartient à `SYNAPSE_TRUSTED_PROXIES`.
  `GET /auth/signup` n’expose que le booléen `public_signup` pour l’interface ;
  il n’est pas soumis au même limiteur.
  Changer le mot de passe exige le mot de passe actuel, un CSRF `Origin` et
  révoque les autres sessions. La liste `GET /auth/sessions` n’expose ni jeton
  ni empreinte. La suppression de compte exige le mot de passe et efface les
  coffres possédés.

## Client web

L’appareil de confiance enveloppe la clé de coffre dans IndexedDB avec une
clé AES-GCM non extractible (Web Crypto). Aucune passkey, aucun envoi
serveur. Quiconque contrôle le profil navigateur peut déverrouiller ; la
phrase reste la secours. « Se souvenir de cet appareil » à la connexion
(ADR 0014) allonge seulement le cookie de session de compte ; cela ne
persiste pas la clé de coffre.

La déconnexion verrouille immédiatement le coffre et retire les moyens de
déverrouillage de confiance et les credentials d'assistant de l'appareil. Elle
conserve le cache, l'enveloppe de clé, l'historique et les opérations en attente
sous forme chiffrée : une panne réseau au logout ne doit pas effacer le seul
exemplaire d'une modification. Une connexion ultérieure du même compte permet
de déverrouiller ce contenu avec la phrase. L'effacement des données de
l'appareil est une action distincte. Les réponses asynchrones d'une ancienne
session ne doivent pas repeupler un coffre verrouillé ou un autre compte.

Chaque enregistrement synchronisable persiste dans une transaction IndexedDB
le ciphertext, l'identité d'opération et l'historique avant le transport. La
livraison s'exécute en arrière-plan ; erreurs HTTP, timeout et ack invalide
laissent l'opération récupérable. Un ack doit correspondre à l'opération
envoyée. Un rejeu après interruption conserve l'identité et le ciphertext déjà
tentés ; les modifications locales suivantes restent distinctes.

La CSP de `apps/web/index.html` limite `connect-src` à `'self'`,
`https://api.openai.com`, `https://auth.openai.com` et `https://chatgpt.com`
(assistant Codex optionnel, hors serveur Synapse). Les WebSockets utilisent
l’origine de l’application ; aucune permission générique `ws:` ou `wss:` n’est
accordée. Les en-têtes CSP de Nginx et Caddy ajoutent `frame-ancestors 'none'`.
Le jeton d’assistant n’est jamais en `localStorage` : il est enveloppé avec la
clé de coffre. La connexion par abonnement utilise le code d’appareil
officiel Codex ; elle n’ouvre pas d’iframe ChatGPT.

## Desktop Tauri

Capabilities limitées à `core:default` et aux commandes fenêtre nécessaires
au chrome natif. Pas de shell, HTTP générique ni accès filesystem. Le même
client Vue/IndexedDB chiffré que le web s'exécute dans le WebView ; ses appels
Synapse (auth, enveloppe, push/pull) passent par un enum Rust fermé, borné à
l’URL d’instance configurée. Le cookie de session reste dans un jar mémoire
Rust et n’est jamais exposé à Vue. Une session mémorisée (ADR 0014) peut
être recopiée dans `app_data_dir()/remembered-session` avec des permissions
restreignantes et une liaison explicite à l’origine de l’instance ; elle n’est
jamais réutilisée sur un autre serveur. Les anciens fichiers sans origine
exigent une nouvelle connexion. La déconnexion efface ce fichier.
CSP fenêtre : `default-src 'self'` avec
styles/images locaux et `connect-src` OpenAI/ChatGPT pour l’assistant Codex
optionnel (jamais le serveur Synapse).

Le sélecteur natif de dossier et la réplique utilisent des commandes fermées.
La réplique conserve un manifeste de propriété et un journal d’écriture ; elle
refuse d’écraser les fichiers inconnus ou modifiés par un autre outil. Son
Markdown est en clair sur le disque et reste présent après verrouillage : les
permissions et la protection du disque relèvent du poste local (ADR 0013).
Une erreur de réplique est visible et ne supprime jamais la copie chiffrée.

Le mode sans serveur dispose d’un profil local distinct des comptes distants.
Il ne crée ni session distante ni opération réseau en attente. Les clés et
phrases suivent les mêmes règles de purge ; seule l’enveloppe chiffrée est
conservée pour le déverrouillage suivant (ADR 0016).

## Chemins de coffre

`VaultPath` refuse les traversées `..`, chemins absolus, séparateurs Windows
ambigus, flux ADS (`:`), octets NUL et extensions hors `.md`. Les écritures
résolvent les liens symboliques et refusent une sortie de racine.

## Opérateur

Exiger HTTPS devant le serveur en production (Caddy). La configuration
`.env.example` utilise `SYNAPSE_ENV=production`, des cookies Secure et une
inscription fermée ; `SYNAPSE_ENV` accepte uniquement `development` ou
`production`. Ne jamais activer `SYNAPSE_COOKIE_SECURE=false` ni
`SYNAPSE_ALLOW_PUBLIC_SIGNUP=true` hors développement contrôlé.
Le compte local `test` / `test` n’est créé que lorsque
`SYNAPSE_ENV=development` et `SYNAPSE_DEV_FIXTURE=true` sont définis
explicitement. Le serveur refuse de démarrer en production si ce compte est
encore présent.
Les pulls et pushes sont bornés par taille, concurrence et délai ; chaque
compte dispose d’un quota de stockage chiffré. `/health/storage` expose la
capacité restante, la file d’opérations et le dernier horodatage de sauvegarde
fourni par l’opérateur.
Les imports ZIP vérifient les tailles déclarées avant inflation et exécutent la
décompression bornée dans un worker annulable afin de ne pas bloquer l’interface.
