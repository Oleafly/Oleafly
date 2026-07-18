import { useState } from "react";
import { ChevronDown, ExternalLink, Github, Link as LinkIcon } from "lucide-react";
import { useGithubStore } from "@/store/github";
import { useSettingsStore } from "@/store/settings";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <div className="flex h-7 items-center overflow-hidden rounded-md">
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
          <DropdownMenuTrigger asChild>
            <button type="button"
              aria-label="GitHub actions"
              className={cn(
                "flex h-full items-center gap-0.5 px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                connected ? "rounded-r-md" : "rounded-md",
              )}
            >
              <Github className="size-4" />
              <ChevronDown className="size-3 shrink-0 opacity-60" />
            </button>
          </DropdownMenuTrigger>
        </Tooltip>
      </div>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem disabled={!githubUrl} onSelect={onOpenInGithub}>
          <ExternalLink className="size-4 text-muted-foreground" />
          <span className="truncate">Open in GitHub</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!githubUrl} onSelect={onCopyLink}>
          <LinkIcon className="size-4 text-muted-foreground" />
          <span className="truncate">Copy repository link</span>
        </DropdownMenuItem>
        {!githubUrl && (
          <p className="px-2 py-1 pl-8 text-[10px] text-muted-foreground">
            Push to GitHub to enable these
          </p>
        )}
        {!connected && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={openSettings}>
              <Github className="size-4 text-muted-foreground" />
              <span className="truncate">Connect GitHub…</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
