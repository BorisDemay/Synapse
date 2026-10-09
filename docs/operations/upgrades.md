# Mises à jour

Le pipeline `main` stage checksums, signatures, SBOM, manifestes et images
`synapse-server:<version>` / `synapse-web:<version>`. Le compte NAS restreint
peut seulement déposer sous `incoming/` et invoquer `synapse-deploy`.

Le script allowlisté valide l’archive et les labels d’image avant de toucher la
stack. Si les checksums de migrations changent, il appelle la sauvegarde
pré-déploiement. Il vérifie ensuite `/health/version`, la version/SHA et la
présence d’un artefact. Les manifests versionnés sont prêts avant activation ;
les deux URLs stables basculent ensemble par remplacement atomique du pointeur
`stable/current`. Une fois le pointeur basculé, le script relit
`/updates/stable/latest.json` et `/updates/stable/web.json` et exige la même
version et le même SHA que `/health/version` ; toute divergence déclenche le
rollback d’images et de pointeur.

Après le provisionnement initial, l’instance peut tirer automatiquement les
assets de la dernière release GitHub. Elle ne nécessite aucune liste centrale
d’instances. Ajouter dans l’environnement local, sans le committer :

```dotenv
SYNAPSE_UPDATE_REPOSITORY=owner/repository
```

Installer `infra/systemd/synapse-update.service` et
`infra/systemd/synapse-update.timer`, puis activer le timer. Pour un dépôt
privé, placer un fine-grained token limité à la lecture des releases dans
`/srv/synapse/.update-token` (mode `0600`). L’updater télécharge l’archive
signée, vérifie les checksums, puis délègue au déployeur avec sauvegarde,
health-check et rollback.

En manuel : sauvegarder, fixer `SYNAPSE_VERSION`, lancer Compose sans rebuild,
vérifier `/health/version`, puis remplacer uniquement le pointeur
`stable/current` vers le répertoire versionné validé.

Les migrations sont idempotentes autant que possible (`IF NOT EXISTS`). Ne pas
éditer une migration déjà déployée ; ajouter un nouveau fichier numéroté. Toute
expansion de schéma doit rester lisible par la version serveur précédente.
