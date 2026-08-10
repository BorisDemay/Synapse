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

## Pull, curseurs et reprise

Un `SyncCursor` v1 est un UUID opaque émis exclusivement par le serveur. Il est
lié côté serveur au triplet `(vault_id, user_id, revision)` et ne contient ni
révision, ni utilisateur, ni métadonnée en clair. Le client le conserve et le
renvoie sans l'interpréter. Un curseur reste consommable après une coupure ou
une reprise tant que sa révision est conservée par le serveur.

Le pull HTTP v1 est un `GET` navigateur-compatible sans corps :

`GET /v1/vaults/{vault_id}/operations?limit=<1..100>&cursor=<uuid>`

Le paramètre `limit` est obligatoire (1 à 100 inclus). Le paramètre `cursor` est
optionnel : son absence demande un snapshot depuis la révision 0. Une réponse
`PullResponse` contient seulement des opérations chiffrées, dans l'ordre strict
des révisions serveur croissantes, et un `next_cursor` opaque nullable. Le
serveur ne retourne jamais plus de 100 opérations et n'émet `next_cursor` que
lorsqu'une page suivante existe. Le schéma `PullRequest` reste la forme
canonique du contrat logique (version, coffre, curseur, limite) ; sur le fil
HTTP, le coffre vient du chemin et le curseur/limite des query params.

Après une coupure, un redémarrage ou la perte d'un signal WebSocket, le client
reprend un pull depuis son dernier curseur durable.

Si un curseur est inconnu, est lié à un autre `(vault_id, user_id)`, ou pointe
avant le plancher de rétention, le serveur retourne HTTP `409 Conflict` avec le
JSON fermé et versionné suivant :

```json
{
  "protocol_version": 1,
  "code": "sync_cursor_resnapshot_required",
  "resnapshot_cursor": null
}
```

Ce code stable n'expose aucune cause, révision ou métadonnée supplémentaire. Le
client doit abandonner le curseur concerné et réessayer le même pull sans
`cursor`; il ne doit pas déduire de l'erreur l'existence ou l'état d'un autre
coffre.

WebSocket est uniquement un signal de réveil : il ne constitue ni un accusé de
réception ni une source de vérité. Toute reprise passe par le pull paginé.

## Contrat publié

Le document OpenAPI déterministe est versionné dans
`crates/synapse-protocol/schema/openapi.json`. Le test de contrat vérifie que sa génération est stable, que les enveloppes de
pull et l'erreur de resnapshot refusent les champs inconnus, et qu'aucun schéma
n'introduit un champ de contenu en clair.
