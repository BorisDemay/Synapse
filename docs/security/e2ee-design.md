# Chiffrement de coffre côté client

## Portée du MVP

Chaque contenu synchronisé est chiffré localement avec une clé de coffre aléatoire de 256 bits et XChaCha20-Poly1305. Le serveur ne reçoit jamais le Markdown, les titres, chemins, tags, wikilinks, index de recherche, aperçus ou clés de coffre en clair.

L’AAD versionné lie chaque ciphertext à son `vault_id`, son `note_id` et sa révision. Une tentative de déchiffrement avec une autre combinaison échoue.

## Enveloppe locale de clé

La clé de coffre est enveloppée localement avec une clé dérivée de la phrase secrète par Argon2id. Chaque enveloppe utilise un sel aléatoire unique et un nonce XChaCha20-Poly1305 généré par le CSPRNG du système. Les clés et clés dérivées sont zéroïsées en mémoire lorsqu’elles sont libérées et leurs implémentations `Debug` ne révèlent pas de matière secrète.

La phrase secrète est distincte du mot de passe d’authentification et ne traverse jamais l’API. L’enveloppe sérialisée contient seulement le sel, le nonce et le ciphertext de la clé de coffre.

## Limites et récupération

- Une phrase secrète perdue rend le coffre irrécupérable sans mécanisme de récupération explicitement conçu ; le MVP n’en fournit pas.
- Le client sauvegarde localement chaque mutation comme ciphertext et opération en attente avant transport. Des snapshots ciphertext de récupération sont espacés d’au moins cinq minutes et conservés sept jours; ils ne sont pas une sauvegarde indépendante. L’expiration physique se fait lors d’une sauvegarde ultérieure de la note (les notes dormantes peuvent garder des snapshots expirés); l’interface filtre les expirés de la note active. Les révisions denses non marquées et les cibles de restaurations nommées restent préservées. Une fermeture brutale avant le délai web de deux secondes peut perdre le brouillon en mémoire. Voir [ADR 0020](../adr/0020-local-recovery-snapshots.md).
- Changer la phrase secrète exige de déverrouiller localement la clé de coffre puis de la ré-envelopper ; aucun re-chiffrement de contenu n’est nécessaire.
- Le MVP ne prend pas en charge le partage E2EE entre comptes : la distribution, la rotation et la révocation de clés de groupe sont hors périmètre.
- Le chiffrement ne masque pas les métadonnées de transport telles que tailles de ciphertext, volumes, révisions, timing, membres autorisés et adresse IP observée par le serveur.
