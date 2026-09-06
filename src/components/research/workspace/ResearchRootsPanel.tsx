import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2Off,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { pickOpenPath } from "@/lib/native-file-dialog";
import { revealInDir } from "@/lib/tauri";
import { isMac } from "@/lib/utils";
import {
  addResearchRoot,
  getResearchRootHealth,
  getResearchWorkspace,
  listResearchRootFiles,
  readResearchRootFile,
  removeResearchRoot,
  updateResearchRoot,
  type LinkedResearchRoot,
  type ResearchRootAvailability,
  type ResearchRootFileContent,
  type ResearchRootFileEntry,
  type ResearchRootHealth,
  type ResearchRootRole,
  type ResearchWorkspace,
} from "@/lib/research-workspace";

const ROLE_LABELS: Record<ResearchRootRole, string> = {
  references: "References",
  data: "Data",
  analysis: "Analysis",
  manuscript: "Manuscript",
};

const HEALTH_LABELS: Record<ResearchRootAvailability, string> = {
  available: "Available",
  missing: "Missing",
  unreadable: "Unreadable",
};

const HEALTH_ICONS: Record<ResearchRootAvailability, typeof CircleCheck> = {
  available: CircleCheck,
  missing: CircleHelp,
  unreadable: CircleAlert,
};

function folderName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) ?? "Research files";
}

function detail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function HealthBadge({ health }: { health: ResearchRootHealth | undefined }) {
  const availability = health?.availability ?? "available";
  const Icon = HEALTH_ICONS[availability];
  const badge = (
    <Badge
      variant={availability === "available" ? "quiet" : "outline"}
      className={availability === "available" ? "gap-1" : "gap-1 border-destructive/40 text-destructive"}
    >
      <Icon aria-hidden="true" className="size-3" />
      {HEALTH_LABELS[availability]}
    </Badge>
  );
  if (!health?.detail) return badge;
  return <Tooltip label={health.detail}>{badge}</Tooltip>;
}

function LinkFolderDialog({
  open,
  editing,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  editing: LinkedResearchRoot | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: { path: string; label: string; role: ResearchRootRole }) => void;
}) {
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<ResearchRootRole>("data");

  useEffect(() => {
    if (!open) return;
    setPath(editing?.canonicalPath ?? "");
    setLabel(editing?.label ?? "");
    setRole(editing?.role ?? "data");
  }, [editing, open]);

  const chooseFolder = async () => {
    const chosen = await pickOpenPath({ directory: true, multiple: false, title: "Link research folder" });
    if (typeof chosen !== "string") return;
    setPath(chosen);
    if (!label.trim()) setLabel(folderName(chosen));
  };

  if (!open) return null;

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent className="max-w-lg" closeDisabled={busy} data-testid="research-root-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit linked folder" : "Link a research folder"}</DialogTitle>
          <DialogDescription>
            Keep datasets, source libraries, and analysis folders beside this manuscript. The folder
            stays where it is and Oleafly only reads from it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="new-research-root-path" className="text-xs font-medium">
              Folder
            </label>
            <div className="flex gap-2">
              <Input
                id="new-research-root-path"
                value={path}
                readOnly
                placeholder="Choose a folder"
                className="font-mono text-xs"
              />
              {editing ? null : (
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Choose folder"
                  disabled={busy}
                  onClick={chooseFolder}
                >
                  <FolderPlus />
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="new-research-root-label" className="text-xs font-medium">
              Label
            </label>
            <Input
              id="new-research-root-label"
              value={label}
              maxLength={120}
              placeholder="Study data"
              disabled={busy}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="new-research-root-role" className="text-xs font-medium">
              Role
            </label>
            <Select value={role} disabled={busy} onValueChange={(value) => setRole(value as ResearchRootRole)}>
              <SelectTrigger id="new-research-root-role" aria-label="Folder role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROLE_LABELS).map(([value, text]) => (
                  <SelectItem key={value} value={value}>
                    {text}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The role tells the assistant what the folder holds. It does not change access.
            </p>
          </div>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock aria-hidden="true" className="size-3" />
            Linked folders are read only. Oleafly never writes to them.
          </p>
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !path || !label.trim()}
            onClick={() => onSubmit({ path, label, role })}
            data-testid="research-root-submit"
          >
            {busy ? <Loader2 className="animate-spin" /> : <FolderPlus />}
            {editing ? "Save folder" : "Link folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RootCard({
  projectId,
  root,
  health,
  onEdit,
  onUnlink,
}: {
  projectId: string;
  root: LinkedResearchRoot;
  health: ResearchRootHealth | undefined;
  onEdit: () => void;
  onUnlink: () => void;
}) {
  const [files, setFiles] = useState<ResearchRootFileEntry[] | null>(null);
  const [selected, setSelected] = useState<ResearchRootFileContent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRequest = useRef(0);

  useEffect(() => () => { previewRequest.current += 1; }, []);

  const browse = async () => {
    const request = ++previewRequest.current;
    setBusy(true);
    setError(null);
    setSelected(null);
    try {
      const listing = await listResearchRootFiles(projectId, root.id, "", 8);
      if (request !== previewRequest.current) return;
      setFiles(listing.entries);
      if (listing.truncated) setError("This view stops after 2,000 files or eight folder levels.");
    } catch (cause) {
      if (request === previewRequest.current) setError(detail(cause));
    } finally {
      if (request === previewRequest.current) setBusy(false);
    }
  };

  const inspect = async (file: ResearchRootFileEntry) => {
    if (file.isDirectory || file.isSymlink) return;
    const request = ++previewRequest.current;
    setBusy(true);
    setError(null);
    setSelected(null);
    try {
      const content = await readResearchRootFile(projectId, root.id, file.relativePath);
      if (request === previewRequest.current) setSelected(content);
    } catch (cause) {
      if (request === previewRequest.current) setError(detail(cause));
    } finally {
      if (request === previewRequest.current) setBusy(false);
    }
  };

  return (
    <article className="rounded-lg border bg-card p-4 shadow-sm" data-root-id={root.id}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <Folder aria-hidden="true" className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{root.label}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{ROLE_LABELS[root.role]}</Badge>
            <Badge variant="quiet" className="gap-1">
              <Lock aria-hidden="true" className="size-3" />
              Read only
            </Badge>
            <HealthBadge health={health} />
          </div>
          <Tooltip label={root.canonicalPath} wide className="mt-2 block min-w-0 max-w-full">
            <code className="block w-full truncate text-xs text-muted-foreground">
              {root.canonicalPath}
            </code>
          </Tooltip>
          <div className="mt-2">
            <Button variant="outline" size="xs" disabled={busy} onClick={browse}>
              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Browse files
            </Button>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`More actions for ${root.label}`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => void revealInDir(root.canonicalPath).catch(() => {})}>
                <FolderOpen className="size-4 text-muted-foreground" />
                {isMac ? "Show in Finder" : "Show in Explorer"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="size-4 text-muted-foreground" /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onUnlink}
              >
                <Link2Off className="size-4" /> Unlink
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {files && (
        <div className="mt-3 grid max-h-80 gap-3 overflow-hidden rounded-md border bg-muted/20 p-3 md:grid-cols-2">
          <div className="overflow-auto">
            {files.length === 0 ? (
              <p className="text-sm text-muted-foreground">This folder is empty.</p>
            ) : (
              <ul className="space-y-1">
                {files.map((file) => (
                  <li key={file.relativePath}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent disabled:cursor-default disabled:opacity-60"
                      disabled={file.isDirectory || file.isSymlink}
                      onClick={() => void inspect(file)}
                    >
                      {file.isDirectory ? <Folder /> : <File />}
                      <span className="min-w-0 flex-1 truncate">{file.relativePath}</span>
                      {file.isSymlink && <span>Blocked link</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="overflow-auto rounded bg-background p-3">
            {!selected ? (
              <p className="text-sm text-muted-foreground">Choose a text file to inspect it.</p>
            ) : selected.isBinary ? (
              <p className="text-sm text-muted-foreground">Binary files are not shown here.</p>
            ) : (
              <>
                <p className="mb-2 truncate text-xs font-medium">{selected.relativePath}</p>
                <pre className="whitespace-pre-wrap break-words text-xs">{selected.content}</pre>
                {selected.truncated && (
                  <p className="mt-2 text-xs text-muted-foreground">Preview stopped at 256 KiB.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {error && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

export function ResearchRootsPanel({ projectId }: { projectId: string }) {
  const [workspace, setWorkspace] = useState<ResearchWorkspace | null>(null);
  const [health, setHealth] = useState<Record<string, ResearchRootHealth>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRootId, setEditingRootId] = useState<string | null>(null);
  const [unlinkRootId, setUnlinkRootId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await getResearchWorkspace(projectId);
      setWorkspace(next);
      const checks = await getResearchRootHealth(projectId).catch(() => [] as ResearchRootHealth[]);
      setHealth(Object.fromEntries(checks.map((entry) => [entry.rootId, entry])));
    } catch (cause) {
      setError(detail(cause));
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const roots = workspace?.roots ?? [];
  const editingRoot = roots.find((root) => root.id === editingRootId) ?? null;
  const unlinkRoot = roots.find((root) => root.id === unlinkRootId) ?? null;

  const openAdd = () => {
    setEditingRootId(null);
    setDialogError(null);
    setDialogOpen(true);
  };

  const openEdit = (rootId: string) => {
    setEditingRootId(rootId);
    setDialogError(null);
    setDialogOpen(true);
  };

  const submit = async (values: { path: string; label: string; role: ResearchRootRole }) => {
    setBusy(true);
    setDialogError(null);
    try {
      if (editingRoot) {
        setWorkspace(
          await updateResearchRoot({
            projectId,
            rootId: editingRoot.id,
            label: values.label,
            role: values.role,
            access: editingRoot.access,
          }),
        );
      } else {
        setWorkspace(
          await addResearchRoot({
            projectId,
            path: values.path,
            label: values.label,
            role: values.role,
            access: "read_only",
          }),
        );
      }
      setDialogOpen(false);
      setEditingRootId(null);
      const checks = await getResearchRootHealth(projectId).catch(() => [] as ResearchRootHealth[]);
      setHealth(Object.fromEntries(checks.map((entry) => [entry.rootId, entry])));
    } catch (cause) {
      setDialogError(detail(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirmUnlink = async () => {
    const rootId = unlinkRootId;
    setUnlinkRootId(null);
    if (!rootId) return;
    setBusy(true);
    setError(null);
    try {
      setWorkspace(await removeResearchRoot(projectId, rootId));
    } catch (cause) {
      setError(detail(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-5"
      aria-labelledby="research-roots-title"
      data-testid="research-roots-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="research-roots-title" className="text-lg font-semibold">
            Research folders
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Datasets, source libraries, and analysis folders stay in their original locations.
            Oleafly reads them and never writes to them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label="Refresh linked folders"
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw className={busy ? "animate-spin" : ""} /> Refresh
          </Button>
          <Button size="sm" disabled={busy} onClick={openAdd} data-testid="research-root-link">
            <FolderPlus /> Link folder
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {busy && !workspace ? <Loader2 className="animate-spin text-muted-foreground" /> : null}

      {workspace && roots.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No research folders are linked to this manuscript.
          </p>
          <Button className="mt-4" disabled={busy} onClick={openAdd} data-testid="research-root-link-empty">
            <FolderPlus /> Link folder
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {roots.map((root) => (
            <RootCard
              key={JSON.stringify([projectId, root.id, root.identity, root.canonicalPath])}
              projectId={projectId}
              root={root}
              health={health[root.id]}
              onEdit={() => openEdit(root.id)}
              onUnlink={() => setUnlinkRootId(root.id)}
            />
          ))}
        </div>
      )}

      <LinkFolderDialog
        open={dialogOpen}
        editing={editingRoot}
        busy={busy}
        error={dialogError}
        onClose={() => {
          setDialogOpen(false);
          setEditingRootId(null);
        }}
        onSubmit={(values) => void submit(values)}
      />

      <ConfirmationDialog
        open={unlinkRoot !== null}
        destructive
        title="Unlink this folder?"
        description={`"${unlinkRoot?.label ?? ""}" is removed from this manuscript. The folder and its files stay where they are.`}
        confirmLabel="Unlink"
        onConfirm={() => void confirmUnlink()}
        onCancel={() => setUnlinkRootId(null)}
      />
    </section>
  );
}
