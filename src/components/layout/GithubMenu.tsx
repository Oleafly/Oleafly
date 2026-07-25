import { useState } from "react";
import { ExternalLink, Github, Link as LinkIcon, Settings } from "lucide-react";
import { useGithubStore } from "@/store/github";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
    setSettingsInitialSection("integrations");
    setSettingsOpen(true);
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {connected ? (
        <Tooltip label={`Connected as @${login}`} side="bottom">
          <DropdownMenuTrigger asChild>
            <button type="button"
              aria-label={`GitHub: ${login}`}
              className="flex h-9 items-center gap-1.5 rounded-md pl-1 pr-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
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
          </DropdownMenuTrigger>
        </Tooltip>
      ) : (
        <Tooltip label="GitHub" side="bottom">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="GitHub actions"
              className="h-9 text-muted-foreground hover:text-foreground"
            >
              <Github />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
      )}

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
        <DropdownMenuSeparator />
        {connected ? (
          <DropdownMenuItem onSelect={openSettings}>
            <Settings className="size-4 text-muted-foreground" />
            <span className="truncate">GitHub settings</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={openSettings}>
            <Github className="size-4 text-muted-foreground" />
            <span className="truncate">Connect GitHub…</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
