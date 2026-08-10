# Durcissement réseau et client

## Serveur HTTP

- En-têtes systématiques : `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, CSP API
  `default-src 'none'; frame-ancestors 'none'; base-uri 'none'`.
- `Strict-Transport-Security` uniquement lorsque `SYNAPSE_ENV=production`.
- CORS allowlist : `SYNAPSE_ALLOWED_ORIGIN` est le seul `Origin` accepté pour
  les réponses CORS et pour les mutations cookie-authentifiées (CSRF).
- Corps de push plafonné (`DefaultBodyLimit` sur `/operations`).
- Rate limiting Tower Governor sur `/auth/signup` et `/auth/login`.

## Desktop Tauri

Capabilities limitées à `core:default` et `dialog:allow-open` (ouverture de
coffre). Pas de shell, HTTP générique ni accès filesystem élargi. CSP fenêtre :
`default-src 'self'` avec styles/images locaux.

## Chemins de coffre

`VaultPath` refuse les traversées `..`, chemins absolus, séparateurs Windows
ambigus, flux ADS (`:`), octets NUL et extensions hors `.md`. Les écritures
résolvent les liens symboliques et refusent une sortie de racine.

## Opérateur

Exiger HTTPS devant le serveur en production (Caddy). Ne jamais activer
`SYNAPSE_COOKIE_SECURE=false` ni `SYNAPSE_ALLOW_PUBLIC_SIGNUP=true` hors
environnements de développement contrôlés.
