# Rollback de release

Avant l’activation des manifestes, un échec remet automatiquement les images de
la version indiquée par `/srv/synapse/.active-version`. PostgreSQL et le
volume de blobs ne sont ni supprimés ni recréés. Les expansions de schéma déjà
appliquées restent compatibles avec ce serveur précédent.

Pour un drill : relever la cible de `stable/current`, stager une release de test
dont le health check échoue, invoquer `synapse-deploy`, puis vérifier que
`/health/version` retourne l’ancienne version et que `stable/current` désigne
toujours la cible précédente. Les deux URLs de manifest doivent ainsi conserver
la même identité. Consigner la date, les deux SHA et la sauvegarde créée.

Une version desktop installée n’est jamais rétrogradée ou resignée. Publier une
nouvelle version ascendante corrective.
