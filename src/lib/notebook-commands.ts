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
  outdatedSystem?: string | null;
  minimumVersion?: string | null;
  offered: boolean;
  downloadBytes: number | null;
  license: string;
  installing: boolean;
  supersededVersions?: readonly string[];
}

export type LanguageRuntimeName = "r" | "python" | "julia";

export type InstallableRuntime = Exclude<LanguageRuntimeName, "julia">;

export interface RuntimeInstaller {
  version: string;
  downloadBytes: number;
}

export interface RuntimePackage {
  name: string;
  installed: boolean;
}

export interface LanguageRuntime {
  name: LanguageRuntimeName;
  path: string | null;
  version: string | null;
  installer?: RuntimeInstaller | null;
  packages?: readonly RuntimePackage[];
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

export interface RuntimeInstallProgress {
  runtime: InstallableRuntime;
  phase: NotebookInstallPhase;
  receivedBytes: number;
  totalBytes: number;
}

export async function installLanguageRuntime(
  runtime: InstallableRuntime,
  onProgress: (progress: RuntimeInstallProgress) => void,
): Promise<void> {
  const channel = new Channel<RuntimeInstallProgress>();
  channel.onmessage = onProgress;
  try {
    await invoke<void>("install_language_runtime", { runtime, onProgress: channel });
  } finally {
    channel.onmessage = () => {};
  }
}

export const installRPackages = (projectId: string | null, packages: readonly string[]) =>
  invoke<NotebookToolchainStatus>("install_r_packages", { projectId, packages });

export const installPythonPackages = (projectId: string | null, packages: readonly string[]) =>
  invoke<NotebookToolchainStatus>("install_python_packages", { projectId, packages });

export const recheckNotebookToolchain = () => invoke<NotebookToolchainStatus>("recheck_notebook_toolchain");

export const removeNotebookTool = (tool: NotebookTool) =>
  invoke<NotebookToolchainStatus>("remove_notebook_tool", { tool });

export const openCompiledHtml = (projectId: string, mainDocument?: string) =>
  invoke<void>("open_compiled_html", mainDocument === undefined ? { projectId } : { projectId, mainDocument });

export const compiledHtmlPreviewUrl = (projectId: string, mainDocument?: string) =>
  invoke<string>(
    "compiled_html_preview_url",
    mainDocument === undefined ? { projectId } : { projectId, mainDocument },
  );
