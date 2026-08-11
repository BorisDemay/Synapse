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
