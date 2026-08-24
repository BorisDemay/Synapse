# Installer Synapse sur un NAS

Ce guide sert à déployer une instance personnelle de Synapse sur un NAS Linux
capable d'exécuter Docker Compose v2 (par exemple via Container Manager ou une
installation Docker classique). L'instance fournit l'API, PostgreSQL, le
stockage de blobs chiffrés et l'interface web. Le client Windows se connecte
ensuite à cette instance pour les comptes et la synchronisation.

## Réponse courte : faut-il cloner le dépôt ?

Oui, avec la configuration actuelle il faut récupérer le dépôt **ou une archive
source exacte du dépôt**. Le fichier `docker-compose.yml` construit les images
de l'API Rust et de l'interface web à partir des `Dockerfile` et des sources.
Il n'existe pas encore d'image Docker publique prête à tirer, ni d'installateur
API autonome.

Le clonage est le chemin recommandé, car il permet aussi les mises à jour, les
migrations et les scripts de sauvegarde. Une archive source d'une version Git
précise est une alternative valable si Git n'est pas disponible sur le NAS.

## Pré-requis

- Un NAS Linux avec Docker Engine et Docker Compose v2 (`docker compose
  version`).
- Un accès SSH ou un terminal sur le NAS.
- Un port TCP libre pour Synapse (8080 dans les exemples).
- Pour un accès hors du réseau local : un nom de domaine, HTTPS et un proxy
  inverse TLS devant Synapse. Ne pas exposer une instance HTTP sur Internet.

La première construction compile Rust et le client web dans Docker ; elle peut
prendre plusieurs minutes selon le processeur du NAS.

## Installation sur le NAS

Choisir un répertoire persistant, puis récupérer une version déterminée du
dépôt. Remplacer `adbc945` par un tag de release lorsqu'il y en aura un.

```bash
mkdir -p /srv/synapse
cd /srv/synapse
git clone https://github.com/BorisDemay/Synapse.git app
cd app
git checkout adbc945
```

Créer le fichier de configuration, lisible uniquement par l'administrateur :

```bash
umask 077
cp .env.example .env
chmod 600 .env
```

Éditer ensuite `.env`. Pour une instance accessible en HTTPS à
`https://synapse.example.net`, les valeurs importantes sont :

```dotenv
SYNAPSE_HTTP_PORT=8080
SYNAPSE_ALLOWED_ORIGIN=https://synapse.example.net
SYNAPSE_ALLOW_PUBLIC_SIGNUP=false
SYNAPSE_COOKIE_SECURE=true
SYNAPSE_ENV=production
RUST_LOG=info

POSTGRES_DB=synapse
POSTGRES_USER=synapse
POSTGRES_PASSWORD=remplacer-par-un-mot-de-passe-aleatoire-long-alphanumerique

SYNAPSE_BOOTSTRAP_ADMIN_EMAIL=admin@exemple.net
SYNAPSE_BOOTSTRAP_ADMIN_PASSWORD=remplacer-par-un-mot-de-passe-aleatoire-long
```

Pour un test uniquement sur le réseau local, utiliser à la place l'URL réelle
du NAS, par exemple `http://192.168.1.50:8080`, mettre cette même valeur dans
`SYNAPSE_ALLOWED_ORIGIN` et conserver `SYNAPSE_COOKIE_SECURE=false`. Cette
configuration HTTP ne doit pas être publiée sur Internet.

Démarrer la stack et attendre les contrôles de santé :

```bash
docker compose up --build -d --wait
docker compose ps
curl -fsS http://127.0.0.1:8080/health/ready
```

La sortie de la dernière commande doit indiquer que le service est prêt. En cas
d'échec, consulter les journaux sans y copier les secrets :

```bash
docker compose logs --tail=200 server
docker compose logs --tail=200 caddy
```

Les données PostgreSQL et les blobs chiffrés sont stockés dans les volumes
Docker nommés ; `docker compose down` les conserve. Ne pas lancer
`docker compose down -v` en production : cette variante supprime les volumes.

## HTTPS et exposition réseau

La configuration Caddy incluse écoute en HTTP sur le port publié ; elle est
adaptée au développement et au réseau local. Pour une exposition Internet,
placer un proxy inverse TLS du NAS (ou un Caddy/Nginx séparé) devant
`http://127.0.0.1:8080`, publier uniquement le port HTTPS et définir :

```dotenv
SYNAPSE_ALLOWED_ORIGIN=https://synapse.example.net
SYNAPSE_COOKIE_SECURE=true
SYNAPSE_ENV=production
```

Le proxy doit transmettre les routes `/auth/`, `/v1/`, `/vaults`, `/health/`
et l'interface web. La configuration Caddy du projet les sert déjà toutes sur
le même port ; le proxy externe peut donc relayer l'intégralité du site vers
le port 8080.

## Connecter le client Windows

Dans l'écran de connexion du client Synapse, saisir l'URL publique de
l'instance :

```text
https://synapse.example.net
```

Pour un test local, saisir par exemple `http://192.168.1.50:8080`. Ne pas
utiliser `http://127.0.0.1:3000` : cette adresse désigne le PC Windows, pas le
NAS.

Se connecter avec le compte d'administration bootstrapé. Si l'inscription
publique est volontairement activée, créer un compte depuis le client puis la
désactiver dans `.env` et redémarrer :

```bash
docker compose up -d
```

## Exploitation courante

```bash
# État et journaux
docker compose ps
docker compose logs -f server

# Arrêt sans effacer les données
docker compose down

# Démarrage après arrêt ou redémarrage du NAS
docker compose up -d

# Sauvegarde : inclut PostgreSQL et les blobs chiffrés
mkdir -p /srv/synapse/backups
bash infra/scripts/backup.sh /srv/synapse/backups
```

Conserver les sauvegardes hors du NAS. Une sauvegarde de blobs ne remplace pas
la phrase de déchiffrement des utilisateurs : le serveur ne peut pas récupérer
ces clés de coffre.

## Mise à jour

Avant toute mise à jour, effectuer une sauvegarde. Ensuite :

```bash
cd /srv/synapse/app
git fetch --tags origin
git checkout <tag-ou-commit-verifie>
docker compose build
bash infra/scripts/migrate.sh
docker compose up -d
curl -fsS http://127.0.0.1:8080/health/ready
```

Consulter les changements de schéma sous `migrations/` et les notes de version
avant de mettre à jour. La procédure de restauration est documentée dans
`docs/operations/backup-restore.md`.
