# ADR 0020 — Snapshots locaux de récupération chiffrés

- Statut : accepté
- Date : 2026-09-24
- Complète : ADR 0010, 0011, 0017 et 0018
- Plan : `docs/plans/2026-09-22-writing-first.md`

## Contexte

L’éditeur doit sauvegarder les saisies sans présenter chaque mutation chiffrée comme une entrée d’historique utilisateur. Le modèle de récupération local vise l’espacement (au moins cinq minutes) et la rétention (sept jours) du plugin File recovery d’Obsidian, sans copier son code ni prétendre fournir une sauvegarde indépendante.

## Décision

L’éditeur partagé sauvegarde après deux secondes d’inactivité. Une navigation quitte l’éditeur seulement après la persistance locale durable; une erreur bloque la navigation et laisse le brouillon disponible. Chaque mutation conserve atomiquement le ciphertext de note et l’opération/outbox existants. Aucun contenu clair ne rejoint IndexedDB, le serveur ou les logs.

Le cache garde un snapshot chiffré initial puis au plus un snapshot toutes les cinq minutes par note; une suppression capture de façon forcée le ciphertext immédiatement antérieur. Seuls les snapshots explicitement marqués sont éligibles à l’expiration de sept jours, lors d’une sauvegarde ultérieure de cette note. L’interface de récupération masque les snapshots âgés de plus de sept jours et ne montre pas les anciennes révisions denses. Les révisions historiques non marquées et les cibles des points de restauration nommés restent préservées. La création de nouveaux points nommés n’est pas proposée dans cette interface.

Aucun balayage global n’est effectué : les snapshots des notes dormantes peuvent rester physiquement présents après expiration jusqu’à leur prochaine sauvegarde. Les éléments supprimés suivent le parcours de récupération distinct d’ADR 0017.

## Limites

Une fermeture brutale avant le délai de deux secondes peut perdre le brouillon en mémoire. Il n’existe aucune garantie d’enregistrement lors de `pagehide`, ni de récupération après effacement/perte du cache. La rétention n’est pas une sauvegarde. Aucun schéma serveur, protocole, format cryptographique ou primitive nouvelle n’est ajouté.

## Sources produit

- Obsidian Help, [File recovery](https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Plugins/File%20recovery.md)
- Forum Obsidian, [Stopped saving to iCloud without notification](https://forum.obsidian.md/t/stopped-saving-to-icloud-without-notification/27518)
