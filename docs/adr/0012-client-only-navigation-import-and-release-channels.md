# ADR 0012 — Fonctions de navigation locales, import opaque et canaux de release

- Statut : accepté
- Date : 2026-08-24

## Contexte

Les modèles, propriétés, recherches, graphe, import de
coffres Markdown et aperçu de pièces jointes ajoutent des chemins, relations et
contenus qui ne doivent jamais devenir des métadonnées du serveur E2EE.
L'application doit aussi distribuer des artefacts Windows et Linux vérifiables
sans introduire de service tiers obligatoire.

## Décision

- Les préférences par coffre (modèles, épingles et recherches
  sauvegardées) sont chiffrées avec la clé de coffre avant IndexedDB. Elles ne
  sont ni synchronisées ni journalisées.
- Les modèles restent des notes Markdown ordinaires. Seule leur insertion
  remplace `{{date}}`, `{{time}}` et `{{title}}` localement.
- L'import examine un dossier choisi explicitement ou un ZIP avant toute écriture.
  Il refuse traversal, configuration `.obsidian`, types exécutables, plus de
  10 000 entrées et plus de 250 MiB décompressés. Les pièces jointes importées
  sont placées sous `attachments/`; les liens Markdown relatifs concernés sont
  réécrits vers ce chemin portable avant chiffrement.
- Propriétés, recherche, outline, graphe et diffs sont calculés dans le client
  déverrouillé. Le graphe n'est ni persisté ni envoyé au serveur.
- Les releases exposent deux canaux, `stable` et `beta`, avec artefacts,
  checksums, SBOM et signatures. L'auto-update est reporté : la mise à jour est
  manuelle et vérifiable.

## Conséquences

L'import reste compatible avec le Markdown et les médias standards, mais les
liens vers des pièces jointes sont normalisés sous `attachments/` afin de
respecter ADR 0010. Les préférences sont spécifiques à l'appareil ; les modèles
eux-mêmes se synchronisent en tant que notes chiffrées. La dépendance `fflate`
(MIT) sert uniquement à lire les archives ZIP localement.
