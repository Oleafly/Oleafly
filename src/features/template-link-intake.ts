import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { logError } from "@/lib/log";
import { TEMPLATE_LINK_EVENT, templateLinkReady } from "@/lib/tauri";

export function openTemplateLinkLater(link: unknown): Promise<void> {
  return import("@/store/template-link").then(
    (module) => module.openTemplateLink(link),
    (error: unknown) => void logError("open a template link", error),
  );
}

export function useTemplateLinkIntake(): void {
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    listen<unknown>(TEMPLATE_LINK_EVENT, (event) => void openTemplateLinkLater(event.payload))
      .then(async (unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        stop = unlisten;
        const waiting = await templateLinkReady();
        if (waiting) await openTemplateLinkLater(waiting);
      })
      .catch((error: unknown) => void logError("listen for template links", error));
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
}
