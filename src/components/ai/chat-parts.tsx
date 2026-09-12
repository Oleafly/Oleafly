import {
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type RefObject,
} from "react";
import {
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleSlash,
  Copy,
  Info,
  Loader2,
  Paperclip,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatMessage, ReasoningBlockData, SubagentEntry, ToolEntry } from "@/store/chats";
import { agentTodoProgress, type AgentTodo } from "@/store/agent-todos";
import {
  agentFileChangeTotals,
  type AgentFileChange,
  type AgentFileChangeTurn,
} from "@/store/agent-file-changes";
import { Markdown } from "@/components/ui/markdown";
import { Popover } from "@/components/ui/popover";
import { AgentLogo } from "@/components/ai/acp/AgentLogo";
import { ProviderLogo } from "@/components/ai/ProviderLogo";
import { ResearchToolCard } from "@/components/ai/activity/ResearchToolCard";
import { lastFinishedPicture, ToolPicture } from "@/components/ai/activity/ToolPicture";
import { usePersistentExpansion } from "@/components/ai/activity/expansion-state";
import {
  projectToolEntry,
  splitAgentNotices,
  type ResearchChatActions,
} from "@/lib/chat-activity";
import { tokenizeComposer } from "@/lib/composer-tokens";
import { i18n } from "@/i18n";
import { formatList, formatTime } from "@/lib/intl";
import { cn } from "@/lib/utils";

const USER_SKILL_CHIP_CLASS =
  "rounded bg-blue-300/35 px-1 py-px font-medium text-white";
const USER_MENTION_CHIP_CLASS =
  "rounded bg-teal-300/35 px-1 py-px font-medium text-white";

function userTokenChipClass(kind: string): string | undefined {
  if (kind === "skill") return USER_SKILL_CHIP_CLASS;
  if (kind === "mention") return USER_MENTION_CHIP_CLASS;
  return undefined;
}

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
          className={userTokenChipClass(token.kind)}
        >
          {msg.content.slice(token.start, token.end)}
        </span>
      ))}
    </p>
  );
}

export function Shimmer({ text }: Readonly<{ text?: string }>) {
  return text ? <span className="ai-shimmer text-xs">{text}</span> : null;
}

// Used for low-urgency notices we don't want to spend a full banner on.
export function InfoHint({ message }: Readonly<{ message: string }>) {
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

function todoStatusLabel(status: AgentTodo["status"]): string {
  switch (status) {
    case "completed":
      return i18n.t(($) => $.ai.chat.todos.status.completed);
    case "in_progress":
      return i18n.t(($) => $.ai.chat.todos.status.inProgress);
    case "cancelled":
      return i18n.t(($) => $.ai.chat.todos.status.cancelled);
    default:
      return i18n.t(($) => $.ai.chat.todos.status.pending);
  }
}

function AgentTodoList({ todos }: Readonly<{ todos: readonly AgentTodo[] }>) {
  const { t } = useTranslation(["common", "ai"]);
  return (
    <ul className="space-y-1">
      {todos.map((todo) => (
        <li
          key={todo.id}
          data-todo-status={todo.status}
          aria-label={t(($) => $.ai.chat.todos.ariaLabel, {
            status: todoStatusLabel(todo.status),
            content: todo.content,
          })}
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

function AgentPlanStatusBadge({ status }: Readonly<{ status: AgentPlanApproval["status"] }>) {
  const { t } = useTranslation(["common", "ai"]);
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
      {status === "awaiting"
        ? t(($) => $.ai.chat.plan.statusAwaiting)
        : t(($) => $.ai.chat.plan.statusApproved)}
    </span>
  );
}

const STATUS_PILL_CLOSE_DELAY_MS = 150;

export function AgentStatusPill({
  todos,
  turn,
  approval,
}: Readonly<{
  todos: readonly AgentTodo[];
  turn: AgentFileChangeTurn | null;
  approval?: AgentPlanApproval;
}>) {
  const { t } = useTranslation(["common", "ai"]);
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
            {t(($) => $.ai.chat.pill.plan)}
          </span>
        )}
        {approval && (hasSteps || hasFiles) && <span aria-hidden="true"> · </span>}
        {hasSteps && (
          <span data-pill-segment="steps" className="tabular-nums">
            {t(($) => $.ai.chat.pill.step, {
              current: progress.current,
              total: progress.total,
            })}
          </span>
        )}
        {hasSteps && hasFiles && <span aria-hidden="true"> · </span>}
        {hasFiles && (
          <span data-pill-segment="review">
            {t(($) => $.ai.chat.pill.review)}{" "}
            <span className="tabular-nums text-emerald-600 dark:text-emerald-400">+{totals.additions}</span>{" "}
            <span className="tabular-nums text-destructive">-{totals.deletions}</span>
          </span>
        )}
      </button>

      {open && (
        <div className="pointer-events-auto absolute inset-x-0 bottom-full mx-auto w-full max-w-[22rem] pb-1.5">
          <div
            id={panelId}
            role="dialog"
            aria-label={t(($) => $.ai.chat.plan.detailsAriaLabel)}
            data-testid="agent-todos"
            data-plan-status={planStatus}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            onBlur={closeWhenFocusLeaves}
            className="max-h-72 overflow-y-auto rounded-lg border bg-popover p-2.5 text-left text-popover-foreground shadow-lg"
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {approval || hasSteps
                  ? t(($) => $.ai.chat.plan.headingPlan)
                  : t(($) => $.ai.chat.plan.headingChanges)}
              </span>
              {approval && <AgentPlanStatusBadge status={approval.status} />}
            </div>
            {todos.length > 0 && <AgentTodoList todos={todos} />}
            {awaiting && approval && (
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={t(($) => $.ai.chat.plan.approve)}
                  onClick={() => {
                    close();
                    approval.onApprove();
                  }}
                  disabled={approval.busy}
                  className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Check aria-hidden="true" className="size-3.5 shrink-0" />
                  {t(($) => $.ai.chat.plan.approve)}
                </button>
                <button
                  type="button"
                  aria-label={t(($) => $.ai.chat.plan.revise)}
                  onClick={() => {
                    close();
                    approval.onRevise();
                  }}
                  disabled={approval.busy}
                  className="flex h-7 shrink-0 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t(($) => $.ai.chat.plan.revise)}
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
}: Readonly<{
  file: AgentFileChange;
  state: "changed" | "committed";
}>) {
  return (
    <span
      data-file-change-state={state}
      data-file-change-path={file.path}
      className="flex min-w-0 items-center gap-2 text-[11px]"
    >
      <span className="min-w-0 flex-1 truncate text-foreground">{file.path}</span>
      <span className="shrink-0 tabular-nums text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
      <span className="shrink-0 tabular-nums text-destructive">-{file.deletions}</span>
    </span>
  );
}

function FileChangeDetails({ turn }: Readonly<{ turn: AgentFileChangeTurn }>) {
  const { t } = useTranslation(["common", "ai"]);
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
            {t(($) => $.ai.chat.fileChanges.changed)}
          </span>
          {changed.map((file) => (
            <FileChangeRow key={file.path} file={file} state="changed" />
          ))}
        </span>
      )}
      {[...committed.entries()].map(([commitId, files]) => (
        <span key={commitId} data-commit-id={commitId} className="block space-y-1.5">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t(($) => $.ai.chat.fileChanges.committed, { commit: commitId.slice(0, 7) })}
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
}: Readonly<{
  todos: readonly AgentTodo[];
  turn: AgentFileChangeTurn | null;
  plan?: boolean;
}>) {
  const { t } = useTranslation(["common", "ai"]);
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
        {plan && <span>{t(($) => $.ai.chat.runSummary.plan)}</span>}
        {plan && hasSteps && <span aria-hidden="true"> · </span>}
        {hasSteps && (
          <span className="tabular-nums">
            {t(($) => $.ai.chat.runSummary.stepsDone, { done, total: progress.total })}
          </span>
        )}
        {(plan || hasSteps) && hasFiles && <span aria-hidden="true"> · </span>}
        {hasFiles && (
          <span>
            {t(($) => $.ai.chat.runSummary.filesChanged, { count: totals.files })}{" "}
            <span className="tabular-nums text-emerald-600 dark:text-emerald-400">+{totals.additions}</span>{" "}
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

export function CopyMessageButton({ text }: Readonly<{ text: string }>) {
  const { t } = useTranslation(["common", "ai"]);
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
      aria-label={t(($) => $.ai.chat.copyMessage)}
      title={t(($) => $.ai.chat.copyMessage)}
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

function exploredFiles(count: number): string | null {
  return count === 0 ? null : i18n.t(($) => $.ai.chat.exploration.files, { count });
}

function exploredSearches(count: number): string | null {
  return count === 0 ? null : i18n.t(($) => $.ai.chat.exploration.searches, { count });
}

function exploredLists(count: number): string | null {
  return count === 0 ? null : i18n.t(($) => $.ai.chat.exploration.lists, { count });
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
  const parts = [exploredFiles(files), exploredSearches(searches), exploredLists(lists)].filter(
    (p): p is string => p != null,
  );
  return parts.length === 0
    ? i18n.t(($) => $.ai.chat.exploration.explored)
    : i18n.t(($) => $.ai.chat.exploration.exploredItems, {
        items: formatList(parts, { type: "unit", style: "narrow" }),
      });
}

// A collapsed run of read-only tool calls: "Explored 3 files, 2 searches",
// expandable to the individual tool badges. Mirrors the reference exploration
// grouping so a long read-heavy turn stays scannable.
export function ExplorationGroup({
  tools,
  actions,
  expansionKey,
}: Readonly<{
  tools: ToolEntry[];
  actions?: ResearchChatActions;
  expansionKey?: string;
}>) {
  useTranslation(["common", "ai"]);
  const [open, setOpen] = usePersistentExpansion(expansionKey, false);
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
            <ToolBadge
              key={tool.id ?? `explore-${index}`}
              tc={tool}
              actions={actions}
              expansionKey={expansionKey ? `${expansionKey}:${tool.id ?? index}` : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export { freeFigurePath, ToolPicture } from "@/components/ai/activity/ToolPicture";

export function ToolBadge({
  tc,
  actions,
  expansionKey,
  live = false,
}: Readonly<{
  tc: ToolEntry;
  actions?: ResearchChatActions;
  expansionKey?: string;
  live?: boolean;
}>) {
  return <ResearchToolCard tc={tc} actions={actions} expansionKey={expansionKey} live={live} />;
}

export function formatToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (typeof record.content === "string") return record.content;
    if (typeof record.error === "string") {
      return i18n.t(($) => $.ai.chat.toolOutputError, { message: record.error });
    }
  }
  return JSON.stringify(output, null, 2) ?? String(output);
}

export type AiHintSurface = "chat" | "settings";

const ERROR_HINTS: ReadonlyArray<{
  codes?: readonly number[];
  pattern?: RegExp;
  hint: (where: string) => string;
}> = [
  {
    codes: [402],
    pattern: /insufficient balance|no resource package|recharge|out of credit|insufficient[_ ]?quota|exceeded your current quota|billing|payment required/,
    hint: (where) => i18n.t(($) => $.ai.chat.errorHints.outOfCredits, { where }),
  },
  {
    codes: [401, 403],
    pattern: /invalid api key|incorrect api key|unauthorized|invalid[_ ]?api[_ ]?key|authentication|no api key/,
    hint: (where) => i18n.t(($) => $.ai.chat.errorHints.invalidKey, { where }),
  },
  {
    codes: [429],
    pattern: /rate limit|too many requests|\b429\b/,
    hint: (where) => i18n.t(($) => $.ai.chat.errorHints.rateLimited, { where }),
  },
  {
    pattern: /no longer available|has been retired|model.{0,40}(deprecated|discontinued|not found|does not exist)|unknown model|model_not_found/,
    hint: (where) => i18n.t(($) => $.ai.chat.errorHints.retiredModel, { where }),
  },
  {
    codes: [503],
    pattern: /high demand|overloaded|over capacity|service unavailable|\b503\b/,
    hint: (where) => i18n.t(($) => $.ai.chat.errorHints.overloaded, { where }),
  },
  {
    pattern: /econnrefused|failed to fetch|fetch failed|load failed|network error|not reachable|connection refused/,
    hint: () => i18n.t(($) => $.ai.chat.errorHints.unreachable),
  },
];

export function friendlyHint(
  text: string,
  statusCode?: number,
  surface: AiHintSurface = "chat",
): string | null {
  const t = text.toLowerCase();
  const where =
    surface === "settings"
      ? i18n.t(($) => $.ai.chat.errorHints.where.inSettings)
      : i18n.t(($) => $.ai.chat.errorHints.where.modelMenu);
  for (const rule of ERROR_HINTS) {
    const matched =
      (statusCode !== undefined && rule.codes?.includes(statusCode)) || rule.pattern?.test(t);
    if (matched) return rule.hint(where);
  }
  return null;
}

function responseBodyMessage(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const parsed = JSON.parse(value) as { error?: { message?: string } };
    return parsed.error?.message ?? value;
  } catch {
    return String(value);
  }
}

function rawErrorDetail(bodyMsg: string, bodyIsExtra: boolean, statusCode?: number): string {
  const statusSuffix = statusCode ? `, HTTP ${statusCode}` : "";
  if (bodyIsExtra) return ` (${bodyMsg.slice(0, 160)}${statusSuffix})`;
  if (statusCode) return ` (HTTP ${statusCode})`;
  return "";
}

function detailedError(
  head: string,
  detail: Readonly<{
    name: string;
    message: string;
    statusCode?: number;
    bodyMsg: string;
    bodyIsExtra: boolean;
    fallback: unknown;
  }>,
): string {
  const parts: string[] = [head];
  if (detail.name) parts.push(detail.name);
  if (detail.message) parts.push(detail.message);
  if (detail.statusCode) parts.push(`(HTTP ${detail.statusCode})`);
  if (detail.bodyIsExtra) parts.push(`→ ${detail.bodyMsg.slice(0, 300)}`);
  if (parts.length <= 1) parts.push(String(detail.fallback));
  return parts.join(" ");
}

export function formatError(e: unknown, providerLabel?: string): string {
  const err = typeof e === "object" && e !== null
    ? e as Record<string, unknown>
    : {};
  const statusValue = err.statusCode ?? err.status;
  const statusCode = typeof statusValue === "number" ? statusValue : undefined;
  const bodyMsg = responseBodyMessage(err.responseBody);
  const bodyIsExtra = Boolean(bodyMsg) && bodyMsg !== err.message;
  const who = providerLabel ? `${providerLabel}: ` : "";
  const rawDetail = rawErrorDetail(bodyMsg, bodyIsExtra, statusCode);
  const message = typeof err.message === "string" ? err.message : String(e);
  const name = typeof err.name === "string" ? err.name : "";
  const hint = friendlyHint(`${message} ${bodyMsg}`, statusCode);
  if (hint) return `⚠ ${who}${hint}${rawDetail}`;
  return detailedError(`⚠ ${who}`.trimEnd(), {
    name,
    message,
    statusCode,
    bodyMsg,
    bodyIsExtra,
    fallback: e,
  });
}

// Keep active streams as plain text, then parse Markdown once reasoning is complete.
export function ReasoningBlock({
  text,
  active,
  durationMs,
  expansionKey,
}: Readonly<{
  text: string;
  active?: boolean;
  durationMs?: number;
  expansionKey?: string;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const [open, setOpen] = usePersistentExpansion(expansionKey, false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void text;
    if (active && open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text, active, open]);

  let label: string;
  if (active) {
    label = t(($) => $.ai.chat.reasoning.thinking);
  } else if (durationMs) {
    label = t(($) => $.ai.chat.reasoning.thoughtFor, {
      seconds: Math.max(1, Math.round(durationMs / 1000)),
    });
  } else {
    label = t(($) => $.ai.chat.reasoning.label);
  }

  // A finished reasoning block with no text carries nothing to read; hide it
  // rather than render an empty "Reasoning" collapsible.
  if (!active && !text.trim()) return null;

  return (
    <div
      data-reasoning-block
      data-reasoning-status={active ? "running" : "completed"}
      className="max-w-[85%] text-xs"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="group flex w-full items-center gap-2 py-1 text-left text-sm text-muted-foreground"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            <Brain className={cn("size-3.5 group-hover:hidden", active && "ai-shimmer-icon")} />
            <ChevronRight className="hidden size-3.5 group-hover:block" />
          </span>
        )}
        {active ? <Shimmer text={label} /> : <span>{label}</span>}
      </button>
      {open && (
        <div
          ref={scrollRef}
          className="ml-[0.4375rem] max-h-56 overflow-x-hidden overflow-y-auto break-words border-l pl-3 py-1 text-[11px] leading-relaxed text-muted-foreground"
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

const SUBAGENT_PREVIEW_HEIGHT = 176;

function SubagentIdentity({ entry }: Readonly<{ entry: SubagentEntry }>) {
  if (entry.runtime === "acp" && entry.agentId) {
    return <AgentLogo agentId={entry.agentId} size={14} />;
  }
  if (entry.providerId) return <ProviderLogo providerId={entry.providerId} size={14} />;
  return <Bot aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
}

function SubagentStatusIcon({ state }: Readonly<{ state: string }>) {
  if (state === "done") return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />;
  if (state === "error") return <XCircle className="size-3.5 shrink-0 text-destructive" />;
  if (state === "interrupted") {
    return <CircleSlash className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  return <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />;
}

// Delegated child run, in the multi-agent-action card shape: what it was
// asked, where it is, and what came back.
function subagentStatusLabel(entry: SubagentEntry, detailText: string): string {
  if (entry.state === "done") return i18n.t(($) => $.ai.chat.subagent.finished);
  if (entry.state === "error") return i18n.t(($) => $.ai.chat.subagent.failed);
  if (entry.state === "interrupted") return i18n.t(($) => $.ai.chat.subagent.stopped);
  if (entry.state === "tool" && detailText) {
    return i18n.t(($) => $.ai.chat.subagent.usingTool, { tool: detailText });
  }
  return i18n.t(($) => $.ai.chat.subagent.working);
}

function subagentEmptyBody(state: string): string {
  return state === "error"
    ? i18n.t(($) => $.ai.chat.subagent.errorBody)
    : i18n.t(($) => $.ai.chat.subagent.stoppedBody);
}

function subagentOutput({
  entry,
  detailText,
  bodyId,
  bodyRef,
  expanded,
  overflows,
}: Readonly<{
  entry: SubagentEntry;
  detailText: string;
  bodyId: string;
  bodyRef: RefObject<HTMLDivElement | null>;
  expanded: boolean;
  overflows: boolean;
}>) {
  return (
    <div className="relative border-t">
      <div
        id={bodyId}
        ref={bodyRef}
        data-testid="subagent-output"
        data-expanded={expanded ? "true" : "false"}
        className={cn(
          "px-2.5 py-2 text-[11px] leading-relaxed text-foreground/90",
          !expanded && "max-h-44 overflow-hidden",
        )}
      >
        {detailText ? (
          <Markdown className="chat-markdown">{detailText}</Markdown>
        ) : (
          <span className="text-muted-foreground">{subagentEmptyBody(entry.state)}</span>
        )}
      </div>
      {overflows && !expanded && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-muted to-transparent"
        />
      )}
    </div>
  );
}

export function SubagentCard({
  entry,
  actions,
}: Readonly<{
  entry: SubagentEntry;
  actions?: ResearchChatActions;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const settled =
    entry.state === "done" || entry.state === "error" || entry.state === "interrupted";
  const running = !settled;
  const detail = splitAgentNotices(entry.detail ?? "");
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyId = useId();

  useEffect(() => {
    const node = bodyRef.current;
    if (!node || running) {
      setOverflows(false);
      return;
    }
    const measure = () => setOverflows(node.scrollHeight > SUBAGENT_PREVIEW_HEIGHT + 8);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [running]);

  const openSession =
    entry.sessionId && actions?.openSession
      ? () => {
          if (entry.sessionId) {
            actions.openSession?.({ threadId: entry.sessionId, runtime: entry.runtime });
          }
        }
      : null;
  const statusLabel = subagentStatusLabel(entry, detail.text);

  return (
    <div
      data-testid="subagent-card"
      data-subagent-state={entry.state}
      className="max-w-[85%] overflow-hidden rounded-lg border bg-muted/60 text-xs"
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border bg-background">
          <SubagentIdentity entry={entry} />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{entry.label}</span>
        {entry.modelId && (
          <span
            data-testid="subagent-model"
            className="hidden max-w-[10rem] shrink-0 truncate rounded-full border bg-background px-1.5 py-px font-mono text-[10px] text-muted-foreground sm:inline"
          >
            {entry.modelId}
          </span>
        )}
        <SubagentStatusIcon state={entry.state} />
        {settled && <span className="sr-only">{statusLabel}</span>}
      </div>
      {running && (
        <div className="border-t px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
          <Shimmer text={statusLabel} />
        </div>
      )}
      {!running &&
        (detail.text || entry.state !== "done") &&
        subagentOutput({ entry, detailText: detail.text, bodyId, bodyRef, expanded, overflows })}
      {detail.notices.map((notice) => (
        <p
          key={notice}
          data-testid="agent-notice"
          className="flex items-start gap-1.5 border-t bg-amber-500/5 px-2.5 py-1.5 text-[10px] leading-snug text-muted-foreground"
        >
          <Info aria-hidden="true" className="mt-px size-3 shrink-0 text-amber-500" />
          <span className="min-w-0">{notice}</span>
        </p>
      ))}
      {(overflows || openSession) && (
        <div className="flex items-center justify-between gap-2 border-t px-1.5 py-1">
          <span>
            {overflows && (
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={bodyId}
                className="rounded px-1.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? t(($) => $.common.actions.showLess) : t(($) => $.common.actions.showMore)}
              </button>
            )}
          </span>
          {openSession && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-foreground hover:bg-accent"
              onClick={openSession}
            >
              {t(($) => $.ai.chat.subagent.openTask)}
              <ChevronRight aria-hidden="true" className="size-3" />
            </button>
          )}
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
  expansionKey,
}: Readonly<{
  rows: React.ReactNode[];
  totalMs: number;
  expansionKey?: string;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const [open, setOpen] = usePersistentExpansion(expansionKey, false);
  const listId = useId();
  const seconds = Math.max(1, Math.round(totalMs / 1000));
  const label =
    totalMs > 0
      ? t(($) => $.ai.chat.workedSteps.duration, { seconds })
      : t(($) => $.ai.chat.workedSteps.steps, { count: rows.length });
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
type MessageRowContext = Readonly<{
  msg: ChatMessage;
  live?: boolean;
  actions?: ResearchChatActions;
  expansionScope?: string;
  tools: readonly ToolEntry[];
  blocks: readonly ReasoningBlockData[];
}>;

function scopedExpansionKey(scope: string | undefined, suffix: string): string | undefined {
  return scope ? `${scope}:${suffix}` : undefined;
}

function reasoningAnchoredAt(
  blocks: readonly ReasoningBlockData[],
  toolCount: number,
  index: number,
): boolean {
  return blocks.some((b) => Math.min(b.beforeTool, toolCount) === index);
}

function pushReasoningRows(rows: React.ReactNode[], context: MessageRowContext, index: number) {
  const { blocks, tools, live, expansionScope } = context;
  blocks.forEach((b, blockIndex) => {
    if (Math.min(b.beforeTool, tools.length) === index) {
      rows.push(
        <ReasoningBlock
          key={b.id ?? `legacy-reasoning-${blockIndex}`}
          text={b.text}
          active={!!live && b.ms === undefined}
          durationMs={b.ms}
          expansionKey={scopedExpansionKey(expansionScope, `reasoning:${b.id ?? blockIndex}`)}
        />,
      );
    }
  });
}

function explorationRunEnd(context: MessageRowContext, start: number): number {
  const { tools, blocks, live } = context;
  if (live || !EXPLORATION_TOOLS[tools[start].name]) return -1;
  let j = start;
  while (
    j + 1 < tools.length &&
    EXPLORATION_TOOLS[tools[j + 1].name] &&
    !reasoningAnchoredAt(blocks, tools.length, j + 1)
  ) {
    j++;
  }
  return j > start ? j : -1;
}

function pushToolRow(rows: React.ReactNode[], context: MessageRowContext, index: number) {
  const { tools, actions, expansionScope, live } = context;
  const tool = tools[index];
  const key = tool.id ?? `legacy-tool-${index}`;
  rows.push(
    <ToolBadge
      key={key}
      tc={tool}
      actions={actions}
      expansionKey={scopedExpansionKey(expansionScope, `tool:${key}`)}
      live={live}
    />,
  );
}

function buildMessageRows(context: MessageRowContext): React.ReactNode[] {
  const { msg, tools, actions, expansionScope } = context;
  const rows: React.ReactNode[] = [];
  let i = 0;
  while (i <= tools.length) {
    pushReasoningRows(rows, context, i);
    if (i < tools.length) {
      const end = explorationRunEnd(context, i);
      if (end >= 0) {
        rows.push(
          <ExplorationGroup
            key={tools[i].id ?? `explore-group-${i}`}
            tools={tools.slice(i, end + 1)}
            actions={actions}
            expansionKey={scopedExpansionKey(expansionScope, `exploration:${tools[i].id ?? i}`)}
          />,
        );
        i = end + 1;
        continue;
      }
      pushToolRow(rows, context, i);
    }
    i++;
  }
  for (const entry of msg.subagents ?? []) {
    rows.push(<SubagentCard key={entry.id} entry={entry} actions={actions} />);
  }
  return rows;
}

function messageTimestamp(createdAt: number | undefined): Readonly<{ iso?: string; label?: string }> {
  if (createdAt === undefined) return {};
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return {};
  return {
    iso: date.toISOString(),
    label: formatTime(date, { hour: "numeric", minute: "2-digit" }),
  };
}

function messageBubble({
  msg,
  live,
  tokenizedUserText,
  messageTime,
  messageIso,
}: Readonly<{
  msg: ChatMessage;
  live?: boolean;
  tokenizedUserText: React.ReactNode | null;
  messageTime?: string;
  messageIso?: string;
}>) {
  return (
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
            : "w-full bg-background text-foreground ring-1 ring-border/60 dark:bg-muted dark:ring-0",
        )}
      >
        {tokenizedUserText ?? (
          <Markdown className="chat-markdown" inverted={msg.role === "user"} streaming={live}>
            {msg.content}
          </Markdown>
        )}
      </div>
      <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
        {messageTime && (
          <time dateTime={messageIso} className="tabular-nums">
            {messageTime}
          </time>
        )}
        <CopyMessageButton text={msg.content} />
      </div>
    </div>
  );
}

export const MessageItem = memo(function MessageItem({
  msg,
  live,
  actions,
  expansionScope,
}: Readonly<{
  msg: ChatMessage;
  live?: boolean;
  actions?: ResearchChatActions;
  expansionScope?: string;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const tools = msg.toolCalls ?? [];
  const attachmentOccurrences = new Map<string, number>();
  // Fall back to the legacy single-block fields for chats persisted before
  // reasoningBlocks existed.
  const blocks =
    msg.reasoningBlocks ??
    (msg.reasoning ? [{ text: msg.reasoning, ms: msg.reasoningMs, beforeTool: 0 }] : []);
  // Each block renders before the tool call whose index it recorded, to
  // interleave thinking phases and tool badges in arrival order.
  const rows = buildMessageRows({ msg, live, actions, expansionScope, tools, blocks });
  const totalMs = blocks.reduce((sum, block) => sum + (block.ms ?? 0), 0);
  const hasVisibleOutcome = tools.some((tool) => {
    const view = projectToolEntry(tool);
    return (
      view.status === "failed" ||
      view.status === "cancelled" ||
      view.status === "declined" ||
      view.kind === "literature" ||
      view.kind === "citation" ||
      view.kind === "compile" ||
      view.kind === "artifact" ||
      view.kind === "delegation"
    );
  });
  const foldSteps =
    !live &&
    rows.length > 0 &&
    msg.role === "assistant" &&
    !hasVisibleOutcome &&
    !(msg.subagents?.length);
  const pictures = !live && msg.role === "assistant" ? lastFinishedPicture(msg.toolCalls ?? []) : [];
  const tokenizedUserText = msg.role === "user" ? userTokenChips(msg) : null;
  const timestamp = messageTimestamp(msg.createdAt);
  return (
    <div className={cn("flex flex-col gap-1.5", msg.role === "user" && "items-end")}>
      {foldSteps ? (
        <WorkedSteps
          rows={rows}
          totalMs={totalMs}
          expansionKey={scopedExpansionKey(expansionScope, "steps")}
        />
      ) : rows}
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
          {t(($) => $.ai.chat.steered)}
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
      {msg.notices?.map((notice) => (
        <p
          key={notice}
          data-testid="agent-notice"
          className="max-w-[85%] rounded-md border border-border/70 bg-muted/40 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground"
        >
          {notice}
        </p>
      ))}
      {msg.content
        ? messageBubble({
            msg,
            live,
            tokenizedUserText,
            messageTime: timestamp.label,
            messageIso: timestamp.iso,
          })
        : null}
    </div>
  );
});
