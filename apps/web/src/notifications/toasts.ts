import { shallowRef } from "vue";

export type ToastKind = "info" | "success" | "warning" | "error";
export type ToastAction = { label: string; run: () => void | Promise<void> };
export type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
};
type ToastInput = Omit<Toast, "id"> & { duration?: number };

// Ephemeral client-only state. Never serialize vault names, paths or errors.
export const toasts = shallowRef<Toast[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 0;

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

export function clearToasts() {
  for (const id of timers.keys()) dismissToast(id);
  toasts.value = [];
}

export function notify({ duration, ...toast }: ToastInput): number {
  const id = ++nextId;
  if (toasts.value.length >= 4) dismissToast(toasts.value[0]!.id);
  toasts.value = [...toasts.value, { ...toast, id }];
  const lifetime =
    duration ?? (toast.kind === "error" ? 0 : toast.action ? 12000 : 7000);
  if (lifetime > 0)
    timers.set(
      id,
      setTimeout(() => dismissToast(id), lifetime),
    );
  return id;
}
