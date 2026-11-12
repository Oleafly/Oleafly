import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { i18n } from "@/i18n";

export interface NodeRoot {
  render: (content: ReactNode) => void;
  unmount: () => void;
}

export function nodeRoot(host: HTMLElement, mount: (host: HTMLElement) => Pick<Root, "render" | "unmount"> = createRoot): NodeRoot {
  const root = mount(host);
  let content: ReactNode;
  let asked = false;
  let ready = false;
  let closed = false;
  const show = () => root.render(<I18nextProvider i18n={i18n}>{content}</I18nextProvider>);
  queueMicrotask(() => {
    ready = true;
    if (asked && !closed) show();
  });
  return {
    render(next) {
      if (closed) return;
      content = next;
      asked = true;
      if (ready) show();
    },
    unmount() {
      if (closed) return;
      closed = true;
      queueMicrotask(() => root.unmount());
    },
  };
}
