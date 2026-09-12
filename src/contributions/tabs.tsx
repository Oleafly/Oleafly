import { lazy } from "react";
import { FileText, FlaskConical, GitBranch, Plug, Search, SearchCode, ShieldCheck } from "lucide-react";
import { registerRailTab } from "@oleafly/registry";
import { i18n } from "@/i18n";
import { useGitStatusStore } from "@/store/git-status";
import { useMcpActivityStore } from "@/store/mcp-activity";
import { SourceControl } from "@/components/layout/SourceControl";
import { PreflightPanel } from "@/components/preflight/PreflightPanel";
import { McpActivityPanel } from "@/components/layout/McpActivityPanel";
import { FilesPanel, ProjectSearch } from "@/components/layout/Sidebar";

const ReferencesPanel = lazy(() =>
  import("@/components/layout/ReferencesPanel").then((module) => ({
    default: module.ReferencesPanel,
  })),
);

const ResearchWorkspacePanel = lazy(() =>
  import("@/components/research/ResearchWorkspacePanel").then((module) => ({ default: module.ResearchWorkspacePanel })),
);

export function registerRailTabs() {
  registerRailTab({
    id: "research",
    label: () => i18n.t(($) => $.shell.rail.research),
    icon: FlaskConical,
    section: "assist",
    order: 60,
    beta: true,
    panel: ResearchWorkspacePanel,
  });
  registerRailTab({
    id: "files",
    label: () => i18n.t(($) => $.shell.rail.files),
    icon: FileText,
    section: "explore",
    order: 10,
    panel: FilesPanel,
  });
  registerRailTab({
    id: "search",
    label: () => i18n.t(($) => $.shell.rail.search),
    icon: Search,
    section: "explore",
    order: 20,
    panel: ProjectSearch,
  });
  registerRailTab({
    id: "source",
    label: () => i18n.t(($) => $.shell.rail.sourceControl),
    icon: GitBranch,
    section: "explore",
    order: 30,
    useBadge: () => useGitStatusStore((s) => s.count),
    panel: SourceControl,
  });
  registerRailTab({
    id: "preflight",
    label: () => i18n.t(($) => $.shell.rail.preflight),
    icon: ShieldCheck,
    section: "review",
    order: 40,
    // Preflight checks target documents, not single figures.
    when: (ctx) => ctx.projectKind !== "image" && ctx.projectKind !== "diagram",
    panel: PreflightPanel,
  });
  registerRailTab({
    id: "refs",
    label: () => i18n.t(($) => $.shell.rail.references),
    icon: SearchCode,
    section: "review",
    order: 50,
    panel: ReferencesPanel,
  });
  // Live log of tools/call traffic from external MCP clients. Only while the
  // local MCP server is running (Settings → Integrations → Oleafly MCP).
  registerRailTab({
    id: "mcp",
    label: () => i18n.t(($) => $.shell.rail.mcp),
    icon: Plug,
    section: "assist",
    order: 65,
    when: (ctx) => !!ctx.mcpEnabled,
    useBadge: () => useMcpActivityStore((s) => s.unread),
    panel: McpActivityPanel,
  });
}
