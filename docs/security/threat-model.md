# Modèle de menace du MVP

## Objectifs de sécurité

Synapse protège la confidentialité et l’intégrité des contenus de coffre contre
un serveur curieux ou compromis, un accès non autorisé entre comptes, des entrées
hostiles et des interruptions de synchronisation. L’E2EE ne masque pas les
métadonnées de transport comme l’adresse IP, le volume, le moment des échanges,
l’appartenance à un coffre ou les numéros de révision.

## Actifs

| Actif | Protection requise |
| --- | --- |
| Fichiers Markdown et pièces jointes locaux | Permissions OS, chemins validés, écritures atomiques |
| Clé de coffre | Mémoire d’un client déverrouillé seulement |
| Phrase secrète et clé de wrapping | Dérivation Argon2id locale, jamais envoyée au serveur |
| Identifiants et sessions | Argon2id côté serveur, cookie opaque révocable |
| Ciphertexts et enveloppes de clés | Intégrité SHA-256, stockage opaque et contrôle d’accès |
| Base PostgreSQL et volume de blobs | Aucun contenu de coffre en clair, sauvegarde restaurable |
| Cache navigateur | IndexedDB ciphertext-only, purge de clé au verrouillage |

## Frontières de confiance

### Client desktop et fichiers locaux

Le système de fichiers local est une frontière hostile : noms, liens symboliques,
permissions et modifications externes sont validés. Les opérations ne sortent
jamais de la racine du coffre. Le client peut voir le Markdown après
 déverrouillage ; il ne l’écrit pas dans des logs, erreurs ou télémétrie.

### Navigateur

Le navigateur est non fiable pour le stockage de secrets. IndexedDB garde des
ciphertexts et les curseurs nécessaires, mais jamais la clé de coffre en clair.
`localStorage`, URL, traces et état persistant ne reçoivent ni clé ni contenu.
Le rendu Markdown désactive le HTML brut et est assaini ; CSP et CSRF protègent
les frontières HTTP.

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

| Menace | Contrôles MVP |
| --- | --- |
| Compromission du serveur | XChaCha20-Poly1305 côté client, AAD versionné, pas de Markdown serveur |
| Vol ou rejeu de session | Cookies opaques, rotation, expiration, révocation et rate limiting |
| Traversal ou symlink | `VaultPath` validé, résolution confinée, tests multi-plateformes |
| Altération de ciphertext | AEAD, AAD liée au coffre/note/révision, hash de ciphertext |
| Écrasement concurrent | `operation_id`, `base_revision`, révisions immuables et conflits préservés |
| XSS et fuite de cache | HTML brut désactivé, assainissement, CSP et IndexedDB chiffré |
| Fuite de diagnostics | Redaction testée, logs structurés sans payload, secrets ni cookies |
| Perte de phrase secrète | Limite documentée : pas de récupération implicite ni escrow serveur |

## Hors périmètre et hypothèses

Le partage E2EE entre comptes, la récupération sans secret et les CRDT sont hors
MVP. La phrase de wrapping est distincte du mot de passe d’authentification :
elle est utilisée seulement dans le client pour dériver la clé locale avec
Argon2id et ne traverse jamais l’API. Les limites par défaut sont 10 MiB par
note et 100 MiB par pièce jointe, configurables côté serveur. Les révisions sont
retenues 90 jours et les blobs orphelins disposent d’une grâce de 30 jours avant
purge.
