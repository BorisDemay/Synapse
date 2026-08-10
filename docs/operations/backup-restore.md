# Sauvegarde et restauration

## Contenu d’une sauvegarde

`infra/scripts/backup.sh <dir>` écrit un répertoire versionné contenant :

- `postgres.dump` — dump PostgreSQL custom (`pg_dump`)
- `blobs/` — copie du volume de ciphertexts
- `backup.json` — métadonnées et empreintes SHA-256
- `manifest.sha256` — empreintes des fichiers sauvegardés

Prendre la sauvegarde pendant une charge faible. Pour une cohérence stricte,
arrêtez l’API (`docker compose stop server`) avant le dump, ou acceptez qu’une
écriture concurrente puisse apparaître seulement côté blobs ou seulement côté
SQL.

## Restauration

```bash
bash infra/scripts/restore.sh --yes /path/to/backup/latest
```

Sans `--yes`, la commande refuse d’écraser la base. Le script vérifie l’espace
disque disponible (~2× la taille de la sauvegarde + 100 MiB).

## Migrations

```bash
bash infra/scripts/migrate.sh
```

Relance le serveur Compose pour rejouer les migrations SQL embarquées au
démarrage.

## Vérification

```bash
bash tests/integration/backup_restore.sh
```
