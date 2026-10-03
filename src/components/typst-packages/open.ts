import { logError } from "@/lib/log";

export function openTypstPackages(): void {
  void import("./TypstPackagesDialog")
    .then((module) => module.showTypstPackagesDialog())
    .catch((error: unknown) => logError("open Typst packages", error));
}
