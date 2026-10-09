# ADR 0015 — Mises à jour continues, signées et activées après déploiement

- Statut : accepté
- Date : 2026-08-31
- Remplace : la décision de mise à jour manuelle de l’ADR 0012

## Contexte

Le web, le serveur et les clients desktop doivent désigner exactement le même
commit. Une publication partielle rendrait les diagnostics et le protocole
ambigus. Un client natif ne peut pas faire confiance au seul TLS de l’instance :
un artefact doit aussi porter une signature vérifiée par une clé embarquée.

## Décision

Chaque pipeline vert de `main` produit la version `0.1.<github.run_number>`.
Il reconstruit serveur, web, Windows et Linux depuis le même SHA, puis déploie
serveur et web avant d’activer les manifestes `stable`. Une release n’est jamais
web-only ou desktop-only.

`latest.json` suit le format statique Tauri et contient les signatures inline.
Le plugin officiel vérifie obligatoirement la signature avant de conserver le
paquet téléchargé. Sa clé publique est injectée à la compilation et embarquée ;
la clé privée reste un secret GitHub protégé. Le feed desktop est construit par
Rust depuis l’origine Synapse connectée. Seuls HTTPS et le loopback HTTP de
développement sont admis.

Le coordinateur partagé expose `idle`, `checking`, `downloading`, `ready`,
`applying` et `error`. Les erreurs n’affectent ni l’éditeur, ni le cache chiffré,
ni l’outbox. L’activation reste explicite : rechargement web ou
installation/redémarrage desktop.

Sur le NAS, les artefacts et les deux manifestes sont copiés dans le répertoire
versionné immuable avant le changement de stack. Après `/health/version` et la
disponibilité des artefacts, les URLs stables `latest.json` et `web.json`
résolvent toutes deux via le même lien symbolique `current`, remplacé par un
unique renommage atomique. Une erreur restaure la version d’image et le pointeur
précédents sans exposer deux identités de release différentes.

## Conséquences

Le premier binaire updater doit être installé manuellement. Une version native
déjà installée n’est jamais rétrogradée : une correction est une nouvelle
version ascendante. Les migrations de release restent additives et compatibles
avec le serveur précédent. Le canal `beta` est réservé mais n’est pas alimenté
par ce pipeline.

Le déploiement serveur/web suit désormais un modèle pull : chaque instance
exécute localement un timer updater qui lit la dernière release GitHub, sans
registre central d’instances ni connexion entrante depuis GitHub Actions.
