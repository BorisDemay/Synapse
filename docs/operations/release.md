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
signé par Windows. Les artefacts versionnés, SBOM et checksums forment l’archive
GitHub immuable. Le NAS active `latest.json` et `web.json` en dernier. Les clés
privées ne doivent jamais être enregistrées dans le dépôt, les logs ou les
artefacts.

Le premier build updater doit être installé manuellement sur Windows et Linux.
