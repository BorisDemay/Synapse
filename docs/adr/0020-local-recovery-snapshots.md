# ADR 0020 — Snapshots locaux de récupération chiffrés

- Statut : accepté
- Date : 2026-09-24
- Complète : ADR 0010, 0011, 0017 et 0018
- Plan : `docs/plans/2026-09-22-writing-first.md`

## Contexte

L’éditeur Synapse doit offrir une expérience de sauvegarde rapprochée sans
présenter chaque mutation chiffrée comme une entrée d’historique utilisateur.
Le format récurrent visé est celui de File recovery d’Obsidian (snapshots au
moins toutes les cinq minutes, rétention de sept jours), pas une copie de
sauvegarde indépendante. Les points de restauration nommés hérités existent
peut-être déjà dans les préférences chiffrées et restent des données utilisateur.

## Décision

L’éditeur web déclenche une sauvegarde après deux secondes d’inactivité. Chaque
sauvegarde durable garde son fonctionnement existant : contenu chiffré et
opération/outbox persistent ensemble, avec `operation_id`, base causale,
gardes d’erreur et règles de synchronisation inchangés. L’outbox n’est pas
remplacée par le mécanisme de récupération.

Le cache local conserve un snapshot chiffré initial puis au plus un nouveau
snapshot par note toutes les cinq minutes, avec capture forcée du ciphertext
précédant une suppression. Les snapshots identifiés par le marqueur existant
sont éligibles à une rétention de sept jours lors des sauvegardes ultérieures.
La vue n’affiche que ces snapshots et masque ceux de plus de sept jours sur la
note active. Les anciens enregistrements denses non marqués ne sont ni supprimés
ni présentés comme des snapshots; aucun balayage global du coffre n’est effectué.
Par conséquent, un snapshot expiré d’une note inactive peut rester chiffré sur
le disque jusqu’à la prochaine sauvegarde de cette note. Les entrées d’éléments
supprimés suivent leur parcours de récupération séparé.

L’interface n’offre pas la création manuelle de nouveaux points nommés.
Les points nommés déjà présents restent séparément étiquetés, lisibles et
restaurables; leur ciphertext cible n’est pas purgé par cette rétention.

## Limites

Ce mécanisme est une récupération locale, non une sauvegarde indépendante ni
une garantie de récupération après effacement/perte du cache. Une fermeture
brutale avant le délai de deux secondes peut perdre le brouillon non encore
sauvegardé. Le garde de navigation attend une sauvegarde durable et bloque la
sortie en cas d’échec; aucune durabilité asynchrone de `pagehide` n’est promise.
La rétention physique des snapshots dormants est déclenchée à la prochaine
sauvegarde, tandis que leur affichage est filtré dès la lecture pour la note
active.

Les snapshots ne contiennent que le ciphertext existant; aucun clair, endpoint,
schéma serveur, primitive crypto ou migration n’est ajouté. Aucune donnée
historique ou référence nommée préexistante n’est silencieusement effacée.

## Sources produit

- Obsidian Help, [File recovery](https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Plugins/File%20recovery.md) (snapshots espacés d’au moins cinq minutes, rétention de sept jours).
- Forum Obsidian, [Stopped saving to iCloud without notification](https://forum.obsidian.md/t/stopped-saving-to-icloud-without-notification/27518) (délai d’autosauvegarde d’environ deux secondes).
