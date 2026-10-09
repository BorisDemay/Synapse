# ADR 0007 — Éditeur Markdown à rendu instantané

- Statut : accepté
- Date : 2026-08-13

## Contexte

Le premier éditeur reposait sur CodeMirror 6 et une couche de décorations
spécifique à Synapse. Chaque construction Markdown devait être reconnue,
masquée et stylée séparément. Cette approche ne couvrait donc qu'un
sous-ensemble de la syntaxe et multipliait les comportements particuliers à
tester et maintenir, notamment pour les listes imbriquées.

Synapse a besoin d'une expérience proche du « live preview » d'Obsidian tout en
conservant le Markdown comme format canonique local. La solution doit couvrir
CommonMark et GFM sans service distant et ne doit pas persister le contenu en
clair dans le stockage du navigateur.

## Décision

`MarkdownEditor.vue` utilise Vditor 3.11.3 en mode IR (« instant rendering »).
Le composant Vue échange exclusivement des chaînes Markdown avec le reste de
l'application et conserve l'autosauvegarde différée existante. La
prévisualisation en lecture seule basée sur markdown-it et DOMPurify reste une
frontière séparée.

Les contraintes d'intégration suivantes sont obligatoires :

- `cache.enable` vaut toujours `false` afin qu'aucun contenu de note ne soit
  écrit par Vditor dans `localStorage` ;
- le répertoire `vditor/dist` est copié dans les builds web et desktop et le
  `cdn` Vditor pointe vers cette ressource de même origine ;
- les commandes d'upload et d'enregistrement sont absentes de la barre
  d'outils ; l'ouverture automatique des liens, la prévisualisation d'image et
  le rendu des médias sont désactivés ;
- la CSP web interdit les images réseau, les médias, les frames et les objets
  afin qu'une ressource Markdown ne déclenche aucune requête silencieuse ;
- l'assainissement Markdown reste activé ;
- la valeur Markdown venant du coffre reste la source de vérité lors d'un
  changement de note.

## Conséquences

La couverture de syntaxe, les raccourcis et les règles de listes sont fournis
par une bibliothèque maintenue plutôt que par une succession de décorations
locales. Les ressources Vditor augmentent la taille du build, mais permettent
un démarrage hors ligne et évitent toute dépendance à un CDN.

Le mode IR peut normaliser certaines écritures Markdown lors d'une édition. Le
format persistant reste du Markdown, jamais du HTML, mais Synapse ne garantit
pas la conservation octet pour octet d'une syntaxe équivalente après
modification. Les tests d'interface couvrent les constructions représentatives
et l'autosauvegarde couvre la valeur Markdown émise.

## Alternatives rejetées

- Étendre la couche CodeMirror interne : sa couverture resterait à construire
  et à maintenir syntaxe par syntaxe.
- `codemirror-live-markdown` : le paquet est encore en version alpha et repose
  lui aussi sur des décorations CodeMirror, avec une couverture plus limitée
  qu'un moteur Markdown complet.
- Un éditeur qui persiste du HTML comme format principal : il contredirait le
  rôle canonique des fichiers Markdown locaux.
