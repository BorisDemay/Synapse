const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Focusables d'un dialogue, dans l'ordre du DOM, sans éléments désactivés ou
 * masqués. Utilisé par le piège de Tab et le focus initial.
 */
export function isDialogElementVisible(element: HTMLElement): boolean {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    )
      return false;
  }
  return true;
}

const activeDialogs: DialogFocusController[] = [];

export function getDialogFocusableElements(
  container: HTMLElement,
): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.matches(":disabled") &&
      isDialogElementVisible(element) &&
      element.tabIndex >= 0,
  );
}

export interface DialogFocusControllerOptions {
  getContainer: () => HTMLElement | null;
  onEscape: () => void;
}

/**
 * Gère le focus d'un dialogue modal : focus initial dans le dialogue, piège
 * Tab/Maj+Tab, fermeture sur Échap, et restitution du focus à l'élément qui
 * était actif à l'ouverture.
 */
export class DialogFocusController {
  private readonly options: DialogFocusControllerOptions;
  private opener: HTMLElement | null = null;
  private container: HTMLElement | null = null;

  constructor(options: DialogFocusControllerOptions) {
    this.options = options;
  }

  attach(): void {
    if (this.container) return;
    const active = document.activeElement;
    this.opener = active instanceof HTMLElement ? active : null;
    this.container = this.options.getContainer();
    const container = this.container;
    if (!container) {
      return;
    }
    activeDialogs.push(this);
    document.addEventListener("focusin", this.handleFocusIn, true);
    container.addEventListener("keydown", this.handleKeydown, true);
    const focusables = getDialogFocusableElements(container);
    (focusables[0] ?? container).focus();
  }

  detach(): void {
    const wasActive = activeDialogs.at(-1) === this;
    const index = activeDialogs.indexOf(this);
    if (index !== -1) activeDialogs.splice(index, 1);
    document.removeEventListener("focusin", this.handleFocusIn, true);
    this.container?.removeEventListener("keydown", this.handleKeydown, true);
    this.container = null;
    if (
      wasActive &&
      this.opener?.isConnected &&
      isDialogElementVisible(this.opener)
    ) {
      this.opener.focus();
    }
    this.opener = null;
  }

  private readonly handleFocusIn = (event: FocusEvent) => {
    const container = this.container;
    if (
      activeDialogs.at(-1) !== this ||
      !container?.isConnected ||
      container.contains(event.target as Node)
    )
      return;
    // Native top-layer dialogs own focus independently of custom overlays.
    if ((event.target as Element | null)?.closest?.("dialog[open]")) return;
    (getDialogFocusableElements(container)[0] ?? container).focus();
  };

  private readonly handleKeydown = (event: KeyboardEvent) => {
    const container = this.container;
    if (!container) {
      return;
    }
    if (event.key === "Escape") {
      event.stopPropagation();
      this.options.onEscape();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusables = getDialogFocusableElements(container);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && container.contains(active);
    if (event.shiftKey) {
      if (!inside || active === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      event.preventDefault();
      first.focus();
    }
  };
}
