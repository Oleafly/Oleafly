import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { WebMe } from "../api";
import { navigate, projectHref } from "./navigation";

export function LeafMark({ className }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        d="M21 2C6 2 4 16 3 22h1.998c.666-3.333 2.333-5.166 5.002-5.5 4-.5 7-4 8-7l-1.5-1 1-1c1-1 2.004-2.5 3.5-5.5z"
        fill="#2F6FDB"
      />
    </svg>
  );
}

function AccountMenu({ me, onSignOut }: Readonly<{ me: WebMe; onSignOut: () => void }>) {
  const { t } = useTranslation(["web"]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t(($) => $.web.app.account)}
          className="flex shrink-0 rounded-full border border-transparent transition-colors hover:border-primary/40 focus-visible:border-primary"
        >
          <Avatar person={{ id: me.accountId, name: me.name || me.login || "?", imageUrl: me.avatarUrl }} size="base" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel className="space-y-0.5">
          <span className="block truncate text-xs font-medium">{me.name || me.login}</span>
          {me.email ? <span className="block truncate text-[0.6875rem] text-muted-foreground">{me.email}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut aria-hidden className="size-4" />
          {t(($) => $.web.app.signOut)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppHeader({
  me,
  onSignOut,
  children,
}: Readonly<{ me: WebMe | null; onSignOut?: () => void; children?: ReactNode }>) {
  const { t } = useTranslation(["web"]);
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-sidebar px-3">
      <a
        href={projectHref(null)}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          navigate(null);
        }}
        className="flex shrink-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-semibold transition-colors hover:bg-sidebar-accent focus-visible:bg-sidebar-accent"
      >
        <LeafMark className="size-4" />
        <span className="hidden sm:inline">{t(($) => $.web.app.name)}</span>
      </a>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      {me && onSignOut ? <AccountMenu me={me} onSignOut={onSignOut} /> : null}
    </header>
  );
}
