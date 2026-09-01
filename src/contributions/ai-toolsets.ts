import { registerAiToolset } from "@oleafly/registry";
import { createFigureTools, createOleaflyTools, type ConfirmFn } from "@/lib/ai-tools";
import { createResearchAiTools } from "@/lib/research-tools";

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
    mode: "figure",
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
}
