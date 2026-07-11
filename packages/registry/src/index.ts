import type { ComponentType, ReactNode } from "react";

/**
 * @openleaf/registry — the internal contribution registry. Features (in-app
 * modules today, packages later) declare rail tabs, commands, and AI toolsets
 * here; the app shell (Rail, Sidebar, palette, omnibar, chat) renders whatever
 * is registered instead of hard-wiring feature lists.
 *
 * Registration is static: contributions are registered once at startup,
 * before the shell mounts, so readers treat the collections as immutable.
 * This is NOT a public plugin API; shapes may change freely.
 */

/** App state a contribution may condition on, built by the rendering surface
 *  from its own subscriptions (so visibility stays reactive). */
export interface AppContext {
  projectId: string | null;
  /** "tex", "image", ... or null when no project is open. */
  projectKind: string | null;
  theme: "light" | "dark";
}

/** A tab on the left rail plus the sidebar panel it opens. */
export interface RailTabContribution {
  id: string;
  /** Tooltip / aria label (include any shortcut hint, e.g. "(Shift-F12)"). */
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Visual group on the rail; consecutive non-empty sections get a divider. */
  section: "explore" | "review" | "assist";
  /** Sort key within the whole rail (ascending). */
  order: number;
  /** Hide from the rail but still resolve the panel (legacy/state-only tabs). */
  hidden?: boolean;
  when?: (ctx: AppContext) => boolean;
  /**
   * Optional live badge count. This is a React hook: it is called on every
   * render of the tab's button, so it must follow the rules of hooks and the
   * contribution must never change between renders.
   */
  useBadge?: () => number;
  /** The sidebar panel rendered while this tab is active. */
  panel: ComponentType;
}

/** An action offered on the command palette (Cmd+K) and/or omnibar (Cmd+P). */
export interface CommandContribution {
  id: string;
  surfaces: readonly ("palette" | "omnibar")[];
  /** Palette group heading; groups render in first-registered order. */
  group?: string;
  label: string | ((ctx: AppContext) => string);
  icon?: (ctx: AppContext) => ReactNode;
  /** Right-aligned shortcut hint on the palette, e.g. "⌘↵". */
  hint?: string;
  /** Extra match keywords for omnibar search. */
  keywords?: string;
  when?: (ctx: AppContext) => boolean;
  /** Sort key within the surface/group (ascending). */
  order: number;
  run: (ctx: AppContext) => void;
}

/** A toolset the AI chat hands to the model, selected by chat mode. */
// biome-ignore lint/suspicious/noExplicitAny: opts/tools are typed at both app
// ends (contribution + chat surface); the registry is just the meeting point.
export interface AiToolsetContribution<O = any, T = any> {
  id: string;
  /** The chat mode this toolset serves, e.g. "chat" or "figure". */
  mode: string;
  create(opts: O): T;
}

export interface Registry {
  railTabs: RailTabContribution[];
  commands: CommandContribution[];
  aiToolsets: AiToolsetContribution[];
}

export const registry: Registry = { railTabs: [], commands: [], aiToolsets: [] };

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

/** Visible rail tabs for a context, grouped by section in rail order. */
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

/** Commands for a surface and context, in registration order. */
export function commandsFor(
  surface: "palette" | "omnibar",
  ctx: AppContext,
): CommandContribution[] {
  return registry.commands.filter(
    (c) => c.surfaces.includes(surface) && (c.when?.(ctx) ?? true),
  );
}

/** Resolve a command's display label. */
export function commandLabel(c: CommandContribution, ctx: AppContext): string {
  return typeof c.label === "function" ? c.label(ctx) : c.label;
}
