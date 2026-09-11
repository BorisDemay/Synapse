# Mises à jour

Le pipeline `main` stage checksums, signatures, SBOM, manifestes et images
`synapse-server:<version>` / `synapse-web:<version>`. Le compte NAS restreint
peut seulement déposer sous `incoming/` et invoquer `synapse-deploy`.

Le script allowlisté valide l’archive et les labels d’image avant de toucher la
stack. Si les checksums de migrations changent, il appelle la sauvegarde
pré-déploiement. Il vérifie ensuite `/health/version`, la version/SHA et la
présence d’un artefact. Les manifestes sont publiés en dernier.

Après le provisionnement initial, l’instance peut tirer automatiquement les
assets de la dernière release GitHub. Elle ne nécessite aucune liste centrale
d’instances. Ajouter dans l’environnement local, sans le committer :

```dotenv
SYNAPSE_UPDATE_REPOSITORY=owner/repository
```

Installer `infra/systemd/synapse-update.service` et
`infra/systemd/synapse-update.timer`, puis activer le timer. Pour un dépôt
privé, placer un fine-grained token limité à la lecture des releases dans
`/mnt/nas1/synapse/.update-token` (mode `0600`). L’updater télécharge l’archive
signée, vérifie les checksums, puis délègue au déployeur avec sauvegarde,
health-check et rollback.

En manuel : sauvegarder, fixer `SYNAPSE_VERSION`, lancer Compose sans rebuild,
vérifier `/health/version`, puis seulement remplacer les deux manifestes.

Les migrations sont idempotentes autant que possible (`IF NOT EXISTS`). Ne pas
éditer une migration déjà déployée ; ajouter un nouveau fichier numéroté. Toute
expansion de schéma doit rester lisible par la version serveur précédente.
