import { registerAiToolset } from "@oleafly/registry";
import { createFigureTools, createOleaflyTools, type ConfirmFn } from "@/lib/ai-tools";
import { createResearchAiTools } from "@/lib/research-tools";
import { createOverleafAiTools } from "@/lib/overleaf-ai-tools";
import { createDesktopAppsTools } from "@/lib/desktop-apps";

let registered = false;

export function registerAiToolsets() {
  if (registered) return;
  registered = true;
  registerAiToolset({
    id: "project-tools",
    mode: "chat",
    source: { kind: "project" },
    create: (opts: {
      confirm?: ConfirmFn;
      onImage?: (dataUrl: string) => void;
      runId?: () => string | null;
    }) =>
      createOleaflyTools(opts),
  });
  registerAiToolset({
    id: "figure-tools",
    mode: "chat",
    source: { kind: "figure" },
    create: (opts: { confirm?: ConfirmFn; onImage?: (dataUrl: string) => void }) =>
      createFigureTools(opts),
  });
  registerAiToolset({
    id: "research-tools",
    mode: "chat",
    source: { kind: "project" },
    create: (opts: { confirm?: ConfirmFn }) => createResearchAiTools(opts),
  });
  registerAiToolset({
    id: "overleaf-tools",
    mode: "chat",
    source: { kind: "project" },
    create: (opts: { confirm?: ConfirmFn }) => createOverleafAiTools(opts),
  });
  // 0.4.8 I: present only once Desktop apps are on; Rust runs the calls.
  registerAiToolset({
    id: "desktop-apps",
    mode: "chat",
    source: { kind: "project" },
    create: () => createDesktopAppsTools(),
  });
}
