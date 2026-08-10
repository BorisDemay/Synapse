# Mises à jour

1. Lire les notes de version et les migrations sous `migrations/`.
2. Prendre une sauvegarde : `bash infra/scripts/backup.sh ./backups`.
3. Tirer les nouvelles images / reconstruire : `docker compose build`.
4. Appliquer les migrations : `bash infra/scripts/migrate.sh`.
5. Vérifier `bash infra/docker/healthcheck.sh http://127.0.0.1:8080`.
6. En cas de problème, restaurer : `bash infra/scripts/restore.sh --yes ./backups/latest`.

Les migrations sont idempotentes autant que possible (`IF NOT EXISTS`). Ne pas
éditer une migration déjà déployée ; ajouter un nouveau fichier numéroté.
