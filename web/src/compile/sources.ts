import type { CompileFile, CompileSources } from "@oleafly/compile-port";
import type { WebApi } from "../api";
import type { WebFile } from "../protocol";

export interface SourceReader {
  api: WebApi;
  projectId: string;
  files(): readonly WebFile[];
  /** The text the browser holds for an open file, edits it hasn't sent yet included. */
  openText(path: string): string | null;
}

/**
 * The project as a compile reads it now: the server's text for every file,
 * this browser's own text for the files it has open, and other files fetched
 * once, when the engine asks for them.
 */
export async function readSources(reader: SourceReader, signal: AbortSignal): Promise<CompileSources> {
  const served = await reader.api.texts(reader.projectId, signal);
  const texts = new Map(served.map((entry) => [entry.path, entry.text]));
  const tree = reader.files();
  const blobs = new Map(tree.filter((file) => file.kind === "blob" && file.blob).map((file) => [file.path, file.blob as string]));
  const files: CompileFile[] = [
    ...served.map((entry) => ({ path: entry.path, kind: "text" as const })),
    ...[...blobs.keys()].map((path) => ({ path, kind: "blob" as const })),
  ];
  const fetched = new Map<string, Promise<Uint8Array | null>>();
  return {
    files,
    text: (path) => (texts.has(path) ? (reader.openText(path) ?? texts.get(path) ?? null) : null),
    bytes(path) {
      const hash = blobs.get(path);
      if (!hash) return Promise.resolve(null);
      let pending = fetched.get(path);
      if (!pending) {
        pending = reader.api.blob(reader.projectId, hash).then(async (blob) => new Uint8Array(await blob.arrayBuffer()));
        fetched.set(path, pending);
      }
      return pending;
    },
  };
}
