import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Github, Link as LinkIcon, Settings } from "lucide-react";
import { useGithubStore } from "@/store/github";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
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
}: Readonly<{
  githubUrl: string | null;
  onOpenInGithub: () => void;
  onCopyLink: () => void;
}>) {
  const { t } = useTranslation(["shell"]);
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
        <Tooltip label={t(($) => $.shell.githubMenu.connectedAs, { login })} side="bottom">
          <DropdownMenuTrigger asChild>
            <button type="button"
              aria-label={t(($) => $.shell.githubMenu.accountAriaLabel, { login })}
              className="flex h-9 items-center gap-1.5 rounded-md pl-1 pr-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              <Avatar
                person={{ id: login, name: login, imageUrl: user?.avatar_url }}
                size="sm"
                fallbackIcon={<Github />}
              />
              <span className="max-w-[110px] truncate">{login}</span>
            </button>
          </DropdownMenuTrigger>
        </Tooltip>
      ) : (
        <Tooltip label={t(($) => $.shell.githubMenu.tooltip)} side="bottom">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t(($) => $.shell.githubMenu.actions)}
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
          <span className="truncate">{t(($) => $.shell.githubMenu.openInGithub)}</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!githubUrl} onSelect={onCopyLink}>
          <LinkIcon className="size-4 text-muted-foreground" />
          <span className="truncate">{t(($) => $.shell.githubMenu.copyRepositoryLink)}</span>
        </DropdownMenuItem>
        {!githubUrl && (
          <p className="px-2 py-1 pl-8 text-[0.625rem] text-muted-foreground">
            {t(($) => $.shell.githubMenu.pushHint)}
          </p>
        )}
        <DropdownMenuSeparator />
        {connected ? (
          <DropdownMenuItem onSelect={openSettings}>
            <Settings className="size-4 text-muted-foreground" />
            <span className="truncate">{t(($) => $.shell.githubMenu.settings)}</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={openSettings}>
            <Github className="size-4 text-muted-foreground" />
            <span className="truncate">{t(($) => $.shell.githubMenu.connect)}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
