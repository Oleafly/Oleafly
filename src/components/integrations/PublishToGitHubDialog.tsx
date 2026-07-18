import { useEffect, useState } from "react";
import {
  Check,
  GitBranch,
  Github,
  Loader2,
  Lock,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useGithubStore } from "@/store/github";
import { gitAutoCommit, gitPush, gitSetRemote } from "@/lib/tauri";
import {
  githubCreateRepo,
  githubListRepos,
  type GitHubRepo,
} from "@/lib/github";
import { logError } from "@/lib/log";
import { cn } from "@/lib/utils";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function PublishToGitHubDialog({
  open,
  onClose,
  projectId,
  projectName,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  projectName: string;
  onPublished: (remoteUrl: string) => void;
}) {
  const status = useGithubStore((s) => s.status);
  const [tab, setTab] = useState<"new" | "existing">("new");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [repoName, setRepoName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);

  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [query, setQuery] = useState("");
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const { dialogRef, onBackdropMouseDown } =
    useModalAccessibility<HTMLDivElement>(open, onClose);

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    setSelected(null);
    setRepoName(slug(projectName || "openleaf-project"));
  }, [open, projectName]);

  useEffect(() => {
    if (!open || status !== "connected") return;
    setLoadingRepos(true);
    githubListRepos()
      .then(setRepos)
      .catch((e) => void logError("github list repos", e))
      .finally(() => setLoadingRepos(false));
  }, [open, status]);

  if (!open) return null;

  const note = (ok: boolean, text: string) => setMsg({ ok, text });

  const publishNew = async () => {
    if (!projectId) return;
    const name = slug(repoName.trim() || projectName || "openleaf-project");
    if (!name) return note(false, "Enter a repository name.");
    setBusy(true);
    try {
      const repo = await githubCreateRepo(name, isPrivate);
      // A brand-new project may have no commits yet; the remote itself stays
      // clean since auth is handled by gitPush's credential helper, not a
      // token embedded in .git/config.
      await gitAutoCommit(projectId, "Initial commit");
      await gitSetRemote(projectId, repo.clone_url);
      await gitPush(projectId);
      note(true, `Published to ${repo.full_name}.`);
      onPublished(repo.clone_url);
      window.setTimeout(onClose, 900);
    } catch (e) {
      note(false, String(e));
    } finally {
      setBusy(false);
    }
  };

  const publishExisting = async () => {
    if (!projectId || !selected) return;
    setBusy(true);
    try {
      await gitAutoCommit(projectId, "Initial commit");
      await gitSetRemote(projectId, selected);
      // The remote may already contain commits (e.g. an auto-initialized repo);
      // allow the push to surface a useful error if a merge is needed.
      try {
        await gitPush(projectId);
      } catch (e) {
        note(false, `Linked to ${selected}, but push needs a pull first: ${e}`);
        onPublished(selected);
        return;
      }
      note(true, `Linked and pushed to ${selected}.`);
      onPublished(selected);
      window.setTimeout(onClose, 900);
    } catch (e) {
      note(false, String(e));
    } finally {
      setBusy(false);
    }
  };

  const filtered = repos
    .filter((r) => r.full_name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 60);

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-4">
      <button type="button" aria-label="Close publish dialog" className="absolute inset-0" onMouseDown={onBackdropMouseDown} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-github-title"
        tabIndex={-1}
        className="relative flex h-[min(560px,88vh)] w-[min(620px,94vw)] flex-col overflow-hidden rounded-xl border bg-sidebar text-sidebar-foreground shadow-2xl"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <Github className="size-4" />
            <h2 id="publish-github-title" className="text-sm font-semibold">Publish to GitHub</h2>
          </div>
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        {status !== "connected" ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
            Connect GitHub first (Settings → GitHub).
          </div>
        ) : (
          <>
            <div className="flex shrink-0 gap-1 border-b px-3 py-2">
              {(["new", "existing"] as const).map((t) => (
                <button type="button"
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    tab === t
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  )}
                >
                  {t === "new" ? "Create new repository" : "Link existing"}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
              {tab === "new" ? (
                <div className="space-y-3">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      Repository name
                    </span>
                    <input
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      aria-label="Repository name"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                    />
                  </label>
                  <label className="flex cursor-pointer items-center justify-between rounded-md border bg-card p-3">
                    <span className="flex items-center gap-2">
                      <Lock className="size-4 text-muted-foreground" />
                      <span className="text-xs">
                        Private
                        <span className="ml-1 text-muted-foreground">
                          (recommended)
                        </span>
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={isPrivate}
                      onChange={(e) => setIsPrivate(e.target.checked)}
                    />
                  </label>
                  <Button
                    className="w-full"
                    disabled={busy || !repoName.trim()}
                    onClick={() => void publishNew()}
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Github className="size-4" />
                    )}
                    Create &amp; push
                  </Button>
                </div>
              ) : (
                <div className="flex h-full flex-col gap-2">
                  <div className="flex items-center gap-2 rounded-md border px-2">
                    <Search className="size-3.5 text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search your repositories…"
                      className="flex-1 bg-transparent py-2 text-xs outline-none"
                    />
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto rounded-md border">
                    {loadingRepos ? (
                      <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" /> Loading…
                      </div>
                    ) : filtered.length === 0 ? (
                      <div className="p-6 text-center text-xs text-muted-foreground">
                        No repositories found.
                      </div>
                    ) : (
                      filtered.map((r) => (
                        <button type="button"
                          key={r.full_name}
                          onClick={() => setSelected(r.clone_url)}
                          className={cn(
                            "flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs last:border-0 hover:bg-accent/60",
                            selected === r.clone_url && "bg-accent"
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono">
                              {r.full_name}
                            </span>
                          </span>
                          {r.private && (
                            <Lock className="size-3 shrink-0 text-muted-foreground" />
                          )}
                          {selected === r.clone_url && (
                            <Check className="size-3.5 shrink-0 text-emerald-500" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  <Tooltip label="Sets origin and pushes the current branch">
                    <Button
                      className="w-full"
                      disabled={busy || !selected}
                      onClick={() => void publishExisting()}
                    >
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <GitBranch className="size-4" />
                      )}
                      Link &amp; push
                    </Button>
                  </Tooltip>
                </div>
              )}
            </div>

            {msg && (
              <div
                className={cn(
                  "shrink-0 border-t p-3 text-xs",
                  msg.ok
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-destructive/30 bg-destructive/10 text-destructive"
                )}
              >
                {msg.text}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
