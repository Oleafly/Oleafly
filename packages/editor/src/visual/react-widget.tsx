import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// One React root per widget element. CodeMirror reuses an element through `updateDOM`,
// so the root, and the component state inside it, outlive each rebuild.
const roots = new WeakMap<HTMLElement, Root>();

export function renderWidget(element: HTMLElement, node: ReactNode): void {
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }
  root.render(node);
}

// Unmounts after CodeMirror finishes its update; React can't unmount during one.
export function unmountWidget(element: HTMLElement): void {
  const root = roots.get(element);
  if (!root) return;
  roots.delete(element);
  queueMicrotask(() => root.unmount());
}

export class WidgetErrorBoundary extends Component<
  { name: string; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${this.props.name} rendering failed`, error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
