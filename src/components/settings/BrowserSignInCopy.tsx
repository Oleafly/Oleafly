import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { cn } from "@/lib/utils";
import {
  isOverleafError,
  overleafSignInBrowsers,
  overleafSignInWithAppCookies,
  type OverleafSignInBrowser,
  type OverleafStatus,
} from "@/lib/overleaf";
import { useOverleafImportStore } from "@/store/overleaf-import";
import {
  COOKIE_IMPORT_CANCELLED,
  detectBrowserCookieSources,
  importBrowserCookies,
  type BrowserCookieSource,
} from "@/lib/tauri";

export interface BrowserSignInCopyProps {
  server: string;
  onSignedIn(status: OverleafStatus): void;
  variant?: "row" | "button";
}

function serverHostname(server: string): string | null {
  try {
    return new URL(server).hostname || null;
  } catch {
    return null;
  }
}

export function BrowserSignInCopy({ server, onSignedIn, variant = "row" }: Readonly<BrowserSignInCopyProps>) {
  const { t } = useTranslation(["common", "settings"]);
  const domain = serverHostname(server);
  const detection = useRef(0);
  const [sources, setSources] = useState<BrowserCookieSource[] | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState("");
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  useEffect(() => {
    const request = ++detection.current;
    detectBrowserCookieSources()
      .then((found) => {
        if (detection.current === request) setSources(found);
      })
      .catch((error: unknown) => {
        void logError("detect browser profiles for the sign-in copy", error);
        if (detection.current === request) setSources([]);
      });
    return () => {
      detection.current += 1;
    };
  }, []);

  const available = (sources ?? []).some((source) => source.status === "available" && source.profile !== null);
  if (!available || !domain) return null;

  const selectedSource = selectedIndex === "" ? null : (sources?.[Number(selectedIndex)] ?? null);

  const statusLabel = (source: BrowserCookieSource): string => {
    if (source.status === "coming_soon") return t(($) => $.settings.integrations.cookies.status.comingSoon);
    if (source.status === "no_cookie_store") return t(($) => $.settings.integrations.cookies.status.noCookieStore);
    if (source.status === "not_installed") return t(($) => $.settings.integrations.cookies.status.notInstalled);
    return t(($) => $.settings.integrations.cookies.status.available);
  };

  const open = () => {
    setChoosing(true);
    setSelectedIndex("");
    setCopyError(null);
    setOutcome(null);
  };

  const copy = async () => {
    if (!selectedSource?.profile || copying) return;
    const { browser, browserName, profile } = selectedSource;
    setCopying(true);
    setCopyError(null);
    let imported: number;
    try {
      const summary = await importBrowserCookies({ browser, profile, domain });
      imported = summary.imported;
    } catch (error) {
      setCopying(false);
      if (describeError(error) === COOKIE_IMPORT_CANCELLED) return;
      void logError("copy browser cookies", error);
      setCopyError(describeError(error));
      return;
    }
    try {
      const status = await overleafSignInWithAppCookies(server);
      setChoosing(false);
      onSignedIn(status);
    } catch (error) {
      void logError("sign in with copied browser cookies", error);
      setChoosing(false);
      setOutcome(
        isOverleafError(error, "browser_sign_in_failed")
          ? t(($) => $.settings.integrations.cookies.notSignedIn, {
              count: imported,
              browser: browserName,
            })
          : describeError(error),
      );
    } finally {
      setCopying(false);
    }
  };

  const trigger = (
    <Button
      type="button"
      variant={variant === "row" ? "outline" : "secondary"}
      size="sm"
      data-testid="browser-sign-in-copy"
      onClick={open}
    >
      {t(($) => $.settings.integrations.cookies.useBrowserSignIn)}
    </Button>
  );
  const result = outcome ? (
    <output className="mt-2 block select-text text-xs text-muted-foreground">{outcome}</output>
  ) : null;

  return (
    <>
      {variant === "row" ? (
        <SettingsRow
          className="mt-4"
          testId="browser-sign-in-copy-row"
          label={t(($) => $.settings.integrations.cookies.label)}
          description={t(($) => $.settings.integrations.cookies.signInDescription, { server: domain })}
          details={result}
          control={trigger}
        />
      ) : (
        <div className="space-y-1">
          {trigger}
          {result}
        </div>
      )}

      <Dialog open={choosing} onOpenChange={(next) => !next && !copying && setChoosing(false)}>
        <DialogContent
          closeDisabled={copying}
          onEscapeKeyDown={(event) => copying && event.preventDefault()}
          onPointerDownOutside={(event) => copying && event.preventDefault()}
          className="z-[120] max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl"
          overlayClassName="z-[120]"
        >
          <DialogHeader>
            <DialogTitle>{t(($) => $.settings.integrations.cookies.dialogTitle)}</DialogTitle>
            <DialogDescription>{t(($) => $.settings.integrations.cookies.dialogDescription)}</DialogDescription>
          </DialogHeader>

          <p className="text-sm font-medium" data-testid="browser-sign-in-copy-site">
            {t(($) => $.settings.integrations.cookies.site, { domain })}
          </p>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t(($) => $.settings.integrations.cookies.profileLegend)}</legend>
            <RadioGroup
              aria-label={t(($) => $.settings.integrations.cookies.profileGroupLabel)}
              value={selectedIndex}
              disabled={copying}
              onValueChange={(value) => {
                setSelectedIndex(value);
                setCopyError(null);
              }}
            >
              {(sources ?? []).map((source, index) => {
                const sourceId = `browser-sign-in-source-${index}`;
                const detailId = `${sourceId}-detail`;
                const unavailable = source.status !== "available" || source.profile === null;
                return (
                  <label
                    key={`${source.browser}-${source.profile ?? source.status}`}
                    htmlFor={sourceId}
                    className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                  >
                    <RadioGroupItem
                      id={sourceId}
                      value={String(index)}
                      disabled={unavailable}
                      aria-describedby={detailId}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 space-y-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                        <span>{source.browserName}</span>
                        {source.profileName ? <span>{source.profileName}</span> : null}
                        <span className="text-xs text-muted-foreground">{statusLabel(source)}</span>
                      </span>
                      <span id={detailId} className="block text-xs text-muted-foreground">
                        {source.detail}
                      </span>
                    </span>
                  </label>
                );
              })}
            </RadioGroup>
          </fieldset>

          {copyError ? (
            <p role="alert" className="select-text text-sm text-destructive">
              {copyError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={copying} onClick={() => setChoosing(false)}>
              {t(($) => $.common.actions.cancel)}
            </Button>
            <Button type="button" disabled={!selectedSource || copying} onClick={() => void copy()}>
              {copying ? <Spinner size="sm" /> : null}
              {copying
                ? t(($) => $.settings.integrations.cookies.copying)
                : t(($) => $.settings.integrations.cookies.copyAction)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function useSignInOutcome() {
  const phase = useOverleafImportStore((state) => state.phase);
  const error = useOverleafImportStore((state) => state.error);
  const [attempted, setAttempted] = useState(false);
  const signing = phase === "signing-in";
  return {
    signing,
    error,
    failed: attempted && !signing && phase === "signed-out" && error !== null,
    attempt: () => setAttempted(true),
  };
}

function SignInDetails({ waiting, failed, error }: Readonly<{ waiting: string | null; failed: boolean; error: unknown }>) {
  if (waiting) return <output className="mt-2 block text-xs text-muted-foreground">{waiting}</output>;
  if (!failed) return null;
  return (
    <p role="alert" className="mt-2 select-text text-xs text-destructive">
      {describeError(error)}
    </p>
  );
}

export function WindowSignIn() {
  const { t } = useTranslation(["settings"]);
  const server = useOverleafImportStore((state) => state.server);
  const signingWith = useOverleafImportStore((state) => state.signingWith);
  const signIn = useOverleafImportStore((state) => state.signIn);
  const outcome = useSignInOutcome();
  const host = serverHostname(server) ?? server;
  const title = t(($) => $.settings.integrations.overleaf.windowLabel, { server: host });
  const waiting = outcome.signing && signingWith === null;
  return (
    <SettingsRow
      className="mt-4"
      testId="window-sign-in-row"
      label={title}
      description={t(($) => $.settings.integrations.overleaf.windowDescription)}
      details={
        <SignInDetails
          waiting={waiting ? t(($) => $.settings.integrations.overleaf.windowWaiting, { server: host }) : null}
          failed={outcome.failed}
          error={outcome.error}
        />
      }
      control={
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="window-sign-in"
          disabled={outcome.signing}
          onClick={() => {
            outcome.attempt();
            void signIn(title);
          }}
        >
          {waiting ? <Spinner size="sm" /> : null}
          {t(($) => $.settings.integrations.overleaf.windowAction)}
        </Button>
      }
    />
  );
}

export function BrowserSignIn({
  variant = "row",
  fallback = null,
}: Readonly<{ variant?: "row" | "button"; fallback?: ReactNode }>) {
  const { t } = useTranslation(["settings"]);
  const server = useOverleafImportStore((state) => state.server);
  const signingWith = useOverleafImportStore((state) => state.signingWith);
  const signInWithBrowser = useOverleafImportStore((state) => state.signInWithBrowser);
  const outcome = useSignInOutcome();
  const [browsers, setBrowsers] = useState<OverleafSignInBrowser[] | null>(null);
  const [chosen, setChosen] = useState("");

  useEffect(() => {
    let live = true;
    overleafSignInBrowsers()
      .then((found) => {
        if (live) setBrowsers(found);
      })
      .catch((error: unknown) => {
        void logError("list browsers for Overleaf sign-in", error);
        if (live) setBrowsers([]);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!browsers) return null;
  const picked = browsers.find((browser) => browser.key === chosen) ?? browsers[0];
  if (!picked) return fallback;
  const signing = outcome.signing;
  const waiting = signing && signingWith !== null;
  const host = serverHostname(server) ?? server;
  const label = t(($) => $.settings.integrations.overleaf.browserLabel);

  const picker = (
    <Select value={picked.key} onValueChange={setChosen} disabled={signing}>
      <SelectTrigger
        className="h-8 w-[168px] text-xs"
        data-testid="browser-sign-in-picker"
        aria-label={t(($) => $.settings.integrations.overleaf.browserPick)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="z-[130]">
        {browsers.map((browser) => (
          <SelectItem key={browser.key} value={browser.key} className="text-xs">
            {browser.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const trigger = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid="browser-sign-in"
      disabled={signing}
      onClick={() => {
        outcome.attempt();
        void signInWithBrowser(picked);
      }}
    >
      {waiting ? <Spinner size="sm" /> : null}
      {variant === "row" ? t(($) => $.settings.integrations.overleaf.browserAction) : label}
    </Button>
  );
  const controls = (
    <div className={cn("flex flex-wrap items-center gap-2", variant === "row" ? "justify-end" : "justify-center")}>
      {picker}
      {trigger}
    </div>
  );

  if (variant === "button") {
    return (
      <div className="flex flex-col items-center gap-1">
        {controls}
        <p className="max-w-md text-xs text-muted-foreground">
          {t(($) => $.settings.integrations.overleaf.browserHint)}
        </p>
      </div>
    );
  }
  return (
    <SettingsRow
      className="mt-4"
      testId="browser-sign-in-row"
      label={label}
      description={t(($) => $.settings.integrations.overleaf.browserDescription, { server: host })}
      details={
        <SignInDetails
          waiting={
            waiting
              ? t(($) => $.settings.integrations.overleaf.browserWaiting, { browser: signingWith, server: host })
              : null
          }
          failed={outcome.failed}
          error={outcome.error}
        />
      }
      control={controls}
    />
  );
}
