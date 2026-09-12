import { useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { describeError } from "@/lib/app-error";
import {
  detectBrowserCookieSources,
  importBrowserCookies,
  type BrowserCookieImportSummary,
  type BrowserCookieSource,
  type BrowserCookieSourceId,
} from "@/lib/tauri";

type ImportStage = "closed" | "select" | "confirm";

type ReviewErrorCode = "chooseProfile" | "hostname";

interface ReviewedImport {
  browser: BrowserCookieSourceId;
  browserName: string;
  profile: string;
  profileName: string;
  domain: string | null;
}

function normalizeDomain(value: string): {
  domain: string | null;
  error: ReviewErrorCode | null;
} {
  const domain = value.trim().toLowerCase();
  if (!domain) return { domain: null, error: null };
  const labels = domain.split(".");
  const valid =
    domain.length <= 253 &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    );
  return valid ? { domain, error: null } : { domain: null, error: "hostname" };
}

export function BrowserCookieImport() {
  const { t } = useTranslation(["common", "settings"]);
  const detectionRequest = useRef(0);
  const [stage, setStage] = useState<ImportStage>("closed");
  const [sources, setSources] = useState<BrowserCookieSource[]>([]);
  const [selectedIndex, setSelectedIndex] = useState("");
  const [domainDraft, setDomainDraft] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<ReviewErrorCode | null>(null);
  const [reviewedImport, setReviewedImport] = useState<ReviewedImport | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [summary, setSummary] = useState<BrowserCookieImportSummary | null>(
    null,
  );

  const selectedSource =
    selectedIndex === "" ? null : (sources[Number(selectedIndex)] ?? null);

  const sourceStatusLabel = (source: BrowserCookieSource): string => {
    if (source.status === "coming_soon")
      return t(($) => $.settings.integrations.cookies.status.comingSoon);
    if (source.status === "no_cookie_store")
      return t(($) => $.settings.integrations.cookies.status.noCookieStore);
    if (source.status === "not_installed")
      return t(($) => $.settings.integrations.cookies.status.notInstalled);
    return t(($) => $.settings.integrations.cookies.status.available);
  };

  const summaryLabel = (result: BrowserCookieImportSummary): string => {
    const count = result.imported;
    const browser = result.browserName;
    if (result.profileName && result.domain) {
      return t(($) => $.settings.integrations.cookies.importedProfileDomain, {
        count,
        browser,
        profile: result.profileName,
        domain: result.domain,
      });
    }
    if (result.profileName) {
      return t(($) => $.settings.integrations.cookies.importedProfile, {
        count,
        browser,
        profile: result.profileName,
      });
    }
    if (result.domain) {
      return t(($) => $.settings.integrations.cookies.importedDomain, {
        count,
        browser,
        domain: result.domain,
      });
    }
    return t(($) => $.settings.integrations.cookies.imported, {
      count,
      browser,
    });
  };

  const reviewErrorLabel = (code: ReviewErrorCode): string =>
    code === "hostname"
      ? t(($) => $.settings.integrations.cookies.errors.hostname)
      : t(($) => $.settings.integrations.cookies.errors.chooseProfile);

  const loadSources = async () => {
    const requestId = ++detectionRequest.current;
    setDetecting(true);
    setDetectionError(null);
    setSelectedIndex("");
    try {
      const detected = await detectBrowserCookieSources();
      if (detectionRequest.current !== requestId) return;
      setSources(detected);
    } catch (error) {
      if (detectionRequest.current !== requestId) return;
      setSources([]);
      setDetectionError(describeError(error));
    } finally {
      if (detectionRequest.current === requestId) setDetecting(false);
    }
  };

  const closeImporter = () => {
    detectionRequest.current += 1;
    setDetecting(false);
    setStage("closed");
  };

  const openImporter = () => {
    setStage("select");
    setSources([]);
    setSelectedIndex("");
    setDomainDraft("");
    setDetectionError(null);
    setReviewError(null);
    setImportError(null);
    setReviewedImport(null);
    setSummary(null);
    void loadSources();
  };

  const reviewImport = () => {
    if (
      selectedSource?.status !== "available" ||
      selectedSource.profile === null
    ) {
      setReviewError("chooseProfile");
      return;
    }
    const validation = normalizeDomain(domainDraft);
    if (validation.error) {
      setReviewError(validation.error);
      return;
    }
    setReviewError(null);
    setImportError(null);
    setReviewedImport({
      browser: selectedSource.browser,
      browserName: selectedSource.browserName,
      profile: selectedSource.profile,
      profileName: selectedSource.profileName ?? selectedSource.profile,
      domain: validation.domain,
    });
    setStage("confirm");
  };

  const runImport = async () => {
    if (!reviewedImport || importing) return;
    setImporting(true);
    setImportError(null);
    try {
      const result = await importBrowserCookies({
        browser: reviewedImport.browser,
        profile: reviewedImport.profile,
        domain: reviewedImport.domain,
      });
      setSummary(result);
      setStage("closed");
    } catch (error) {
      setImportError(describeError(error));
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <div className="rounded-lg border bg-card p-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">
              {t(($) => $.settings.integrations.cookies.title)}
            </div>
            <div className="text-xs text-muted-foreground">
              {t(($) => $.settings.integrations.cookies.description)}
            </div>
          </div>
          <Button type="button" variant="outline" onClick={openImporter}>
            {t(($) => $.settings.integrations.cookies.action)}
          </Button>
        </div>
        {summary ? (
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            {summaryLabel(summary)}
          </p>
        ) : null}
      </div>

      <Dialog
        open={stage === "select"}
        onOpenChange={(open) => !open && closeImporter()}
      >
        <DialogContent
          className="z-[120] max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl"
          overlayClassName="z-[120]"
        >
          <DialogHeader>
            <DialogTitle>
              {t(($) => $.settings.integrations.cookies.dialogTitle)}
            </DialogTitle>
            <DialogDescription>
              {t(($) => $.settings.integrations.cookies.dialogDescription)}
            </DialogDescription>
          </DialogHeader>

          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="text-sm text-muted-foreground"
          >
            {detecting
              ? t(($) => $.settings.integrations.cookies.detecting)
              : !detectionError && sources.length === 0
                ? t(($) => $.settings.integrations.cookies.empty)
                : null}
          </div>

          {detectionError ? (
            <div className="space-y-3 rounded-md border border-destructive/40 p-3">
              <p role="alert" className="text-sm text-destructive">
                {detectionError}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadSources()}
              >
                {t(($) => $.settings.integrations.cookies.tryAgain)}
              </Button>
            </div>
          ) : null}

          {!detecting && !detectionError ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                {t(($) => $.settings.integrations.cookies.profileLegend)}
              </legend>
              <RadioGroup
                aria-label={t(
                  ($) => $.settings.integrations.cookies.profileGroupLabel,
                )}
                value={selectedIndex}
                onValueChange={(value) => {
                  setSelectedIndex(value);
                  setReviewError(null);
                }}
              >
                {sources.map((source, index) => {
                  const sourceId = `browser-cookie-source-${index}`;
                  const detailId = `${sourceId}-detail`;
                  const unavailable =
                    source.status !== "available" || source.profile === null;
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
                          {source.profileName ? (
                            <span>{source.profileName}</span>
                          ) : null}
                          <span className="text-xs text-muted-foreground">
                            {sourceStatusLabel(source)}
                          </span>
                        </span>
                        <span
                          id={detailId}
                          className="block text-xs text-muted-foreground"
                        >
                          {source.detail}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </RadioGroup>
            </fieldset>
          ) : null}

          <div className="space-y-1.5">
            <label
              className="text-sm font-medium"
              htmlFor="browser-cookie-domain"
            >
              {t(($) => $.settings.integrations.cookies.hostnameLabel)}
            </label>
            <Input
              id="browser-cookie-domain"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              placeholder={t(
                ($) => $.settings.integrations.cookies.hostnamePlaceholder,
              )}
              value={domainDraft}
              disabled={!selectedSource}
              aria-invalid={reviewError === "hostname"}
              aria-describedby={
                reviewError
                  ? "browser-cookie-domain-hint browser-cookie-review-error"
                  : "browser-cookie-domain-hint"
              }
              onChange={(event) => {
                setDomainDraft(event.target.value);
                setReviewError(null);
              }}
            />
            <p
              id="browser-cookie-domain-hint"
              className="text-xs text-muted-foreground"
            >
              {t(($) => $.settings.integrations.cookies.hostnameHint)}
            </p>
          </div>

          {reviewError ? (
            <p
              id="browser-cookie-review-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {reviewErrorLabel(reviewError)}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={closeImporter}
            >
              {t(($) => $.common.actions.cancel)}
            </Button>
            <Button
              type="button"
              onClick={reviewImport}
              disabled={detecting || !selectedSource}
            >
              {t(($) => $.settings.integrations.cookies.review)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={stage === "confirm"}
        onOpenChange={(open) => !open && !importing && setStage("select")}
      >
        <DialogContent
          role="alertdialog"
          closeDisabled={importing}
          onEscapeKeyDown={(event) => importing && event.preventDefault()}
          onPointerDownOutside={(event) => importing && event.preventDefault()}
          className="z-[120] sm:max-w-md"
          overlayClassName="z-[120]"
        >
          <DialogHeader>
            <DialogTitle>
              {t(($) => $.settings.integrations.cookies.confirmTitle)}
            </DialogTitle>
            <DialogDescription>
              {reviewedImport?.domain
                ? t(($) => $.settings.integrations.cookies.confirmDomain, {
                    profile: reviewedImport.profileName,
                    browser: reviewedImport.browserName,
                    domain: reviewedImport.domain,
                  })
                : t(($) => $.settings.integrations.cookies.confirmAllDomains, {
                    profile: reviewedImport?.profileName,
                    browser: reviewedImport?.browserName,
                  })}
            </DialogDescription>
          </DialogHeader>

          {importError ? (
            <p role="alert" className="text-sm text-destructive">
              {importError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              autoFocus
              disabled={importing}
              onClick={() => {
                setImportError(null);
                setStage("select");
              }}
            >
              {t(($) => $.common.actions.back)}
            </Button>
            <Button
              type="button"
              disabled={importing}
              onClick={() => void runImport()}
            >
              {importing
                ? t(($) => $.settings.integrations.cookies.importing)
                : t(($) => $.settings.integrations.cookies.action)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
