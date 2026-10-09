// Captures deterministic Synapse UI screenshots with synthetic local data.
// No real account, server, vault, or secret is used: network routes are mocked,
// notes are disposable fixtures, and the Vite dev server is closed at the end.
import { chromium } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "../../apps/web/node_modules/vite/dist/node/index.js";

const repo = resolve(import.meta.dirname, "../..");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const args = new Map(
  process.argv.slice(2).flatMap((arg) => {
    if (!arg.startsWith("--")) return [];
    const [key, value = "true"] = arg.slice(2).split("=");
    return [[key, value]];
  }),
);
const only = new Set(
  (args.get("only") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);
const outDir = resolve(
  repo,
  args.get("out") ?? `screenshots/synapse-ui-${timestamp}`,
);
mkdirSync(outDir, { recursive: true });

const server = await createServer({
  root: resolve(repo, "apps/web"),
  configFile: resolve(repo, "apps/web/vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});

function wants(name) {
  return only.size === 0 || only.has(name);
}

function usersPayload() {
  return {
    users: [
      {
        activated: true,
        created_at: "2025-01-09T10:00:00.000Z",
        email: "admin@example.test",
        is_admin: true,
      },
      {
        activated: true,
        created_at: "2025-01-10T11:00:00.000Z",
        email: "writer@example.test",
        is_admin: false,
      },
      {
        activated: false,
        created_at: "2025-01-11T12:00:00.000Z",
        email: "pending@example.test",
        is_admin: false,
      },
    ],
  };
}

async function installRoutes(page, origin) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    const method = request.method();

    if (url.pathname === "/auth/signup" && method === "GET") {
      return route.fulfill({ status: 200, json: { public_signup: true } });
    }
    if (url.pathname === "/auth/signup" && method === "POST") {
      return route.fulfill({ status: 201, json: {} });
    }
    if (url.pathname === "/auth/activate") {
      return route.fulfill({ status: 204, body: "" });
    }
    if (url.pathname === "/auth/users") {
      return route.fulfill({ status: 200, json: usersPayload() });
    }
    if (url.pathname === "/auth/sessions") {
      return route.fulfill({
        status: 200,
        json: {
          email: "admin@example.test",
          sessions: [
            {
              created_at: "2025-02-01T09:00:00.000Z",
              current: true,
              id: "current-session",
            },
            {
              created_at: "2025-01-28T18:30:00.000Z",
              current: false,
              id: "linux-laptop",
            },
          ],
        },
      });
    }
    if (url.pathname === "/auth/invitations") {
      return route.fulfill({
        status: 201,
        json: {
          email: "new-user@example.test",
          email_sent: false,
          expires_at: "2025-02-03T09:00:00.000Z",
          is_admin: false,
          token: "screenshot-invitation-token",
        },
      });
    }
    if (url.pathname.startsWith("/auth/")) {
      return route.fulfill({ status: 204, body: "" });
    }
    if (
      url.pathname === "/health/storage" ||
      url.pathname.startsWith("/health/")
    ) {
      return route.fulfill({ status: 200, json: { ok: true } });
    }
    if (url.pathname === "/v1/session") {
      return route.fulfill({ status: 401, json: {} });
    }
    if (url.pathname === "/v1/vaults") {
      return route.fulfill({ status: 200, json: { vaults: [] } });
    }
    if (url.pathname === "/vaults") {
      return route.fulfill({
        status: 201,
        json: { id: "01990000-0000-7000-8000-000000000001" },
      });
    }
    if (url.pathname.startsWith("/v1/")) {
      return route.fulfill({ status: 200, json: {} });
    }
    return route.continue();
  });
}

async function shot(page, name, options = {}) {
  if (!wants(name)) return;
  await page.waitForTimeout(options.delay ?? 250);
  const path = join(outDir, `${name}.png`);
  await page.screenshot({
    animations: "disabled",
    fullPage: options.fullPage ?? true,
    path,
  });
  console.log(path);
}

async function newPage(
  browser,
  origin,
  viewport = { width: 1440, height: 920 },
) {
  const context = await browser.newContext({ colorScheme: "light", viewport });
  const page = await context.newPage();
  await installRoutes(page, origin);
  return { context, page };
}

async function bootstrapVault(page, origin) {
  await page.goto(`${origin}/login`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    const { useAuthStore } = await import("/src/stores/auth.ts");
    const { useVaultStore } = await import("/src/stores/vault.ts");
    const { useAssistantStore } = await import("/src/stores/assistant.ts");
    const { uuidV7 } = await import("/src/crypto/vault-key.ts");
    const auth = useAuthStore();
    const vault = useVaultStore();
    await auth.enterLocalMode();
    await vault.createAndUnlockVault("synthetic screenshot passphrase");

    const roadmapId = uuidV7();
    const apiId = uuidV7();
    const dailyId = uuidV7();
    const deletedId = uuidV7();

    await vault.saveNote({
      id: roadmapId,
      path: "Projects/Roadmap.md",
      content: `---\ntags: [synapse, ux]\nstatus: draft\nowner: local\n---\n# Roadmap chiffrée\n\nCette note synthétique sert uniquement aux captures d’écran.\n\n- Explorer les panneaux\n- Vérifier les menus\n- Préparer une capture complète\n\nLien vers [[Projects/API]].`,
    });
    await vault.saveNote({
      id: roadmapId,
      path: "Projects/Roadmap.md",
      content: `---\ntags: [synapse, ux]\nstatus: review\nowner: local\n---\n# Roadmap chiffrée\n\nCette note synthétique sert uniquement aux captures d’écran.\n\n- Explorer les panneaux\n- Vérifier les menus\n- Préparer une capture complète\n\nLien vers [[Projects/API]].\n\n> Aucun contenu réel n’est utilisé.`,
    });
    await vault.saveNote({
      id: apiId,
      path: "Projects/API.md",
      content:
        "# API locale\n\nBacklink vers [[Projects/Roadmap]].\n\n| Élément | État |\n| --- | --- |\n| Capture | OK |",
    });
    await vault.saveNote({
      id: dailyId,
      path: "Templates/Daily.md",
      content: "# {{title}}\n\n- Fait\n- À suivre\n",
    });
    await vault.saveNote({
      id: deletedId,
      path: "Archive/Ancienne note.md",
      content:
        "# Ancienne note\n\nContenu synthétique supprimé pour montrer le panneau de récupération.",
    });
    await vault.deleteNote(deletedId);
    await vault.createRestorePoint(roadmapId, "Avant revue UX");
    await vault.savePreferences({
      ...vault.preferences,
      pinnedNoteIds: [roadmapId],
      recentNoteIds: [roadmapId, apiId],
      savedSearches: [{ id: uuidV7(), label: "Notes UX", query: "#ux" }],
      templatesPath: "Templates",
    });
    await vault.rememberRecentNote(roadmapId);

    const assistant = useAssistantStore();
    const messages = [
      {
        content: "Résume les panneaux à vérifier.",
        id: "msg-user",
        role: "user",
      },
      {
        content: "Voici une liste synthétique de panneaux et menus à valider.",
        id: "msg-assistant",
        role: "assistant",
      },
    ];
    assistant.connected = false;
    assistant.models = [
      {
        id: "synthetic-fast",
        label: "Synthetic Fast",
        reasoningLevels: [
          { id: "low", label: "Rapide" },
          { id: "high", label: "Approfondi" },
        ],
        serviceTiers: [{ id: "flex", name: "Mode rapide" }],
      },
      { id: "synthetic-careful", label: "Synthetic Careful" },
    ];
    assistant.model = "synthetic-fast";
    assistant.reasoningEffort = "low";
    assistant.conversations = [
      {
        activeConversationId: "conversation-screenshot",
        attachedNoteIds: [roadmapId],
        createdAt: Date.now() - 180000,
        id: "conversation-screenshot",
        messages,
        title: "Préparer le plan de capture",
        updatedAt: Date.now() - 60000,
      },
    ];
    assistant.activeConversationId = "conversation-screenshot";
    assistant.messages = messages;
    assistant.attachNote(roadmapId);

    auth.isLocalMode = false;
    auth.isAuthenticated = true;
    auth.isOfflineSession = false;
    auth.userId = "screenshot-admin";
    auth.email = "admin@example.test";
    auth.isAdmin = true;

    window.__screenshotIds = { apiId, dailyId, roadmapId };
    await document
      .querySelector("#app")
      .__vue_app__.config.globalProperties.$router.push("/vault");
  });
  await page
    .getByRole("textbox", { exact: true, name: "Éditeur Markdown" })
    .waitFor({ timeout: 30000 });
  await page.evaluate(async () => {
    const { clearToasts } = await import("/src/notifications/toasts.ts");
    clearToasts();
  });
}

function makeImportFolder() {
  const dir = mkdtempSync(join(tmpdir(), "synapse-import-"));
  mkdirSync(join(dir, "Imported"), { recursive: true });
  mkdirSync(join(dir, ".obsidian"), { recursive: true });
  writeFileSync(
    join(dir, "Imported", "Capture.md"),
    "# Capture importée\n\nNote synthétique pour prévisualiser l’import.\n",
  );
  writeFileSync(
    join(dir, "Imported", "Second.md"),
    "# Second document\n\nContenu local de test.\n",
  );
  writeFileSync(join(dir, ".obsidian", "workspace.json"), "{}");
  return dir;
}

await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const disposables = [];

try {
  if (
    [
      "01-page-login",
      "02-page-register",
      "03-page-register-success",
      "04-page-activate",
      "05-page-activate-success",
    ].some(wants)
  ) {
    const { context, page } = await newPage(browser, origin);
    await page.goto(`${origin}/login`);
    await page.getByRole("heading", { name: "Bon retour." }).waitFor();
    await shot(page, "01-page-login");

    await page.goto(`${origin}/register`);
    await page
      .getByRole("heading", { name: "Commencez votre espace." })
      .waitFor();
    await shot(page, "02-page-register");
    await page.getByLabel("Email").fill("new-user@example.test");
    await page.getByLabel("Mot de passe").fill("correct horse battery staple");
    await page.getByRole("button", { name: "S’inscrire" }).click();
    await page
      .getByRole("heading", { name: "Consultez votre messagerie." })
      .waitFor();
    await shot(page, "03-page-register-success");

    await page.goto(`${origin}/activate?token=screenshot-token`);
    await page.getByRole("heading", { name: "Activer votre compte" }).waitFor();
    await shot(page, "04-page-activate");
    await page.getByRole("button", { name: "Activer le compte" }).click();
    await page.getByText("Compte activé.").waitFor();
    await shot(page, "05-page-activate-success");
    await context.close();
  }

  if (wants("06-page-unlock-create")) {
    const { context, page } = await newPage(browser, origin);
    await page.goto(`${origin}/login`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(async () => {
      const { useAuthStore } = await import("/src/stores/auth.ts");
      await useAuthStore().enterLocalMode();
      await document
        .querySelector("#app")
        .__vue_app__.config.globalProperties.$router.push("/unlock");
    });
    await page.getByRole("heading", { name: "Créer un coffre" }).waitFor();
    await shot(page, "06-page-unlock-create");
    await context.close();
  }

  if (wants("07-page-admin") || wants("08-menu-admin-role-select")) {
    const { context, page } = await newPage(browser, origin);
    await page.goto(`${origin}/login`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(async () => {
      const { useAuthStore } = await import("/src/stores/auth.ts");
      const auth = useAuthStore();
      auth.isAuthenticated = true;
      auth.isLocalMode = false;
      auth.isOfflineSession = false;
      auth.userId = "screenshot-admin";
      auth.email = "admin@example.test";
      auth.isAdmin = true;
      await document
        .querySelector("#app")
        .__vue_app__.config.globalProperties.$router.push("/admin");
    });
    await page.getByRole("heading", { name: "Administration" }).waitFor();
    await shot(page, "07-page-admin");
    await page.locator("#admin-invite-role").click();
    await page.getByRole("option", { name: "Administrateur" }).waitFor();
    await shot(page, "08-menu-admin-role-select");
    await context.close();
  }

  const vaultNames = [
    "09-page-vault-main",
    "10-panel-search-palette",
    "11-panel-settings-appearance",
    "12-panel-settings-vault",
    "13-panel-settings-device",
    "14-panel-settings-account",
    "15-panel-settings-users",
    "16-panel-deleted-items",
    "17-panel-assistant-connect",
    "18-panel-assistant-chat",
    "19-panel-assistant-conversations",
    "20-panel-note-history",
    "21-panel-quick-assistant",
    "22-menu-vault-note-context",
    "23-panel-import-preview",
    "24-menu-editor-context",
    "25-menu-editor-context-submenu",
    "26-panel-conflict-resolver",
  ];

  if (vaultNames.some(wants)) {
    const { context, page } = await newPage(browser, origin);
    await bootstrapVault(page, origin);
    await shot(page, "09-page-vault-main");

    if (wants("10-panel-search-palette")) {
      await page.keyboard.press("Control+k");
      await page
        .getByRole("dialog", { name: "Recherche dans le coffre" })
        .waitFor();
      await page
        .getByRole("searchbox", { name: "Rechercher une note ou une commande" })
        .fill("ux");
      await shot(page, "10-panel-search-palette");
      await page.keyboard.press("Escape");
    }

    if (
      [
        "11-panel-settings-appearance",
        "12-panel-settings-vault",
        "13-panel-settings-device",
        "14-panel-settings-account",
        "15-panel-settings-users",
      ].some(wants)
    ) {
      await page.getByRole("button", { name: "Ouvrir les paramètres" }).click();
      await page
        .getByRole("dialog", { exact: true, name: "Paramètres" })
        .waitFor();
      await shot(page, "11-panel-settings-appearance");
      for (const [label, file] of [
        ["Coffre", "12-panel-settings-vault"],
        ["Appareil", "13-panel-settings-device"],
        ["Compte", "14-panel-settings-account"],
        ["Utilisateurs", "15-panel-settings-users"],
      ]) {
        const button = page.getByRole("button", { exact: true, name: label });
        if ((await button.count()) && wants(file)) {
          await button.click();
          await shot(page, file);
        }
      }
      await page.getByRole("button", { name: "Fermer les paramètres" }).click();
    }

    if (wants("16-panel-deleted-items")) {
      await page.getByRole("button", { name: "Éléments supprimés" }).click();
      await page.getByRole("heading", { name: "Éléments supprimés" }).waitFor();
      await shot(page, "16-panel-deleted-items");
      await page
        .getByRole("button", { name: "Fermer les éléments supprimés" })
        .click();
    }

    if (wants("17-panel-assistant-connect")) {
      await page.evaluate(async () => {
        const { clearToasts } = await import("/src/notifications/toasts.ts");
        clearToasts();
      });
      await page
        .getByRole("button", { exact: true, name: "Assistant" })
        .click();
      await page.getByRole("heading", { name: "Assistant" }).waitFor();
      await shot(page, "17-panel-assistant-connect");
      await page.getByRole("button", { name: "Fermer l’assistant" }).click();
    }

    if (
      [
        "18-panel-assistant-chat",
        "19-panel-assistant-conversations",
        "20-panel-note-history",
        "21-panel-quick-assistant",
      ].some(wants)
    ) {
      await page.evaluate(async () => {
        const { useAssistantStore } = await import("/src/stores/assistant.ts");
        const assistant = useAssistantStore();
        const roadmapId = window.__screenshotIds.roadmapId;
        const messages = [
          {
            content: "Résume les panneaux à vérifier.",
            id: "msg-user",
            role: "user",
          },
          {
            content:
              "Voici une liste synthétique de panneaux et menus à valider.",
            id: "msg-assistant",
            role: "assistant",
          },
        ];
        assistant.connected = true;
        assistant.models = [
          {
            id: "synthetic-fast",
            label: "Synthetic Fast",
            reasoningLevels: [
              { id: "low", label: "Rapide" },
              { id: "high", label: "Approfondi" },
            ],
            serviceTiers: [{ id: "flex", name: "Mode rapide" }],
          },
          { id: "synthetic-careful", label: "Synthetic Careful" },
        ];
        assistant.model = "synthetic-fast";
        assistant.reasoningEffort = "low";
        assistant.fast = true;
        assistant.conversations = [
          {
            attachedNoteIds: [roadmapId],
            createdAt: Date.now() - 180000,
            id: "conversation-screenshot",
            messages,
            title: "Préparer le plan de capture",
            updatedAt: Date.now() - 60000,
          },
        ];
        assistant.activeConversationId = "conversation-screenshot";
        assistant.messages = messages;
      });
      await page
        .getByRole("button", { exact: true, name: "Assistant" })
        .click();
      await page.getByRole("heading", { name: "Assistant" }).waitFor();
      await shot(page, "18-panel-assistant-chat");
      if (wants("19-panel-assistant-conversations")) {
        await page
          .getByRole("button", {
            name: "Afficher ou masquer les conversations",
          })
          .click();
        await page.getByRole("heading", { name: "Conversations" }).waitFor();
        await shot(page, "19-panel-assistant-conversations");
        await page
          .getByRole("button", { name: "Retour à la conversation" })
          .click();
      }
      if (wants("20-panel-note-history")) {
        await page
          .getByRole("button", {
            name: "Afficher ou masquer l’historique de la note",
          })
          .click();
        await page.getByText("Historique local").waitFor();
        await shot(page, "20-panel-note-history");
        await page
          .getByRole("button", { name: "Fermer l'historique local" })
          .click();
      }
      const closeAssistant = page.getByRole("button", {
        name: "Fermer l’assistant",
      });
      if (await closeAssistant.isVisible().catch(() => false)) {
        await closeAssistant.click();
      }

      if (wants("21-panel-quick-assistant")) {
        await page.keyboard.press("Control+Alt+k");
        await page
          .getByRole("dialog", { name: "Prompt rapide à l’assistant" })
          .waitFor();
        await page
          .getByRole("textbox", { name: "Prompt à envoyer à l’assistant" })
          .fill("Propose un titre synthétique.");
        await shot(page, "21-panel-quick-assistant");
        await page
          .getByRole("button", { name: "Fermer le prompt rapide" })
          .click();
      }
    }

    if (wants("22-menu-vault-note-context")) {
      await page.evaluate(async () => {
        const { useSidebarLayout } = await import(
          "/@fs/root/projects/obsidian_clone/packages/ui/src/index.ts"
        );
        const { useVaultStore } = await import("/src/stores/vault.ts");
        const { clearToasts } = await import("/src/notifications/toasts.ts");
        clearToasts();
        const sidebar = useSidebarLayout();
        sidebar.setCollapsed(false);
        sidebar.setCompact(false);
        const vault = useVaultStore();
        const ids = window.__screenshotIds;
        vault.notes.set(ids.roadmapId, {
          content:
            "# Roadmap chiffrée\n\nNote synthétique restaurée dans l’arbre pour le menu contextuel.",
          path: "Projects/Roadmap.md",
          revision: 2,
        });
        vault.notes.set(ids.apiId, {
          content: "# API locale\n\nBacklink vers [[Projects/Roadmap]].",
          path: "Projects/API.md",
          revision: 1,
        });
      });
      let item = page.locator('.vault-tree-item[data-kind="note"]').first();
      if (
        (await page.locator('.vault-tree-item[data-kind="note"]').count()) === 0
      ) {
        await page
          .locator('.vault-tree-item[data-kind="folder"]')
          .first()
          .click();
        await page.waitForTimeout(150);
        item = page.locator('.vault-tree-item[data-kind="note"]').first();
      }
      await item.click({ button: "right" });
      await page.getByRole("menu", { name: "Actions de la note" }).waitFor();
      await shot(page, "22-menu-vault-note-context");
      await page.keyboard.press("Escape");
    }

    if (wants("23-panel-import-preview")) {
      const importDir = makeImportFolder();
      disposables.push(importDir);
      await page.locator("input[webkitdirectory]").setInputFiles(importDir);
      await page
        .getByRole("heading", { name: "Prévisualisation de l’import" })
        .waitFor({ timeout: 30000 });
      await shot(page, "23-panel-import-preview");
      await page.getByRole("button", { name: "Annuler" }).click();
    }

    if (
      wants("24-menu-editor-context") ||
      wants("25-menu-editor-context-submenu")
    ) {
      await page
        .getByRole("button", { exact: true, name: "Texte brut" })
        .click();
      const editor = page.locator('.vditor-sv[contenteditable="true"]');
      await editor.waitFor();
      await editor.click({ position: { x: 240, y: 100 } });
      await editor.click({ button: "right", position: { x: 260, y: 120 } });
      await page.getByRole("menu", { name: "Outils Markdown" }).waitFor();
      await shot(page, "24-menu-editor-context");
      await page.getByRole("menuitem", { name: /Formater/ }).hover();
      await page.getByRole("menu", { name: "Formater" }).waitFor();
      await shot(page, "25-menu-editor-context-submenu");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    }

    if (wants("26-panel-conflict-resolver")) {
      await page.evaluate(async () => {
        const { useVaultStore } = await import("/src/stores/vault.ts");
        const vault = useVaultStore();
        const id = window.__screenshotIds.roadmapId;
        vault.activeConflict = {
          base: "# Roadmap chiffrée\n\nBase synthétique.",
          conflict: {
            base_ciphertext_hash: "base",
            local_ciphertext_hash: "local",
            operation_id: "conflict-screenshot",
            remote_ciphertext_hash: "remote",
            remote_revision: 7,
          },
          local: "# Roadmap chiffrée\n\nVersion locale synthétique.",
          manualDraft:
            "# Roadmap chiffrée\n\nBrouillon de résolution manuelle.",
          noteId: id,
          remote: "# Roadmap chiffrée\n\nVersion distante synthétique.",
        };
        vault.setSyncStatus("conflict");
      });
      await page
        .getByRole("region", { name: "Résolution de conflit" })
        .waitFor();
      await shot(page, "26-panel-conflict-resolver");
    }

    await context.close();
  }
} finally {
  for (const path of disposables)
    rmSync(path, { force: true, recursive: true });
  await browser.close();
  await server.close();
}

console.log(`\nScreenshots saved in: ${outDir}`);
