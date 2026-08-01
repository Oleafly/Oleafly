import { lazy } from "react";
import { FileText, GitBranch, Plug, Search, SearchCode, ShieldCheck, Sparkles } from "lucide-react";
import { registerRailTab } from "@oleafly/registry";
import { useGitStatusStore } from "@/store/git-status";
import { useMcpActivityStore } from "@/store/mcp-activity";
import { FilesPanel, ProjectSearch } from "@/components/layout/Sidebar";

// Rail panels stay lazy so their dependencies (AI SDK, git views, pdf.js
// consumers) load on first open instead of riding in the entry chunk.
const ReferencesPanel = lazy(() =>
  import("@/components/layout/ReferencesPanel").then((module) => ({
    default: module.ReferencesPanel,
  })),
);
const SourceControl = lazy(() =>
  import("@/components/layout/SourceControl").then((module) => ({
    default: module.SourceControl,
  })),
);
const PreflightPanel = lazy(() =>
  import("@/components/preflight/PreflightPanel").then((module) => ({
    default: module.PreflightPanel,
  })),
);
const McpActivityPanel = lazy(() =>
  import("@/components/layout/McpActivityPanel").then((module) => ({
    default: module.McpActivityPanel,
  })),
);
const ChatPanel = lazy(() =>
  import("@/components/ai/ChatPanel").then((module) => ({
    default: module.ChatPanel,
  })),
);

export function registerRailTabs() {
  registerRailTab({
    id: "files",
    label: "Source Tree",
    icon: FileText,
    section: "explore",
    order: 10,
    panel: FilesPanel,
  });
  registerRailTab({
    id: "search",
    label: "Project search",
    icon: Search,
    section: "explore",
    order: 20,
    panel: ProjectSearch,
  });
  registerRailTab({
    id: "source",
    label: "Git",
    icon: GitBranch,
    section: "explore",
    order: 30,
    useBadge: () => useGitStatusStore((s) => s.count),
    panel: SourceControl,
  });
  registerRailTab({
    id: "preflight",
    label: "Preflight (ATS + accessibility)",
    icon: ShieldCheck,
    section: "review",
    order: 40,
    // Preflight (ATS + accessibility) targets documents, not single figures.
    when: (ctx) => ctx.projectKind !== "image" && ctx.projectKind !== "diagram",
    panel: PreflightPanel,
  });
  registerRailTab({
    id: "refs",
    label: "References & citations (Shift-F12)",
    icon: SearchCode,
    section: "review",
    order: 50,
    panel: ReferencesPanel,
  });
  registerRailTab({
    id: "ai",
    label: "Chat / AI Assistant",
    icon: Sparkles,
    section: "assist",
    order: 60,
    panel: ChatPanel,
  });
  // Live log of tools/call traffic from external MCP clients. Only while the
  // local MCP server is running (Settings → MCP).
  registerRailTab({
    id: "mcp",
    label: "MCP activity",
    icon: Plug,
    section: "assist",
    order: 65,
    when: (ctx) => !!ctx.mcpEnabled,
    useBadge: () => useMcpActivityStore((s) => s.unread),
    panel: McpActivityPanel,
  });
  // Legacy persisted tab id that opened the same chat panel; keep the panel
  // resolvable without showing a second rail button.
  registerRailTab({
    id: "chat",
    label: "Chat",
    icon: Sparkles,
    section: "assist",
    order: 70,
    hidden: true,
    panel: ChatPanel,
  });
}
