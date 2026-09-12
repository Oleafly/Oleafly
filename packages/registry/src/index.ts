import type { ComponentType, ReactNode } from "react";

// Registration is static: contributions are registered once at startup,
// before the shell mounts, so readers treat the collections as immutable.
// This is NOT a public plugin API; shapes may change freely.

export interface AppContext {
  projectId: string | null;
  projectKind: string | null;
  theme: "light" | "dark";
  mcpEnabled?: boolean;
  documentEngineId?: string;
  documentEngineLoaded?: boolean;
  activeDocumentPath?: string | null;
  latexToolsEnabled?: boolean;
}

export type Message = string | ((ctx: AppContext) => string);

export interface RailTabContribution {
  id: string;
  label: Message;
  icon: ComponentType<{ className?: string }>;
  section: "explore" | "review" | "assist";
  order: number;
  hidden?: boolean;
  beta?: boolean;
  when?: (ctx: AppContext) => boolean;
  // Called on every render of the tab's button, so it must follow the rules
  // of hooks and the contribution must never change between renders.
  useBadge?: () => number;
  panel: ComponentType;
}

export interface CommandContribution {
  id: string;
  surfaces: readonly ("palette" | "omnibar")[];
  group?: Message;
  label: Message;
  icon?: (ctx: AppContext) => ReactNode;
  hint?: Message;
  keywords?: Message;
  slash?: readonly string[];
  when?: (ctx: AppContext) => boolean;
  order: number;
  run: (ctx: AppContext) => void;
}

// biome-ignore lint/suspicious/noExplicitAny: opts/tools are typed at both app
// ends (contribution + chat surface); the registry is just the meeting point.
export type AiToolsetSource =
  | { kind: "project" }
  | { kind: "figure" }
  | { kind: "skills" }
  | { kind: "mcp"; server: string };

export interface AiToolsetContribution<O = any, T = any> {
  id: string;
  mode: string;
  source?: AiToolsetSource;
  create(opts: O): T;
}

export interface ContextProviderContribution {
  id: string;
  isActive: (ctx: AppContext) => boolean;
  order: number;
}

export interface Registry {
  railTabs: RailTabContribution[];
  commands: CommandContribution[];
  aiToolsets: AiToolsetContribution[];
  contextProviders: ContextProviderContribution[];
}

export const registry: Registry = {
  railTabs: [],
  commands: [],
  aiToolsets: [],
  contextProviders: [],
};

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

export function registerRailTab(tab: RailTabContribution): void {
  registry.railTabs.push(tab);
  registry.railTabs.sort(byOrder);
}

export function registerCommand(cmd: CommandContribution): void {
  registry.commands.push(cmd);
  registry.commands.sort(byOrder);
}

export function registerAiToolset(toolset: AiToolsetContribution): void {
  registry.aiToolsets.push(toolset);
}

export function registerContextProvider(c: ContextProviderContribution): void {
  registry.contextProviders.push(c);
  registry.contextProviders.sort(byOrder);
}

export function activeContextProvider(
  ctx: AppContext,
): ContextProviderContribution | undefined {
  return registry.contextProviders.find((p) => p.isActive(ctx));
}

export function railSections(ctx: AppContext): RailTabContribution[][] {
  const sections: RailTabContribution["section"][] = ["explore", "review", "assist"];
  return sections
    .map((s) =>
      registry.railTabs.filter(
        (t) => t.section === s && !t.hidden && (t.when?.(ctx) ?? true),
      ),
    )
    .filter((group) => group.length > 0);
}

export function commandsFor(
  surface: "palette" | "omnibar",
  ctx: AppContext,
): CommandContribution[] {
  return registry.commands.filter(
    (c) => c.surfaces.includes(surface) && (c.when?.(ctx) ?? true),
  );
}

function resolveMessage(value: Message | undefined, ctx: AppContext): string {
  if (value === undefined) return "";
  return typeof value === "function" ? value(ctx) : value;
}

export function railTabLabel(tab: RailTabContribution, ctx: AppContext): string {
  return resolveMessage(tab.label, ctx);
}

export function commandLabel(c: CommandContribution, ctx: AppContext): string {
  return resolveMessage(c.label, ctx);
}

export function commandGroup(c: CommandContribution, ctx: AppContext): string | undefined {
  return c.group === undefined ? undefined : resolveMessage(c.group, ctx);
}

export function commandHint(c: CommandContribution, ctx: AppContext): string | undefined {
  return c.hint === undefined ? undefined : resolveMessage(c.hint, ctx);
}

export function commandKeywords(c: CommandContribution, ctx: AppContext): string {
  return resolveMessage(c.keywords, ctx);
}
