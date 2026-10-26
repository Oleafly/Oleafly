import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ForgeBrandIcon } from "@/components/settings/git-hosting/ForgeBrandIcon";
import { accountKey, hostLabel, kindLabel } from "@/lib/forge";
import type { ForgeAccount } from "@/lib/tauri";
import type { ForgeCheckState } from "@/store/forge-accounts";

/** One signed-in account: who, where, what kind of server, whether it still
 * works, its certificate file, and the actions for it. */
export function AccountRow({
  account,
  check,
  busy,
  onSignOut,
  onSignInAgain,
  onChangeCa,
  onRemoveCa,
}: Readonly<{
  account: ForgeAccount;
  check?: ForgeCheckState;
  busy: boolean;
  onSignOut: () => void;
  onSignInAgain: () => void;
  onChangeCa: () => void;
  onRemoveCa: () => void;
}>) {
  const { t } = useTranslation(["settings"]);
  const key = accountKey(account.base);
  const host = hostLabel(account.base);

  return (
    <section
      data-testid={`git-hosting-account-${key}`}
      aria-label={t(($) => $.settings.gitHosting.account.ariaLabel, {
        login: account.login,
        host,
      })}
      className="flex items-start gap-3 rounded-lg border bg-background p-3"
    >
      <Avatar
        person={{
          id: `${key}:${account.login}`,
          name: account.name ?? account.login,
          imageUrl: account.avatarUrl,
        }}
        size="md"
        fallbackIcon={<ForgeBrandIcon base={account.base} kind={account.kind} flavor={account.flavor} />}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">
            {t(($) => $.settings.gitHosting.account.signedInAs, { login: account.login })}
          </span>
          <Badge variant="outline" size="sm" className="gap-1">
            <ForgeBrandIcon kind={account.kind} flavor={account.flavor} className="size-2.5" />
            {kindLabel(account)}
          </Badge>
          {check === "checking" ? (
            <Badge variant="muted" size="sm" className="gap-1">
              <Spinner size="sm" />
              {t(($) => $.settings.gitHosting.account.checking)}
            </Badge>
          ) : null}
          {check === "signed_out" ? (
            <Badge variant="destructive" size="sm" data-testid={`git-hosting-signed-out-${key}`}>
              {t(($) => $.settings.gitHosting.account.signedOut)}
            </Badge>
          ) : null}
          {check === "unreachable" ? (
            <Badge variant="warning" size="sm">
              {t(($) => $.settings.gitHosting.account.unreachable)}
            </Badge>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {account.name ? `${host} · ${account.name}` : host}
        </div>
        {account.caFile ? (
          <div className="break-all text-xs text-muted-foreground">
            {t(($) => $.settings.gitHosting.account.caFile, { file: account.caFile })}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {check === "signed_out" ? (
            <Button
              size="xs"
              data-testid={`git-hosting-sign-in-again-${key}`}
              disabled={busy}
              onClick={onSignInAgain}
            >
              {t(($) => $.settings.gitHosting.account.signInAgain)}
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            data-testid={`git-hosting-ca-${key}`}
            disabled={busy}
            onClick={onChangeCa}
          >
            {account.caFile
              ? t(($) => $.settings.gitHosting.account.caChange)
              : t(($) => $.settings.gitHosting.account.caAdd)}
          </Button>
          {account.caFile ? (
            <Button size="xs" variant="ghost" disabled={busy} onClick={onRemoveCa}>
              {t(($) => $.settings.gitHosting.add.caRemove)}
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            data-testid={`git-hosting-sign-out-${key}`}
            disabled={busy}
            onClick={onSignOut}
            className="hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
          >
            {t(($) => $.settings.gitHosting.account.signOut)}
          </Button>
        </div>
      </div>
    </section>
  );
}
