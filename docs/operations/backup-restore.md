# Sauvegarde et restauration

## Sauvegarde cohérente

```bash
bash infra/scripts/backup.sh /path/to/backups
```

Le script arrête l’API pendant le dump PostgreSQL et la copie des blobs. Il
redémarre l’API uniquement si elle était démarrée avant la sauvegarde, y compris
lorsqu’une copie échoue. Prévoyez cette interruption pendant une charge faible.
PostgreSQL doit être démarré et le conteneur API doit exister. Ne lancez pas deux
opérations de maintenance en parallèle et ne laissez aucun autre processus écrire
directement dans la base ou le volume pendant cette opération.

Un répertoire versionné contient `postgres.dump` (format custom PostgreSQL),
`blobs/`, `backup.json` (version/date) et `manifest.sha256`. Les empreintes utilisent
des chemins relatifs : le répertoire peut être déplacé. Le manifeste couvre
exactement les fichiers sauvegardés. Le lien `latest` n’est remplacé qu’après
réussite ; une erreur laisse un répertoire `.incomplete-*` pour diagnostic.

Le serveur conserve des ciphertexts, mais le dump contient aussi les comptes,
permissions et sessions. Stockez les sauvegardes sur un support protégé et chiffré
par l’opérateur. Le manifeste détecte une corruption accidentelle ; il ne signe
pas la sauvegarde. Restaurez uniquement une sauvegarde de provenance fiable.

## Restauration

```bash
bash infra/scripts/restore.sh --yes /path/to/backups/latest
```

Sans `--yes`, la commande refuse d’écraser la base. Avant toute commande Docker,
elle refuse les fichiers absents, supplémentaires ou corrompus, les manifests
incomplets, les chemins dangereux, liens symboliques et fichiers spéciaux. Elle
vérifie également l’espace disque local (~2× la sauvegarde + 100 MiB ; vérifier
séparément l’espace du moteur Docker si celui-ci est distant).

Le script démarre PostgreSQL seul si nécessaire et valide le catalogue du dump
avec `pg_restore --list` avant de stopper l’API. Il utilise les identifiants
configurés dans le conteneur PostgreSQL ; pour la restauration ils doivent être
non vides et composés de lettres ASCII, chiffres ou `_`. Les bases système ne
peuvent pas être des cibles. `COMPOSE_FILE`, `ENV_FILE` et
`COMPOSE_PROJECT_NAME` permettent de sélectionner explicitement la stack.

Après ces contrôles, la base cible est supprimée et recréée. La restauration SQL
s’exécute dans une transaction avec arrêt à la première erreur. Le volume de
blobs est remplacé via un conteneur de maintenance avant de relancer l’API.
Compose attend ensuite les contrôles de santé PostgreSQL/API/proxy. Un échec ne
produit jamais le message de réussite et demande l’arrêt de l’API pour éviter de
servir un état partiel. Corrigez la cause puis relancez la restauration complète.
Cette procédure ne fournit pas de rollback automatique après suppression de la
base : conservez une sauvegarde vérifiée de l’état précédent.

## Migrations et vérification

```bash
bash infra/scripts/migrate.sh
python3 tests/operations/backup_test.py
bash tests/integration/backup_restore.sh
```

L’intégration utilise le projet Docker isolé `synapse-backup-test` et le port
18089 (surcharge `SYNAPSE_HTTP_PORT`), puis supprime uniquement ses volumes.
Elle crée un compte/coffre/opération chiffrée, refuse des sauvegardes endommagées,
déplace la sauvegarde, détruit les volumes et vérifie le contenu répliqué après
restauration. Les tests ciblés vérifient aussi les échecs de copie/restauration et
la conservation de l’état initial d’une API arrêtée.
