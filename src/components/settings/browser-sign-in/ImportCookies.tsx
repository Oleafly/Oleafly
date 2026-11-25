import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cookie, Globe } from "lucide-react";
import { ManageSignInsDialog } from "@/components/settings/browser-sign-in/ManageSignInsDialog";
import { useBrowserIcons } from "@/components/settings/browser-sign-in/use-browser-icons";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { isOverleafError, overleafSignInWithAppCookies, type OverleafStatus } from "@/lib/overleaf";
import {
  COOKIE_IMPORT_CANCELLED,
  detectBrowserCookieSources,
  importBrowserCookies,
  type BrowserCookieSource,
} from "@/lib/tauri";
import { repeatsAccount, useOverleafImportStore } from "@/store/overleaf-import";

export interface ImportCookiesProps {
  server: string;
  disabled?: boolean;
  onSignedIn(status: OverleafStatus): void;
}

function serverHostname(server: string): string | null {
  try {
    return new URL(server).hostname || null;
  } catch {
    return null;
  }
}

type BrowserProfile = BrowserCookieSource & { profile: string; profileName: string };

function profilesIn(sources: readonly BrowserCookieSource[]): BrowserProfile[] {
  return sources.flatMap((source) =>
    source.profile !== null && (source.status === "available" || source.status === "no_cookie_store")
      ? [{ ...source, profile: source.profile, profileName: source.profileName ?? source.profile }]
      : [],
  );
}

function keyOf(profile: BrowserProfile): string {
  return `${profile.browser}/${profile.profile}`;
}

function firstImportable(profiles: readonly BrowserProfile[]): BrowserProfile | null {
  return profiles.find((profile) => profile.status === "available") ?? null;
}

function useBrowserProfiles() {
  const detection = useRef(0);
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const detect = useCallback(async () => {
    const request = ++detection.current;
    try {
      const found = profilesIn(await detectBrowserCookieSources());
      if (detection.current === request) setProfiles(found);
    } catch (error) {
      void logError("detect browser profiles for the sign-in copy", error);
    }
  }, []);
  useEffect(() => {
    void detect();
    return () => {
      detection.current += 1;
    };
  }, [detect]);
  return { profiles, detect };
}

export function ImportCookies({ server, disabled = false, onSignedIn }: Readonly<ImportCookiesProps>) {
  const { t } = useTranslation("settings");
  const domain = serverHostname(server);
  const { profiles, detect } = useBrowserProfiles();
  const [shown, setShown] = useState<"import" | "manage" | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  if (!firstImportable(profiles) || !domain) return null;

  const open = () => {
    setShown("import");
    setOutcome(null);
    void detect();
  };

  return (
    <>
      <div className="flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
        {t(($) => $.settings.integrations.cookies.orExisting)}
      </div>
      <SettingsRow
        testId="browser-sign-in-copy-row"
        className="@max-lg:flex-col @max-lg:items-start @max-lg:gap-3"
        icon={
          <AppIcon>
            <Cookie className="size-4" />
          </AppIcon>
        }
        label={t(($) => $.settings.integrations.cookies.label)}
        description={t(($) => $.settings.integrations.cookies.signInDescription, { server: domain })}
        details={
          outcome ? (
            <output className="mt-2 block select-text text-xs text-muted-foreground">{outcome}</output>
          ) : null
        }
        control={
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="browser-sign-in-copy"
            disabled={disabled}
            onClick={open}
          >
            {t(($) => $.settings.integrations.cookies.useBrowserSignIn)}
          </Button>
        }
      />
      {shown === "import" ? (
        <ImportCookiesDialog
          server={server}
          domain={domain}
          profiles={profiles}
          onClose={() => setShown(null)}
          onManage={() => setShown("manage")}
          onSignedIn={(status) => {
            setShown(null);
            onSignedIn(status);
          }}
          onNotSignedIn={(message) => {
            setShown(null);
            setOutcome(message);
          }}
        />
      ) : null}
      <ManageSignInsDialog
        open={shown === "manage"}
        onOpenChange={(next) => !next && setShown(null)}
        addLabel={t(($) => $.settings.integrations.signIns.importMore)}
        onAdd={open}
      />
    </>
  );
}

type ImportOutcome =
  | { kind: "cancelled" }
  | { kind: "failed"; error: unknown }
  | { kind: "refused"; error: unknown; imported: number }
  | { kind: "repeated"; account: string }
  | { kind: "signed-in"; status: OverleafStatus };

async function importSignIn(server: string, domain: string, { browser, profile }: BrowserProfile): Promise<ImportOutcome> {
  let imported: number;
  try {
    ({ imported } = await importBrowserCookies({ browser, profile, domain }));
  } catch (error) {
    if (describeError(error) === COOKIE_IMPORT_CANCELLED) return { kind: "cancelled" };
    void logError("copy browser cookies", error);
    return { kind: "failed", error };
  }
  try {
    const before = useOverleafImportStore.getState().status;
    const status = await overleafSignInWithAppCookies(server);
    const account = repeatsAccount(before, status);
    return account === null ? { kind: "signed-in", status } : { kind: "repeated", account };
  } catch (error) {
    void logError("sign in with copied browser cookies", error);
    return { kind: "refused", error, imported };
  }
}

function ImportCookiesDialog({
  server,
  domain,
  profiles,
  onClose,
  onManage,
  onSignedIn,
  onNotSignedIn,
}: Readonly<{
  server: string;
  domain: string;
  profiles: BrowserProfile[];
  onClose(): void;
  onManage(): void;
  onSignedIn(status: OverleafStatus): void;
  onNotSignedIn(message: string): void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  const icons = useBrowserIcons();
  const fromId = useId();
  const [picked, setPicked] = useState("");
  const [copying, setCopying] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const chosen =
    profiles.find((profile) => keyOf(profile) === picked && profile.status === "available") ??
    firstImportable(profiles);

  const copy = async () => {
    if (!chosen || copying) return;
    setCopying(true);
    setProblem(null);
    const outcome = await importSignIn(server, domain, chosen);
    setCopying(false);
    switch (outcome.kind) {
      case "signed-in":
        onSignedIn(outcome.status);
        break;
      case "refused":
        onNotSignedIn(
          isOverleafError(outcome.error, "browser_sign_in_failed")
            ? t(($) => $.settings.integrations.cookies.notSignedIn, {
                count: outcome.imported,
                browser: chosen.browserName,
              })
            : describeError(outcome.error),
        );
        break;
      case "repeated":
        setProblem(
          t(($) => $.settings.integrations.cookies.sameAccount, {
            account: outcome.account,
            profile: `${chosen.browserName} ${chosen.profileName}`,
          }),
        );
        break;
      case "failed":
        setProblem(describeError(outcome.error));
        break;
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !copying && onClose()}>
      <DialogContent
        data-testid="import-cookies"
        closeDisabled={copying}
        onEscapeKeyDown={(event) => copying && event.preventDefault()}
        onPointerDownOutside={(event) => copying && event.preventDefault()}
        className="z-[120] max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl"
        overlayClassName="z-[120]"
      >
        <DialogHeader>
          <DialogTitle>{t(($) => $.settings.integrations.cookies.dialogTitle)}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <span id={fromId} className="shrink-0 text-sm">
            {t(($) => $.settings.integrations.cookies.from)}
          </span>
          <Select
            value={chosen ? keyOf(chosen) : ""}
            disabled={copying}
            onValueChange={(value) => {
              setPicked(value);
              setProblem(null);
            }}
          >
            <SelectTrigger aria-labelledby={fromId} data-testid="browser-cookie-source">
              <SelectValue>
                {chosen ? <ProfileLabel profile={chosen} icon={icons[chosen.browser]} /> : null}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="z-[130]">
              {profiles.map((profile) => (
                <SelectItem
                  key={keyOf(profile)}
                  value={keyOf(profile)}
                  textValue={`${profile.browserName} ${profile.profileName}`}
                  indicator="right-circle"
                  disabled={profile.status !== "available"}
                  trailing={
                    profile.status === "available" ? null : (
                      <span className="text-xs text-muted-foreground">
                        {t(($) => $.settings.integrations.cookies.noCookies)}
                      </span>
                    )
                  }
                >
                  <ProfileLabel profile={profile} icon={icons[profile.browser]} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
          <Globe aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span data-testid="browser-sign-in-copy-site" className="min-w-0 truncate text-sm font-medium">
            {domain}
          </span>
        </div>
        <DialogDescription className="text-xs">
          {t(($) => $.settings.integrations.cookies.dialogDescription, { server: domain })}
        </DialogDescription>

        {problem ? (
          <p role="alert" className="select-text text-sm text-destructive">
            {problem}
          </p>
        ) : null}

        <DialogFooter className="sm:items-center">
          <Button
            type="button"
            variant="link"
            className="px-0 sm:mr-auto"
            data-testid="manage-sign-ins-link"
            disabled={copying}
            onClick={onManage}
          >
            {t(($) => $.settings.integrations.signIns.title)}
          </Button>
          <Button type="button" variant="ghost" disabled={copying} onClick={onClose}>
            {t(($) => $.common.actions.cancel)}
          </Button>
          <Button type="button" disabled={!chosen || copying} onClick={() => void copy()}>
            {copying ? <Spinner size="sm" /> : null}
            {copying
              ? t(($) => $.settings.integrations.cookies.copying)
              : t(($) => $.settings.integrations.cookies.copyAction)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProfileLabel({ profile, icon }: Readonly<{ profile: BrowserProfile; icon: string | undefined }>) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <AppIcon url={icon} size="sm" />
      <span className="shrink-0">{profile.browserName}</span>
      <span className="truncate text-muted-foreground">{profile.profileName}</span>
    </span>
  );
}
