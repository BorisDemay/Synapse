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

Conserver `/mnt/nas1/synapse/.env` root-only. La variable
`SYNAPSE_PUBLIC_URL` doit être disponible pour le health check externe. Épingler
la clé hôte NAS complète dans `NAS_SSH_KNOWN_HOSTS`; ne jamais utiliser
`StrictHostKeyChecking=no`.
