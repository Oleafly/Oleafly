import type { Diagnostic } from "@codemirror/lint";
import { i18n } from "@/i18n";
import { loadUniverseIndex, outdatedImports } from "@/lib/typst-universe";

export async function typstPackageHints(text: string, offline: boolean): Promise<Diagnostic[]> {
  if (!text.includes("@preview/")) return [];
  let latest: Map<string, string>;
  try {
    const index = await loadUniverseIndex({ offline });
    latest = new Map(index.packages.map((pkg) => [pkg.name, pkg.version]));
  } catch {
    return [];
  }
  return outdatedImports(text, latest).map((found) => ({
    from: found.from,
    to: found.to,
    severity: "info",
    source: "typst packages",
    message: i18n.t(($) => $.editor.typstPackages.hints.updateAvailable, {
      name: found.name,
      latest: found.latest,
      version: found.version,
    }),
    actions: [
      {
        name: i18n.t(($) => $.editor.typstPackages.hints.update, { version: found.latest }),
        apply: (view, from, to) => {
          view.dispatch({ changes: { from, to, insert: found.latest } });
        },
      },
    ],
  }));
}
