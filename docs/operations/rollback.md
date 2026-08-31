# Rollback de release

Avant l’activation des manifestes, un échec remet automatiquement les images de
la version indiquée par `/mnt/nas1/synapse/.active-version`. PostgreSQL et le
volume de blobs ne sont ni supprimés ni recréés. Les expansions de schéma déjà
appliquées restent compatibles avec ce serveur précédent.

Pour un drill : conserver `latest.json` et `web.json`, stager une release de
test dont le health check échoue, invoquer `synapse-deploy`, puis vérifier que
`/health/version` retourne l’ancienne version et que les deux manifestes sont
inchangés. Consigner la date, les deux SHA et la sauvegarde créée.

Une version desktop installée n’est jamais rétrogradée ou resignée. Publier une
nouvelle version ascendante corrective.
