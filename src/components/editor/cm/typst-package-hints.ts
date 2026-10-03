import { linter, type Diagnostic } from "@codemirror/lint";
import { useSettingsStore } from "@/store/settings";

async function packageHints(text: string): Promise<Diagnostic[]> {
  try {
    const { typstPackageHints } = await import("@/lib/typst-package-hints");
    return await typstPackageHints(text, useSettingsStore.getState().offline);
  } catch {
    return [];
  }
}

export function createTypstPackageHintLinter() {
  return linter((view) => packageHints(view.state.doc.toString()), {
    delay: 1500,
    tooltipFilter: () => [],
  });
}
