import { useFilesStore } from "@/store/files";

export function installE2ePdfProbe() {
  if (!import.meta.env.DEV) return;
  (window as unknown as { __e2ePdfText?: () => Promise<string> }).__e2ePdfText = async () => {
    const projectId = useFilesStore.getState().projectId;
    if (!projectId) throw new Error("no active project");
    const { readCompiledPdf } = await import("@/lib/tauri");
    const { extractForPreflight } = await import("@oleafly/preflight/pdf-extract");
    const bytes = new Uint8Array(await readCompiledPdf(projectId));
    const ex = await extractForPreflight(bytes);
    return ex.pageText.join("\n");
  };
}
