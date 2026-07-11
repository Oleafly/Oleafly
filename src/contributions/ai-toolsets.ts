import { registerAiToolset } from "@openleaf/registry";
import { createOpenLeafTools, createFigureTools, type ConfirmFn } from "@/lib/ai-tools";

/** The AI chat toolsets shipped with the core app, selected by chat mode. */
export function registerAiToolsets() {
  registerAiToolset({
    id: "project-tools",
    mode: "chat",
    create: (opts: { confirm?: ConfirmFn }) => createOpenLeafTools(opts),
  });
  registerAiToolset({
    id: "figure-tools",
    mode: "figure",
    create: (opts: { confirm?: ConfirmFn; onImage?: (dataUrl: string) => void }) =>
      createFigureTools(opts),
  });
}
