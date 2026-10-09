# ADR 0014 : session de compte mémorisée sur un appareil

- Statut : accepté
- Date : 2026-08-25
- Complète : ADR 0006 (déverrouillage coffre) et ADR 0011 (cookie desktop)

## Contexte

La connexion compte utilise un cookie de session opaque de 8 heures. L’utilisateur
peut vouloir sauter le mot de passe de compte aux ouvertures suivantes sans
pour autant déverrouiller le coffre sans phrase.

L’appareil de confiance web (ADR 0006) enveloppe la clé de coffre dans IndexedDB.
Ce n’est pas un mécanisme de session serveur. Le réutiliser à l’écran de
connexion mélangerait les secrets.

## Décision

« Se souvenir de cet appareil » sur le formulaire de connexion est une option
de **session de compte** :

- Le client envoie `remember_device: true` à `POST /auth/login`.
- Le serveur émet le même cookie opaque `HttpOnly; Secure; SameSite=Strict`,
  avec une durée de 30 jours au lieu de 8 heures. Seul le hash du jeton est
  stocké en base.
- Le client web s’appuie sur ce cookie ; `restoreSession()` saute le formulaire
  si le cookie est encore valide. La phrase du coffre reste exigée, sauf si
  l’enveloppe ADR 0006 existe déjà.
- Le desktop persiste le jeton opaque dans un fichier du répertoire de données
  de l’application, lu uniquement par Rust, jamais exposé à Vue ni à
  `localStorage`. Déconnexion, révocation (Paramètres → sessions) ou fichier
  illisible effacent cette copie.
- Précision de sécurité du 2026-09-08 : la copie native associe explicitement le
  jeton à l’origine validée de l’instance (schéma, hôte et port). Un changement
  d’origine ne doit jamais réutiliser ce jeton. Les anciens fichiers sans
  origine ne sont pas migrés par supposition : ils imposent une nouvelle
  connexion. La reprise de session reste possible sur la même origine.
- La clé de coffre, la phrase et le mot de passe ne sont jamais persistés par
  cette option.

## Conséquences

Un poste partagé ne doit pas cocher l’option. Révoquer la session depuis les
paramètres, ou « Se déconnecter », retire l’accès compte. Oublier l’appareil
de confiance (ADR 0006) n’invalide pas la session serveur, et inversement.
