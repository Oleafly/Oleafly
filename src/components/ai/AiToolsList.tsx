import { toolRisk, type ToolRisk } from "@oleafly/ai-tools";
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
  desc: string;
  group: AiToolGroup;
  note?: string;
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

export const AI_TOOLS: AiToolInfo[] = [
  { name: "read_file", group: "Files", desc: "Read a project file, a slice at a time for long ones." },
  { name: "write_file", group: "Files", desc: "Write a whole file, replacing what was there." },
  { name: "replace_in_file", group: "Files", desc: "Find an exact passage in a file and replace it." },
  { name: "create_file", group: "Files", desc: "Create a new file or folder in the project." },
  { name: "rename_file", group: "Files", desc: "Rename or move a file or folder." },
  { name: "delete_file", group: "Files", desc: "Delete a file or folder." },
  { name: "list_files", group: "Files", desc: "List every file and folder in the project." },
  { name: "search_project", group: "Files", desc: "Search the project's text and get file and line hits." },
  {
    name: "project_map",
    group: "Files",
    desc: "Read the document's outline: sections, labels, citation keys, macros, inputs, and anything unresolved.",
    note: "LaTeX projects only",
  },
  { name: "show_location", group: "Files", desc: "Open a file at a line in the editor and move the PDF preview to that spot." },
  { name: "compile", group: "Build and PDF", desc: "Compile the project with its engine and report errors." },
  { name: "get_log", group: "Build and PDF", desc: "Read the last compile log." },
  { name: "get_pdf_text", group: "Build and PDF", desc: "Read the text of the compiled PDF page by page." },
  {
    name: "verify_pdf_pages",
    group: "Build and PDF",
    desc: "Render compiled pages as images so a vision model can check the layout.",
    note: "Needs the PDF page capture setting",
  },
  { name: "set_main_doc", group: "Build and PDF", desc: "Change which file the project compiles from." },
  { name: "literature_search", group: "Research", desc: "Search OpenAlex for papers by keyword, no key needed." },
  { name: "verify_citation", group: "Research", desc: "Turn a DOI or a title into verified BibTeX through doi.org or Crossref." },
  { name: "project_library_search", group: "Research", desc: "Search the project's own text and notes by keyword." },
  {
    name: "alphaxiv_search",
    group: "Research",
    desc: "Search arXiv papers through alphaXiv.",
    note: "Needs an alphaXiv key in Integrations",
  },
  {
    name: "alphaxiv_paper_content",
    group: "Research",
    desc: "Fetch the full text of an arXiv paper through alphaXiv.",
    note: "Needs an alphaXiv key in Integrations",
  },
  {
    name: "preview_figure",
    group: "Figures",
    desc: "Compile a TikZ or PGFPlots figure on its own and show the result in the chat.",
    note: "LaTeX projects only",
  },
  {
    name: "insert_figure",
    group: "Figures",
    desc: "Insert the finished figure at the cursor with a caption and label, and save a PNG under figures/.",
    note: "LaTeX projects only",
  },
  { name: "load_image", group: "Figures", desc: "Look at an image that is already in the project." },
  { name: "update_todos", group: "Plan and memory", desc: "Write or update the step by step plan shown in the chat." },
  { name: "get_todos", group: "Plan and memory", desc: "Read the current plan." },
  { name: "remember_note", group: "Plan and memory", desc: "Save a project note that later chats will see." },
  { name: "forget_note", group: "Plan and memory", desc: "Remove a saved project note." },
  { name: "list_notes", group: "Plan and memory", desc: "List the saved project notes." },
  { name: "load_skill", group: "Skills", desc: "Load the full instructions of one skill before following it." },
  { name: "read_skill_file", group: "Skills", desc: "Read a reference file or script that ships with a skill." },
  { name: "spawn_agent", group: "Agents", desc: "Start a helper agent with its own task and tools." },
  { name: "send_message", group: "Agents", desc: "Send a message to a running helper agent." },
  { name: "followup_task", group: "Agents", desc: "Give a helper agent another task after it finishes." },
  { name: "wait_agent", group: "Agents", desc: "Wait for a helper agent to finish and read its result." },
  { name: "interrupt_agent", group: "Agents", desc: "Stop what a helper agent is doing." },
  { name: "list_agents", group: "Agents", desc: "List the helper agents and their state." },
  { name: "close_agent", group: "Agents", desc: "Close a helper agent." },
  {
    name: "run_command",
    group: "System",
    desc: "Run a shell command in the project folder, with a two minute limit.",
    note: "Approved in the chat, one command at a time",
  },
  {
    name: "computer_use",
    group: "System",
    desc: "Open a web page in the assistant's browser window.",
    note: "Needs the web browser setting",
  },
  { name: "toggle_theme", group: "System", desc: "Switch between light and dark mode." },
];

export function approvalLabel(risk: ToolRisk): string {
  switch (risk) {
    case "read":
      return "Never";
    case "shell":
      return "Every time, in the chat";
    case "network":
      return "Only in Ask for approval mode";
    default:
      return "Yes, unless allowed for the project";
  }
}

const RISK_CLASS: Record<ToolRisk, string> = {
  read: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  write: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  shell: "bg-destructive/10 text-destructive",
  network: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
};

export function AiToolsTable({ className }: { className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-md border", className)} data-testid="ai-tools-table">
      <table className="w-full border-collapse text-left text-[11px]">
        <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Tool
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              What it does
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Asks first
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
                  {group}
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
                      {tool.desc}
                      {tool.note && (
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">{tool.note}</span>
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
          <span className="text-muted-foreground">{t.desc}</span>
        </div>
      ))}
    </div>
  );
}
