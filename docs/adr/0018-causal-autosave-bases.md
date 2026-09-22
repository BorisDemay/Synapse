# ADR 0018 — Base causale des autosauvegardes côté client

- Statut : accepté
- Date : 2026-09-22
- Complète : ADR 0002 et ADR 0011
- Plan : `docs/plans/2026-09-22-autosave-conflicts.md`

## Contexte

Un brouillon peut commencer à la révision R, avant l’ack de sa sauvegarde locale
précédente, puis être chiffré ou mis en file après cet ack (R+1). Le rebasing des
opérations déjà en file ne couvre pas cette fenêtre : la nouvelle opération
porte encore R et entre en conflit avec sa propre sauvegarde précédente.

Utiliser systématiquement la dernière révision du coffre serait dangereux :
elle peut provenir d’un autre appareil ou d’une modification indépendante de
l’assistant que le brouillon n’intègre pas.

## Décision

L’éditeur capture un jeton de base conservé uniquement en mémoire, lié au compte,
au coffre, à la session déverrouillée et à la note. Le store rattache ce jeton à
la version locale effectivement affichée et aux sauvegardes produites par ce
même brouillon. Seuls les acks de ces sauvegardes peuvent faire avancer sa base.
Une version remplacée par un pull distant ne reçoit pas implicitement cette
provenance. La réouverture peut reconnaître une version locale encore en file
par l’identité de son ciphertext dans le cache chiffré.

Avant la première tentative réseau, `prepareOperation` peut consulter cette
base causale en complément du rebasing déjà prévu pour les opérations en file.
Si elle a avancé pendant la persistance locale, l’opération est rechiffrée avec
l’AAD correspondant, via les primitives existantes. Une opération déjà tentée
reste strictement identique pour permettre le rejeu idempotent après perte d’ack.

Les jetons et associations sont privés au client et purgés au verrouillage ou
au changement de session. Ils ne sont ni sérialisés dans la file ni transmis au
serveur. Le protocole, les enveloppes cryptographiques et le schéma IndexedDB
restent inchangés. Aucune déduction de causalité n’est faite depuis un préfixe
Markdown, une ressemblance entre textes ou la seule dernière révision serveur.

## Conséquences

La saisie peut continuer pendant l’enregistrement et la synchronisation sans
attendre le réseau. Les brouillons réellement obsolètes restent soumis au
contrôle de révision. Les conflits déjà enregistrés ne sont pas effacés ni
résolus rétroactivement : leurs versions doivent rester disponibles.
L’absence de provenance ne justifie jamais d’ignorer un conflit serveur.
