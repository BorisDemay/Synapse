# ADR 0010 — Item de coffre chiffré (chemin et type dans le ciphertext)

- Statut : accepté
- Date : 2026-08-19

## Contexte

Le fil de synchronisation v1 n’expose que des `EncryptedPushOperation`
opaques : ciphertext, nonce, empreinte, `note_id` et révisions. Le plaintext
chiffré était jusqu’ici le Markdown brut. Les clients web n’avaient donc
aucune notion de chemin ; dossiers, renommages et pièces jointes ne pouvaient
pas survivre à une sync E2EE.

Le serveur ne doit toujours pas voir de chemin, tag, nom de fichier ou octet
de pièce jointe en clair.

## Décision

Le plaintext scellé par XChaCha20-Poly1305 est un **item de coffre versionné**,
pas un champ protocole. Le JSON de push reste inchangé.

Format UTF-8 (corps éventuellement binaire) :

```text
SYNAPSE-ITEM-v1
kind: note|attachment
path: <chemin relatif validé>
content-type: <MIME, pièces seulement>

<body>
```

L’en-tête se termine à la première ligne vide. Le corps est tout ce qui suit.

- `kind: note` : `VaultPath` se terminant par `.md`. Corps = Markdown.
- `kind: attachment` : chemin sous `attachments/`, hors exécutables
  (`.exe`, `.bat`, `.cmd`, `.com`, `.scr`, `.ps1`, `.dll`, `.so`).
- Notes héritées (UTF-8 sans magic) restent déchiffrables. Le prochain
  enregistrement les ré-enveloppe. Chemin dérivé : chemin disque déjà connu
  (desktop) ou `notes/{id-court}.md` (web).
- Un item (note ou pièce) est plafonné à **10 MiB** avant chiffrement. Le
  serveur aligne `MAX_CIPHERTEXT_BYTES` sur 10 MiB plus une marge JSON. Les
  100 MiB du modèle de menace exigent un upload streamé hors JSON ; ils restent
  hors de cette livraison.
- Les fichiers desktop restent canoniques en clair (ADR 0003) : l’enveloppe
  n’est écrite que dans le ciphertext de sync.
- Le sentinelle de suppression `\u0000synapse/deleted` n’est pas enveloppé,
  afin de rester lisible par les clients existants.

## Conséquences

Dossiers, tags locaux, wikilinks et pièces jointes peuvent se répliquer sans
élargir le contrat serveur. Un opérateur qui lit PostgreSQL ou le volume de
blobs ne voit toujours que du ciphertext. Les clients doivent décoder l’item
après déverrouillage ; un ciphertext héritage reste une note.

## Alternatives rejetées

- Champ `path` sur `EncryptedPushOperation` : fuite de métadonnées vers le
  serveur, contraire à l’E2EE.
- 100 MiB dans le JSON de push : charge mémoire inacceptable sur Axum.
- Écrire l’enveloppe dans les fichiers `.md` locaux : casse l’interop
  Markdown et l’ADR 0003.
