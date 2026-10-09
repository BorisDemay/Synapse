# Politique de sécurité

Synapse manipule des coffres Markdown chiffrés de bout en bout. La sécurité est
une exigence de conception : merci de signaler toute faiblesse de manière
responsable.

## Versions prises en charge

Seule la dernière release du canal `stable` est prise en charge. Les versions
antérieures ne reçoivent pas de correctif.

## Signaler une vulnérabilité

**N’ouvrez pas d’issue publique** pour un problème de sécurité.

1. Utilisez le signalement privé de vulnérabilité GitHub : onglet **Security** du
   dépôt → **Report a vulnerability**. Le rapport reste privé entre vous et le
   mainteneur.
2. Sinon, contactez le mainteneur par un canal privé (message direct GitHub) en
   décrivant le problème sans divulguer d’exploit public.

Merci d’inclure :

- une description de l’impact et du scénario d’attaque ;
- les versions, plateformes et configurations concernées ;
- une reproduction minimale, si possible dans un environnement de test jetable ;
- toute proposition de correction.

## Périmètre

Sont particulièrement attendus :

- toute fuite de contenu de coffre en clair (note, titre, chemin, tag, lien,
  extrait, pièce jointe) vers le serveur, PostgreSQL, le stockage de blobs, les
  journaux, les métriques ou les traces ;
- la présence de la clé de coffre, de la phrase de déchiffrement ou d’un secret
  de session dans `localStorage`, une URL, un journal, une erreur, la
  télémétrie ou une API serveur ;
- une faille de contrôle d’accès entre comptes, coffres ou sessions ;
- une injection (SQL, XSS, traversée de chemin), un contournement CSRF/CORS, une
  attaque par rejeu d’opération ou par force brute ;
- une altération des artefacts de release, des signatures ou du canal de mise à
  jour.

## Hors périmètre

- Compromission du poste client ou du navigateur d’un utilisateur légitime.
- Attaques physiques, ou ingénierie sociale.
- Déni de service non borné sans impact d’intégrité ou de confidentialité.
- Absence de fonctionnalité (par exemple récupération de clé perdue) documentée
  comme limite assumée dans le [README](README.md) et le
  [modèle de menace](docs/security/threat-model.md).

## Divulgation

Le mainteneur accuse réception, évalue et corrige, puis coordonne une divulgation
publique une fois un correctif disponible. Merci de laisser un délai raisonnable
avant toute publication.

## Bonnes pratiques d’exploitation

Un déploiement sûr suppose TLS, des cookies `Secure`, la désinscription publique
désactivée, des sauvegardes chiffrées testées et une instance non exposée sans
proxy inverse. Voir [docs/operations/install.md](docs/operations/install.md) et
[la checklist de préversion](docs/testing/release-checklist.md).
