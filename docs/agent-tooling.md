# Outillage des agents

## Instructions de projet

`AGENTS.md` est la source d’instructions portable du dépôt pour Hermes, Codex, Claude Code et les outils compatibles. Il oriente les agents vers le plan et les compétences locales selon la zone modifiée.

## Compétences locales

Les fichiers sous `skills/` sont des procédures versionnées du projet. Ils ne remplacent pas les compétences d’un agent hôte ; `AGENTS.md` impose leur lecture avant une modification relevant de leur périmètre.

| Fichier | Périmètre |
|---|---|
| `skills/synapse-security/SKILL.md` | E2EE, clés, authentification, stockage, journalisation et permissions |
| `skills/synapse-sync/SKILL.md` | Réplication offline-first, protocole, files d’opérations, conflits et WebSocket |
| `skills/synapse-delivery/SKILL.md` | Vue, Tauri, Rust, Docker, CI, tests et livraison |

## MCP

`.mcp.json` contient uniquement Playwright MCP. Il est open source, gratuit et utile pour inspecter l’interface lors des tests locaux.

- Lancer le MCP uniquement contre l’application locale de développement ou de test.
- Ne pas lui donner de cookies de production, secrets, identifiants privés ou accès à un serveur externe.
- Les tâches filesystem, shell, Git, PostgreSQL, Docker et HTTP utilisent les outils natifs et les commandes contrôlées du dépôt : un MCP supplémentaire serait redondant et élargirait inutilement la surface d’attaque.
- GitHub MCP est volontairement absent : l’intégration exige un jeton et n’est pas nécessaire avant qu’un dépôt distant et une politique de jetons existent.

## Validation

Avant d’utiliser `.mcp.json`, vérifier que le client agent ciblé reconnaît ce format et que Node.js/npx sont disponibles. Le serveur Playwright ne doit pas être un prérequis pour compiler, tester ou auto-héberger Synapse.
