# ADR 0002 — Synchronisation par opérations et révisions

- Statut : accepté
- Date : 2026-08-08

## Contexte

Un client doit continuer à modifier son coffre sans réseau. Les clients peuvent
réessayer après un crash, une coupure ou une notification WebSocket perdue. Le
serveur ne peut pas fusionner des contenus chiffrés.

## Décision

Chaque mutation porte un `operation_id` UUIDv7 globalement unique, un
`vault_id`, une `base_revision` strictement positive et un payload chiffré.
L’application d’une opération est idempotente : un rejeu retourne le résultat
durable initial et ne crée pas de révision supplémentaire. Un rejeu avec le
même identifiant mais un coffre, une note, une base, un ciphertext, un nonce ou
une empreinte différents est rejeté ; l’identifiant d’opération ne peut pas
être réutilisé pour faire acquitter un autre payload.

Chaque coffre a une suite de révisions croissantes. Le contenu est adressé par
la somme SHA-256 des octets de ciphertext, et non par une empreinte de contenu
clair. Le serveur valide l’intégrité annoncée sans déchiffrement.

Un push dont `base_revision` n’est plus la révision courante retourne un conflit
opaque. Il préserve les références chiffrées base, locale et distante. Le client
peut effectuer une fusion trois voies uniquement après déchiffrement local et
uniquement pour des hunks disjoints ; sinon il exige une résolution manuelle.
Une résolution produit une nouvelle révision et ne supprime jamais les variantes.

Les pulls utilisent un curseur stable, paginé et reprenable. Le WebSocket est un
signal de réveil seulement : après toute reconnexion, le client tire depuis son
curseur persistant. Une opération sort de la file locale seulement après un ack
durable du serveur.

## Conséquences

Le réseau ne bloque jamais l’édition locale. Les notifications peuvent être
perdues, dupliquées ou réordonnées sans perte de données. Les conflits sont plus
visibles qu’avec un CRDT, mais aucune fusion de contenu n’est confiée au serveur.

## Alternatives rejetées

- Dernier écrivain gagnant : il provoque des écrasements silencieux.
- Ordonnancement par horodatage : les horloges dérivent.
- CRDT dans le MVP : la sérialisation Markdown et le coût opérationnel ne sont
  pas encore justifiés.
- WebSocket comme journal durable : une notification n’est pas un ack.
