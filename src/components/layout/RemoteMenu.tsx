import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, GitBranch, Link as LinkIcon, Settings } from "lucide-react";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { ForgeBrandIcon } from "@/components/settings/git-hosting/ForgeBrandIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ForgeAccount } from "@/lib/tauri";

export function RemoteMenu({
  webUrl,
  host,
  account,
  onOpen,
  onCopyLink,
}: Readonly<{
  webUrl: string | null;
  host: string;
  account: ForgeAccount | null;
  onOpen: () => void;
  onCopyLink: () => void;
}>) {
  const { t } = useTranslation(["shell"]);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setSettingsInitialSection = useSettingsStore((s) => s.setSettingsInitialSection);
  const setSettingsScrollTarget = useSettingsStore((s) => s.setSettingsScrollTarget);
  const [open, setOpen] = useState(false);
  const fallbackIcon = account ? (
    <ForgeBrandIcon base={account.base} kind={account.kind} flavor={account.flavor} />
  ) : (
    <GitBranch />
  );

  const openSettings = () => {
    setSettingsScrollTarget("git-hosting");
    setSettingsInitialSection("integrations");
    setSettingsOpen(true);
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {account ? (
        <Tooltip
          label={t(($) => $.shell.remoteMenu.signedInAs, { host, login: account.login })}
          side="bottom"
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              data-testid="remote-menu-account"
              aria-label={t(($) => $.shell.remoteMenu.accountLabel, { host, login: account.login })}
              className="h-9 gap-1.5 pl-1 pr-2 text-xs text-foreground [&_svg]:size-3"
            >
              <Avatar
                person={{ id: `${host}:${account.login}`, name: account.name ?? account.login, imageUrl: account.avatarUrl }}
                size="sm"
                fallbackIcon={fallbackIcon}
              />
              <span className="max-w-[110px] truncate">{account.login}</span>
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
      ) : (
        <Tooltip label={host} side="bottom">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-testid="remote-menu-trigger"
              aria-label={t(($) => $.shell.remoteMenu.actions)}
              className="h-9 text-muted-foreground hover:text-foreground"
            >
              <GitBranch />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
      )}

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem data-testid="remote-menu-open" disabled={!webUrl} onSelect={onOpen}>
          <ExternalLink className="size-4 text-muted-foreground" />
          <span className="truncate">{t(($) => $.shell.remoteMenu.openOnHost, { host })}</span>
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="remote-menu-copy" disabled={!webUrl} onSelect={onCopyLink}>
          <LinkIcon className="size-4 text-muted-foreground" />
          <span className="truncate">{t(($) => $.shell.remoteMenu.copyRepositoryLink)}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="remote-menu-settings" onSelect={openSettings}>
          <Settings className="size-4 text-muted-foreground" />
          <span className="truncate">{t(($) => $.shell.remoteMenu.settings)}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
