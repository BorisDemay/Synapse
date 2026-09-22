# Faux conflits entre autosauvegardes successives

## Reproduction et périmètre

Un seul éditeur web suffit : début du brouillon suivant à R, ack de sa propre
sauvegarde précédente à R+1, puis déclenchement du debounce. Le serveur refuse
correctement la base R ; c’est le client qui a perdu la filiation locale.
Le test `tests/e2e/sequential-autosave.spec.ts` reproduit ce cas avec un vrai
serveur et PostgreSQL, une réponse d’ack retenue, des timers d’éditeur contrôlés
et exclusivement des données synthétiques. Avant correction : `conflict` au
lieu de `synced`.

## Correction

- Capturer la base du brouillon et la version locale dont il continue l’édition.
- Suivre uniquement les acks de cette filiation, pas toute évolution de head.
- Réévaluer cette base avant la première tentative si l’ack a devancé la
  persistance IndexedDB ; conserver le ciphertext exact après toute tentative.
- Invalider la provenance au verrouillage/changement de compte ou coffre.
- Préserver le chemin de conflit existant pour les modifications indépendantes.

Décision : ADR 0018. Pas de modification du serveur, de nouvelle primitive
cryptographique ni de migration de stockage. Aucun contenu utilisateur réel
n’est utilisé dans les fixtures ou journaux de validation.

## Vérifications

- Store : brouillon suivant après ack, frappe continue pendant la sauvegarde,
  ack pendant la mise en file, cache rouvert avec une opération en attente,
  mutation indépendante de l’assistant, tête distante, jeton d’une autre note
  ou d’une ancienne session.
- File : révision causale tardive appliquée avant le premier envoi seulement ;
  rejeu tenté conservé octet pour octet.
- Vue : tests de brouillons, base capturée et garde de persistance existants.
- E2E : nouvelle reproduction, conflits entre deux clients, ack perdu,
  redémarrage hors ligne et récupération chiffrée existants.

Commandes : `pnpm test`, `pnpm typecheck`, `pnpm lint`, `just e2e-recovery`.
Les conflits déjà ouverts restent à résoudre explicitement ; aucune version
n’est supprimée automatiquement par ce correctif.

## Résultats observés

- `pnpm test` : 670 tests réussis, dont les nouveaux cas de filiation locale,
  mutation indépendante et autre onglet partageant IndexedDB.
- `pnpm typecheck` et `pnpm lint` : réussis.
- `pnpm test:ux` : 14 vérifications navigateur réussies.
- `SYNAPSE_E2E_UI_PORT=15183 SYNAPSE_E2E_API_PORT=13010 just e2e-recovery` :
  11 parcours réussis contre PostgreSQL et le serveur réels. Ports isolés choisis
  car le port de test habituel était occupé ; aucun service existant arrêté.
- Smoke Tauri natif Linux sous `dbus-run-session`/`xvfb-run` : création locale,
  annulation du sélecteur, redémarrage, hors ligne/reconnexion, conflit,
  historique et pièces jointes réussis. Pas de test natif Windows ici.
