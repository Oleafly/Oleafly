import { logError } from "@/lib/log";

export function openTypstUpgrade(version: string | null = null): void {
  void import("./TypstUpgradeDialog")
    .then((module) => module.showTypstUpgradeDialog(version))
    .catch((error: unknown) => logError("open Typst upgrade check", error));
}
