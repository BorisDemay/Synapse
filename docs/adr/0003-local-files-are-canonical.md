# ADR 0003 — Les fichiers locaux sont canoniques

- Statut : accepté
- Date : 2026-08-08

## Contexte

Synapse doit rester utilisable hors ligne et interopérable avec des outils qui
lisent directement un coffre Markdown. Une synchronisation distante ne doit ni
bloquer une écriture ni remplacer silencieusement un fichier local.

## Décision

Dans le client desktop, le dossier local Markdown est l’unité canonique du
coffre. Le client effectue des écritures atomiques dans ce dossier, surveille les
modifications externes et reconstruit seulement l’index local affecté. SQLite
sert d’index, d’historique et de file d’opérations persistante ; il n’est pas la
source de vérité du contenu Markdown.

Les chemins sont relatifs au coffre, validés avant toute résolution et refusent
notamment les chemins absolus, préfixes Windows, segments parent et NUL. Les
écritures ne sortent jamais de la racine du coffre, y compris via un lien
symbolique.

Une mutation locale devenue synchronisable est chiffrée côté client et ajoutée à
la file persistante après succès de l’écriture disque et de la mise à jour
transactionnelle de l’index. Une erreur réseau conserve l’opération en attente.

## Conséquences

Les fichiers restent lisibles, exportables et modifiables sans Synapse. Une
modification externe peut créer une révision locale et un conflit ultérieur,
mais n’est jamais écrasée sans intervention explicite. L’UI ne fait aucun accès
direct non allowlisté au système de fichiers.

## Alternatives rejetées

- Base distante comme source de vérité : incompatible avec le local-first.
- Base SQLite comme unique source de vérité : réduit l’interopérabilité Markdown.
- Écritures directes non atomiques : exposent des fichiers partiellement écrits.
