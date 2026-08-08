# Protocole de synchronisation chiffré v1

## Frontière de confiance

Le protocole v1 transporte exclusivement des identifiants opaques, des révisions,
des curseurs, des nonces, des empreintes de ciphertext et des ciphertexts. Il ne
contient jamais de titre, chemin, tag, lien, extrait, Markdown, pièce jointe en
clair, clé de coffre ou phrase secrète. La clé de coffre enveloppée est elle-même
un blob chiffré et n'est présente qu'à la création d'un coffre.

Les ciphertexts sont liés côté client à `vault_id`, `note_id` et à la révision par
l'AAD versionnée. Le serveur ne déchiffre pas et ne fusionne pas le contenu.

## Transitions d'une opération

Une opération locale est `pending` dans l'outbox jusqu'à une réponse serveur
durable :

```text
pending -> accepted
pending -> conflict
pending -> rejected
```

`accepted` confirme l'application idempotente de l'opération. Le rejeu du même
`operation_id` retourne le même résultat sans créer une nouvelle révision.
`conflict` signale une `base_revision` obsolète et expose uniquement les
références aux ciphertexts base, local et distant. Un client déverrouillé peut
les déchiffrer et effectuer une fusion trois voies uniquement pour des hunks
disjoncts ; sinon une résolution manuelle produit une nouvelle révision.
`rejected` ne retire pas l'opération locale sans action explicite du client.

## Pull et reprise

Un `PullRequest` contient le coffre, un `SyncCursor` opaque facultatif et une
limite. La réponse est ordonnée de manière stable et fournit `next_cursor` quand
une page suivante existe. Après une coupure, un redémarrage ou la perte d'un
signal WebSocket, le client reprend un pull depuis son dernier curseur durable.

WebSocket est uniquement un signal de réveil : il ne constitue ni un accusé de
réception ni une source de vérité. Toute reprise passe par le pull paginé.

## Contrat publié

Le document OpenAPI déterministe est versionné dans
`crates/synapse-protocol/schema/openapi.json`. Le test de contrat vérifie que sa
génération est stable et que le schéma d'opération chiffrée n'introduit aucun
champ de contenu en clair.
