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

## Claude Code

`.claude/` contient la configuration partagée de Claude Code. `settings.local.json` reste personnel et n’est pas versionné.

| Élément | Rôle |
|---|---|
| `.claude/skills` | Lien vers `skills/`, pour que Claude Code découvre les compétences du projet sans les dupliquer |
| `.claude/agents/docs.md` | Haiku, lecture seule : documentation d’API tierce pour la version épinglée |
| `.claude/agents/security-reviewer.md` | Opus, lecture seule : revue d’un plan ou d’un diff de sécurité ou de synchronisation contre les invariants d’`AGENTS.md` |
| `.claude/agents/log-digester.md` | Haiku : résumé des échecs d’une sortie longue de tests, build ou CI |
| `.claude/hooks/protect-secrets.py` | `PreToolUse` : refuse l’édition de `.env*` (hors `.example`) et de fichiers de clés |
| `.claude/hooks/sensitive-area.py` | `PostToolUse` : rappelle une fois par session la revue `security-reviewer` après une édition en zone sécurité ou synchronisation |
| `.githooks/pre-commit` → `.claude/hooks/commit-review.py` | Hook Git `pre-commit` : quand Claude Code lance le *commit* (`CLAUDECODE=1`), fait relire l’index par `security-reviewer` sur Opus, en mode non interactif et en lecture seule (`Read`, `Grep`, `Glob`). Git l’exécute sur l’index réellement validé (`-a`, chemins et worktrees compris). Un verdict `BLOCK` ou une revue impossible annule le *commit*. Un verdict `PASS` est mis en cache pour ce diff ; le rapport est écrit dans `.git/synapse-commit-review.md`. Les *commits* faits à la main ne sont pas relus |
| `.claude/hooks/commit-guard.py` | `PreToolUse` (Bash) : refuse `--no-verify`, `-n` et toute modification de `core.hooksPath`, et bloque les *commits* tant que le hook n’est pas activé dans le clone ou le worktree |
| `.claude/hooks/stop-checks.py` | `Stop` : `typecheck` des packages JS et `cargo check` des crates modifiés ; un échec renvoie l’erreur à l’agent. Les tests restent à exécuter selon `AGENTS.md` |

Activation, une fois par clone : `git config core.hooksPath .githooks`. Une revue prend environ une minute : lancer le *commit* avec un délai d’exécution d’au moins 15 minutes. Tests des hooks : `python3 -m unittest discover -s .claude/hooks`. Ces hooks supposent un agent coopératif : ils empêchent les contournements accidentels, pas un contournement délibéré.

Les hooks utilisent `python3` et ajoutent les toolchains installées sous `/root` au `PATH` lorsqu’elles existent. Le hook `PreToolUse` ne couvre pas les écritures faites via le shell.

Si `npx` n’est pas dans le `PATH` du processus Claude Code, enregistrer Playwright MCP en portée locale (non versionnée), qui prend le pas sur `.mcp.json` :

```sh
claude mcp add --scope local playwright -e PATH=<dossier de node>:/usr/bin:/bin -- <dossier de node>/npx -y @playwright/mcp@0.0.79
```

## MCP

`.mcp.json` contient uniquement Playwright MCP. Il est open source, gratuit et utile pour inspecter l’interface lors des tests locaux.

- Lancer le MCP uniquement contre l’application locale de développement ou de test.
- Ne pas lui donner de cookies de production, secrets, identifiants privés ou accès à un serveur externe.
- Les tâches filesystem, shell, Git, PostgreSQL, Docker et HTTP utilisent les outils natifs et les commandes contrôlées du dépôt : un MCP supplémentaire serait redondant et élargirait inutilement la surface d’attaque.
- GitHub MCP est volontairement absent : l’intégration exige un jeton et n’est pas nécessaire avant qu’un dépôt distant et une politique de jetons existent.

### Sélection d’éléments dans le navigateur (Yoink)

Pi ne lit pas `.mcp.json` : il ne prend pas en charge MCP et délègue cette intégration à une extension. Le pont vers [Yoink](https://getyoink.dev/), l’extension Chrome qui renvoie un élément désigné (sélecteur, HTML, styles calculés, capture) avec une note libre, est donc une extension pi **au niveau utilisateur** (`~/.pi/agent/extensions/yoink/`), hors dépôt.

- Elle sert à désigner un élément dans l’application locale et à demander une correction ciblée à l’agent.
- `yoink-mcp` est publié en `UNLICENSED` : il ne peut être ni vendorisé ni déclaré comme dépendance du dépôt. L’extension ne le lance qu’à la demande (`/yoink setup` ou première utilisation de l’outil), version figée.
- Le jeton d’appairage ne doit pas entrer dans le contexte du modèle ; il est masqué des résultats d’outil et n’est affiché qu’au développeur.
- Usage restreint à l’application locale de développement : jamais de cookies ni de secrets de production.

## Validation

Avant d’utiliser `.mcp.json`, vérifier que le client agent ciblé reconnaît ce format et que Node.js/npx sont disponibles. Le serveur Playwright ne doit pas être un prérequis pour compiler, tester ou auto-héberger Synapse. Le pont Yoink est un confort de développement local : il est optionnel et n’est requis ni pour compiler, ni pour tester, ni pour auto-héberger Synapse.
