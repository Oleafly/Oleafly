import { useEffect, useRef, useState } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import {
  isOverleafError,
  overleafSignInWithAppCookies,
  type OverleafStatus,
} from "@/lib/overleaf";
import {
  detectBrowserCookieSources,
  importBrowserCookies,
  type BrowserCookieSource,
  type BrowserCookieSourceId,
} from "@/lib/tauri";

type CopyStage = "closed" | "select" | "confirm";

interface ReviewedCopy {
  browser: BrowserCookieSourceId;
  browserName: string;
  profile: string;
  profileName: string;
}

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
  const [stage, setStage] = useState<CopyStage>("closed");
  const [selectedIndex, setSelectedIndex] = useState("");
  const [reviewError, setReviewError] = useState(false);
  const [reviewed, setReviewed] = useState<ReviewedCopy | null>(null);
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
    setStage("select");
    setSelectedIndex("");
    setReviewError(false);
    setReviewed(null);
    setCopyError(null);
    setOutcome(null);
  };

  const review = () => {
    if (selectedSource?.status !== "available" || selectedSource.profile === null) {
      setReviewError(true);
      return;
    }
    setReviewError(false);
    setCopyError(null);
    setReviewed({
      browser: selectedSource.browser,
      browserName: selectedSource.browserName,
      profile: selectedSource.profile,
      profileName: selectedSource.profileName ?? selectedSource.profile,
    });
    setStage("confirm");
  };

  const copy = async () => {
    if (!reviewed || copying) return;
    setCopying(true);
    setCopyError(null);
    let imported: number;
    try {
      const summary = await importBrowserCookies({
        browser: reviewed.browser,
        profile: reviewed.profile,
        domain,
      });
      imported = summary.imported;
    } catch (error) {
      setCopyError(describeError(error));
      setCopying(false);
      return;
    }
    try {
      const status = await overleafSignInWithAppCookies(server);
      setStage("closed");
      onSignedIn(status);
    } catch (error) {
      void logError("sign in with copied browser cookies", error);
      setStage("closed");
      setOutcome(
        isOverleafError(error, "browser_sign_in_failed")
          ? t(($) => $.settings.integrations.cookies.notSignedIn, {
              count: imported,
              browser: reviewed.browserName,
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

      <Dialog open={stage === "select"} onOpenChange={(next) => !next && setStage("closed")}>
        <DialogContent
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
              onValueChange={(value) => {
                setSelectedIndex(value);
                setReviewError(false);
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

          {reviewError ? (
            <p role="alert" className="select-text text-sm text-destructive">
              {t(($) => $.settings.integrations.cookies.errors.chooseProfile)}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setStage("closed")}>
              {t(($) => $.common.actions.cancel)}
            </Button>
            <Button type="button" onClick={review} disabled={!selectedSource}>
              {t(($) => $.settings.integrations.cookies.review)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stage === "confirm"} onOpenChange={(next) => !next && !copying && setStage("select")}>
        <DialogContent
          role="alertdialog"
          closeDisabled={copying}
          onEscapeKeyDown={(event) => copying && event.preventDefault()}
          onPointerDownOutside={(event) => copying && event.preventDefault()}
          className="z-[120] sm:max-w-md"
          overlayClassName="z-[120]"
        >
          <DialogHeader>
            <DialogTitle>{t(($) => $.settings.integrations.cookies.confirmTitle)}</DialogTitle>
            <DialogDescription>
              {t(($) => $.settings.integrations.cookies.confirmCopy, {
                domain,
                profile: reviewed?.profileName,
                browser: reviewed?.browserName,
              })}
            </DialogDescription>
          </DialogHeader>

          {copyError ? (
            <p role="alert" className="select-text text-sm text-destructive">
              {copyError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              autoFocus
              disabled={copying}
              onClick={() => {
                setCopyError(null);
                setStage("select");
              }}
            >
              {t(($) => $.common.actions.back)}
            </Button>
            <Button type="button" disabled={copying} onClick={() => void copy()}>
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
