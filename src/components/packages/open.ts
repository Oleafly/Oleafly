import { logError } from "@/lib/log";

export function openLatexPackages(): void {
  void import("./LatexPackagesDialog")
    .then((module) => module.showLatexPackagesDialog())
    .catch((error: unknown) => logError("open LaTeX packages", error));
}
