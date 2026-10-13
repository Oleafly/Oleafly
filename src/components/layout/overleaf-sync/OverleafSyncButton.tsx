import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { ExternalLink, KeyRound, RefreshCw, Unlink } from "lucide-react";
import { OverleafBrandIcon } from "@/components/settings/IntegrationBrandIcons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { describeError } from "@/lib/app-error";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { logError } from "@/lib/log";
import { overleafTokenPage, type SyncSide } from "@/lib/overleaf-sync";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useOverleafSyncStore } from "@/store/overleaf-sync";

const AUTO_SYNC_EVERY = 3 * 60_000;
const QUIET_AFTER_TYPING = 15_000;
const MAX_SHOWN = 12;

type ShellTranslate = ReturnType<typeof useTranslation<["shell"]>>["t"];

function statusLine(t: ShellTranslate, now: number): string {
  const state = useOverleafSyncStore.getState();
  const status = state.status;
  if (state.phase === "linking") return t(($) => $.shell.overleafSync.status.linking);
  if (state.phase === "syncing") return t(($) => $.shell.overleafSync.status.syncing);
  if (state.conflicts.length > 0) {
    return t(($) => $.shell.overleafSync.status.conflicts, { count: state.conflicts.length });
  }
  if (state.error) return describeError(state.error);
  if (!status?.linked) return t(($) => $.shell.overleafSync.status.notLinked);
  if (!status.tokenSaved) return t(($) => $.shell.overleafSync.status.needsToken);
  if (!status.lastSyncAt) return t(($) => $.shell.overleafSync.status.never);
  const when = formatRelativeTimeFrom(status.lastSyncAt * 1000, now, {
    justNow: t(($) => $.shell.overleafSync.status.justNow),
  });
  return t(($) => $.shell.overleafSync.status.synced, { time: when });
}

function useAutoSync(projectId: string) {
  const lastEdit = useRef(0);
  useEffect(
    () =>
      useFilesStore.subscribe((state, previous) => {
        if (state.files !== previous.files) lastEdit.current = Date.now();
      }),
    [],
  );
  useEffect(() => {
    const tick = () => {
      const sync = useOverleafSyncStore.getState();
      const files = useFilesStore.getState();
      const dirty = Object.values(files.files).some((file) => file.dirty);
      const awake = document.visibilityState === "visible" && document.hasFocus();
      if (
        sync.projectId !== projectId ||
        !sync.status?.linked ||
        !sync.status.auto ||
        !sync.status.tokenSaved ||
        sync.conflicts.length > 0 ||
        !awake ||
        dirty ||
        Date.now() - lastEdit.current < QUIET_AFTER_TYPING
      ) {
        return;
      }
      void sync.sync(null, "auto");
    };
    const first = window.setTimeout(tick, 2_000);
    const timer = window.setInterval(tick, AUTO_SYNC_EVERY);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [projectId]);
}

export function OverleafSyncButton() {
  const { t } = useTranslation(["shell"]);
  const projectId = useFilesStore((state) => state.projectId);
  const status = useOverleafSyncStore((state) => state.status);
  const phase = useOverleafSyncStore((state) => state.phase);
  const conflicts = useOverleafSyncStore((state) => state.conflicts);
  const choice = useOverleafSyncStore((state) => state.choice);
  const error = useOverleafSyncStore((state) => state.error);
  const refresh = useOverleafSyncStore((state) => state.refresh);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (projectId) void refresh(projectId);
  }, [projectId, refresh]);
  useAutoSync(projectId ?? "");

  if (!projectId || !status || (!status.linked && !status.importedFrom)) return null;

  const busy = phase !== "idle";
  const attention = conflicts.length > 0 || Boolean(error);
  const store = useOverleafSyncStore.getState();

  const startLink = () => {
    if (!status.tokenSaved) setTokenOpen(true);
    else void store.link();
  };
  const syncNow = () => {
    if (!status.tokenSaved) setTokenOpen(true);
    else if (conflicts.length > 0) setConflictsOpen(true);
    else void store.sync(null, "manual");
  };

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && setNow(Date.now())}>
        <Tooltip label={t(($) => $.shell.overleafSync.button)} side="bottom">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-testid="overleaf-sync-button"
              aria-label={t(($) => $.shell.overleafSync.button)}
              className="relative size-7 text-muted-foreground hover:text-foreground"
            >
              {busy ? <Spinner size="sm" /> : <OverleafBrandIcon className="size-4 text-[#47A141]" />}
              <span
                aria-hidden
                className={cn(
                  "absolute right-1 top-1 size-1.5 rounded-full",
                  attention ? "bg-amber-500" : "hidden",
                )}
              />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="space-y-0.5">
            <span className="block text-sm">{t(($) => $.shell.overleafSync.title)}</span>
            <span data-testid="overleaf-sync-status" className="block select-text text-xs font-normal text-muted-foreground">
              {statusLine(t, now)}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {status.linked ? (
            <LinkedItems
              busy={busy}
              auto={status.auto}
              hasConflicts={conflicts.length > 0}
              onSync={syncNow}
              onResolve={() => setConflictsOpen(true)}
            />
          ) : (
            <DropdownMenuItem data-testid="overleaf-sync-link" disabled={busy} onSelect={startLink}>
              <RefreshCw className="size-4 text-muted-foreground" />
              {t(($) => $.shell.overleafSync.actions.keepInSync)}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setTokenOpen(true)}>
            <KeyRound className="size-4 text-muted-foreground" />
            {status.tokenSaved
              ? t(($) => $.shell.overleafSync.actions.changeToken)
              : t(($) => $.shell.overleafSync.actions.addToken)}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TokenDialog
        open={tokenOpen}
        server={status.importedFrom?.server ?? status.server}
        onClose={() => setTokenOpen(false)}
        onSaved={() => {
          setTokenOpen(false);
          if (status.linked) void store.sync(null, "manual");
          else void store.link();
        }}
      />
      <ChoiceDialog files={choice} onClose={() => store.dismissChoice()} />
      <ConflictDialog open={conflictsOpen} files={conflicts} onClose={() => setConflictsOpen(false)} />
    </>
  );
}

function LinkedItems({
  busy,
  auto,
  hasConflicts,
  onSync,
  onResolve,
}: Readonly<{ busy: boolean; auto: boolean; hasConflicts: boolean; onSync: () => void; onResolve: () => void }>) {
  const { t } = useTranslation(["shell"]);
  const store = useOverleafSyncStore.getState();
  return (
    <>
      {hasConflicts ? (
        <DropdownMenuItem data-testid="overleaf-sync-resolve" disabled={busy} onSelect={onResolve}>
          <RefreshCw className="size-4 text-amber-600" />
          {t(($) => $.shell.overleafSync.actions.resolve)}
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem data-testid="overleaf-sync-now" disabled={busy} onSelect={onSync}>
          <RefreshCw className="size-4 text-muted-foreground" />
          {t(($) => $.shell.overleafSync.actions.syncNow)}
        </DropdownMenuItem>
      )}
      <DropdownMenuCheckboxItem
        data-testid="overleaf-sync-auto"
        checked={auto}
        disabled={busy}
        onCheckedChange={(checked) => void store.setAuto(checked === true)}
      >
        {t(($) => $.shell.overleafSync.actions.auto)}
      </DropdownMenuCheckboxItem>
      <DropdownMenuItem data-testid="overleaf-sync-unlink" disabled={busy} onSelect={() => void store.unlink()}>
        <Unlink className="size-4 text-muted-foreground" />
        {t(($) => $.shell.overleafSync.actions.unlink)}
      </DropdownMenuItem>
    </>
  );
}

function TokenDialog({
  open,
  server,
  onClose,
  onSaved,
}: Readonly<{ open: boolean; server: string; onClose: () => void; onSaved: () => void }>) {
  const { t } = useTranslation(["shell"]);
  const [token, setToken] = useState("");
  const [failed, setFailed] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setFailed(null);
    const saved = await useOverleafSyncStore.getState().saveToken(token.trim());
    setSaving(false);
    if (saved) {
      setToken("");
      onSaved();
    } else {
      setFailed(useOverleafSyncStore.getState().error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent data-testid="overleaf-token-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(($) => $.shell.overleafSync.token.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.shell.overleafSync.token.description)}</DialogDescription>
        </DialogHeader>
        <button
          type="button"
          onClick={() => {
            openExternal(overleafTokenPage(server)).catch((error) => void logError("open overleaf settings", error));
          }}
          className="inline-flex w-fit items-center gap-1 rounded px-1 text-sm font-medium text-primary hover:bg-accent focus-visible:bg-accent"
        >
          {t(($) => $.shell.overleafSync.token.openSettings)}
          <ExternalLink aria-hidden className="size-3.5" />
        </button>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Input
            type="password"
            data-testid="overleaf-token-input"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            aria-label={t(($) => $.shell.overleafSync.token.label)}
            placeholder={t(($) => $.shell.overleafSync.token.label)}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">{t(($) => $.shell.overleafSync.token.note)}</p>
          {failed ? (
            <p role="alert" className="select-text text-xs text-destructive">
              {describeError(failed)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t(($) => $.shell.overleafSync.cancel)}
            </Button>
            <Button type="submit" data-testid="overleaf-token-save" disabled={saving || token.trim().length === 0}>
              {saving ? <Spinner size="sm" /> : null}
              {t(($) => $.shell.overleafSync.token.save)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FileList({ files }: Readonly<{ files: readonly string[] }>) {
  const { t } = useTranslation(["shell"]);
  const shown = files.slice(0, MAX_SHOWN);
  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2 font-mono text-xs">
      {shown.map((file) => (
        <li key={file} className="truncate" title={file}>
          {file}
        </li>
      ))}
      {files.length > shown.length ? (
        <li className="font-sans text-muted-foreground">
          {t(($) => $.shell.overleafSync.more, { count: files.length - shown.length })}
        </li>
      ) : null}
    </ul>
  );
}

function ChoiceDialog({ files, onClose }: Readonly<{ files: readonly string[]; onClose: () => void }>) {
  const { t } = useTranslation(["shell"]);
  const choose = (prefer: SyncSide) => {
    onClose();
    void useOverleafSyncStore.getState().link(prefer);
  };
  return (
    <Dialog open={files.length > 0} onOpenChange={(next) => !next && onClose()}>
      <DialogContent data-testid="overleaf-choice-dialog" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(($) => $.shell.overleafSync.choice.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.shell.overleafSync.choice.description)}</DialogDescription>
        </DialogHeader>
        <FileList files={files} />
        <DialogFooter>
          <Button type="button" variant="outline" data-testid="overleaf-choice-remote" onClick={() => choose("remote")}>
            {t(($) => $.shell.overleafSync.choice.theirs)}
          </Button>
          <Button type="button" data-testid="overleaf-choice-local" onClick={() => choose("local")}>
            {t(($) => $.shell.overleafSync.choice.mine)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConflictDialog({
  open,
  files,
  onClose,
}: Readonly<{ open: boolean; files: readonly string[]; onClose: () => void }>) {
  const { t } = useTranslation(["shell"]);
  const [picks, setPicks] = useState<Record<string, SyncSide>>({});
  const complete = files.length > 0 && files.every((file) => picks[file]);
  const pickAll = (side: SyncSide) => setPicks(Object.fromEntries(files.map((file) => [file, side])));

  return (
    <Dialog open={open && files.length > 0} onOpenChange={(next) => !next && onClose()}>
      <DialogContent data-testid="overleaf-conflict-dialog" className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t(($) => $.shell.overleafSync.conflicts.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.shell.overleafSync.conflicts.description)}</DialogDescription>
        </DialogHeader>
        <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
          {files.map((file) => (
            <li key={file} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file}>
                {file}
              </span>
              <SidePicker value={picks[file]} onChange={(side) => setPicks((current) => ({ ...current, [file]: side }))} />
            </li>
          ))}
        </ul>
        <div className="flex gap-2 text-xs">
          <button type="button" onClick={() => pickAll("local")} className="rounded px-1 font-medium hover:bg-accent focus-visible:bg-accent">
            {t(($) => $.shell.overleafSync.conflicts.allMine)}
          </button>
          <button type="button" onClick={() => pickAll("remote")} className="rounded px-1 font-medium hover:bg-accent focus-visible:bg-accent">
            {t(($) => $.shell.overleafSync.conflicts.allTheirs)}
          </button>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t(($) => $.shell.overleafSync.cancel)}
          </Button>
          <Button
            type="button"
            data-testid="overleaf-conflict-apply"
            disabled={!complete}
            onClick={() => {
              onClose();
              void useOverleafSyncStore.getState().sync(picks, "manual");
            }}
          >
            {t(($) => $.shell.overleafSync.conflicts.apply)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SidePicker({ value, onChange }: Readonly<{ value: SyncSide | undefined; onChange: (side: SyncSide) => void }>) {
  const { t } = useTranslation(["shell"]);
  const sides: { side: SyncSide; label: string }[] = [
    { side: "local", label: t(($) => $.shell.overleafSync.conflicts.mine) },
    { side: "remote", label: t(($) => $.shell.overleafSync.conflicts.theirs) },
  ];
  return (
    <fieldset className="flex shrink-0 items-center rounded-md border p-0.5">
      {sides.map(({ side, label }) => (
        <button
          key={side}
          type="button"
          aria-pressed={value === side}
          onClick={() => onChange(side)}
          className={cn(
            "rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors focus-visible:bg-accent/60",
            value === side ? "bg-accent text-foreground" : "hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}
