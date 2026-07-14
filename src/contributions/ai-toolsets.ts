import { registerAiToolset } from "@openleaf/registry";
import { createOpenLeafTools, createFigureTools, type ConfirmFn } from "@/lib/ai-tools";

export function registerAiToolsets() {
  registerAiToolset({
    id: "project-tools",
    mode: "chat",
    create: (opts: { confirm?: ConfirmFn; onImage?: (dataUrl: string) => void }) =>
      createOpenLeafTools(opts),
  });
  registerAiToolset({
    id: "figure-tools",
    mode: "figure",
    create: (opts: { confirm?: ConfirmFn; onImage?: (dataUrl: string) => void }) =>
      createFigureTools(opts),
  });
}
