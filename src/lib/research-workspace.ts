import { invoke } from "@tauri-apps/api/core";

export type ResearchRootRole = "references" | "data" | "analysis" | "manuscript";
export type ResearchRootAccess = "read_only" | "read_write";
export type ResearchRootConsumer = "native" | "acp" | "task";
export type ResearchDocumentEngine = "latex" | "typst" | "markdown";
export type ResearchStarter =
  | "article"
  | "literature_review"
  | "thesis"
  | "reproducible_analysis";

export interface LinkedResearchRoot {
  id: string;
  canonicalPath: string;
  identity: string;
  label: string;
  role: ResearchRootRole;
  access: ResearchRootAccess;
  createdAtMs: number;
}

export interface ResearchWorkspace {
  version: number;
  primaryProjectId: string;
  roots: LinkedResearchRoot[];
  updatedAtMs: number;
}

export interface AddResearchRootRequest {
  projectId: string;
  path: string;
  label: string;
  role: ResearchRootRole;
  access?: ResearchRootAccess;
}

export interface UpdateResearchRootRequest {
  projectId: string;
  rootId: string;
  label: string;
  role: ResearchRootRole;
  access: ResearchRootAccess;
}

export interface ResearchRootCapability {
  rootId: string;
  label: string;
  role: ResearchRootRole;
  configuredAccess: ResearchRootAccess;
  effectiveAccess: ResearchRootAccess;
  canonicalPath: string | null;
  exposure: "native_capability" | "native_read_context" | "context_only";
}

export interface ResearchRootFileEntry {
  relativePath: string;
  name: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
}

export interface ResearchRootListing {
  rootId: string;
  path: string;
  entries: ResearchRootFileEntry[];
  truncated: boolean;
}

export interface ResearchRootFileContent {
  rootId: string;
  relativePath: string;
  content: string;
  bytesRead: number;
  truncated: boolean;
  isBinary: boolean;
}

export interface ResearchProjectRequest {
  name: string;
  engine: ResearchDocumentEngine;
  starter: ResearchStarter;
}

export interface ResearchProjectFilePreview {
  path: string;
  kind: "file" | "directory";
  content?: string;
}

export interface ResearchProjectPreview {
  name: string;
  engine: ResearchDocumentEngine;
  starter: ResearchStarter;
  mainDocument: string;
  initialTask: string;
  files: ResearchProjectFilePreview[];
}

export interface ResearchProjectSetupProgress {
  projectId: string | null;
  initialTaskReady: boolean;
}

export class ResearchProjectSetupStageError extends Error {
  constructor(
    public readonly stage: "project" | "task" | "open",
    message: string,
    public readonly projectId: string | null,
  ) {
    super(message);
    this.name = "ResearchProjectSetupStageError";
  }
}

export const getResearchWorkspace = (projectId: string) =>
  invoke<ResearchWorkspace>("get_research_workspace", { projectId });

export const addResearchRoot = (request: AddResearchRootRequest) =>
  invoke<ResearchWorkspace>("add_research_root", { request });

export const updateResearchRoot = (request: UpdateResearchRootRequest) =>
  invoke<ResearchWorkspace>("update_research_root", { request });

export const removeResearchRoot = (projectId: string, rootId: string) =>
  invoke<ResearchWorkspace>("remove_research_root", { projectId, rootId });

export const listResearchRootFiles = (
  projectId: string,
  rootId: string,
  relativePath = "",
  maxDepth = 3,
) =>
  invoke<ResearchRootListing>("list_research_root_files", {
    projectId,
    rootId,
    relativePath,
    maxDepth,
  });

export const readResearchRootFile = (
  projectId: string,
  rootId: string,
  relativePath: string,
  maxBytes = 256 * 1024,
) =>
  invoke<ResearchRootFileContent>("read_research_root_file", {
    projectId,
    rootId,
    relativePath,
    maxBytes,
  });

export const writeResearchRootFile = (
  projectId: string,
  rootId: string,
  relativePath: string,
  content: string,
) =>
  invoke<void>("write_research_root_file", {
    projectId,
    rootId,
    relativePath,
    content,
  });

export const getResearchRootCapabilities = (
  projectId: string,
  consumer: ResearchRootConsumer,
) =>
  invoke<ResearchRootCapability[]>("research_root_capabilities", {
    projectId,
    consumer,
  });

export const previewResearchProject = (request: ResearchProjectRequest) =>
  invoke<ResearchProjectPreview>("preview_research_project", { request });

export const createResearchProject = (request: ResearchProjectRequest) =>
  invoke<string>("create_research_project", { request });

export async function finishResearchProjectSetup({
  request,
  task,
  progress,
  ensureInitialTask,
  onCreated,
  onProgress,
  createProject = createResearchProject,
}: {
  request: ResearchProjectRequest;
  task: { title: string; prompt: string; starter: ResearchStarter };
  progress: ResearchProjectSetupProgress;
  ensureInitialTask: (task: {
    projectId: string;
    title: string;
    prompt: string;
    starter: ResearchStarter;
  }) => void | Promise<void>;
  onCreated: (projectId: string) => void | Promise<void>;
  onProgress: (progress: ResearchProjectSetupProgress) => void;
  createProject?: (request: ResearchProjectRequest) => Promise<string>;
}): Promise<void> {
  let projectId = progress.projectId;
  let initialTaskReady = progress.initialTaskReady;
  if (!projectId) {
    try {
      projectId = await createProject(request);
    } catch (cause) {
      throw new ResearchProjectSetupStageError(
        "project",
        cause instanceof Error ? cause.message : String(cause),
        null,
      );
    }
    onProgress({ projectId, initialTaskReady: false });
  }
  if (!initialTaskReady) {
    try {
      await ensureInitialTask({ projectId, ...task });
    } catch (cause) {
      throw new ResearchProjectSetupStageError(
        "task",
        cause instanceof Error ? cause.message : String(cause),
        projectId,
      );
    }
    initialTaskReady = true;
    onProgress({ projectId, initialTaskReady });
  }
  try {
    await onCreated(projectId);
  } catch (cause) {
    throw new ResearchProjectSetupStageError(
      "open",
      cause instanceof Error ? cause.message : String(cause),
      projectId,
    );
  }
}
