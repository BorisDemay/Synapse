# Publication Windows et Linux

Les tags `vX.Y.Z` lancent le workflow de release. Une préversion doit utiliser
un tag contenant `-beta` et est publiée dans le canal `beta`; les autres tags
vont dans `stable`. Les canaux ne réalisent pas encore de mise à jour automatique.

La publication exige les secrets protégés suivants :

- `WINDOWS_CERTIFICATE_PFX_BASE64` et `WINDOWS_CERTIFICATE_PASSWORD` pour
  Authenticode ;
- `LINUX_GPG_PRIVATE_KEY` et `LINUX_GPG_PASSPHRASE` pour signer les checksums.

Le workflow échoue si l'un des secrets manque. Avant publication, exécuter
`just verify`, les parcours de sync/conflict, la checklist de sécurité et une
revue crypto indépendante. Publier avec les artefacts les SBOM CycloneDX, les
checksums SHA-256 et la signature OpenPGP. Les clés privées ne doivent jamais
être enregistrées dans le dépôt, les logs ou les artefacts.
