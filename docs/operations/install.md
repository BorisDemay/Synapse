# Installation auto-hébergée (Docker Compose)

## Prérequis

- Docker Compose et le plugin Compose v2
- En production, un DNS qui pointe `SYNAPSE_PUBLIC_HOST` vers la machine et les
  ports 80/443 disponibles pour Caddy ; le port HTTP de gestion reste lié à
  loopback par défaut

## Démarrage minimal

```bash
cp .env.example .env
# Ajuster SYNAPSE_PUBLIC_HOST, SYNAPSE_ALLOWED_ORIGIN et les secrets PostgreSQL
docker compose up --build -d --wait
curl --fail https://notes.example.com/health/ready
```

Pour une vérification locale jetable, utilisez explicitement la configuration
de développement :

```bash
docker compose -p synapse-dev --env-file .env.development.example up --build -d --wait
bash infra/docker/healthcheck.sh http://127.0.0.1:18090
```

Services démarrés : PostgreSQL, API Rust, UI web (nginx), Caddy. Les blobs
chiffrés vivent dans le volume `blob_data` ; PostgreSQL dans `postgres_data`.

Le chemin `SYNAPSE_RELEASES_PATH` est monté en lecture seule dans nginx et sert
`/updates`. En production NAS, le définir à
`/srv/synapse/releases`. Le répertoire `stable/<version>` est immuable et
contient ses manifests ; `stable/latest.json` et `stable/web.json` résolvent
tous deux via l’unique pointeur atomique `stable/current`.

L’inscription publique est désactivée dans `.env.example`. En production,
utilisez les invitations ou un admin bootstrap. Le compte fixture `test` / `test`
n’est créé que lorsque `SYNAPSE_ENV=development` et
`SYNAPSE_DEV_FIXTURE=true` sont définis explicitement.

## Profil observabilité (optionnel)

```bash
docker compose --profile observability up -d
```

Expose Prometheus sur `:9090` pour scrappeur `GET /metrics` du serveur. Ce
profil n’est pas requis pour le chemin minimal.

## Arrêt

```bash
docker compose down
```

Les volumes nommés sont conservés tant que vous n’ajoutez pas `-v`.

## Vérification automatisée

```bash
bash tests/integration/self_hosted.sh
```

Ce script construit les images dans un projet Compose jetable, démarre la
stack sur le port 18090 (surcharge possible via `SYNAPSE_HTTP_PORT`), crée et
active son compte synthétique, puis vérifie le compte et sa session après
redémarrage. Un port occupé provoque un échec. Le nettoyage supprime uniquement
les conteneurs et volumes de ce projet temporaire ; une installation existante
n’est pas réutilisée.
