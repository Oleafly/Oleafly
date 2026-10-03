import { logError } from "@/lib/log";

export function openTypstExport(): void {
  void import("./TypstExportDialog")
    .then((module) => module.showTypstExportDialog())
    .catch((error: unknown) => logError("open Typst export", error));
}
