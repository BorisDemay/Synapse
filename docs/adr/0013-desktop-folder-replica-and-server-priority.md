# ADR 0013 — Réplique dossier desktop et priorité serveur

- Statut : accepté
- Date : 2026-08-25
- Complète : ADR 0011 (client Vue canonique), ADR 0002 (sync par opérations)

## Contexte

Le client partagé (web et Tauri) persiste un cache chiffré IndexedDB et une
file d’opérations jusqu’à ack. Le desktop n’écrivait plus de Markdown sur
disque (ADR 0011). Un usage hors ligne exige pourtant un dossier local
récupérable, tout en évitant un second protocole de sync ni un fork silencieux
quand le serveur est joignable.

## Décision

Le client Vue/IndexedDB et la file chiffrée restent le chemin d’édition et de
réplication (ADR 0011, ADR 0002). Aucun nouveau protocole ni primitive crypto.

Sur **desktop**, chaque mutation déchiffrée est aussi écrite dans un **dossier
Markdown choisi ou créé par défaut**, via des commandes Tauri fermées
(chemins validés par `VaultPath` / `VaultAssetPath`, écriture atomique). Le
dossier est un filet hors-ligne et une interopérabilité fichiers ; ce n’est
pas une seconde outbox. Le réseau ne bloque jamais l’écriture locale
(IndexedDB + dossier).

Quand le serveur est joignable, **il a priorité** : un flush ou une
reconnexion **tire d’abord** depuis le curseur persistant, applique le flux
distant, puis pousse les opérations en attente. Une `base_revision` obsolète
reste un conflit opaque (base, local, distant) résolu seulement sur un client
déverrouillé. Le dossier est mis à jour après application du distant ; on
n’écrase pas le serveur avec du local aveugle.

Si push/pull échoue, les opérations restent en file jusqu’à ack. Un timer
d’appareil réessaie toutes les **X secondes** (défaut 10, borné 3–60). X n’est
pas du contenu de coffre. Pas de boucle serrée. Un conflit arrête le retry
jusqu’à résolution manuelle.

Le **navigateur** n’a pas de dossier natif : il conserve le cache IndexedDB
chiffré. L’UI web ne demande jamais de dossier OS, n’utilise pas l’API File
System Access, et n’expose pas ce setup dans l’onboarding ni les paramètres
web. Le dialogue « créer / choisir un dossier de coffre local » n’apparaît
que sur le client lourd Tauri, à la **première création** de coffre. Les
paramètres desktop peuvent ensuite afficher le chemin et le changer.

## Conséquences

Le desktop expose du Markdown en clair dans le dossier choisi (comme l’ancien
modèle fichier). Verrouiller l’app ne l’efface pas. Le serveur, PostgreSQL,
les blobs, logs et métriques ne reçoivent toujours que des ciphertexts.

## Alternatives rejetées

- Rouvrir le coffre dossier comme source de vérité desktop : casse ADR 0011 et
  duplique l’éditeur / la sync.
- File System Access dans le navigateur : hors plan, support inégal, UI
  mensongère si on l’annonce comme un dossier toujours disponible.
- Last-writer-wins vers le serveur : interdit par ADR 0002.
