# Modèle de menace du MVP

## Objectifs de sécurité

Synapse protège la confidentialité et l’intégrité des contenus de coffre contre
un serveur curieux ou compromis, un accès non autorisé entre comptes, des entrées
hostiles et des interruptions de synchronisation. L’E2EE ne masque pas les
métadonnées de transport comme l’adresse IP, le volume, le moment des échanges,
l’appartenance à un coffre ou les numéros de révision.

## Actifs

| Actif                                      | Protection requise                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fichiers Markdown et pièces jointes locaux | Permissions OS, chemins validés, écritures atomiques                                                                                                                                        |
| Clé de coffre                              | Mémoire d’un client déverrouillé seulement                                                                                                                                                  |
| Phrase secrète et clé de wrapping          | Dérivation Argon2id locale, jamais envoyée au serveur ; re-wrapping local lors d’un changement de phrase                                                                                    |
| Identifiants et sessions                   | Argon2id côté serveur, cookie opaque révocable                                                                                                                                              |
| Ciphertexts et enveloppes de clés          | Intégrité SHA-256, stockage opaque et contrôle d’accès                                                                                                                                      |
| Base PostgreSQL et volume de blobs         | Aucun contenu de coffre en clair, sauvegarde restaurable                                                                                                                                    |
| Cache navigateur                           | IndexedDB ciphertext-only, purge de clé au verrouillage                                                                                                                                     |
| Enveloppe d’appareil de confiance          | AES-GCM Web Crypto, clé non extractible dans IndexedDB ; jamais de clé de coffre en clair                                                                                                   |
| Jeton d’assistant Codex                    | Optionnel ; enveloppé avec la clé de coffre, ciphertext IndexedDB sur web et desktop ; appel direct à OpenAI, jamais le serveur Synapse                                                     |
| Conversations Codex                        | Fils, titres, messages et notes liées chiffrés avec la clé de coffre et un AAD dédié ; stockage local uniquement, purgé de la mémoire au verrouillage                                       |
| Cookie de session desktop                  | Jar mémoire Rust ; copie optionnelle du jeton opaque dans le répertoire de données de l’application si « Se souvenir de cet appareil » (ADR 0014) ; jamais exposé à Vue ni à `localStorage` |
| Chaîne de mise à jour                      | Clé publique Tauri embarquée, clé privée GitHub protégée, Authenticode Windows, checksums et SBOM ; aucun secret dans les artefacts                                                         |

## Frontières de confiance

### Client desktop et pont natif

Les anciens coffres de fichiers locaux restent une frontière hostile : noms, liens symboliques,
permissions et modifications externes sont validés. Les opérations ne sortent
jamais de la racine du coffre. Le client peut voir le Markdown après
déverrouillage ; il ne l’écrit pas dans des logs, erreurs ou télémétrie.
Le HTTP Synapse est émis par Rust vers une origine configurée ; Vue n’a pas
d’accès HTTP générique.
L’updater suit la même origine validée. Il refuse HTTP hors loopback, vérifie la
signature Tauri avant installation et refuse les versions inférieures. La
WebView ne reçoit aucune permission updater générique.

### Navigateur

Le navigateur est non fiable pour le stockage de secrets. IndexedDB garde des
ciphertexts et les curseurs nécessaires, mais jamais la clé de coffre en clair.
`localStorage`, URL, traces et état persistant ne reçoivent ni clé ni contenu.
Le cache persistant de l’éditeur Vditor est explicitement désactivé. Ses
ressources d’exécution sont embarquées et servies depuis la même origine ; les
outils d’upload et d’enregistrement, l’ouverture automatique des liens et le
rendu des médias sont désactivés. La CSP refuse aussi les images réseau, médias,
frames et objets afin qu’une URL Markdown ne produise aucune requête
silencieuse. Le rendu Markdown désactive le HTML brut et est assaini ; CSP et
CSRF protègent les frontières HTTP.

### HTTP et WebSocket

HTTPS est obligatoire en production. Les sessions sont des cookies `HttpOnly`,
`Secure` et `SameSite=Strict`; les mutations cookie-authentifiées nécessitent une
protection CSRF. Le WebSocket authentifié ne transmet qu’un signal de nouveau
curseur, jamais une preuve durable de réception ni du contenu en clair.

### Serveur, PostgreSQL et volume de blobs

Le serveur est un coordinateur opaque et non une frontière de confidentialité.
Il autorise les comptes et coffres, mais stocke uniquement ciphertexts, nonces,
empreintes de ciphertext, révisions, curseurs, identifiants d’opération et
enveloppes chiffrées. Les requêtes SQL sont paramétrées. Les blobs sont adressés
par une empreinte validée et ne dérivent jamais d’un chemin fourni par un client.

## Menaces et contrôles

| Menace                               | Contrôles MVP                                                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compromission du serveur             | XChaCha20-Poly1305 côté client, AAD versionné, pas de Markdown serveur                                                                                         |
| Vol ou rejeu de session              | Cookies opaques, rotation, expiration (8 h par défaut, 30 jours si appareil mémorisé), révocation (liste et révocation depuis les paramètres) et rate limiting |
| Compromission d’un mot de passe      | Changement authentifié, CSRF, révocation des autres sessions                                                                                                   |
| Suppression de compte                | Mot de passe actuel, CSRF, effacement des coffres possédés ; pas de récupération serveur                                                                       |
| Traversal ou symlink                 | `VaultPath` validé, résolution confinée, tests multi-plateformes                                                                                               |
| Altération de ciphertext             | AEAD, AAD liée au coffre/note/révision, hash de ciphertext                                                                                                     |
| Écrasement concurrent                | `operation_id`, `base_revision`, révisions immuables et conflits préservés                                                                                     |
| XSS et fuite de cache                | HTML brut désactivé, assainissement, CSP et IndexedDB chiffré                                                                                                  |
| Fuite de diagnostics                 | Redaction testée, logs structurés sans payload, secrets ni cookies                                                                                             |
| Perte de phrase secrète              | Limite documentée : pas de récupération implicite ni escrow serveur                                                                                            |
| Assistant Codex optionnel            | Credential fourni par l’utilisateur, `store: false`, historique local chiffré, notes attachées seulement, pas de proxy Synapse ; OpenAI voit le clair choisi   |
| Compromission du feed de mise à jour | TLS, origine d’instance fermée, signature Tauri obligatoire et Authenticode Windows                                                                            |
| Publication partielle ou prématurée  | Parité Windows/Linux/web, santé et identité vérifiées, manifestes mutables remplacés en dernier                                                                |
| Vol du compte de déploiement         | Tag Tailscale éphémère, hôte SSH épinglé, compte sans sudo général et commande forcée                                                                          |

## Hors périmètre et hypothèses

Le partage E2EE entre comptes, la récupération sans secret et les CRDT sont hors
MVP. L’assistant Codex est hors du chemin de synchronisation : il n’est jamais
requis, et le contenu envoyé à OpenAI n’est plus confidentiel vis-à-vis de ce
fournisseur. La phrase de wrapping est distincte du mot de passe d’authentification :
elle est utilisée seulement dans le client pour dériver la clé locale avec
Argon2id et ne traverse jamais l’API. Les limites par défaut sont 10 MiB par note et 10 MiB par pièce jointe
via le JSON de push (ADR 0010). 100 MiB par pièce exigera un upload
streamé hors JSON, hors de la livraison actuelle. Configurable côté serveur. Les révisions sont
retenues 90 jours et les blobs orphelins disposent d’une grâce de 30 jours avant
purge.
