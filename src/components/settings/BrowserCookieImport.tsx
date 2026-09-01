import { useRef, useState } from "react";
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
import {
  detectBrowserCookieSources,
  importBrowserCookies,
  type BrowserCookieImportSummary,
  type BrowserCookieSource,
  type BrowserCookieSourceId,
} from "@/lib/tauri";

type ImportStage = "closed" | "select" | "confirm";

interface ReviewedImport {
  browser: BrowserCookieSourceId;
  browserName: string;
  profile: string;
  profileName: string;
  domain: string | null;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function normalizeDomain(value: string): {
  domain: string | null;
  error: string | null;
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
  return valid
    ? { domain, error: null }
    : { domain: null, error: "Enter a hostname such as example.com." };
}

function sourceStatusLabel(source: BrowserCookieSource): string {
  if (source.status === "coming_soon") return "Coming soon";
  if (source.status === "no_cookie_store") return "No cookie store";
  if (source.status === "not_installed") return "Not installed";
  return "Available";
}

function formatSummary(summary: BrowserCookieImportSummary): string {
  const importedLabel = summary.imported === 1 ? "cookie" : "cookies";
  const profile = summary.profileName ? `, ${summary.profileName}` : "";
  const domain = summary.domain ? ` for ${summary.domain}` : "";
  return `Imported ${summary.imported} ${importedLabel} from ${summary.browserName}${profile}${domain}.`;
}

export function BrowserCookieImport() {
  const detectionRequest = useRef(0);
  const [stage, setStage] = useState<ImportStage>("closed");
  const [sources, setSources] = useState<BrowserCookieSource[]>([]);
  const [selectedIndex, setSelectedIndex] = useState("");
  const [domainDraft, setDomainDraft] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewedImport, setReviewedImport] = useState<ReviewedImport | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const selectedSource =
    selectedIndex === "" ? null : (sources[Number(selectedIndex)] ?? null);

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
      setDetectionError(
        errorMessage(error, "Oleafly could not detect installed browser profiles."),
      );
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
      setReviewError("Choose an available browser profile.");
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
      setSummary(formatSummary(result));
      setStage("closed");
    } catch (error) {
      setImportError(
        errorMessage(error, "Oleafly could not import cookies from this profile."),
      );
    } finally {
      setImporting(false);
    }
  };

  const reviewedScope = reviewedImport?.domain ?? "all domains";

  return (
    <>
      <div className="rounded-lg border bg-card p-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Import cookies</div>
            <div className="text-xs text-muted-foreground">
              Use an existing browser sign-in in Oleafly's in-app browser.
            </div>
          </div>
          <Button type="button" variant="outline" onClick={openImporter}>
            Import cookies
          </Button>
        </div>
        {summary ? (
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            {summary}
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
            <DialogTitle>Import browser cookies</DialogTitle>
            <DialogDescription>
              Choose one installed browser profile. Oleafly reads it only after
              you review and confirm the import. Chromium cookies are unlocked
              locally through macOS Keychain. Oleafly does not send cookie
              values to an Oleafly service.
            </DialogDescription>
          </DialogHeader>

          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="text-sm text-muted-foreground"
          >
            {detecting
              ? "Looking for installed browser profiles..."
              : !detectionError && sources.length === 0
                ? "No supported browser profiles were found."
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
                Try again
              </Button>
            </div>
          ) : null}

          {!detecting && !detectionError ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Browser profile</legend>
              <RadioGroup
                aria-label="Browser profiles"
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
              Target hostname (optional)
            </label>
            <Input
              id="browser-cookie-domain"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              placeholder="example.com"
              value={domainDraft}
              disabled={!selectedSource}
              aria-invalid={reviewError === "Enter a hostname such as example.com."}
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
              Enter a site hostname to import only cookies that site can use.
              Leave blank to import every eligible cookie in this profile.
            </p>
          </div>

          {reviewError ? (
            <p
              id="browser-cookie-review-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {reviewError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={closeImporter}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={reviewImport}
              disabled={detecting || !selectedSource}
            >
              Review import
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
            <DialogTitle>Confirm cookie import</DialogTitle>
            <DialogDescription>
              You are about to import cookies from the{" "}
              {reviewedImport?.profileName} profile in{" "}
              {reviewedImport?.browserName} for {reviewedScope}. Cookie values
              will be stored in the in-app browser and sent only to their
              matching websites. Oleafly will ask you to confirm once more in a
              native dialog before reading the profile.
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
              Back
            </Button>
            <Button
              type="button"
              disabled={importing}
              onClick={() => void runImport()}
            >
              {importing ? "Importing cookies..." : "Import cookies"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
