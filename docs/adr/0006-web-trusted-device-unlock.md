# ADR 0006 : déverrouillage web par appareil de confiance

- Statut : accepté
- Date : 2026-08-16
- Remplace : WebAuthn PRF (2026-08-11)

## Contexte

La clé de coffre est volontairement conservée uniquement en mémoire après un
déverrouillage par phrase. Cela protège l’E2EE, mais impose de ressaisir la
phrase après un rechargement du navigateur. WebAuthn PRF évitait de persister
une clé utilisable, mais les gestionnaires de mots de passe (Bitwarden, etc.)
interceptent la cérémonie, n’exposent souvent pas PRF, et demandent d’enregistrer
une clé d’accès.

## Décision

Le client web peut enregistrer un appareil de confiance **dans ce navigateur**,
uniquement après un déverrouillage réussi par phrase.

- Une clé AES-GCM 256 bits **non extractible** est créée par Web Crypto et
  stockée dans IndexedDB. Elle ne quitte pas le module cryptographique du
  navigateur.
- La clé de coffre est chiffrée avec cette clé (AES-GCM, AAD lié au coffre) ;
  IndexedDB conserve l’IV, le ciphertext et la `CryptoKey` non extractible.
- La phrase, la clé de coffre en clair et une clé de wrapping exportable ne
  sont jamais persistées. Rien n’est envoyé au serveur.
- Le rechargement peut déverrouiller sans geste WebAuthn. Effacer les données
  du site, ou « Oublier cet appareil », oblige à ressaisir la phrase.

C’est une commodité liée au profil navigateur, pas une récupération. Quiconque
a accès à ce profil (ou un XSS) peut déverrouiller le coffre. La phrase reste
la seule méthode de secours.

## Conséquences

Les passkeys et Bitwarden ne sont plus sollicités. La déconnexion verrouille
la clé en mémoire mais conserve l’enveloppe locale jusqu’à révocation
explicite. Ce n’est pas un coffre-fort : un poste partagé ne doit pas cocher
« Rester déverrouillé sur ce navigateur ».
