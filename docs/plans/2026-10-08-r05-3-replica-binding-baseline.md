# R05.3 — Association opaque réplique↔note et baseline miroir

## Statut et bornes

Plan d’exécution versionné le 8 octobre 2026. Il complète
[ADR 0013](../adr/0013-desktop-folder-replica-and-server-priority.md), sans
modifier les plans historiques. R05.2 reste découverte/classification seule ;
ce plan n’implémente ni l’import, ni rename/delete, ni watcher/UX complet.

La source de vérité demeure le cache Vue/IndexedDB chiffré et son outbox (ADR
0011, ADR 0002). Le dossier est une projection Markdown desktop. Il est hors
périmètre d’ajouter une primitive, un format crypto, un protocole, une mutation
serveur, une nouvelle outbox, une migration serveur ou une permission Tauri.
Il est interdit de déduire un `note_id` depuis un chemin, un hash, du Markdown,
une date, un voisinage, une copie ou un snapshot de récupération. Aucune
persistance plaintext de candidate, baseline ou variante n’est permise.

## Dépendances et ordre obligatoire

1. R05.2 est vert : elle classe un candidat sans toucher état canonique,
   manifeste ou fichiers.
2. **R05.3b — installer binding + baseline** est intégrée et validée avant que
   tout code d’import puisse être écrit ou activé.
3. **R05.3c — import confirmé** dépend de R05.3b et reste désactivé sans ses
   preuves de passage. R05.4 (rename/delete) et R05.5 (watcher/UX) dépendent
   ensuite de R05.3c, sans la contourner.

Chaque tranche suit TDD vertical RED→GREEN : une preuve de comportement échoue
d’abord pour l’absence exacte, l’implémentation minimale la rend verte, puis la
suite touchée est exécutée. Les fixtures sont synthétiques et les assertions de
diagnostic vérifient l’absence de Markdown, chemin, clé et secret hors des
frontières clientes.

## R05.3b — Installer l’association et la baseline

### Données et propriétaires

- Faire évoluer de façon rétrocompatible le manifeste local vers une version qui
  conserve `owner`, chemin relatif validé, empreintes de détection et un
  `binding_id` local aléatoire. Ni `note_id`, ni révision, ciphertext, nonce,
  contenu Markdown ou clé ne sont écrits dans ce manifeste.
- Ajouter dans le cache chiffré existant une baseline partitionnée par
  profil/compte quand applicable/coffre/dossier : `binding_id`, `note_id`,
  révision et identité du ciphertext réellement miroirés, plus la variante
  chiffrée de base ou sa référence durable. Réutiliser enveloppe, chiffrement,
  AAD et mécanisme de persistance existants ; ne pas en concevoir un nouveau.
- Définir l’état chiffré `installing`/`ready` et son identifiant de reprise. Le
  manifest est le propriétaire de la projection chemin→binding ; le cache
  chiffré est le propriétaire binding→note/baseline.

### Installation, migration et interruption

- L’adaptateur d’export transporte explicitement `note_id`, chemin, révision et
  variante canonique persistée. Il ne cherche aucune identité dans le dossier.
  Il écrit d’abord un journal chiffré, projette atomiquement les octets
  canoniques, puis finalise manifest et baseline après vérification.
- À chaque frontière filesystem/IndexedDB, reprendre ou compenser depuis le
  journal chiffré. Une reprise est idempotente : aucun second binding, aucune
  mutation, opération ou base ne peut apparaître. Une écriture disque ou stockage
  échouée reste visible et non importable.
- Lire les manifests v1 sans les rendre propriétaires : leurs entrées sont
  `legacy/unbound`. Les réassocier seulement via une réinstallation canonique
  recevant explicitement l’identité depuis le cache ; les hashes existants sont
  des gardes de divergence, jamais une preuve d’identité.
- Au lock/logout/switch profil-compte-coffre-dossier, arrêter watcher et travaux
  en mémoire ; purger clés et contexte actif. Au retour, rescan et revalider la
  partition complète avant toute proposition. Un changement de contexte ne peut
  jamais reprendre un binding d’une autre partition.

### Preuves de passage RED→GREEN

1. L’export canonique initialise un binding aléatoire et une baseline chiffrée
   `ready` correspondant à la variante réellement écrite.
2. Un manifest v1 reste lisible mais son fichier est non importable jusqu’à la
   réinstallation explicitement identifiée ; contenu/hash/chemin égaux ne le
   rendent pas lié.
3. Crash et erreurs de stockage avant/après chaque frontière reprennent ou
   signalent une divergence sans dupliquer binding, baseline, mutation ou outbox.
4. Lock/logout et switches invalident le contexte ; la reprise avec un autre
   compte/coffre/dossier échoue fermée.
5. Tests natifs Windows et Linux couvrent lien/reparse point, casse/collision,
   écriture atomique, permissions et symlink ; les logs ne révèlent ni chemin
   ni fixture Markdown.

## R05.3c — Import confirmé seulement

### Préconditions et transition

L’import ne peut être proposé que sur desktop déverrouillé, dans le contexte
actif, pour un candidat R05.2 possédé avec manifest `ready`, baseline déchiffrée
cohérente, racine revalidée et lecture stable. Il exige confirmation explicite.
Un candidat inconnu, dangereux, ambigu, legacy/non lié, sans baseline, avec
baseline incohérente/expirée, ou changé depuis contrôle est refusé sans écriture.

Après confirmation, charger les trois variantes **réelles** : baseline chiffrée,
état canonique local et candidat externe en mémoire. Un brouillon conserve sa
base causale ADR 0018 et un pull gagne avant tout push : appliquer pull, puis
revalider les variantes et `base_revision`. Fusionner seulement des hunks
disjoints sur client déverrouillé ; sinon conserver base, locale et
distante/externe pour résolution manuelle. Le serveur ne reçoit que la mutation
chiffrée existante avec `operation_id` unique et `base_revision`; aucun contenu
clair ne quitte le client.

La persistance canonique/outbox et la finalisation du manifeste n’ont pas de
transaction globale : employer l’état de progression de R05.3b. Après crash,
rejeu ou ack perdu, retrouver la même opération tentée et ne jamais en créer une
seconde. Le mode autonome écrit seulement l’état local et le miroir ; il émet
zéro requête, push, pull ou WebSocket.

### Preuves de passage RED→GREEN

1. Une confirmation avec association prête persiste la mutation chiffrée et une
   unique opération avec `operation_id`/`base_revision`; annulation ou absence de
   précondition ne touche rien.
2. Échec IndexedDB/filesystem, crash aux frontières, rejeu et ack perdu
   préservent chaque variante et restent idempotents.
3. Brouillon actif, pull concurrent et base obsolète conservent les variantes;
   aucune fusion implicite ni écrasement serveur n’a lieu. Le pull précède push.
4. Mode autonome : l’import confirmé reste local et aucune primitive réseau
   n’est appelée.
5. Windows/Linux : symlink/reparse, collision de casse, permission, volume
   indisponible et changement pendant lecture refusent l’import sans fuite dans
   les logs.

## Critère d’autorisation de la tranche suivante

R05.3c ne commence qu’après revue de R05.3b et preuves vertes de chaque point
ci-dessus. R05.4/R05.5 ne commencent qu’après les preuves R05.3c, y compris les
essais d’interruption, de conflit brouillon/pull, de priorité pull→push et de
zéro réseau autonome. Toute absence de base réelle, de binding explicite ou de
variante chiffrée bloque fail-closed ; elle ne se résout jamais par une
heuristique ou un snapshot de récupération.