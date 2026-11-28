import type { CompileError } from "@/lib/tauri";
import type { InstallableRuntime } from "@/lib/notebook-commands";

export type RuntimeNeed =
  | { readonly kind: "runtime"; readonly runtime: InstallableRuntime }
  | { readonly kind: "packages"; readonly runtime: InstallableRuntime; readonly packages: readonly string[] };

const JUPYTER = "jupyter";
const DOCUMENT_PACKAGES: ReadonlySet<string> = new Set(["knitr", "rmarkdown", JUPYTER]);

function needFor(error: CompileError): RuntimeNeed | null {
  const named = error.params?.package;
  switch (error.code) {
    case "notebook.r_missing":
      return { kind: "runtime", runtime: "r" };
    case "notebook.python_missing":
      return { kind: "runtime", runtime: "python" };
    case "notebook.jupyter_missing":
    case "notebook.jupyter_missing_command":
      return { kind: "packages", runtime: "python", packages: [JUPYTER] };
    case "notebook.r_package_missing":
      return named ? { kind: "packages", runtime: "r", packages: [named] } : null;
    case "notebook.python_module_missing":
      return named ? { kind: "packages", runtime: "python", packages: [named] } : null;
    default:
      return null;
  }
}

export function runtimeNeedFor(errors: readonly CompileError[], codeAllowed: boolean): RuntimeNeed | null {
  for (const error of errors) {
    const need = needFor(error);
    if (!need) continue;
    if (need.kind === "packages" && !codeAllowed && need.packages.some((name) => !DOCUMENT_PACKAGES.has(name))) {
      continue;
    }
    return need;
  }
  return null;
}

export function packageLabel(name: string): string {
  return name === JUPYTER ? "Jupyter" : name;
}
