# ADR 0016 — Coffres desktop chiffrés sans serveur

- Statut : accepté
- Date : 2026-09-08
- Complète : ADR 0011 et ADR 0013

## Contexte

Le client partagé exigeait une connexion de compte avant de créer un coffre,
alors que le serveur est optionnel dans le périmètre local-first. La réplique
Markdown native existait sans être reliée au parcours produit.

## Décision

Le desktop propose explicitement un mode local sans compte. Son profil et ses
coffres sont partitionnés dans IndexedDB sous un espace local distinct des
comptes serveur. Ce mode n'est pas une authentification distante : aucune
requête de compte, d'enveloppe, de push, de pull ou de WebSocket n'est émise pour
un coffre local. Les gardes de route reconnaissent explicitement ce mode.

La création génère localement un identifiant opaque de coffre et utilise les
primitives et enveloppes chiffrées existantes. La phrase reste locale. Seuls le
ciphertext, l'enveloppe de clé et les identifiants de profil/coffre persistent ;
le redémarrage exige le déverrouillage. Une mutation locale conserve atomiquement
son contenu chiffré et son historique avec une identité/révision locale stable.
Elle n'accumule pas d'opérations réseau sans destination.

Le client Vue/IndexedDB reste canonique. Le desktop installe l'adaptateur de
réplique Markdown et expose un véritable sélecteur de dossier via une commande
Rust fermée. Les chemins sont validés par les types de domaine existants. Une
annulation ne doit ni écraser des données ni produire un succès de sélection.
Un dossier contenant des fichiers inconnus n'est pas écrasé implicitement :
l'utilisateur doit choisir un dossier vide ou importer explicitement ses notes.

La réplique suit les mutations locales durables et les changements distants
appliqués ; son erreur est visible et ne supprime jamais le cache chiffré. Les
fichiers Markdown restent en clair dans le dossier choisi après verrouillage,
comme décidé dans ADR 0013. Le navigateur ne montre aucun sélecteur OS.

Passer à un compte serveur ne publie pas implicitement un coffre local. Le
parcours initial conserve l'export/import explicite pour ce transfert. Une
future migration automatique nécessite son propre protocole idempotent et ses
tests ; elle n'est pas simulée en réutilisant une identité locale sur le serveur.

## Conséquences

Créer, déverrouiller, éditer et rouvrir un coffre desktop est possible sans
serveur. Les tests natifs utilisent un profil temporaire et un dossier jetable
pour vérifier ce parcours sans toucher aux données de l'utilisateur. Les
frontières E2EE, l'absence de filesystem générique dans Vue et les règles de
purge des secrets s'appliquent aussi au mode local.

## Alternatives rejetées

- Faux compte serveur ou jeton de connexion local : confusion d'autorisation.
- Envoyer silencieusement le coffre au prochain login : consentement et
  récupération après interruption non définis.
- Rouvrir un second store desktop canonique : divergence contraire à ADR 0011.
