# Budgets de performance (mesurés)

Ces budgets sont des **baselines mesurées**, pas des objectifs inventés. Une
régression n’échoue en CI que si elle est statistiquement significative par
rapport à la baseline Criterion (ou si le script k6 croise ses seuils).

## Machine de référence

| Champ | Valeur |
| --- | --- |
| Date | 2026-08-11 |
| Hôte | WSL2 (`Linux 6.6.87`, `DESKTOP-A9LH8E4`) |
| CPU | Intel Core i5-14600KF (20 threads visibles) |
| RAM | 15 GiB |
| Rust | `cargo bench` profile `bench` (optimisé) |
| k6 | `k6 v0.57.0` |
| API sous charge | `synapse-server` debug + PostgreSQL test `127.0.0.1:55432` |

## Générateur de coffre

```bash
cargo run -p synapse-fixture-generator --release -- target/perf-vault 10000
```

Produit 10 000 notes déterministes (`SEED=42`) avec liens wiki, tags et tailles
variables, plus `MANIFEST.sha256`.

## Criterion (local store + parse)

Commandes :

```bash
cargo bench -p synapse-core --bench markdown -- --quick
cargo bench -p synapse-local-store --bench search -- --quick
```

Mesures `--quick` sur la machine de référence (médiane Criterion) :

| Benchmark | Mesure | Budget initial (alerte) |
| --- | ---: | ---: |
| `parse_note/bytes_kib/1` | ~395 ns | < 1 µs |
| `parse_note/bytes_kib/8` | ~775 ns | < 2 µs |
| `parse_note/bytes_kib/64` | ~3.5 µs | < 10 µs |
| `parse_note_batch_1000` | ~450 µs | < 1.5 ms |
| `search_paths_token_mid` (index 10k) | ~13 µs | < 50 µs |
| `search_paths_shared_term` (limit 50) | ~4.1 ms | < 15 ms |
| `upsert_note_1000` | ~24 ms | < 80 ms |

Les rapports HTML Criterion sont écrits sous `target/criterion/` (gitignored).
Pour une comparaison de régression plus stable, relancer sans `--quick` et
utiliser `cargo bench -- --save-baseline <name>` / `--baseline <name>`.

## Charge sync (k6, 100 clients)

```bash
SYNAPSE_BASE_URL=http://127.0.0.1:3000 \
SYNAPSE_ALLOWED_ORIGIN=http://127.0.0.1:5173 \
k6 run tests/load/sync.js
```

Scénario : 100 VUs pendant 30 s. Chaque VU possède son coffre, enchaîne
`/health/live`, `/v1/session`, pull, push opaque (UUID v7 + hash SHA-256 du
ciphertext) et un upgrade WebSocket périodique.

Mesure du 2026-08-11 :

| Métrique | Mesure | Seuil k6 |
| --- | ---: | --- |
| `http_req_duration` p(95) | ~45 ms | `< 750 ms` |
| `http_req_failed` | ~0.00 % (3/70914) | `< 2 %` |
| `checks` | ~99.99 % | `> 98 %` |
| Débit HTTP | ~2308 req/s | informatif |
| Itérations | ~576 /s | informatif |

Le script ne transporte aucun clair de coffre : seulement des ciphertexts, nonces
et empreintes, conformément au protocole v1.

## Politique de régression

1. Mettre à jour ce document lorsqu’une baseline est volontairement recalibrée
   (changement d’algo ou de machine de référence).
2. Ne pas durcir les seuils k6 en dessous des mesures + marge confortable sans
   nouvelle campagne.
3. Criterion : échouer seulement via comparaison de baseline, pas sur un seuil
   absolu fragile en CI partagée.

## Client Vue réel — 8 septembre 2026

Commande depuis la racine (Chromium Playwright installé) :

```bash
node tests/performance/client-benchmark.mjs
```

Le script démarre un Vite isolé sur `127.0.0.1:16174`, sans HMR, et un profil
Chromium jetable. Il chiffre 10 000 notes synthétiques d'environ 1 KiB et leur
historique dans le vrai IndexedDB. Il utilise les stores et l'éditeur produit,
vérifie les 10 000 notes, une recherche représentative, une modification durable
après rechargement complet, puis un delta chiffré tiré depuis un curseur durable.
Les réponses réseau sont simulées : la mesure de reconnexion concerne le client,
pas la latence ou le débit serveur. Aucun compte réel n'est utilisé. Un timeout
ou une vérification échouée termine la commande avec un code non nul.

Mesures ponctuelles sur la machine WSL2 de référence ci-dessus, navigateur
Chromium headless, build Vite de développement (pas un budget CI absolu) :

| Étape | Avant | Après |
| --- | ---: | ---: |
| Ouverture froide, 10 000 ciphertexts + 10 000 révisions | **> 30 000 ms**, timeout pendant l'hydratation des historiques | 812 ms |
| Recherche, médiane de 20 requêtes | 10,7 ms, fixture en mémoire uniquement | 17,1 ms, fixture chiffrée rouverte |
| Recherche, p95 | 14,5 ms, fixture en mémoire uniquement | 22,4 ms |
| Rendu du coffre (2 frames) | 615 ms, fixture en mémoire uniquement | 678 ms |
| Modification UI → cache durable, debounce inclus | non mesuré | 1 004 ms |
| Action `saveNote` durable | non mesuré | 319 ms |
| Reconnexion client, curseur + delta puis page terminale | non mesuré | 1 432 ms, 2 GET |
| Plus longue tâche observée pendant ouverture/recherche/rendu | non mesuré | 650 ms |

La création du fixture (9 846 ms) est exclue de l'ouverture. Une mesure
intermédiaire avec seulement les lectures IndexedDB bornées donnait 3 060 ms
pour l'ouverture ; l'historique à la demande et le déchiffrement par groupes de
256 notes réduisent encore le coût. Les variantes chiffrées restent persistées ;
les historiques déchiffrés et clés sont purgés au verrouillage. La restauration
et les points de restauration chargent explicitement l'historique de leur note.
Les lectures par lots partagent une seule transaction readonly cohérente.

Limites observées : l'arbre affiche encore 10 000 éléments (60 103 nœuds DOM) ;
son rendu produit une longue tâche. La recherche reste sous 100 ms dans cette
mesure et ne justifie pas une nouvelle dépendance d'indexation. Ces chiffres ne
prouvent pas une frappe sans aucune pause sur toutes les machines. Les mesures
« avant » en mémoire ne sont pas directement comparables à l'ouverture chiffrée.

### Réplique Markdown native

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --test folder_performance -- --ignored --nocapture
```

Le test utilise exclusivement un dossier temporaire, 10 000 notes synthétiques,
vérifie les octets modifiés et l'absence de réécriture d'un fichier inchangé.
Mesure native debug : création initiale **22 459 ms**, snapshot inchangé
**1 519 ms**, modification d'une note **1 870 ms**. Avant la journalisation par
lot, une création de seulement 1 000 notes prenait 10 940 ms ; ce point de mesure
n'est pas une extrapolation à 10 000 notes.

Le manifeste journalise le lot avant les écritures, puis sa finalisation, au
lieu de réécrire un manifeste croissant après chaque fichier. Les snapshots
restent sérialisés en arrière-plan. Ils relisent les fichiers inchangés pour
détecter les modifications externes mais ne les réécrivent pas ; cette
vérification explique le coût résiduel. Le cache chiffré reste durable même si
la réplique est lente ou échoue.
