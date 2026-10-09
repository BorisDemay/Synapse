# Observabilité respectueuse des données

## Principes

- Les logs et traces ne contiennent jamais de mot de passe, cookie, jeton,
  ciphertext, nonce, Markdown, titre ou chemin de note.
- Utiliser `synapse_server::telemetry::redact_field` avant d’enregistrer un
  champ utilisateur.
- Les métriques Prometheus n’utilisent pas de labels `user_id`, `vault_id` ni
  d’email (cardinalité et fuite d’identité).

## Activation

Au démarrage, `telemetry::init()` installe un abonné `tracing` JSON si possible.
La configuration se fait via `RUST_LOG` (défaut `info`). L’échec d’initialisation
n’empêche pas le démarrage du serveur.

Chaque réponse HTTP porte `x-request-id` (reprise d’un id client ou UUID v7).
Le span `http_request` porte seulement `request_id`, `method` et `route`.

## Métriques

Endpoint : `GET /metrics` (texte Prometheus).

| Métrique | Signification |
| --- | --- |
| `synapse_http_requests_total{status_class}` | Réponses HTTP par classe |
| `synapse_sync_push_total{result}` | Push `accepted` / `conflict` / `error` |
| `synapse_sync_pull_total` | Pull réussis |
| `synapse_sync_conflicts_total` | Conflits de révision |
| `synapse_ws_connections` | Connexions WebSocket actives |

## Traces

Les spans `tracing` fournissent la corrélation locale via `request_id`. Un
export OpenTelemetry optionnel peut s’appuyer sur ces spans sans attacher de
payload ; il ne doit jamais bloquer le démarrage.
