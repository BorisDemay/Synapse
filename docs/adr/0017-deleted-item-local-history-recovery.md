# ADR 0017 — Récupérer les éléments supprimés depuis l’historique local chiffré

- Statut : accepté
- Date : 2026-09-22
- Complète : ADR 0002, ADR 0010, ADR 0011 et ADR 0016
- Plan : `docs/plans/2026-09-22-writing-first.md`

## Contexte

La suppression d’une note ou d’une pièce jointe utilise déjà une mutation
chiffrée contenant la sentinelle de suppression. Les révisions précédentes
restent chiffrées dans le cache local, mais n’étaient pas accessibles depuis
l’interface après disparition de l’élément. Un clic accidentel devait pouvoir
être corrigé sans inventer une corbeille serveur ni persister du contenu en clair.

## Décision

Le client déverrouillé peut proposer les éléments actuellement supprimés dont
la sentinelle est présente dans son cache. La consultation charge à la demande
les révisions locales nécessaires pour retrouver le dernier contenu restaurable,
son type et son chemin. Les titres, chemins et aperçus déchiffrés restent en
mémoire et sont retirés lors du verrouillage ou du changement de coffre/compte.

Une restauration conserve l’identité de l’élément et son chemin validé. Elle
passe par les sauvegardes ordinaires : nouveau `operation_id`, `base_revision`,
chiffrement et persistance durable existants. Elle n’efface ni historique ni
opération en attente et n’outrepasse pas les conflits de synchronisation.
Le client refuse de restaurer un élément qui n’est plus supprimé ou dont le
chemin est occupé par un autre élément vivant, plutôt que d’écraser ce dernier.
Les vérifications de session, clé et coffre sont répétées après les attentes
asynchrones avant d’exposer du contenu ou de restaurer.

Avant de supprimer la note en cours, l’interface conserve durablement le dernier
brouillon. Une erreur de stockage interrompt la suppression ; elle ne doit pas
faire disparaître le travail affiché. Après suppression, une action d’annulation
explicite et un accès aux éléments supprimés exposent la même restauration.

## Limites

Cette fonction est une récupération depuis les révisions **déjà disponibles sur
cet appareil**, pas une garantie de corbeille synchronisée ou de sauvegarde.
Un autre appareil, un cache effacé ou des révisions absentes peuvent empêcher la
restauration. L’interface doit l’expliquer et ne pas afficher de faux succès.
La perte de la phrase et de tout appareil capable de déverrouiller le coffre
n’est pas réparée par cette fonction.

Aucune nouvelle primitive cryptographique, migration de stockage, enveloppe,
API serveur, suppression définitive ou rétention serveur n’est introduite.
La sentinelle existante reste compatible avec les clients antérieurs.
