# ADR 0011 — Le client web chiffré est canonique sur toutes les plateformes

- Statut : accepté
- Date : 2026-08-20

## Contexte

Deux implémentations Vue et deux modèles de stockage ont fait diverger le web
et Tauri. Cette divergence rendait impossible une parité fonctionnelle fiable
et laissait un ancien chemin Tauri écrire du Markdown en clair dans son profil.

## Décision

Tauri embarque désormais le même client Vue que le navigateur : mêmes routes,
stores, cache IndexedDB chiffré, outbox, chiffrement, conflits, historique,
appareil de confiance et export. Le WebView ne reçoit ni filesystem ni HTTP
générique. Un pont Rust fermé traduit seulement les opérations Synapse v1
typées. Le cookie de session reste en mémoire native ; si l’utilisateur coche
« Se souvenir de cet appareil », le jeton opaque peut être recopié dans le
répertoire de données de l’application (ADR 0014), jamais dans Vue.

Les anciens coffres de dossier ne sont plus ouverts par le parcours produit et
ne sont jamais supprimés implicitement. Leur migration exige une étape
explicite et une sauvegarde exportable avant toute suppression.

## Conséquences

Le dossier Markdown n'est plus la source de vérité du desktop. Les données
persistées dans le profil Tauri sont les mêmes ciphertexts que dans IndexedDB
web ; les clés restent seulement en mémoire et sont purgées au verrouillage.

## Alternatives rejetées

- Maintenir deux stores et deux interfaces : la parité ne peut pas être
  démontrée durablement.
- Exposer un accès filesystem ou HTTP générique à Vue : surface de confiance
  incompatible avec le modèle de menace.
