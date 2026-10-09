# ADR 0005 — Contrat de curseur opaque et resnapshot de synchronisation

- Statut : accepté
- Date : 2026-08-08

## Contexte

L'ADR 0002 exige un pull stable, paginé et reprenable. Le contrat v1 exposait
un UUID opaque facultatif sans préciser son rattachement, son expiration, la
taille d'une page ni la récupération lorsqu'un curseur ne peut plus reprendre.
Une implémentation de pull aurait donc dû inventer une sémantique réseau et une
erreur à la volée.

## Décision

Le serveur émet des `SyncCursor` UUID opaques et les associe côté serveur à
`(vault_id, user_id, revision)`. Un curseur ne doit encoder ni révision ni
métadonnée en clair et le client ne doit pas tenter de l'interpréter. `null`
signifie la révision 0 et initie un resnapshot complet.

Chaque page est strictement ordonnée par révision serveur croissante et contient
au plus 100 opérations. Le curseur émis pour une page peut être consommé après
reprise tant que sa révision n'est pas sous le plancher de rétention.

Un curseur inconnu, appartenant à un autre couple `(vault_id, user_id)`, ou
antérieur à ce plancher reçoit HTTP `409 Conflict` et le body JSON fermé v1 :

```json
{
  "protocol_version": 1,
  "code": "sync_cursor_resnapshot_required",
  "resnapshot_cursor": null
}
```

Le code impose au client de reprendre avec `cursor: null`. La réponse ne révèle
pas quelle condition a échoué, une révision, un utilisateur ou un autre
identifiant.

## Conséquences

La Task 18 doit persister et rechercher le rattachement de curseur dans les
transactions appropriées, appliquer le plafond 100, ordonner par révision, et
retourner exactement l'erreur définie ici. Elle ne doit pas créer de curseur
auto-descriptif. Les clients doivent traiter HTTP 409 avec ce code comme un
resnapshot, et les autres 409 restent des erreurs distinctes.

## Alternatives rejetées

- Curseur encodant une révision : il révèle une métadonnée et simplifie le
  forging/rejeu hors contrôle serveur.
- HTTP 400 générique : il ne permet pas au client de distinguer une requête
  malformée d'une reprise qui exige un resnapshot.
- HTTP 410 : il décrit uniquement une ressource supprimée et ne couvre pas le
  curseur inconnu ou associé à un autre utilisateur.
- Autoriser une limite non bornée : elle rend la mémoire, les délais et la
  reprise imprévisibles.
