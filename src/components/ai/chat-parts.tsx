import { memo, useCallback, useEffect, useId, useRef, useState, type FocusEvent } from "react";
import {
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Copy,
  FolderDown,
  Info,
  Loader2,
  Paperclip,
  Terminal,
  Wrench,
  XCircle,
} from "lucide-react";
import type { ChatMessage, ToolEntry } from "@/store/chats";
import { agentTodoProgress, type AgentTodo } from "@/store/agent-todos";
import {
  agentFileChangeTotals,
  type AgentFileChange,
  type AgentFileChangeTurn,
} from "@/store/agent-file-changes";
import { Markdown } from "@/components/ui/markdown";
import { Popover } from "@/components/ui/popover";
import { tokenizeComposer } from "@/lib/composer-tokens";
import { writeFileContent, writeProjectBytes } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";

const USER_SKILL_CHIP_CLASS =
  "rounded bg-blue-300/35 px-1 py-px font-medium text-white";
const USER_MENTION_CHIP_CLASS =
  "rounded bg-teal-300/35 px-1 py-px font-medium text-white";

export function userTokenChips(msg: ChatMessage): React.ReactNode | null {
  const skillIds = msg.skillId ? [msg.skillId] : [];
  const mentions = msg.mentions ?? [];
  if (skillIds.length === 0 && mentions.length === 0) return null;
  const tokens = tokenizeComposer(msg.content, { skillIds, paths: mentions });
  if (!tokens.some((token) => token.kind !== "text")) return null;
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {tokens.map((token) => (
        <span
          key={`${token.kind}-${token.start}`}
          data-token={token.kind}
          className={
            token.kind === "skill"
              ? USER_SKILL_CHIP_CLASS
              : token.kind === "mention"
                ? USER_MENTION_CHIP_CLASS
                : undefined
          }
        >
          {msg.content.slice(token.start, token.end)}
        </span>
      ))}
    </p>
  );
}

export function Shimmer({ text }: { text?: string }) {
  return text ? <span className="ai-shimmer text-xs">{text}</span> : null;
}

// Used for low-urgency notices we don't want to spend a full banner on.
export function InfoHint({ message }: { message: string }) {
  return (
    <Popover ariaLabel={message} trigger={<Info className="size-4" />} className="w-60 p-2.5">
      <p className="text-[11px] leading-relaxed text-muted-foreground">{message}</p>
    </Popover>
  );
}

export interface AgentPlanApproval {
  status: "awaiting" | "approved";
  busy?: boolean;
  onApprove: () => void;
  onRevise: () => void;
}

function AgentTodoList({ todos }: { todos: readonly AgentTodo[] }) {
  return (
    <ul className="space-y-1">
      {todos.map((todo) => (
        <li
          key={todo.id}
          data-todo-status={todo.status}
          aria-label={`${todo.status.replace("_", " ")}: ${todo.content}`}
          className="flex items-start gap-1.5 text-[11px] leading-snug"
        >
          {todo.status === "completed" && (
            <Check
              aria-hidden="true"
              data-todo-icon="completed"
              className="mt-px size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
          )}
          {todo.status === "in_progress" && (
            <Loader2
              aria-hidden="true"
              data-todo-icon="in_progress"
              className="mt-px size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none"
            />
          )}
          {todo.status === "pending" && (
            <Circle
              aria-hidden="true"
              data-todo-icon="pending"
              className="mt-px size-3.5 shrink-0 text-muted-foreground/50"
            />
          )}
          {todo.status === "cancelled" && (
            <XCircle
              aria-hidden="true"
              data-todo-icon="cancelled"
              className="mt-px size-3.5 shrink-0 text-muted-foreground/40"
            />
          )}
          <span
            className={cn(
              todo.status === "completed" && "text-muted-foreground",
              todo.status === "cancelled" && "text-muted-foreground/60 line-through",
              todo.status === "in_progress" && "font-medium text-foreground",
            )}
          >
            {todo.content}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AgentPlanStatusBadge({ status }: { status: AgentPlanApproval["status"] }) {
  return (
    <span
      data-testid="agent-plan-status"
      className={cn(
        "rounded-full px-1.5 py-px text-[10px] font-medium",
        status === "awaiting"
          ? "bg-violet-500/15 text-violet-600 dark:text-violet-300"
          : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      )}
    >
      {status === "awaiting" ? "Awaiting approval" : "Approved"}
    </span>
  );
}

const STATUS_PILL_CLOSE_DELAY_MS = 150;

export function AgentStatusPill({
  todos,
  turn,
  approval,
}: {
  todos: readonly AgentTodo[];
  turn: AgentFileChangeTurn | null;
  approval?: AgentPlanApproval;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipFocusOpenRef = useRef(false);
  const panelId = useId();

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current === null) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);
  const show = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);
  const close = useCallback(() => {
    cancelClose();
    setOpen(false);
    setPinned(false);
  }, [cancelClose]);
  const scheduleClose = () => {
    if (pinned) return;
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, STATUS_PILL_CLOSE_DELAY_MS);
  };

  useEffect(() => cancelClose, [cancelClose]);

  const awaitingReady = approval?.status === "awaiting" && !approval.busy;
  const awaitingReadyRef = useRef(false);
  useEffect(() => {
    const wasReady = awaitingReadyRef.current;
    awaitingReadyRef.current = awaitingReady;
    if (!awaitingReady || wasReady) return;
    cancelClose();
    setOpen(true);
    setPinned(true);
  }, [awaitingReady, cancelClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const active = document.activeElement;
      const focusInside = rootRef.current?.contains(active) ?? false;
      close();
      if (focusInside && active !== pillRef.current) {
        skipFocusOpenRef.current = true;
        pillRef.current?.focus({ preventScroll: true });
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, close]);

  const progress = agentTodoProgress(todos);
  const totals = agentFileChangeTotals(turn);
  const awaiting = approval?.status === "awaiting";
  const hasSteps = progress.total > 0;
  const hasFiles = totals.files > 0;
  if (!approval && !hasSteps && !hasFiles) return null;
  const planStatus = approval?.status ?? "none";
  const closeWhenFocusLeaves = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && rootRef.current?.contains(next)) return;
    close();
  };

  return (
    <div ref={rootRef} className="pointer-events-none relative flex w-full justify-center">
      <button
        ref={pillRef}
        type="button"
        data-testid="agent-status-pill"
        data-plan-status={planStatus}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onMouseEnter={show}
        onMouseLeave={scheduleClose}
        onBlur={closeWhenFocusLeaves}
        onFocus={() => {
          if (skipFocusOpenRef.current) {
            skipFocusOpenRef.current = false;
            return;
          }
          show();
        }}
        onClick={() => {
          if (pinned) {
            close();
            return;
          }
          show();
          setPinned(true);
        }}
        className="pointer-events-auto inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background/95 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground shadow-md backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
      >
        {approval && (
          <span
            data-pill-segment="plan"
            className={
              awaiting
                ? "text-violet-600 dark:text-violet-300"
                : "text-emerald-600 dark:text-emerald-400"
            }
          >
            PLAN
          </span>
        )}
        {approval && (hasSteps || hasFiles) && <span aria-hidden="true"> · </span>}
        {hasSteps && (
          <span data-pill-segment="steps" className="tabular-nums">
            STEP {progress.current}/{progress.total}
          </span>
        )}
        {hasSteps && hasFiles && <span aria-hidden="true"> · </span>}
        {hasFiles && (
          <span data-pill-segment="review">
            REVIEW{" "}
            <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
              +{totals.additions}
            </span>{" "}
            <span className="tabular-nums text-destructive">-{totals.deletions}</span>
          </span>
        )}
      </button>

      {open && (
        <div className="pointer-events-auto absolute inset-x-0 bottom-full mx-auto w-full max-w-[22rem] pb-1.5">
          <div
            id={panelId}
            role="dialog"
            aria-label="Plan details"
            data-testid="agent-todos"
            data-plan-status={planStatus}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            onBlur={closeWhenFocusLeaves}
            className="max-h-72 overflow-y-auto rounded-lg border bg-popover p-2.5 text-left text-popover-foreground shadow-lg"
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {approval || hasSteps ? "Plan" : "Changes"}
              </span>
              {approval && <AgentPlanStatusBadge status={approval.status} />}
            </div>
            {todos.length > 0 && <AgentTodoList todos={todos} />}
            {awaiting && approval && (
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Approve plan"
                  onClick={() => {
                    close();
                    approval.onApprove();
                  }}
                  disabled={approval.busy}
                  className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Check aria-hidden="true" className="size-3.5 shrink-0" />
                  Approve plan
                </button>
                <button
                  type="button"
                  aria-label="Revise"
                  onClick={() => {
                    close();
                    approval.onRevise();
                  }}
                  disabled={approval.busy}
                  className="flex h-7 shrink-0 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Revise
                </button>
              </div>
            )}
            {turn && hasFiles && (
              <div className={cn(todos.length > 0 && "mt-2 border-t pt-2")}>
                <FileChangeDetails turn={turn} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FileChangeRow({
  file,
  state,
}: {
  file: AgentFileChange;
  state: "changed" | "committed";
}) {
  return (
    <span
      data-file-change-state={state}
      data-file-change-path={file.path}
      className="flex min-w-0 items-center gap-2 text-[11px]"
    >
      <span className="min-w-0 flex-1 truncate text-foreground">{file.path}</span>
      <span className="shrink-0 tabular-nums text-emerald-600 dark:text-emerald-400">
        +{file.additions}
      </span>
      <span className="shrink-0 tabular-nums text-destructive">-{file.deletions}</span>
    </span>
  );
}

function FileChangeDetails({ turn }: { turn: AgentFileChangeTurn }) {
  const changed = Object.values(turn.changedFiles);
  const committed = new Map<string, AgentFileChange[]>();
  for (const file of turn.committedFiles) {
    const commitId = file.commitId ?? "committed";
    const files = committed.get(commitId) ?? [];
    files.push(file);
    committed.set(commitId, files);
  }

  return (
    <span className="block min-w-56 space-y-2 text-left font-normal">
      {changed.length > 0 && (
        <span className="block space-y-1.5">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Changed
          </span>
          {changed.map((file) => (
            <FileChangeRow key={file.path} file={file} state="changed" />
          ))}
        </span>
      )}
      {[...committed.entries()].map(([commitId, files]) => (
        <span key={commitId} data-commit-id={commitId} className="block space-y-1.5">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Committed {commitId.slice(0, 7)}
          </span>
          {files.map((file) => (
            <FileChangeRow
              key={file.path}
              file={file}
              state="committed"
            />
          ))}
        </span>
      ))}
    </span>
  );
}

export function AgentRunSummary({
  todos,
  turn,
  plan = false,
}: {
  todos: readonly AgentTodo[];
  turn: AgentFileChangeTurn | null;
  plan?: boolean;
}) {
  const progress = agentTodoProgress(todos);
  const totals = agentFileChangeTotals(turn);
  if (progress.total === 0 && totals.files === 0) return null;
  const done = todos.filter((todo) => todo.status === "completed").length;
  const hasSteps = progress.total > 0;
  const hasFiles = totals.files > 0;

  return (
    <div
      data-testid="agent-run-summary"
      data-plan={plan ? "true" : "false"}
      className="rounded-md border bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground"
    >
      <div className="font-medium">
        {plan && <span>Plan</span>}
        {plan && hasSteps && <span aria-hidden="true"> · </span>}
        {hasSteps && (
          <span className="tabular-nums">
            {done}/{progress.total} done
          </span>
        )}
        {(plan || hasSteps) && hasFiles && <span aria-hidden="true"> · </span>}
        {hasFiles && (
          <span>
            {totals.files} {totals.files === 1 ? "file" : "files"} changed{" "}
            <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
              +{totals.additions}
            </span>{" "}
            <span className="tabular-nums text-destructive">-{totals.deletions}</span>
          </span>
        )}
      </div>
      {turn && hasFiles && (
        <div className="mt-1.5">
          <FileChangeDetails turn={turn} />
        </div>
      )}
    </div>
  );
}

export function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    },
    [],
  );
  return (
    <button
      type="button"
      aria-label="Copy message"
      title="Copy message"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
          resetTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="shrink-0 self-center rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
    </button>
  );
}

// Read-only tools whose consecutive calls collapse into one "Explored…"
// summary, matching the reference exploration grouping.
const EXPLORATION_TOOLS: Record<string, "file" | "search" | "list"> = {
  read_file: "file",
  read_skill_file: "file",
  load_skill: "file",
  get_pdf_text: "file",
  get_log: "file",
  search_project: "search",
  project_library_search: "search",
  list_files: "list",
  project_map: "list",
};

function pluralize(count: number, one: string, many: string): string | null {
  if (count === 0) return null;
  return count === 1 ? `a ${one}` : `${count} ${many}`;
}

// "Explored 3 files, 2 searches" from a run of read-only tool calls.
export function explorationSummary(tools: ToolEntry[]): string {
  let files = 0;
  let searches = 0;
  let lists = 0;
  for (const tool of tools) {
    const kind = EXPLORATION_TOOLS[tool.name];
    if (kind === "file") files++;
    else if (kind === "search") searches++;
    else if (kind === "list") lists++;
  }
  const parts = [
    pluralize(files, "file", "files"),
    pluralize(searches, "search", "searches"),
    pluralize(lists, "list", "lists"),
  ].filter((p): p is string => p != null);
  return parts.length === 0 ? "Explored" : `Explored ${parts.join(", ")}`;
}

// The terminal result of a run_command tool call, derived from both the
// entry status and the envelope. A finished call whose envelope is a decline
// or an error must resolve to a terminal state, never a perpetual spinner.
type ExecView =
  | {
      kind: "exec";
      command: string;
      body: string;
      status: string;
      exitCode: number | null;
      timedOut: boolean;
    }
  | { kind: "declined"; command: string }
  | { kind: "error"; message: string }
  | { kind: "pending" };

function parseExecView(
  output: string | undefined,
  entryStatus: ToolEntry["status"],
): ExecView {
  const settled = entryStatus !== "running";
  if (!output) {
    return settled ? { kind: "error", message: "No result was returned." } : { kind: "pending" };
  }
  let parsed: {
    exec?: boolean;
    command?: string;
    output?: string;
    status?: string;
    exit_code?: number | null;
    timed_out?: boolean;
    declined?: boolean;
    error?: unknown;
  };
  try {
    parsed = JSON.parse(output);
  } catch {
    // A partial envelope mid-stream is still pending; a finished call whose
    // output will not parse is a genuine error worth surfacing.
    return settled ? { kind: "error", message: output.slice(0, 300) } : { kind: "pending" };
  }
  if (parsed.exec && typeof parsed.command === "string") {
    return {
      kind: "exec",
      command: parsed.command,
      body: parsed.output ?? "",
      status: parsed.status ?? (settled ? "Done" : "Running"),
      exitCode: parsed.exit_code ?? null,
      timedOut: Boolean(parsed.timed_out),
    };
  }
  if (parsed.declined) {
    return { kind: "declined", command: typeof parsed.command === "string" ? parsed.command : "" };
  }
  if (parsed.error != null) return { kind: "error", message: String(parsed.error) };
  return settled
    ? { kind: "error", message: "The command returned an unrecognized result." }
    : { kind: "pending" };
}

// Command card for run_command results: `$ command`, aggregated output, and a
// status pill (Success / Failed with exit code N / Stopped / Declined / an
// error), per the reference exec item.
export function ExecCard({ tc }: { tc: ToolEntry }) {
  const [expanded, setExpanded] = useState(false);
  const view = parseExecView(tc.output, tc.status);
  const running = view.kind === "pending";
  // A finished command succeeds only on a clean exit code 0. A null exit
  // (stopped or killed) or a timeout is a failure, not a green check.
  const failed =
    view.kind === "error" ||
    view.kind === "declined" ||
    (view.kind === "exec" && (view.timedOut || view.exitCode !== 0));
  const command =
    view.kind === "exec" || view.kind === "declined" ? view.command : "";
  const body = view.kind === "exec" ? view.body : "";
  const statusLine =
    view.kind === "exec"
      ? view.status
      : view.kind === "declined"
        ? "Declined"
        : view.kind === "error"
          ? view.message
          : null;
  const dataStatus =
    view.kind === "exec"
      ? view.status
      : view.kind === "declined"
        ? "declined"
        : view.kind === "error"
          ? "error"
          : "running";
  return (
    <div
      data-testid="exec-card"
      data-exec-status={dataStatus}
      className="max-w-[85%] overflow-hidden rounded-md border bg-muted text-xs"
    >
      <button
        type="button"
        onClick={() => body && setExpanded((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
          body && "cursor-pointer hover:bg-accent/50",
        )}
      >
        <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
        <code className="min-w-0 flex-1 truncate font-mono text-[11px]">
          $ {command || tc.name}
        </code>
        {running ? (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        ) : failed ? (
          <XCircle className="size-3 shrink-0 text-destructive" />
        ) : (
          <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />
        )}
        {body && (
          <ChevronRight
            className={cn("size-3 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
          />
        )}
      </button>
      {statusLine && !running && (
        <div
          className={cn(
            "border-t px-2.5 py-1 text-[10px] text-muted-foreground",
            failed && "text-destructive",
          )}
        >
          {statusLine}
        </div>
      )}
      {expanded && body && (
        <pre className="max-h-56 animate-in fade-in overflow-auto whitespace-pre-wrap break-words border-t px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground duration-150 motion-reduce:animate-none">
          {body}
        </pre>
      )}
    </div>
  );
}

// A collapsed run of read-only tool calls: "Explored 3 files, 2 searches",
// expandable to the individual tool badges. Mirrors the reference exploration
// grouping so a long read-heavy turn stays scannable.
export function ExplorationGroup({ tools }: { tools: ToolEntry[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="max-w-[85%]" data-testid="exploration-group">
      <button
        type="button"
        aria-controls={listId}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        {explorationSummary(tools)}
      </button>
      {open && (
        <div id={listId} className="mt-1.5 flex animate-in fade-in flex-col gap-1.5 border-l pl-2.5 duration-150 motion-reduce:animate-none">
          {tools.map((tool, index) => (
            <ToolBadge key={tool.id ?? `explore-${index}`} tc={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

function lastFinishedPicture(tools: readonly ToolEntry[]): ToolEntry[] {
  for (let i = tools.length - 1; i >= 0; i--) {
    const tool = tools[i];
    if (tool.image && tool.status === "done") return [tool];
  }
  return [];
}

export function freeFigurePath(
  existing: readonly string[],
  extension: string,
  base = "figure",
): string {
  const taken = new Set(existing.map((path) => path.toLowerCase()));
  const first = `figures/${base}.${extension}`;
  if (!taken.has(first.toLowerCase())) return first;
  for (let n = 2; n < 10_000; n++) {
    const candidate = `figures/${base}-${n}.${extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `figures/${base}-${Date.now()}.${extension}`;
}

async function saveToolPicture(tc: ToolEntry): Promise<string | null> {
  const files = useFilesStore.getState();
  const projectId = files.projectId;
  if (!projectId) return null;
  const existing = files.tree.map((entry) => entry.path);
  if (tc.code) {
    const path = freeFigurePath(existing, "tex");
    await writeFileContent(projectId, path, tc.code.endsWith("\n") ? tc.code : `${tc.code}\n`);
    await files.refreshTree();
    return path;
  }
  if (tc.image) {
    const path = freeFigurePath(existing, "png");
    const base64 = tc.image.split(",")[1] ?? "";
    await writeProjectBytes(projectId, path, base64);
    await files.refreshTree();
    return path;
  }
  return null;
}

export function ToolPicture({ tc }: { tc: ToolEntry }) {
  const [view, setView] = useState<"image" | "code">("image");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasCode = Boolean(tc.code);
  const saveToProject = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const path = await saveToolPicture(tc);
      if (path) toast.success(`Saved ${path}`);
      else toast.error("Open a project to save this figure.");
    } catch (error) {
      toast.error(`Could not save the figure: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  };
  const label = tc.name === "preview_figure" ? "Rendered figure preview" : "Image from the tool";
  const copyCode = async () => {
    if (!tc.code) return;
    try {
      await navigator.clipboard.writeText(tc.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div data-testid="tool-picture-body" className="bg-background">
      {hasCode && (
        <div className="flex items-center gap-1 border-b px-2 py-1">
          <button
            type="button"
            data-testid="tool-picture-view-image"
            aria-pressed={view === "image"}
            onClick={() => setView("image")}
            className={cn(
              "rounded px-2 py-0.5 text-[11px]",
              view === "image" ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50",
            )}
          >
            Figure
          </button>
          <button
            type="button"
            data-testid="tool-picture-view-code"
            aria-pressed={view === "code"}
            onClick={() => setView("code")}
            className={cn(
              "rounded px-2 py-0.5 text-[11px]",
              view === "code" ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50",
            )}
          >
            TikZ
          </button>
          <button
            type="button"
            data-testid="tool-picture-save"
            disabled={saving}
            onClick={() => void saveToProject()}
            className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/50 disabled:opacity-60"
          >
            <FolderDown className="size-3" />
            {saving ? "Saving" : "Save to project"}
          </button>
          <button
            type="button"
            data-testid="tool-picture-copy"
            onClick={() => void copyCode()}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/50"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "Copied" : "Copy code"}
          </button>
        </div>
      )}
      {!hasCode && (
        <div className="flex items-center border-b px-2 py-1">
          <button
            type="button"
            data-testid="tool-picture-save"
            disabled={saving}
            onClick={() => void saveToProject()}
            className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/50 disabled:opacity-60"
          >
            <FolderDown className="size-3" />
            {saving ? "Saving" : "Save to project"}
          </button>
        </div>
      )}
      {view === "image" || !hasCode ? (
        <div className="p-2">
          <img
            src={tc.image}
            alt={label}
            data-testid="tool-image"
            className="mx-auto max-h-80 max-w-full rounded object-contain"
          />
        </div>
      ) : (
        <pre
          data-testid="tool-picture-code"
          className="max-h-80 overflow-auto whitespace-pre-wrap break-words px-2.5 py-1.5 font-mono text-[10px] text-foreground"
        >
          {tc.code}
        </pre>
      )}
    </div>
  );
}

export function ToolBadge({ tc, live = false }: { tc: ToolEntry; live?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const result = tc.output?.includes('"success": true')
    ? "success"
    : tc.output?.includes('"error"')
      ? "error"
      : undefined;
  return (
    <div
      data-tool-name={tc.name}
      data-tool-status={tc.status}
      data-tool-result={result}
      className="max-w-[85%] rounded-md border bg-muted text-xs"
    >
      <button type="button"
        onClick={() => (tc.output || tc.image) && setExpanded(!expanded)}
        className={cn("flex w-full items-center gap-2 px-2.5 py-1.5", (tc.output || tc.image) && "cursor-pointer hover:bg-accent/50")}
      >
        <Wrench className="size-3.5 text-muted-foreground" />
        <span className="font-mono">{tc.name}</span>
        {tc.approval === "rejected" ? (
          <XCircle className="size-3 text-destructive" />
        ) : (
          <>
            {tc.status === "running" && <Loader2 className="size-3 animate-spin" />}
            {tc.status === "done" && <CheckCircle2 className="size-3 text-emerald-500" />}
            {tc.status === "error" && <XCircle className="size-3 text-destructive" />}
          </>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {tc.approval === "approved" && (
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              Approved
            </span>
          )}
          {tc.approval === "rejected" && (
            <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
              Rejected
            </span>
          )}
          {(tc.output || tc.image) && (
            <ChevronRight className={cn("size-3 text-muted-foreground transition-transform", expanded && "rotate-90")} />
          )}
        </span>
      </button>
      {tc.image && (live || expanded) && (
        <div className="border-t">
          <ToolPicture tc={tc} />
        </div>
      )}
      {expanded && tc.output && (
        <pre className="max-h-96 animate-in fade-in overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words border-t px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground duration-150 motion-reduce:animate-none">
          {tc.output}
        </pre>
      )}
    </div>
  );
}

export function formatToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (typeof record.content === "string") return record.content;
    if (typeof record.error === "string") return `Error: ${record.error}`;
  }
  return JSON.stringify(output, null, 2) ?? String(output);
}

export function friendlyHint(text: string, statusCode?: number): string | null {
  const t = text.toLowerCase();
  if (
    statusCode === 402 ||
    /insufficient balance|no resource package|recharge|out of credit|insufficient[_ ]?quota|exceeded your current quota|billing|payment required/.test(t)
  ) {
    return "Your AI provider is out of credits or quota. Top up the account, or switch to another provider (or local Ollama) from the model menu above.";
  }
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    /invalid api key|incorrect api key|unauthorized|invalid[_ ]?api[_ ]?key|authentication|no api key/.test(t)
  ) {
    return "Your API key looks invalid or expired. Update it in Settings → AI Assistant, or switch providers from the model menu above.";
  }
  if (statusCode === 429 || /rate limit|too many requests|\b429\b/.test(t)) {
    return "The provider is rate-limiting requests. Wait a moment and retry, or switch providers from the model menu above.";
  }
  if (
    /no longer available|has been retired|model.{0,40}(deprecated|discontinued|not found|does not exist)|unknown model|model_not_found/.test(
      t,
    )
  ) {
    return "The provider retired or restricted this model. Pick a newer model from the model menu above (Settings → AI Assistant lists what your key can use).";
  }
  if (statusCode === 503 || /high demand|overloaded|over capacity|service unavailable|\b503\b/.test(t)) {
    return "The provider's servers are overloaded right now (this was already retried). Wait a minute and try again, or switch to a sibling model from the model menu above.";
  }
  if (/econnrefused|failed to fetch|fetch failed|load failed|network error|not reachable|connection refused/.test(t)) {
    return "Couldn't reach the AI provider. Check your connection, or if you're using Ollama, make sure it's running (Settings → AI Assistant → Check for Ollama).";
  }
  return null;
}

export function formatError(e: unknown, providerLabel?: string): string {
  const err = typeof e === "object" && e !== null
    ? e as Record<string, unknown>
    : {};
  const statusValue = err.statusCode ?? err.status;
  const statusCode = typeof statusValue === "number" ? statusValue : undefined;
  let bodyMsg = "";
  if (typeof err.responseBody === "string") {
    try {
      const parsed = JSON.parse(err.responseBody) as { error?: { message?: string } };
      bodyMsg = parsed.error?.message ?? err.responseBody;
    } catch {
      bodyMsg = String(err.responseBody);
    }
  }
  // Always keep a compact raw detail (status + provider message) for diagnosis.
  const who = providerLabel ? `${providerLabel}: ` : "";
  const rawDetail =
    bodyMsg && bodyMsg !== err?.message
      ? ` (${bodyMsg.slice(0, 160)}${statusCode ? `, HTTP ${statusCode}` : ""})`
      : statusCode
        ? ` (HTTP ${statusCode})`
        : "";
  const message = typeof err.message === "string" ? err.message : String(e);
  const name = typeof err.name === "string" ? err.name : "";
  const hint = friendlyHint(`${message} ${bodyMsg}`, statusCode);
  if (hint) return `⚠ ${who}${hint}${rawDetail}`;
  const parts: string[] = [`⚠ ${who}`.trimEnd()];
  if (name) parts.push(name);
  if (message) parts.push(message);
  if (statusCode) parts.push(`(HTTP ${statusCode})`);
  if (bodyMsg && bodyMsg !== err?.message) parts.push(`→ ${bodyMsg.slice(0, 300)}`);
  if (parts.length <= 1) parts.push(String(e));
  return parts.join(" ");
}

// Keep active streams as plain text, then parse Markdown once reasoning is complete.
export function ReasoningBlock({
  text,
  active,
  durationMs,
}: {
  text: string;
  active?: boolean;
  durationMs?: number;
}) {
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const open = userToggled ?? false;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void text;
    if (active && open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text, active, open]);

  const label = active
    ? "Thinking…"
    : durationMs
      ? `Thought for ${Math.max(1, Math.round(durationMs / 1000))}s`
      : "Reasoning";

  // A finished reasoning block with no text carries nothing to read; hide it
  // rather than render an empty "Reasoning" collapsible.
  if (!active && !text.trim()) return null;

  return (
    <div className="max-w-[85%] rounded-md border bg-muted text-xs">
      <button
        type="button"
        onClick={() => setUserToggled(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-muted-foreground hover:bg-accent/50"
      >
        <Brain className={cn("size-3.5", active && "ai-shimmer-icon")} />
        {active ? <Shimmer text={label} /> : <span>{label}</span>}
        <ChevronRight className={cn("ml-auto size-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div
          ref={scrollRef}
          className="max-h-56 overflow-x-hidden overflow-y-auto break-words border-t px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground"
        >
          {/* The reasoning trace is rendered as plain text, not Markdown. It is
              a raw thinking dump, often dense with partial LaTeX and long: the
              full math/mermaid/highlight renderer would choke on the fragments
              (showing raw source) and block the main thread while parsing the
              whole trace on expand. Plain pre-wrap opens instantly. */}
          <span className="whitespace-pre-wrap">{text}</span>
        </div>
      )}
    </div>
  );
}

// Delegated child run, in the multi-agent-action card shape: what it was
// asked, where it is, and a preview of what came back.
export function SubagentCard({
  entry,
}: {
  entry: { id: string; label: string; state: string; detail?: string };
}) {
  const running = entry.state !== "done" && entry.state !== "error";
  return (
    <div
      data-testid="subagent-card"
      data-subagent-state={entry.state}
      className="max-w-[85%] rounded-md border bg-muted text-xs"
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Bot className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{entry.label}</span>
        {running && <Loader2 className="size-3 shrink-0 animate-spin" />}
        {entry.state === "done" && (
          <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />
        )}
        {entry.state === "error" && (
          <XCircle className="size-3 shrink-0 text-destructive" />
        )}
      </div>
      {(running || entry.detail) && (
        <div className="border-t px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
          {running
            ? entry.state === "tool" && entry.detail
              ? `Using ${entry.detail}`
              : "Working on it"
            : entry.detail}
        </div>
      )}
    </div>
  );
}

// Finished runs fold their reasoning and tool steps behind one header, so a
// long agentic turn reads as its outcome first. Streaming turns stay fully
// expanded; the fold only applies once the run is over.
function WorkedSteps({
  rows,
  totalMs,
}: {
  rows: React.ReactNode[];
  totalMs: number;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const seconds = Math.max(1, Math.round(totalMs / 1000));
  const label = totalMs > 0 ? `Worked for ${seconds}s` : `Worked through ${rows.length} steps`;
  return (
    <div className="max-w-[85%]">
      <button
        type="button"
        data-testid="worked-steps-toggle"
        aria-controls={listId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        {label}
      </button>
      {open && (
        <div id={listId} className="mt-1.5 flex animate-in fade-in flex-col gap-1.5 border-l pl-2.5 duration-150 motion-reduce:animate-none">
          {rows}
        </div>
      )}
    </div>
  );
}

// Memoized on the message object reference: `updateLast` only replaces the
// *last* message's reference each streamed token, so every earlier message
// skips re-render (and re-parsing its markdown) instead of reconciling the
// whole list per token.
export const MessageItem = memo(function MessageItem({
  msg,
  live,
}: {
  msg: ChatMessage;
  live?: boolean;
}) {
  const tools = msg.toolCalls ?? [];
  const attachmentOccurrences = new Map<string, number>();
  // Fall back to the legacy single-block fields for chats persisted before
  // reasoningBlocks existed.
  const blocks =
    msg.reasoningBlocks ??
    (msg.reasoning ? [{ text: msg.reasoning, ms: msg.reasoningMs, beforeTool: 0 }] : []);
  // Each block renders before the tool call whose index it recorded, to
  // interleave thinking phases and tool badges in arrival order.
  const rows: React.ReactNode[] = [];
  for (let i = 0; i <= tools.length; i++) {
    blocks.forEach((b, blockIndex) => {
      if (Math.min(b.beforeTool, tools.length) === i) {
        rows.push(
          <ReasoningBlock
            key={b.id ?? `legacy-reasoning-${blockIndex}`}
            text={b.text}
            active={!!live && b.ms === undefined}
            durationMs={b.ms}
          />,
        );
      }
    });
    if (i < tools.length) {
      // Collapse a finished run of consecutive read-only tools (with no
      // reasoning anchored between them) into one exploration summary.
      const reasoningAt = (index: number) =>
        blocks.some((b) => Math.min(b.beforeTool, tools.length) === index);
      if (!live && EXPLORATION_TOOLS[tools[i].name]) {
        let j = i;
        while (
          j + 1 < tools.length &&
          EXPLORATION_TOOLS[tools[j + 1].name] &&
          !reasoningAt(j + 1)
        ) {
          j++;
        }
        if (j > i) {
          rows.push(
            <ExplorationGroup
              key={tools[i].id ?? `explore-group-${i}`}
              tools={tools.slice(i, j + 1)}
            />,
          );
          i = j;
          continue;
        }
      }
      const tool = tools[i];
      const key = tool.id ?? `legacy-tool-${i}`;
      if (tool.name === "run_command") {
        rows.push(<ExecCard key={key} tc={tool} />);
      } else {
        rows.push(<ToolBadge key={key} tc={tool} live={live} />);
      }
    }
  }
  for (const entry of msg.subagents ?? []) {
    rows.push(<SubagentCard key={entry.id} entry={entry} />);
  }
  const totalMs = blocks.reduce((sum, block) => sum + (block.ms ?? 0), 0);
  const foldSteps = !live && rows.length > 0 && msg.role === "assistant";
  const pictures = foldSteps ? lastFinishedPicture(msg.toolCalls ?? []) : [];
  const tokenizedUserText = msg.role === "user" ? userTokenChips(msg) : null;
  const createdAt = msg.createdAt === undefined ? null : new Date(msg.createdAt);
  const validCreatedAt = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null;
  const messageTime = validCreatedAt?.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return (
    <div className={cn("flex flex-col gap-1.5", msg.role === "user" && "items-end")}>
      {foldSteps ? <WorkedSteps rows={rows} totalMs={totalMs} /> : rows}
      {pictures.map((tool, index) => (
        <div
          key={tool.id ?? `picture-${index}`}
          data-testid="tool-picture"
          className="max-w-[85%] rounded-md border bg-muted text-xs"
        >
          <ToolPicture tc={tool} />
        </div>
      ))}
      {msg.role === "user" && msg.steered && (
        <span
          data-testid="steered-message-label"
          className="text-[10px] font-medium text-muted-foreground"
        >
          Steered
        </span>
      )}
      {msg.attachments && msg.attachments.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {msg.attachments.map((a) => {
            const identity = `${a.name}:${a.mediaType}`;
            const occurrence = attachmentOccurrences.get(identity) ?? 0;
            attachmentOccurrences.set(identity, occurrence + 1);
            return (
            <span
              key={`${identity}:${occurrence}`}
              className="flex items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              <Paperclip className="size-3" />
              <span className="max-w-[140px] truncate">{a.name}</span>
            </span>
            );
          })}
        </div>
      )}
      {msg.content ? (
        <div
          className={cn(
            "group flex w-full flex-col items-start gap-0.5",
            msg.role === "user" && "items-end",
          )}
        >
          <div
            className={cn(
              "overflow-hidden rounded-lg px-3 py-2 text-sm",
              msg.role === "user"
                ? "max-w-[85%] bg-primary text-white"
                : "w-full bg-muted text-foreground",
            )}
          >
            {tokenizedUserText ?? (
              <Markdown
                className="chat-markdown"
                inverted={msg.role === "user"}
                streaming={live}
              >
                {msg.content}
              </Markdown>
            )}
          </div>
          <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
            {messageTime && (
              <time dateTime={validCreatedAt?.toISOString()} className="tabular-nums">
                {messageTime}
              </time>
            )}
            <CopyMessageButton text={msg.content} />
          </div>
        </div>
      ) : null}
    </div>
  );
});
