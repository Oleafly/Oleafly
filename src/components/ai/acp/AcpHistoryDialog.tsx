import { useCallback, useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Pencil, Search, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ModalShell } from "@/components/ui/modal-shell";
import { Tooltip } from "@/components/ui/tooltip";
import {
  acpAgentSessions, acpError, acpSessionDelete, acpSessionImport, acpSessionPage, acpSessionRename,
  type AcpAgentSessionInfo, type AcpAgentStatus, type AcpSession,
} from "@/lib/acp";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { i18n } from "@/i18n";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { toast } from "@/lib/toast";
import { isDelegatedSession, useAcpSessionsStore } from "@/store/acp-sessions";

const PAGE = 50;
const SEARCH_DELAY_MS = 200;

/** Deletes a conversation after the confirmation; shared by the dialog and the session header. */
export async function deleteConversation(
  projectId: string,
  session: AcpSession,
  fromAgent: boolean,
  agentName: string,
): Promise<void> {
  const outcome = await acpSessionDelete(projectId, session.id, fromAgent);
  useAcpSessionsStore.getState().forgetSession(projectId, session.id);
  if (outcome.agentError) {
    toast.error(i18n.t(($) => $.ai.acp.history.deleteAgentFailed, { agent: agentName, error: outcome.agentError }));
  }
}

/** A name field that saves on Enter or when it loses focus, and drops the edit on Escape. */
export function RenameInput({
  initial,
  className,
  onSave,
  onCancel,
}: Readonly<{
  initial: string;
  className?: string;
  onSave(value: string): void;
  onCancel(): void;
}>) {
  const { t } = useTranslation(["ai"]);
  const cancelled = useRef(false);
  return (
    <Input
      autoFocus
      defaultValue={initial}
      maxLength={120}
      aria-label={t(($) => $.ai.acp.history.renameLabel)}
      className={className}
      onBlur={(event) => {
        if (cancelled.current) return;
        onSave(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          // Saving happens once, on the blur this causes.
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelled.current = true;
          onCancel();
        }
      }}
    />
  );
}

/** Asks before deleting; offers deleting the agent's own copy when it can. */
export function DeleteConversationDialog({
  session,
  agentName,
  open,
  onCancel,
  onConfirm,
}: Readonly<{
  session: AcpSession | null;
  agentName: string;
  open: boolean;
  onCancel(): void;
  onConfirm(fromAgent: boolean): void;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const [fromAgent, setFromAgent] = useState(false);
  const fromAgentId = useId();
  useEffect(() => {
    if (open) setFromAgent(false);
  }, [open]);
  return (
    <ConfirmationDialog
      open={open}
      destructive
      title={t(($) => $.ai.acp.history.deleteTitle)}
      description={t(($) => $.ai.acp.history.deleteDescription)}
      confirmLabel={t(($) => $.ai.acp.history.delete)}
      onCancel={onCancel}
      onConfirm={() => onConfirm(fromAgent)}
    >
      {session?.capabilities.delete && (
        <label htmlFor={fromAgentId} className="mt-2 flex items-center gap-2 text-sm">
          <Checkbox id={fromAgentId} checked={fromAgent} onCheckedChange={(checked) => setFromAgent(checked === true)} />
          {t(($) => $.ai.acp.history.deleteFromAgent, { agent: agentName })}
        </label>
      )}
    </ConfirmationDialog>
  );
}

/** The agent's own conversations: a button to look them up, then a list to pick from. */
function ImportPanel({
  entries,
  agentName,
  idPrefix,
  picked,
  setPicked,
  nextCursor,
  onFind,
  onImport,
}: Readonly<{
  /** Null until the agent has been asked. */
  entries: AcpAgentSessionInfo[] | null;
  agentName: string;
  idPrefix: string;
  picked: Set<string>;
  setPicked: Dispatch<SetStateAction<Set<string>>>;
  nextCursor: string | null;
  onFind(cursor: string | null): Promise<void>;
  onImport(): Promise<void>;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  if (entries === null) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => void onFind(null)}>
        {t(($) => $.ai.acp.history.importFind, { agent: agentName })}
      </Button>
    );
  }
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">{t(($) => $.ai.acp.history.importEmpty, { agent: agentName })}</p>;
  }
  return (
    <>
      <ul className="max-h-48 space-y-1 overflow-y-auto">
        {entries.map((entry, index) => (
          <li key={entry.nativeSessionId}>
            <label htmlFor={`${idPrefix}-${index}`} className="flex items-center gap-2 text-xs">
              <Checkbox
                id={`${idPrefix}-${index}`}
                disabled={entry.imported}
                checked={entry.imported || picked.has(entry.nativeSessionId)}
                onCheckedChange={(checked) => setPicked((current) => {
                  const next = new Set(current);
                  if (checked === true) next.add(entry.nativeSessionId);
                  else next.delete(entry.nativeSessionId);
                  return next;
                })}
              />
              <span className="min-w-0 flex-1 truncate">{entry.title ?? entry.nativeSessionId}</span>
              {entry.imported && <span className="text-muted-foreground">{t(($) => $.ai.acp.history.imported)}</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        {nextCursor && (
          <Button type="button" variant="ghost" size="sm" onClick={() => void onFind(nextCursor)}>
            {t(($) => $.ai.acp.history.loadMore)}
          </Button>
        )}
        <Button type="button" size="sm" disabled={picked.size === 0} onClick={() => void onImport()}>
          {t(($) => $.ai.acp.history.importSelected)}
        </Button>
      </div>
    </>
  );
}

/** Every conversation of the project: search, rename, delete, import. */
export function AcpHistoryDialog({
  projectId,
  open,
  onClose,
  onOpenSession,
  agentName,
  importAgent,
}: Readonly<{
  projectId: string;
  open: boolean;
  onClose(): void;
  onOpenSession(id: string): void;
  agentName(id: string): string;
  importAgent: AcpAgentStatus | undefined;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AcpSession[]>([]);
  const [hasMore, setHasMore] = useState(false);
  // Where the next page starts: the last conversation the backend sent,
  // delegated ones included. The last row shown can be older than that. The
  // id breaks a tie between conversations updated at the same time.
  const [cursor, setCursor] = useState<{ before: number; beforeId: string } | undefined>(undefined);
  const search = useDebouncedValue(query.trim(), SEARCH_DELAY_MS, (value) => value === "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AcpSession | null>(null);
  const [importing, setImporting] = useState<AcpAgentSessionInfo[] | null>(null);
  const [importCursor, setImportCursor] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const importId = useId();
  const request = useRef(0);

  const load = useCallback(async (term: string, after?: { before: number; beforeId: string }) => {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const page = await acpSessionPage(projectId, {
        query: term || undefined,
        before: after?.before,
        beforeId: after?.beforeId,
        limit: PAGE,
      });
      if (id !== request.current) return;
      const visible = page.sessions.filter((session) => !isDelegatedSession(session));
      setRows((current) => (after === undefined ? visible : [...current, ...visible]));
      setHasMore(page.hasMore);
      const last = page.sessions.at(-1);
      setCursor(last ? { before: last.updatedAt, beforeId: last.id } : after);
    } catch (error_) {
      if (id === request.current) setError(acpError(error_));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) void load(search);
  }, [load, open, search]);

  const rename = async (session: AcpSession, title: string) => {
    setRenaming(null);
    const trimmed = title.trim();
    if (!trimmed || trimmed === session.title) return;
    try {
      const saved = await acpSessionRename(projectId, session.id, trimmed);
      setRows((current) => current.map((row) => (row.id === saved.id ? saved : row)));
      useAcpSessionsStore.setState((state) => state.sessions[saved.id]
        ? { sessions: { ...state.sessions, [saved.id]: { ...state.sessions[saved.id], title: saved.title, titleLocked: true } } }
        : state);
    } catch (error_) {
      setError(acpError(error_));
    }
  };

  const confirmDelete = async (fromAgent: boolean) => {
    const session = deleting;
    setDeleting(null);
    if (!session) return;
    try {
      await deleteConversation(projectId, session, fromAgent, agentName(session.agentId));
      setRows((current) => current.filter((row) => row.id !== session.id));
    } catch (error_) {
      setError(acpError(error_));
    }
  };

  const findImports = async (cursor: string | null) => {
    if (!importAgent) return;
    setError(null);
    try {
      const page = await acpAgentSessions(projectId, importAgent.definition.id, cursor);
      setImporting((current) => (cursor && current ? [...current, ...page.sessions] : page.sessions));
      setImportCursor(page.nextCursor);
    } catch (error_) {
      setError(acpError(error_));
    }
  };

  const runImport = async () => {
    if (!importAgent || picked.size === 0) return;
    try {
      await acpSessionImport(projectId, importAgent.definition.id, [...picked]);
      setPicked(new Set());
      setImporting(null);
      await useAcpSessionsStore.getState().loadProject(projectId);
      await load(search);
    } catch (error_) {
      setError(acpError(error_));
    }
  };

  const importName = importAgent?.definition.name ?? "";
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      closeLabel={t(($) => $.common.actions.close)}
      label={t(($) => $.ai.acp.history.title)}
      width="lg"
      testId="acp-history-dialog"
    >
      <div className="flex max-h-[70vh] flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 text-sm font-semibold">{t(($) => $.ai.acp.history.title)}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            aria-label={t(($) => $.common.actions.close)}
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(($) => $.ai.acp.history.search)}
            aria-label={t(($) => $.ai.acp.history.search)}
            className="h-8 pl-7 text-sm"
          />
        </div>
        {error && <ErrorState size="compact" message={error} />}
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto" data-testid="acp-history-rows">
          {rows.length === 0 && !loading && (
            <li className="py-6">
              <EmptyState size="compact" title={t(($) => $.ai.acp.history.empty)} />
            </li>
          )}
          {rows.length === 0 && loading && (
            <li className="flex justify-center py-6">
              <LoadingState size="compact" label={t(($) => $.common.state.loading)} />
            </li>
          )}
          {rows.map((session) => (
            <li key={session.id} data-testid="acp-history-row" className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50">
              <div className="min-w-0 flex-1">
                {renaming === session.id ? (
                  <RenameInput
                    initial={session.title}
                    className="h-7 text-sm"
                    onSave={(value) => void rename(session, value)}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="h-auto w-full justify-start rounded-sm px-0 text-left text-sm font-normal hover:bg-transparent"
                    onClick={() => { onOpenSession(session.id); onClose(); }}
                  >
                    <span className="truncate">{session.title || t(($) => $.ai.acp.untitledConversation)}</span>
                  </Button>
                )}
                <p className="truncate text-[0.6875rem] text-muted-foreground">
                  {agentName(session.agentId)} · {formatRelativeTimeFrom(session.updatedAt)}
                </p>
              </div>
              <Tooltip label={t(($) => $.ai.acp.history.rename)}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground"
                  aria-label={t(($) => $.ai.acp.history.rename)}
                  onClick={() => setRenaming(session.id)}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </Tooltip>
              <Tooltip label={session.status === "running" ? t(($) => $.ai.acp.history.deleteRunning) : t(($) => $.ai.acp.history.delete)}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  aria-label={t(($) => $.ai.acp.history.delete)}
                  disabled={session.status === "running" || session.status === "cancelling"}
                  onClick={() => setDeleting(session)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </Tooltip>
            </li>
          ))}
        </ul>
        {hasMore && (
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load(search, cursor)}>
            {t(($) => $.ai.acp.history.loadMore)}
          </Button>
        )}
        {importAgent?.runtime?.sessionList && (
          <div className="space-y-2 border-t pt-3">
            <ImportPanel
              entries={importing}
              agentName={importName}
              idPrefix={importId}
              picked={picked}
              setPicked={setPicked}
              nextCursor={importCursor}
              onFind={findImports}
              onImport={runImport}
            />
          </div>
        )}
      </div>
      <DeleteConversationDialog
        session={deleting}
        agentName={deleting ? agentName(deleting.agentId) : ""}
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={(fromAgent) => void confirmDelete(fromAgent)}
      />
    </ModalShell>
  );
}

export default AcpHistoryDialog;
