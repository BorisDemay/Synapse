import { unzip } from "fflate";

const MAX_ENTRIES = 10_000;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 250 * 1024 * 1024;

interface ZipWorkerRequest {
  archive: ArrayBuffer;
}

type ZipWorkerResponse =
  | { kind: "success"; entries: Record<string, Uint8Array> }
  | { kind: "entries" | "bytes" | "invalid" };

interface WorkerScope {
  onmessage: ((event: MessageEvent<ZipWorkerRequest>) => void) | null;
  postMessage(message: ZipWorkerResponse, transfer?: Transferable[]): void;
}

const worker = globalThis as unknown as WorkerScope;

worker.onmessage = ({ data }) => {
  let entryCount = 0;
  let extractedBytes = 0;
  let limitError: "entries" | "bytes" | undefined;
  try {
    unzip(
      new Uint8Array(data.archive),
      {
        filter: (file) => {
          entryCount += 1;
          if (entryCount > MAX_ENTRIES) {
            limitError = "entries";
            return false;
          }
          const originalSize = file.originalSize;
          if (
            originalSize === undefined ||
            !Number.isSafeInteger(originalSize) ||
            originalSize < 0 ||
            originalSize > MAX_ENTRY_BYTES ||
            extractedBytes > MAX_EXTRACTED_BYTES - originalSize
          ) {
            limitError = "bytes";
            return false;
          }
          extractedBytes += originalSize;
          return true;
        },
      },
      (error, entries) => {
        if (error) {
          worker.postMessage({ kind: "invalid" });
          return;
        }
        if (limitError) {
          worker.postMessage({ kind: limitError });
          return;
        }
        const transfer = Object.values(entries).map(
          (entry) => entry.buffer as ArrayBuffer,
        );
        worker.postMessage({ entries, kind: "success" }, transfer);
      },
    );
  } catch {
    worker.postMessage({ kind: "invalid" });
  }
};
