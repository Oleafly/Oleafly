import { useTranslation } from "react-i18next";
import { toolRisk, type ToolRisk } from "@oleafly/ai-tools";
import { i18n } from "@/i18n";
import { cn } from "@/lib/utils";

export type AiToolGroup =
  | "Files"
  | "Build and PDF"
  | "Research"
  | "Figures"
  | "Plan and memory"
  | "Skills"
  | "Agents"
  | "System";

export interface AiToolInfo {
  name: string;
  desc: () => string;
  group: AiToolGroup;
  note?: () => string;
}

export const AI_TOOL_GROUPS: AiToolGroup[] = [
  "Files",
  "Build and PDF",
  "Research",
  "Figures",
  "Plan and memory",
  "Skills",
  "Agents",
  "System",
];

export function aiToolGroupLabel(group: AiToolGroup): string {
  switch (group) {
    case "Files":
      return i18n.t(($) => $.ai.tools.groups.files);
    case "Build and PDF":
      return i18n.t(($) => $.ai.tools.groups.buildAndPdf);
    case "Research":
      return i18n.t(($) => $.ai.tools.groups.research);
    case "Figures":
      return i18n.t(($) => $.ai.tools.groups.figures);
    case "Plan and memory":
      return i18n.t(($) => $.ai.tools.groups.planAndMemory);
    case "Skills":
      return i18n.t(($) => $.ai.tools.groups.skills);
    case "Agents":
      return i18n.t(($) => $.ai.tools.groups.agents);
    default:
      return i18n.t(($) => $.ai.tools.groups.system);
  }
}

const latexOnly = () => i18n.t(($) => $.ai.tools.notes.latexOnly);
const alphaxivKey = () => i18n.t(($) => $.ai.tools.notes.alphaxivKey);

export const AI_TOOLS: AiToolInfo[] = [
  { name: "read_file", group: "Files", desc: () => i18n.t(($) => $.ai.tools.catalog.readFile) },
  { name: "write_file", group: "Files", desc: () => i18n.t(($) => $.ai.tools.catalog.writeFile) },
  { name: "replace_in_file", group: "Files", desc: () => i18n.t(($) => $.ai.tools.catalog.replaceInFile) },
  { name: "create_file", group: "Files", desc: () => i18n.t(($) => $.ai.tools.catalog.createFile) },
  { name: "rename_file", group: "Files", desc: () => i18n.t(($) => $.ai.tools.catalog.renameFile) },
  { name: "delete_file", group: "Files", desc: () => i18n.t(($) => $.ai.tools.catalog.deleteFile) },
  { name: "list_files", group: "Files", desc: () => i18n.t(($) => $.ai.tools.catalog.listFiles) },
  { name: "search_project", group: "Files", desc: () => i18n.t(($) => $.ai.tools.catalog.searchProject) },
  {
    name: "project_map",
    group: "Files",
    desc: () => i18n.t(($) => $.ai.tools.catalog.projectMap),
    note: latexOnly,
  },
  { name: "show_location", group: "Files", desc: () => i18n.t(($) => $.ai.tools.catalog.showLocation) },
  { name: "compile", group: "Build and PDF", desc: () => i18n.t(($) => $.ai.tools.catalog.compile) },
  { name: "get_log", group: "Build and PDF", desc: () => i18n.t(($) => $.ai.tools.catalog.getLog) },
  { name: "get_pdf_text", group: "Build and PDF", desc: () => i18n.t(($) => $.ai.tools.catalog.getPdfText) },
  {
    name: "verify_pdf_pages",
    group: "Build and PDF",
    desc: () => i18n.t(($) => $.ai.tools.catalog.verifyPdfPages),
    note: () => i18n.t(($) => $.ai.tools.notes.pdfCaptureSetting),
  },
  { name: "set_main_doc", group: "Build and PDF", desc: () => i18n.t(($) => $.ai.tools.catalog.setMainDoc) },
  { name: "literature_search", group: "Research", desc: () => i18n.t(($) => $.ai.tools.catalog.literatureSearch) },
  { name: "verify_citation", group: "Research", desc: () => i18n.t(($) => $.ai.tools.catalog.verifyCitation) },
  {
    name: "project_library_search",
    group: "Research",
    desc: () => i18n.t(($) => $.ai.tools.catalog.projectLibrarySearch),
  },
  {
    name: "alphaxiv_search",
    group: "Research",
    desc: () => i18n.t(($) => $.ai.tools.catalog.alphaxivSearch),
    note: alphaxivKey,
  },
  {
    name: "alphaxiv_paper_content",
    group: "Research",
    desc: () => i18n.t(($) => $.ai.tools.catalog.alphaxivPaperContent),
    note: alphaxivKey,
  },
  {
    name: "preview_figure",
    group: "Figures",
    desc: () => i18n.t(($) => $.ai.tools.catalog.previewFigure),
    note: latexOnly,
  },
  {
    name: "insert_figure",
    group: "Figures",
    desc: () => i18n.t(($) => $.ai.tools.catalog.insertFigure),
    note: latexOnly,
  },
  { name: "load_image", group: "Figures", desc: () => i18n.t(($) => $.ai.tools.catalog.loadImage) },
  { name: "update_todos", group: "Plan and memory", desc: () => i18n.t(($) => $.ai.tools.catalog.updateTodos) },
  { name: "get_todos", group: "Plan and memory", desc: () => i18n.t(($) => $.ai.tools.catalog.getTodos) },
  { name: "remember_note", group: "Plan and memory", desc: () => i18n.t(($) => $.ai.tools.catalog.rememberNote) },
  { name: "forget_note", group: "Plan and memory", desc: () => i18n.t(($) => $.ai.tools.catalog.forgetNote) },
  { name: "list_notes", group: "Plan and memory", desc: () => i18n.t(($) => $.ai.tools.catalog.listNotes) },
  { name: "load_skill", group: "Skills", desc: () => i18n.t(($) => $.ai.tools.catalog.loadSkill) },
  { name: "read_skill_file", group: "Skills", desc: () => i18n.t(($) => $.ai.tools.catalog.readSkillFile) },
  { name: "spawn_agent", group: "Agents", desc: () => i18n.t(($) => $.ai.tools.catalog.spawnAgent) },
  { name: "send_message", group: "Agents", desc: () => i18n.t(($) => $.ai.tools.catalog.sendMessage) },
  { name: "followup_task", group: "Agents", desc: () => i18n.t(($) => $.ai.tools.catalog.followupTask) },
  { name: "wait_agent", group: "Agents", desc: () => i18n.t(($) => $.ai.tools.catalog.waitAgent) },
  { name: "interrupt_agent", group: "Agents", desc: () => i18n.t(($) => $.ai.tools.catalog.interruptAgent) },
  { name: "list_agents", group: "Agents", desc: () => i18n.t(($) => $.ai.tools.catalog.listAgents) },
  { name: "close_agent", group: "Agents", desc: () => i18n.t(($) => $.ai.tools.catalog.closeAgent) },
  {
    name: "run_command",
    group: "System",
    desc: () => i18n.t(($) => $.ai.tools.catalog.runCommand),
    note: () => i18n.t(($) => $.ai.tools.notes.chatApproval),
  },
  {
    name: "computer_use",
    group: "System",
    desc: () => i18n.t(($) => $.ai.tools.catalog.computerUse),
    note: () => i18n.t(($) => $.ai.tools.notes.browserSetting),
  },
  { name: "toggle_theme", group: "System", desc: () => i18n.t(($) => $.ai.tools.catalog.toggleTheme) },
];

export function approvalLabel(risk: ToolRisk): string {
  switch (risk) {
    case "read":
      return i18n.t(($) => $.ai.tools.approval.never);
    case "shell":
      return i18n.t(($) => $.ai.tools.approval.everyTime);
    case "network":
      return i18n.t(($) => $.ai.tools.approval.askModeOnly);
    default:
      return i18n.t(($) => $.ai.tools.approval.unlessAllowed);
  }
}

const RISK_CLASS: Record<ToolRisk, string> = {
  read: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  write: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  shell: "bg-destructive/10 text-destructive",
  network: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
};

export function AiToolsTable({ className }: { className?: string }) {
  const { t } = useTranslation(["common", "ai"]);
  return (
    <div className={cn("overflow-x-auto rounded-md border", className)} data-testid="ai-tools-table">
      <table className="w-full border-collapse text-left text-[11px]">
        <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              {t(($) => $.ai.tools.table.tool)}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t(($) => $.ai.tools.table.whatItDoes)}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t(($) => $.ai.tools.table.asksFirst)}
            </th>
          </tr>
        </thead>
        {AI_TOOL_GROUPS.map((group) => {
          const tools = AI_TOOLS.filter((tool) => tool.group === group);
          if (tools.length === 0) return null;
          return (
            <tbody key={group} data-testid={`ai-tools-group-${group}`}>
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={3}
                  className="border-t bg-muted/30 px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {aiToolGroupLabel(group)}
                </th>
              </tr>
              {tools.map((tool) => {
                const risk = toolRisk(tool.name);
                return (
                  <tr key={tool.name} className="border-t align-top hover:bg-accent/40">
                    <td className="whitespace-nowrap px-3 py-2">
                      <code className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                        {tool.name}
                      </code>
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {tool.desc()}
                      {tool.note && (
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">{tool.note()}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", RISK_CLASS[risk])}>
                        {approvalLabel(risk)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

export function AiToolsGrid({
  columns = 2,
  className,
}: {
  columns?: 1 | 2;
  className?: string;
}) {
  useTranslation(["common", "ai"]);
  return (
    <div
      className={cn(
        "grid gap-x-4 gap-y-1",
        columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1",
        className,
      )}
    >
      {AI_TOOLS.map((t) => (
        <div key={t.name} className="flex items-baseline gap-2 text-[11px]">
          <code className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
            {t.name}
          </code>
          <span className="text-muted-foreground">{t.desc()}</span>
        </div>
      ))}
    </div>
  );
}
