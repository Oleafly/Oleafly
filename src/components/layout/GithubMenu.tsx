import { useState, type ReactNode } from "react";
import { ChevronDown, ExternalLink, Github, Link as LinkIcon, Settings } from "lucide-react";
import { useGithubStore } from "@/store/github";
import { useSettingsStore } from "@/store/settings";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The GitHub control in the top toolbar: the connected account (avatar +
 * username) and the share actions clubbed into one dropdown, like the Export
 * button. Shows "Open in GitHub" and "Copy GitHub link" (enabled once the
 * project is pushed), plus a link into GitHub settings.
 */
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
      <Tooltip label={connected ? `Connected as @${login}` : "GitHub"} side="bottom">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="GitHub menu"
          className="flex h-7 items-center gap-1.5 rounded-md border bg-background pl-1 pr-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          {connected && user?.avatar_url ? (
            <img src={user.avatar_url} alt="" className="size-5 rounded-full object-cover" />
          ) : (
            <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-background">
              <Github className="size-3" />
            </span>
          )}
          {connected && <span className="max-w-[110px] truncate">{login}</span>}
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </Tooltip>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
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
              label="Copy GitHub link"
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
            <div className="my-1 h-px bg-border" />
            <MenuButton
              icon={<Settings className="size-4 text-muted-foreground" />}
              label={connected ? `Connected as @${login}` : "Connect GitHub…"}
              onClick={openSettings}
            />
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
    <button
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
