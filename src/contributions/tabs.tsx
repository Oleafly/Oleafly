import { lazy } from "react";
import { FlaskConical, Folder, GitBranch, Plug, Search, SearchCode, ShieldCheck } from "@/components/icons/pack";
import { registerRailTab } from "@oleafly/registry";
import { i18n } from "@/i18n";
import { useGitStatusStore } from "@/store/git-status";
import { useMcpActivityStore } from "@/store/mcp-activity";
import { useResearchAttentionBadge } from "@/store/research-attention";
import { researchTasksEnabled } from "@/store/research-tasks-flag";
import {
  ChatPanel,
  ChatRailIcon,
  chatRailLabel,
  CollabPanel,
  CollabRailIcon,
  collabRailLabel,
  CommentsPanel,
  CommentsRailIcon,
  commentsRailLabel,
} from "@/components/collab/CollabSlots";
import { useChatRail } from "@/components/collab/chat-rail";
import { useCollabRail } from "@/components/collab/collab-rail";
import { commentsRailShown } from "@/components/collab/comments-rail";
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
    when: () => researchTasksEnabled(),
    panel: ResearchWorkspacePanel,
    useBadge: () => useResearchAttentionBadge(),
  });
  registerRailTab({
    id: "collab",
    label: collabRailLabel,
    icon: CollabRailIcon,
    section: "assist",
    order: 59,
    when: () => useCollabRail.getState().visible,
    panel: CollabPanel,
  });
  registerRailTab({
    id: "comments",
    label: commentsRailLabel,
    icon: CommentsRailIcon,
    section: "assist",
    order: 59.5,
    when: commentsRailShown,
    panel: CommentsPanel,
  });
  registerRailTab({
    id: "chat",
    label: chatRailLabel,
    icon: ChatRailIcon,
    section: "assist",
    order: 59.75,
    when: () => useChatRail.getState().visible,
    panel: ChatPanel,
  });
  registerRailTab({
    id: "files",
    label: () => i18n.t(($) => $.shell.rail.files),
    icon: Folder,
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
