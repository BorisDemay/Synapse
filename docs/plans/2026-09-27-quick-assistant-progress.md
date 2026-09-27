# Prompt rapide à l’assistant — contexte actif et progression

## Portée

Le raccourci prompt rapide doit exécuter un travail hors du panneau Assistant,
avec progression persistante dans les notifications, sans exposer le prompt, un
titre ou un chemin. L’interface annonce avant l’envoi que la note active en clair
sera envoyée au fournisseur d’IA configuré ; la soumission constitue le
consentement. Sans note active, le prompt est permis sans contexte de coffre.

## Comportement

- Chaque soumission crée un fil neuf et transmet uniquement la note active
  persistée comme note liée ; les liens et messages d’autres fils sont exclus.
- Une note active sale ou avec sauvegarde en cours doit être sauvegardée de façon
  durable avant création du fil, liaison ou appel fournisseur. Une erreur laisse
  le dialogue et le brouillon disponibles, affiche une erreur générique durable
  et n’émet aucun appel IA.
- Le fil neuf valide la note par son identifiant contre le coffre déverrouillé
  courant et persiste le snapshot chiffré avec les mécanismes existants.
- Un toast de progression indéterminé commence avant la préparation asynchrone,
  demeure visible hors panneau Assistant, puis est remplacé par un résultat ou
  une erreur générique. Une réponse texte seule est annoncée comme réponse
  disponible, jamais comme une note écrite.
- Une mutation de compte, coffre ou verrouillage purge la progression et interdit
  aux continuations obsolètes d’afficher un résultat ou de réutiliser la note.
- L’échec de persistance initiale d’un message remet toujours `busy` à false.

## Validation

Les tests couvrent le payload fournisseur et l’exclusion de liens antérieurs,
la sauvegarde préalable / son échec sans envoi, l’avis de consentement, le toast
pendant un envoi différé, les résultats informatifs et erreurs, le changement de
session, l’absence de note active et le reset de `busy`. Les commandes ciblées,
suites web/UI, typecheck, lint et navigateur sont consignés dans le rapport de
travail. Aucun protocole, dépendance ni primitive cryptographique n’est ajouté.
