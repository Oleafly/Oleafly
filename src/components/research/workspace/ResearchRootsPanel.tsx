import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { File, Folder, FolderPlus, Link2Off, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pickOpenPath } from "@/lib/native-file-dialog";
import {
  addResearchRoot,
  getResearchWorkspace,
  listResearchRootFiles,
  readResearchRootFile,
  removeResearchRoot,
  updateResearchRoot,
  type LinkedResearchRoot,
  type ResearchRootAccess,
  type ResearchRootFileContent,
  type ResearchRootFileEntry,
  type ResearchRootRole,
  type ResearchWorkspace,
} from "@/lib/research-workspace";

const ROLE_LABELS: Record<ResearchRootRole, string> = {
  references: "References",
  data: "Data",
  analysis: "Analysis",
  manuscript: "Manuscript",
};

const ACCESS_LABELS: Record<ResearchRootAccess, string> = {
  read_only: "Read only",
  read_write: "Read and write",
};

function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor: string }) {
  return <label className="text-xs font-medium text-muted-foreground" htmlFor={htmlFor}>{children}</label>;
}

function RootEditor({
  projectId,
  root,
  onChanged,
  onRemoved,
}: {
  projectId: string;
  root: LinkedResearchRoot;
  onChanged: (workspace: ResearchWorkspace) => void;
  onRemoved: (workspace: ResearchWorkspace) => void;
}) {
  const [label, setLabel] = useState(root.label);
  const [role, setRole] = useState(root.role);
  const [access, setAccess] = useState(root.access);
  const [files, setFiles] = useState<ResearchRootFileEntry[] | null>(null);
  const [selected, setSelected] = useState<ResearchRootFileContent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRequest = useRef(0);
  const labelId = `research-root-label-${root.id}`;
  const roleId = `research-root-role-${root.id}`;
  const accessId = `research-root-access-${root.id}`;

  useEffect(() => {
    setLabel(root.label);
    setRole(root.role);
    setAccess(root.access);
  }, [root]);

  useEffect(() => () => { previewRequest.current += 1; }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(
        await updateResearchRoot({ projectId, rootId: root.id, label, role, access }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const browse = async () => {
    const request = ++previewRequest.current;
    setBusy(true);
    setError(null);
    setSelected(null);
    try {
      const listing = await listResearchRootFiles(projectId, root.id, "", 8);
      if (request !== previewRequest.current) return;
      setFiles(listing.entries);
      if (listing.truncated) {
        setError("This view stops after 2,000 files or eight folder levels.");
      }
    } catch (cause) {
      if (request === previewRequest.current) setError(cause instanceof Error ? cause.message : String(cause));
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
      if (request === previewRequest.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === previewRequest.current) setBusy(false);
    }
  };

  const unlink = async () => {
    previewRequest.current += 1;
    setBusy(true);
    setError(null);
    setSelected(null);
    try {
      onRemoved(await removeResearchRoot(projectId, root.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const changed = label.trim() !== root.label || role !== root.role || access !== root.access;

  return (
    <article className="rounded-lg border bg-card p-4" data-root-id={root.id}>
      <div className="grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_10rem_11rem_auto]">
        <div className="grid gap-1.5">
          <FieldLabel htmlFor={labelId}>Label</FieldLabel>
          <Input id={labelId} value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <FieldLabel htmlFor={roleId}>Role</FieldLabel>
          <Select value={role} onValueChange={(value) => setRole(value as ResearchRootRole)}>
            <SelectTrigger id={roleId} aria-label={`${root.label} role`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(ROLE_LABELS).map(([value, text]) => (
                <SelectItem key={value} value={value}>{text}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <FieldLabel htmlFor={accessId}>Access</FieldLabel>
          <Select value={access} onValueChange={(value) => setAccess(value as ResearchRootAccess)}>
            <SelectTrigger id={accessId} aria-label={`${root.label} access`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(ACCESS_LABELS).map(([value, text]) => (
                <SelectItem key={value} value={value}>{text}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <Button variant="outline" size="sm" disabled={busy || !changed || !label.trim()} onClick={save}>
            Save
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={unlink}>
            <Link2Off /> Unlink
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={root.canonicalPath}>
          {root.canonicalPath}
        </code>
        <Button variant="ghost" size="sm" disabled={busy} onClick={browse}>
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Browse files
        </Button>
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
      {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
      <p className="mt-2 text-xs text-muted-foreground">Unlinking removes this shortcut. Your files stay where they are.</p>
    </article>
  );
}

export function ResearchRootsPanel({ projectId }: { projectId: string }) {
  const [workspace, setWorkspace] = useState<ResearchWorkspace | null>(null);
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<ResearchRootRole>("data");
  const [access, setAccess] = useState<ResearchRootAccess>("read_only");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setWorkspace(await getResearchWorkspace(projectId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const chooseFolder = async () => {
    const chosen = await pickOpenPath({ directory: true, multiple: false, title: "Link research folder" });
    if (typeof chosen !== "string") return;
    setPath(chosen);
    if (!label.trim()) {
      const parts = chosen.replace(/\\/g, "/").split("/").filter(Boolean);
      setLabel(parts.at(-1) ?? "Research files");
    }
  };

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      setWorkspace(await addResearchRoot({ projectId, path, label, role, access }));
      setPath("");
      setLabel("");
      setRole("data");
      setAccess("read_only");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-5" aria-labelledby="research-roots-title">
      <div>
        <h2 id="research-roots-title" className="text-lg font-semibold">Research folders</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Keep datasets, source libraries, and analysis folders beside this manuscript. Linked folders stay in their original locations.
        </p>
      </div>
      <div className="rounded-lg border bg-muted/20 p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(14rem,1fr)_minmax(10rem,0.6fr)_10rem_11rem_auto]">
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="new-research-root-path">Folder</FieldLabel>
            <div className="flex gap-2">
              <Input id="new-research-root-path" value={path} readOnly placeholder="Choose a folder" />
              <Button variant="outline" size="icon" aria-label="Choose folder" disabled={busy} onClick={chooseFolder}>
                <FolderPlus />
              </Button>
            </div>
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="new-research-root-label">Label</FieldLabel>
            <Input id="new-research-root-label" value={label} maxLength={120} placeholder="Study data" onChange={(event) => setLabel(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="new-research-root-role">Role</FieldLabel>
            <Select value={role} onValueChange={(value) => setRole(value as ResearchRootRole)}>
              <SelectTrigger id="new-research-root-role" aria-label="Folder role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ROLE_LABELS).map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="new-research-root-access">Access</FieldLabel>
            <Select value={access} onValueChange={(value) => setAccess(value as ResearchRootAccess)}>
              <SelectTrigger id="new-research-root-access" aria-label="Folder access"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ACCESS_LABELS).map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button disabled={busy || !path || !label.trim()} onClick={add}>
              {busy ? <Loader2 className="animate-spin" /> : <FolderPlus />} Link folder
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">New links start read-only. Write access applies only to native Oleafly actions that check this link.</p>
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {busy && !workspace ? <Loader2 className="animate-spin text-muted-foreground" /> : null}
      {workspace?.roots.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No research folders are linked to this manuscript.
        </div>
      ) : (
        <div className="space-y-3">
          {workspace?.roots.map((root) => (
            <RootEditor key={JSON.stringify([projectId, root.id, root.identity, root.canonicalPath])} projectId={projectId} root={root} onChanged={setWorkspace} onRemoved={setWorkspace} />
          ))}
        </div>
      )}
    </section>
  );
}
