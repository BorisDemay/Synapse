# Publication continue Windows, Linux, web et serveur

Chaque push ou merge vert sur GitHub `main` devient `0.1.<run_number>` dans le
canal `stable`. Le canal `beta` reste réservé. Le workflow refuse de publier si
un artefact Windows ou Linux manque, ou si les identités web/desktop divergent.

La publication exige les secrets protégés suivants :

- `WINDOWS_CERTIFICATE_PFX_BASE64` et `WINDOWS_CERTIFICATE_PASSWORD` pour
  Authenticode ;
- `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` pour les
  paquets updater ; `TAURI_UPDATER_PUBLIC_KEY` est une variable GitHub publique
  injectée dans le binaire ;
- `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `NAS_DEPLOY_SSH_KEY` et
  `NAS_SSH_KNOWN_HOSTS` pour le déploiement éphémère et l’identité NAS épinglée.

L’import Authenticode précède le bundling ; Tauri signe ensuite le paquet déjà
signé par Windows. Après normalisation, chaque job desktop vérifie la signature
détachée de l’artefact contre `TAURI_UPDATER_PUBLIC_KEY`
(`infra/scripts/release/verify-signature.mjs`), et le job de publication
re-vérifie les deux artefacts téléchargés avant d’assembler l’archive. Un
téléchargement d’artefact altéré ou interverti échoue donc avant publication.
Les artefacts versionnés, SBOM et checksums forment l’archive
GitHub immuable. Le NAS active `latest.json` et `web.json` en dernier. Les clés
privées ne doivent jamais être enregistrées dans le dépôt, les logs ou les
artefacts.

Le premier build updater doit être installé manuellement sur Windows et Linux.

## Drill de déploiement isolé

`tests/integration/release_drill.sh` exécute le vrai
`infra/scripts/deploy-release.sh` dans un projet Compose jetable. Il construit
des images `synapse-server`/`synapse-web` étiquetées avec la version et le SHA,
les publie en TLS local, puis vérifie trois comportements sur une racine de
déploiement privée :

1. la sauvegarde pré-déploiement n’est appelée que lorsque les checksums de
   migration changent ;
2. une activation réussie rend `latest.json` et `web.json` cohérents avec
   `/health/version` ;
3. un manifeste servi divergent déclenche le rollback des images et du
   pointeur vers la release précédente.

```bash
bash tests/integration/release_drill.sh
```
