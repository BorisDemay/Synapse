# ADR 0013 — Réplique dossier desktop et priorité serveur

- Statut : accepté
- Date : 2026-08-25
- Complète : ADR 0011 (client Vue canonique), ADR 0002 (sync par opérations),
  ADR 0016 (coffres desktop autonomes) et ADR 0018 (bases causales des brouillons)

## Contexte

Le client partagé (web et Tauri) persiste un cache chiffré IndexedDB et une
file d’opérations jusqu’à ack. Le desktop n’écrivait plus de Markdown sur
disque (ADR 0011). Un usage hors ligne exige pourtant un dossier local
récupérable, tout en évitant un second protocole de sync ni un fork silencieux
quand le serveur est joignable.

Une réplique lisible peut aussi être modifiée par un autre éditeur. La simple
découverte d’un changement ne démontre ni son propriétaire, ni son intention,
ni sa relation avec la note chiffrée. Le manifeste local actuel lie seulement
un dossier à un coffre et conserve un historique de chemins/empreintes : il ne
porte ni identité de note ni base de fusion. Les snapshots de récupération ne
sont pas une base de réconciliation durable. La décision ci-dessous définit la
frontière à respecter avant toute lecture, import ou surveillance de changements
externes ; elle n’implémente aucun de ces mécanismes.

## Décision

### Canonicalité et périmètre

Le client Vue/IndexedDB chiffré et la file chiffrée restent le chemin canonique
d’édition et de réplication (ADR 0011, ADR 0002). Le dossier Markdown est une
réplique desktop Tauri : ce n’est ni une seconde outbox, ni une source de vérité.
Le navigateur ne reçoit ni dossier natif, ni scan, ni watcher, ni API File
System Access. Aucun nouveau protocole, primitive crypto, capability filesystem
générique, dépendance ou rapprochement d’attachements n’est décidé ici.

Sur **desktop**, chaque mutation locale durable et chaque changement distant
appliqué est aussi écrit dans un **dossier Markdown choisi ou créé par défaut**,
via des commandes Tauri fermées (chemins validés par `VaultPath` /
`VaultAssetPath`, écriture atomique). Le réseau ne bloque jamais l’écriture
locale (IndexedDB + dossier). La réconciliation future se limite aux fichiers
`.md` déjà appartenant à cette réplique liée ; elle n’étend pas le contrat des
attachements existants.

Quand le serveur est joignable, **il a priorité** : un flush ou une reconnexion
**tire d’abord** depuis le curseur persistant, applique le flux distant, puis
pousse les opérations en attente. Une `base_revision` obsolète reste un conflit
opaque (base, local, distant) résolu seulement sur un client déverrouillé. Le
dossier est mis à jour après application du distant ; on n’écrase pas le serveur
avec du local aveugle.

### Identité, manifeste et base protégée

Une future version du manifeste local associera chaque chemin relatif validé
possédé à une identité opaque et stable de note. L’identité, et non le chemin,
est le lien note↔réplique ; le chemin est une projection modifiable. Le manifeste
reste strictement local au dossier lié et conserve seulement les données de
contrôle nécessaires à la réplique (propriétaire du coffre, association opaque,
chemin relatif validé et empreintes de détection). Il ne quitte jamais le client
et ne doit être ni journalisé ni exporté vers le serveur, les métriques ou les
traces.

Pour chaque association possédée, le cache chiffré doit retenir une baseline
réconciliable : l’identité de la note, la révision/identité chiffrée effectivement
miroirée et la variante chiffrée requise comme base. Cette baseline est écrite
avec l’état canonique par les primitives de persistance existantes ; ce n’est pas
un nouveau format cryptographique et elle ne peut pas être remplacée par une
empreinte Markdown ou par un snapshot de récupération. Une variante externe
candidate n’est comparée qu’en mémoire sur un client déverrouillé et n’est jamais
conservée comme cache plaintext persistant.
L’absence, l’incohérence ou l’expiration d’une baseline interdit toute fusion ou
écrasement automatique et impose une résolution explicite.

### Opt-in, classification et confirmation

La détection externe est désactivée par défaut et réservée au dossier lié au
coffre courant. L’opt-in autorise seulement la découverte et l’affichage de
candidats : une découverte, un événement de watcher ou un scan ne produit jamais
à lui seul une écriture plaintext, une mutation chiffrée, une opération serveur
ou une modification du manifeste.

Les résultats sont classés et conservés comme état de contrôle sans cache
plaintext persistant :

- un fichier **possédé** est un `.md` dont le chemin et l’identité correspondent
  à une entrée de manifeste valide ; une modification devient seulement un
  candidat confirmable, puis une mutation locale chiffrée durable ;
- un fichier **inconnu** ne devient jamais possédé par ressemblance de contenu,
  horodatage ou voisinage. Son adoption est une création explicitement confirmée
  avec une identité locale nouvelle ;
- un fichier **dangereux** (hors racine, lien symbolique/reparse point, chemin
  réservé ou invalide, collision de casse, taille/entrée invalide) est refusé
  fail-closed, sans lecture/import ni réécriture ;
- un cas **ambigu** (identité/base manquante, collision, concurrence, paire
  create/delete indécidable ou événement incomplet) reste non résolu et n’est
  jamais deviné.

Même après opt-in, aucune modification externe n’est acceptée silencieusement :
l’utilisateur confirme le candidat et la stratégie de conflit proposée. Une
fusion trois voies n’est permise qu’avec les trois variantes réelles sur le
client déverrouillé et seulement pour des hunks disjoints ; sinon base, locale et
distante/externe restent disponibles pour une résolution manuelle. Un brouillon
éditeur conserve sa base causale propre (ADR 0018) : un candidat externe ou un
pull ne la lui attribue pas et ne peut pas être fusionné implicitement avec lui.

### Durabilité, interruption et reprise

La découverte native, la persistance chiffrée/outbox et la finalisation du
manifeste n’ont pas de transaction commune. Toute future implémentation doit donc
persister un état de progression idempotent et reprendre à partir de celui-ci :
préserver d’abord la candidate ou ses références contrôlées avant qu’un save local
ou pull distant puisse la remplacer, créer au plus une mutation chiffrée portant
`operation_id` et `base_revision`, puis finaliser l’association et le journal du
manifeste après la persistance durable. Une opération ne quitte l’outbox qu’après
ack durable ; le mode autonome n’émet aucune opération réseau (ADR 0016).

Après crash, l’implémentation doit relire le journal/manifeste et l’état chiffré,
reprendre ou présenter un conflit sans créer une seconde opération ni perdre une
variante. Un événement du watcher reste un indice : les duplicats et les échos
d’écritures propres vérifiées sont coalescés, tandis qu’un overflow, une reprise
ou une divergence déclenche un rescan borné et validé, jamais une mutation
inférée.

### Renommages, copies et disparition

Un renommage ne préserve l’identité que si une association possédée unique relie
sans ambiguïté l’ancien chemin et le nouveau chemin validé. Un renommage de casse
seule suit un chemin explicite compatible Windows/Linux, avec contrôle de
collision avant et après l’opération ; il n’est pas assimilé à une suppression et
création. Une copie est un fichier inconnu qui nécessite adoption explicite. Une
paire créer/supprimer, des contenus égaux ou des horodatages voisins ne prouvent
jamais un renommage et exigent une résolution explicite.

L’absence observée une seule fois est transitoire : elle peut provenir d’un
remplacement atomique, d’une écriture par étapes, d’une permission retirée ou
d’un volume indisponible. La réconciliation doit attendre la stabilisation,
revalider la racine et signaler les erreurs sans toucher au cache canonique. Une
suppression externe ne produit un tombstone chiffré qu’après confirmation
explicite, capture de récupération pré-suppression et contrôle des variantes
concurrentes. Permission refusée, dossier inaccessible et volume absent restent
des erreurs réessayables et visibles, pas des suppressions.

### Cycle de vie et confidentialité

Le watcher éventuel est attaché uniquement au coffre déverrouillé, au compte/profil
courant et au dossier lié. Il s’arrête et tout travail non validé en mémoire est
abandonné au verrouillage, logout, changement de compte, de coffre ou de dossier.
Le prochain déverrouillage repart d’un rescan ; il ne réutilise pas d’événements
stales ni ne persiste de nouveau cache plaintext. Verrouiller ne supprime pas la
réplique existante. Les erreurs et l’interface ne divulguent jamais contenu,
chemin, tag, credential ou clé vers le serveur, les logs, métriques ou traces.

### Gates requis avant toute implémentation

Les futures tranches restent bloquées par les preuves RED→GREEN suivantes :

1. **R05.2, découverte seule :** tests d’un `.md` possédé modifié, d’un inconnu,
   d’un lien/échappement, d’une collision de casse et d’un scan/read race ; aucun
   état canonique, fichier ou manifeste ne change.
2. **R05.3, import confirmé :** tests de confirmation, persistance chiffrée et
   outbox idempotentes, échec de stockage, conflit avec brouillon/pull, redémarrage
   hors ligne puis reconnexion ; le mode autonome demeure sans réseau.
3. **R05.4, rename/delete :** tests de rename unique, casse seule, copie,
   paire ambiguë, suppression confirmée, disparition transitoire et interruption
   entre candidate, persistance et manifeste ; aucune variante ni opération ne
   disparaît ou ne se duplique.
4. **R05.5, détection/UX :** tests de coalescence, écho propre, overflow/rescan,
   lock/logout/switch, focus et confirmation clavier, sans cache plaintext ou
   fuite dans les diagnostics.

Chaque gate doit fournir une preuve native sur Windows et Linux : sémantique de
casse et renommage, liens/reparse points, écriture atomique, permission refusée,
volume indisponible, arrêt/reprise et dossier contenant des fichiers inconnus.
Les tests ne doivent employer que des fixtures synthétiques et vérifier que ni
plaintext ni chemin ne sortent des frontières clientes.

Le dialogue « créer / choisir un dossier de coffre local » n’apparaît que sur le
client lourd Tauri, à la **première création** de coffre. Les paramètres desktop
peuvent ensuite afficher le chemin et le changer.

## Conséquences

Le desktop expose du Markdown en clair dans le dossier choisi. Verrouiller
l’app ne l’efface pas. Le serveur, PostgreSQL, les blobs, logs et métriques ne
reçoivent toujours que des ciphertexts. Les modifications externes gagnent une
voie future explicite mais plus lente qu’un import silencieux ; cette contrainte
évite la perte d’une variante, l’adoption d’un fichier tiers et la confusion
entre état disque et état canonique.

## Alternatives rejetées

- Rouvrir le coffre dossier comme source de vérité desktop : casse ADR 0011 et
  duplique l’éditeur / la sync.
- Déduire une identité de note par contenu, hash plaintext, date ou paire
  créer/supprimer : copies, horloges et écritures atomiques rendent cette
  inférence destructrice.
- Accepter automatiquement un événement de watcher ou traiter une absence comme
  une suppression : un signal natif n’est pas une mutation durable confirmée.
- File System Access dans le navigateur : hors plan, support inégal, UI
  mensongère si on l’annonce comme un dossier toujours disponible.
- Last-writer-wins vers le serveur : interdit par ADR 0002.