import { readonly, ref, type DeepReadonly, type Ref } from "vue";

export type UpdateState =
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "applying"
  | "error";

export interface UpdateMetadata {
  version: string;
  commitSha: string;
  publishedAt: string;
  releaseNotes: string;
}

export interface UpdateSnapshot {
  state: UpdateState;
  metadata: UpdateMetadata | null;
  progress: number | null;
  error: string | null;
}

export interface UpdateProvider {
  check(): Promise<UpdateMetadata | null>;
  prepare?(
    metadata: UpdateMetadata,
    onProgress: (progress: number) => void,
  ): Promise<void>;
  apply(metadata: UpdateMetadata): Promise<void>;
}

export interface UpdateCoordinator {
  readonly activationLabel: string;
  readonly snapshot: DeepReadonly<Ref<UpdateSnapshot>>;
  check(): Promise<void>;
  apply(): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "update failed";
}

export function createUpdateCoordinator(
  provider: UpdateProvider,
  options: { activationLabel?: string } = {},
): UpdateCoordinator {
  const snapshot = ref<UpdateSnapshot>({
    error: null,
    metadata: null,
    progress: null,
    state: "idle",
  });
  const preparedVersions = new Set<string>();
  let activeCheck: Promise<void> | null = null;

  async function runCheck(): Promise<void> {
    snapshot.value = {
      error: null,
      metadata: snapshot.value.metadata,
      progress: snapshot.value.progress,
      state: "checking",
    };
    try {
      const metadata = await provider.check();
      if (!metadata) {
        snapshot.value = {
          error: null,
          metadata: null,
          progress: null,
          state: "idle",
        };
        return;
      }
      if (provider.prepare && !preparedVersions.has(metadata.version)) {
        snapshot.value = {
          error: null,
          metadata,
          progress: 0,
          state: "downloading",
        };
        await provider.prepare(metadata, (progress) => {
          snapshot.value = {
            ...snapshot.value,
            progress: Math.min(1, Math.max(0, progress)),
          };
        });
        preparedVersions.add(metadata.version);
      }
      snapshot.value = {
        error: null,
        metadata,
        progress: provider.prepare ? 1 : null,
        state: "ready",
      };
    } catch (error) {
      snapshot.value = {
        ...snapshot.value,
        error: errorMessage(error),
        state: "error",
      };
    }
  }

  return {
    activationLabel: options.activationLabel ?? "Appliquer",
    snapshot: readonly(snapshot),
    check() {
      if (
        snapshot.value.state === "ready" ||
        snapshot.value.state === "applying"
      ) {
        return Promise.resolve();
      }
      if (!activeCheck) {
        activeCheck = runCheck().finally(() => {
          activeCheck = null;
        });
      }
      return activeCheck;
    },
    async apply() {
      if (snapshot.value.state !== "ready" || !snapshot.value.metadata) return;
      const metadata = snapshot.value.metadata;
      snapshot.value = { ...snapshot.value, error: null, state: "applying" };
      try {
        await provider.apply(metadata);
      } catch (error) {
        snapshot.value = {
          ...snapshot.value,
          error: errorMessage(error),
          state: "error",
        };
      }
    },
  };
}

export function startUpdateChecks(
  coordinator: Pick<UpdateCoordinator, "check">,
  target: Window = window,
  intervalMs = 15 * 60 * 1_000,
): () => void {
  const check = () => void coordinator.check();
  const onFocus = () => check();
  const onOnline = () => check();
  target.addEventListener("focus", onFocus);
  target.addEventListener("online", onOnline);
  const interval = target.setInterval(check, intervalMs);
  check();
  return () => {
    target.removeEventListener("focus", onFocus);
    target.removeEventListener("online", onOnline);
    target.clearInterval(interval);
  };
}
