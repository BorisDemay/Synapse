# Mises à jour

Le pipeline `main` stage checksums, signatures, SBOM, manifestes et images
`synapse-server:<version>` / `synapse-web:<version>`. Le compte NAS restreint
peut seulement déposer sous `incoming/` et invoquer `synapse-deploy`.

Le script allowlisté valide l’archive et les labels d’image avant de toucher la
stack. Si les checksums de migrations changent, il appelle la sauvegarde
pré-déploiement. Il vérifie ensuite `/health/version`, la version/SHA et la
présence d’un artefact. Les manifestes sont publiés en dernier.

En manuel : sauvegarder, fixer `SYNAPSE_VERSION`, lancer Compose sans rebuild,
vérifier `/health/version`, puis seulement remplacer les deux manifestes.

Les migrations sont idempotentes autant que possible (`IF NOT EXISTS`). Ne pas
éditer une migration déjà déployée ; ajouter un nouveau fichier numéroté. Toute
expansion de schéma doit rester lisible par la version serveur précédente.
