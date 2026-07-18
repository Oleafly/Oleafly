import { useState, type ReactNode } from "react";
import { ChevronDown, ExternalLink, Github, Link as LinkIcon } from "lucide-react";
import { useGithubStore } from "@/store/github";
import { useSettingsStore } from "@/store/settings";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function GithubMenu({
  githubUrl,
  onOpenInGithub,
  onCopyLink,
}: {
  githubUrl: string | null;
  onOpenInGithub: () => void;
  onCopyLink: () => void;
}) {
  const status = useGithubStore((s) => s.status);
  const user = useGithubStore((s) => s.user);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setSettingsInitialSection = useSettingsStore((s) => s.setSettingsInitialSection);
  const [open, setOpen] = useState(false);

  const connected = status === "connected";
  const login = user?.login ?? "GitHub";

  const openSettings = () => {
    setSettingsInitialSection("github");
    setSettingsOpen(true);
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="flex h-7 items-center overflow-hidden rounded-md border bg-background">
        {connected && (
          <>
            <Tooltip label={`Connected as @${login} · GitHub settings`} side="bottom">
              <button type="button"
                onClick={openSettings}
                aria-label={`GitHub: ${login}`}
                className="flex h-full items-center gap-1.5 rounded-l-md pl-1 pr-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="size-5 rounded-full object-cover" />
                ) : (
                  <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-background">
                    <Github className="size-3" />
                  </span>
                )}
                <span className="max-w-[110px] truncate">{login}</span>
              </button>
            </Tooltip>
            <div className="h-4 w-px shrink-0 bg-border" />
          </>
        )}

        <Tooltip label="GitHub" side="bottom">
          <button type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="GitHub actions"
            className={cn(
              "flex h-full items-center gap-0.5 px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              connected ? "rounded-r-md" : "rounded-md",
            )}
          >
            <Github className="size-4" />
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </button>
        </Tooltip>
      </div>

      {open && (
        <>
          <button type="button" aria-label="Close GitHub menu" className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-50 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-xl">
            <MenuButton
              icon={<ExternalLink className="size-4 text-muted-foreground" />}
              label="Open in GitHub"
              disabled={!githubUrl}
              onClick={() => {
                onOpenInGithub();
                setOpen(false);
              }}
            />
            <MenuButton
              icon={<LinkIcon className="size-4 text-muted-foreground" />}
              label="Copy repository link"
              disabled={!githubUrl}
              onClick={() => {
                onCopyLink();
                setOpen(false);
              }}
            />
            {!githubUrl && (
              <p className="px-2 py-1 pl-8 text-[10px] text-muted-foreground">
                Push to GitHub to enable these
              </p>
            )}
            {!connected && (
              <>
                <div className="my-1 h-px bg-border" />
                <MenuButton
                  icon={<Github className="size-4 text-muted-foreground" />}
                  label="Connect GitHub…"
                  onClick={openSettings}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MenuButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
