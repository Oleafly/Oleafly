import { Channel, invoke } from "@tauri-apps/api/core";

export type NotebookTool = "quarto" | "calepin";

export type NotebookToolSource = "system" | "managed";

export interface NotebookToolInstall {
  path: string;
  version: string | null;
  source: NotebookToolSource;
}

export interface NotebookToolStatus {
  tool: NotebookTool;
  pinnedVersion: string;
  active: NotebookToolInstall | null;
  system: NotebookToolInstall | null;
  managed: NotebookToolInstall | null;
  offered: boolean;
  downloadBytes: number | null;
  license: string;
  installing: boolean;
}

export type LanguageRuntimeName = "r" | "python" | "julia";

export interface LanguageRuntime {
  name: LanguageRuntimeName;
  path: string | null;
  version: string | null;
}

export interface NotebookToolchainStatus {
  quarto: NotebookToolStatus;
  calepin: NotebookToolStatus;
  runtimes: LanguageRuntime[];
}

export type NotebookInstallPhase = "downloading" | "verifying" | "extracting" | "done";

export interface NotebookInstallProgress {
  tool: NotebookTool;
  phase: NotebookInstallPhase;
  receivedBytes: number;
  totalBytes: number;
}

export const notebookToolchainStatus = () =>
  invoke<NotebookToolchainStatus>("notebook_toolchain_status");

export async function installNotebookTool(
  tool: NotebookTool,
  onProgress: (progress: NotebookInstallProgress) => void,
): Promise<NotebookToolchainStatus> {
  const channel = new Channel<NotebookInstallProgress>();
  channel.onmessage = onProgress;
  try {
    return await invoke<NotebookToolchainStatus>("install_notebook_tool", {
      tool,
      onProgress: channel,
    });
  } finally {
    channel.onmessage = () => {};
  }
}

export const removeNotebookTool = (tool: NotebookTool) =>
  invoke<NotebookToolchainStatus>("remove_notebook_tool", { tool });

export const openCompiledHtml = (projectId: string) =>
  invoke<void>("open_compiled_html", { projectId });
