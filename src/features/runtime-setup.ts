import type { RuntimeNeed } from "@/lib/runtime-needs";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { openNotebookToolSettings, runtimeIn, useNotebookToolchainStore } from "@/store/notebook-toolchain";

function recompileIfOpen(projectId: string): void {
  if (useFilesStore.getState().projectId === projectId) void useCompileStore.getState().recompile();
}

export async function acceptRuntimeNeed(projectId: string, need: RuntimeNeed): Promise<void> {
  const store = useNotebookToolchainStore.getState();
  if (need.kind === "packages") {
    if (await store.installRuntimePackages(need.runtime, need.packages, projectId)) recompileIfOpen(projectId);
    return;
  }
  if (store.awaitingInstaller.includes(need.runtime)) {
    const status = await store.recheck();
    if (runtimeIn(status, need.runtime)?.path) recompileIfOpen(projectId);
    return;
  }
  const status = store.status ?? (await store.ensureLoaded());
  const runtime = runtimeIn(status, need.runtime);
  if (runtime?.path) {
    recompileIfOpen(projectId);
    return;
  }
  if (!runtime?.installer) {
    openNotebookToolSettings("quarto");
    return;
  }
  await store.installRuntime(need.runtime);
}
