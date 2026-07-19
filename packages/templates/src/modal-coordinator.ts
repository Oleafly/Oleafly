export interface ModalRegistration {
  id: symbol;
  restore: HTMLElement[];
  logicalOverlay: HTMLElement | null;
}

export function visibleFocusable(elements: HTMLElement[]): HTMLElement[] {
  return elements.filter((element) => {
    if (element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;
    if (typeof window === "undefined") return true;
    let current: HTMLElement | null = element;
    while (current) {
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden") return false;
      current = current.parentElement;
    }
    return true;
  });
}

export class ModalCoordinator {
  private stack: ModalRegistration[] = [];

  add(opener: HTMLElement | null, logicalOverlay: HTMLElement | null = null): symbol {
    const id = Symbol("modal");
    this.stack.push({ id, restore: opener ? [opener] : [], logicalOverlay });
    return id;
  }

  isTop(id: symbol): boolean {
    return this.stack.at(-1)?.id === id;
  }

  remove(id: symbol): HTMLElement | null {
    const index = this.stack.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    const wasTop = index === this.stack.length - 1;
    const [removed] = this.stack.splice(index, 1);
    if (!wasTop) {
      const above = this.stack[index];
      if (above) above.restore.push(...removed.restore);
      return null;
    }
    return removed.restore.find((element) => element.isConnected) ?? null;
  }

  size(): number {
    return this.stack.length;
  }

  topOverlay(): HTMLElement | null {
    return this.stack.at(-1)?.logicalOverlay ?? null;
  }
}

const key = Symbol.for("openleaf.modal-coordinator");
const shared = globalThis as typeof globalThis & { [key]?: ModalCoordinator };
export const modalCoordinator = shared[key] ??= new ModalCoordinator();
