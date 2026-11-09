import type { AssistantScopeModelMemory } from "./scope-model-memory";
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
  type RefObject,
  type UIEventHandler,
} from "react";
import type { AiToolsHost } from "@oleafly/ai-tools";
import type { ModelSelectorGroup } from "@/components/ai/ModelSelector";
import type { ComposerCommand } from "@/components/ai/composer-command-registry";
import type { ChatComposerHandle, MentionItem } from "@/components/ai/composer/ChatComposer";
import type { ConfirmFn } from "@/lib/ai-tools";
import type { MentionAttachment } from "@/lib/chat-attachments";
import type { RuntimeToolset } from "@/lib/ai-tool-availability";
import type { DocumentEngineDescriptor, FileEntry } from "@/lib/tauri";
import { WORKSPACE_ASSISTANT_SCOPE } from "@/components/ai/chat-run-registry";
import { useAssistantRuntimeStore, type AssistantRuntime } from "@/store/assistant-runtime";
import { useFilesStore } from "@/store/files";

export { WORKSPACE_ASSISTANT_SCOPE };

export interface AssistantScopeRun {
  projectId: string;
  confirm: ConfirmFn;
  onImage: (dataUrl: string) => void;
  runId: () => string | null;
  isActive: () => boolean;
}

export interface AssistantScopePrompt {
  tools: readonly string[];
  context: string;
  goalLine: string;
  custom: string;
}

export interface AssistantScopeToolCall {
  name: string;
  args: unknown;
}

export interface AssistantScopeFeatures {
  checkpoints: boolean;
  turnChanges: boolean;
  outputs: boolean;
  handoff: boolean;
  figures: boolean;
  promptShortcuts: boolean;
  homeSuggestions: boolean;
}

export interface AssistantScopeComposer {
  handle?: RefObject<ChatComposerHandle | null>;
  placeholder?: string;
  modelGroups?: readonly ModelSelectorGroup[];
  onPickModelGroup?: (providerId: string, modelId: string) => boolean;
  slashCommands?: (send: (text: string) => void) => ComposerCommand[];
  frame?: (composer: ReactNode, working: boolean) => ReactNode;
  shellClassName?: string;
  textareaLabel?: string;
}

export interface AssistantScopeMentions {
  items: (query: string) => MentionItem[];
  paths: readonly string[];
  attachments: (text: string) => Promise<MentionAttachment[]>;
}

export interface AssistantScopeLayout {
  render: (parts: AssistantLayoutParts) => ReactNode;
}

export interface AssistantLayoutParts {
  working: boolean;
  hasMessages: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
  messages: ReactNode;
  footer: ReactNode;
  composer: ReactNode;
  dialogs: ReactNode;
  newChat: () => void;
  openHistory: () => void;
  stop: () => void;
  chatCount: number;
  canStartChat: boolean;
  setup: ReactNode | null;
}

export interface AssistantScopeValue {
  key: string;
  kind: "workspace" | "note";
  projectId: string | null;
  projectName: string | null;
  projectKind: string | null;
  engine: DocumentEngineDescriptor;
  engineLoaded: boolean;
  tree: readonly FileEntry[];
  currentProjectId: () => string | null;
  currentTree: () => readonly FileEntry[];
  mainDoc: () => string;
  cachedContent: (path: string) => string | undefined;
  toolHost?: AiToolsHost;
  toolAdditions?: (run: AssistantScopeRun) => RuntimeToolset[];
  excludedNames: readonly string[];
  contextBlock?: (query: string) => Promise<string>;
  networkNeedsApproval?: boolean;
  systemPrompt?: (input: AssistantScopePrompt) => string;
  guardToolCall?: (call: AssistantScopeToolCall) => string | null;
  setRuntime: (runtime: AssistantRuntime) => void;
  features: AssistantScopeFeatures;
  composer?: AssistantScopeComposer;
  mentions?: AssistantScopeMentions;
  layout?: AssistantScopeLayout;
  modelMemory?: AssistantScopeModelMemory;
}

export const WORKSPACE_FEATURES: AssistantScopeFeatures = {
  checkpoints: true,
  turnChanges: true,
  outputs: true,
  handoff: true,
  figures: true,
  promptShortcuts: true,
  homeSuggestions: true,
};

const NO_EXCLUDED_NAMES: readonly string[] = [];

const AssistantScopeContext = createContext<AssistantScopeValue | null>(null);

export function AssistantScopeProvider({
  value,
  children,
}: Readonly<{ value: AssistantScopeValue; children: ReactNode }>) {
  return <AssistantScopeContext.Provider value={value}>{children}</AssistantScopeContext.Provider>;
}

export function useProvidedAssistantScope(): AssistantScopeValue | null {
  return useContext(AssistantScopeContext);
}

function workspaceMainDoc(): string {
  const files = useFilesStore.getState();
  return files.mainDoc || files.engine.main_document || "main.tex";
}

function workspaceProjectId(): string | null {
  return useFilesStore.getState().projectId;
}

function workspaceTree(): readonly FileEntry[] {
  return useFilesStore.getState().tree;
}

function workspaceCachedContent(path: string): string | undefined {
  return useFilesStore.getState().files[path]?.content;
}

function setWorkspaceRuntime(runtime: AssistantRuntime): void {
  useAssistantRuntimeStore.getState().setRuntime(runtime);
}

export function useWorkspaceAssistantScope(): AssistantScopeValue {
  const projectId = useFilesStore((s) => s.projectId);
  const projectName = useFilesStore((s) => s.projectName);
  const engine = useFilesStore((s) => s.engine);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const projectKind = useFilesStore((s) => s.projectKind);
  const tree = useFilesStore((s) => s.tree);
  return useMemo(
    () => ({
      key: WORKSPACE_ASSISTANT_SCOPE,
      kind: "workspace" as const,
      projectId,
      projectName,
      projectKind,
      engine,
      engineLoaded,
      tree,
      currentProjectId: workspaceProjectId,
      currentTree: workspaceTree,
      mainDoc: workspaceMainDoc,
      cachedContent: workspaceCachedContent,
      excludedNames: NO_EXCLUDED_NAMES,
      setRuntime: setWorkspaceRuntime,
      features: WORKSPACE_FEATURES,
    }),
    [engine, engineLoaded, projectId, projectKind, projectName, tree],
  );
}
