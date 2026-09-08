# Installation auto-hébergée (Docker Compose)

## Prérequis

- Docker Engine avec le plugin Compose v2
- Ports libres : `8080` (HTTP via Caddy) par défaut

## Démarrage minimal

```bash
cp .env.example .env
# Ajuster SYNAPSE_ALLOWED_ORIGIN et les secrets PostgreSQL
docker compose up --build -d --wait
bash infra/docker/healthcheck.sh http://127.0.0.1:8080
```

Services démarrés : PostgreSQL, API Rust, UI web (nginx), Caddy. Les blobs
chiffrés vivent dans le volume `blob_data` ; PostgreSQL dans `postgres_data`.

Le chemin `SYNAPSE_RELEASES_PATH` est monté en lecture seule dans nginx et sert
`/updates`. En production NAS, le définir à
`/mnt/nas1/synapse/releases`. Le répertoire `stable/<version>` est immuable ;
seuls `stable/latest.json` et `stable/web.json` sont remplacés atomiquement.

Inscription publique locale : `SYNAPSE_ALLOW_PUBLIC_SIGNUP=true` dans `.env`.
En production, désactivez-la et utilisez des invitations / un admin bootstrap.

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
