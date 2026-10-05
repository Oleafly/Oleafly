import { carriesFilePaths, carriesFiles } from "@/lib/external-drop-guard";
import { mimeForPath } from "@/lib/image-mime";
import { logError } from "@/lib/log";
import { readDroppedFile, takeDroppedPaths } from "@/lib/tauri";

export interface NativeDroppedFile {
  name: string;
  read: () => Promise<File>;
}

export function isNativeFileDrop(transfer: DataTransfer | null | undefined): boolean {
  const types = Array.from(transfer?.types ?? []);
  return carriesFilePaths(transfer) && !carriesFiles(transfer) && !types.includes("text/plain");
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export async function takeNativeDrop(): Promise<NativeDroppedFile[]> {
  const paths = await takeDroppedPaths().catch((error: unknown) => {
    void logError("read dropped paths", error);
    return [];
  });
  return paths.map((path) => {
    const name = baseName(path);
    return {
      name,
      read: async () => new File([await readDroppedFile(path)], name, { type: mimeForPath(name) }),
    };
  });
}
