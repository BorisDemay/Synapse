# Smoke WebDriver natif Tauri

Ce smoke ouvre le binaire Tauri localement construit, vérifie que la fenêtre
principale porte le titre `Synapse`, puis attend le parcours de connexion et
ses champs email et mot de passe. Il ne renseigne ni identifiant, ni mot de
passe, ni phrase de déchiffrement, et n'appelle aucune instance Synapse.

`selenium-webdriver` 4.47.0 (Apache-2.0) est la seule dépendance JavaScript
ajoutée : c'est le client WebDriver standard utilisé pour piloter `tauri-driver`
sans ajouter de capability Tauri ni de plugin au produit. Sa version exacte est
verrouillée dans `pnpm-lock.yaml`.

## Prérequis

- binaire `tauri-driver` 2.x disponible dans `PATH` ;
- sous Linux, `WebKitWebDriver` dans `PATH` et une session graphique ou Xvfb ;
- Rust, Node et le gestionnaire indiqué par le champ `packageManager` racine.

Le script supprime d'abord `apps/desktop/dist`, construit explicitement le
binaire debug local avec `tauri build --debug --no-bundle`, attend au plus 60
secondes le driver et la fenêtre, puis ferme toujours la session WebDriver et
le processus driver.

## Exécution

Linux/WSL sans session graphique :

```bash
xvfb-run -a corepack pnpm --filter @synapse/desktop test:e2e:native
```

Windows ou Linux avec session graphique :

```bash
corepack pnpm --filter @synapse/desktop test:e2e:native
```
