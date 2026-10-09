# Frontière de déploiement NAS

Le compte `synapse-deploy` n’a pas de shell interactif. Sa clé SSH porte
`restrict` et une commande forcée qui autorise uniquement :

- l’upload SCP vers `incoming/` ;
- `synapse-deploy <version> <sha>` avec formats stricts.

Seul le script root-owned `/usr/local/sbin/synapse-deploy` est allowlisté par
sudo. Il valide de nouveau tous les arguments, chemins, checksums, manifestes et
labels d’image. Il ne lit ni n’affiche les secrets de `.env`.

Provisionnement initial, en root sur le NAS :

```bash
export SYNAPSE_DEPLOY_PUBLIC_KEY='ssh-ed25519 …'
bash infra/scripts/provision-deploy-account.sh
```

Conserver `/srv/synapse/.env` root-only. La variable
`SYNAPSE_PUBLIC_URL` doit être disponible pour le health check externe. Épingler
la clé hôte NAS complète dans `NAS_SSH_KNOWN_HOSTS`; ne jamais utiliser
`StrictHostKeyChecking=no`.

## Prérequis vérifiés sur TrueNAS 25.10

- `/usr/local/sbin` est en **lecture seule** : installer `deploy-release.sh`
  et `update-instance.sh` sous la racine de déploiement (`infra/scripts/`), pas
  dans `/usr/local/sbin`. Le chemin de la commande de déploiement se configure
  par `SYNAPSE_DEPLOY_COMMAND` dans `.env`, chargé par
  `synapse-update.service` (`EnvironmentFile`).
- Le déployeur vérifie la santé et relit les manifests via
  `SYNAPSE_PUBLIC_URL` **depuis l'hôte lui-même**. L'hôte doit donc résoudre et
  joindre cette URL. Si MagicDNS n'est pas actif localement, ajouter une entrée
  `/etc/hosts` vers l'IP Tailscale (`100.x.y.z <host>.<tailnet>.ts.net`) et la
  persister (tâche d'init TrueNAS), sinon le déploiement échoue sur
  `… is unavailable`.
- Un dépôt privé exige `/srv/synapse/.update-token` (root, mode `0600`)
  contenant un PAT fine-grained limité à ce dépôt avec `Contents: Read-only`.
  Sans lui, l'updater reçoit un 404 à chaque passage.
- Le `nginx.conf` monté dans le conteneur web doit servir les deux manifests
  par le pointeur d'activation :
  `alias /usr/share/nginx/updates/stable/current/latest.json` (idem `web.json`).
  Les artefacts versionnés restent servis par
  `location /updates/stable/ { root /usr/share/nginx; }`. Un `root` sans
  `current` renvoie 404 et bloque l'activation.
- L'exposition publique passe par `tailscale serve` en mode **tailnet only**.
  Ne jamais activer `tailscale funnel` : l'instance resterait joignable par le
  tailnet, donc uniquement par les appareils autorisés.
