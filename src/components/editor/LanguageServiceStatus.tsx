import {
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";
import {
  retryActiveLanguageService,
  setupActiveLanguageService,
} from "@/lib/analysis/language-service-actions";
import {
  analysisReasonEnglishText,
  type AnalysisReason,
} from "@/lib/analysis/reason";
import { getLanguageServiceSetupDisclosure } from "@/lib/language-service/setup-disclosure";
import type { LanguageServiceKind } from "@/lib/language-service/transport";
import { logError } from "@/lib/log";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFilesStore } from "@/store/files";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import {
  offerLanguageServiceSetup,
  useSilentRetry,
  type SilentRetryPolicy,
} from "./LanguageServiceRuntimeBoundary";

const BIBTEX_DOCUMENT = /\.bib$/i;

const START_FAILED: AnalysisReason = { key: "startFailed" };

export const LANGUAGE_SERVICE_RETRY_POLICY: SilentRetryPolicy = {
  baseMs: 5_000,
  maxMs: 300_000,
  limit: Number.POSITIVE_INFINITY,
};

export function LanguageServiceStatus() {
  const projectId = useFilesStore((state) => state.projectId);
  const activePath = useFilesStore((state) => state.activePath);
  const kind = useProjectAnalysisStore(
    (state) => state.snapshot.languageService.kind,
  );
  const readiness = useProjectAnalysisStore(
    (state) => state.snapshot.languageService.readiness,
  );
  const reason = useProjectAnalysisStore(
    (state) => state.snapshot.languageService.reason,
  );
  const failureMessage = useProjectAnalysisStore(
    (state) => state.snapshot.languageService.failure?.message,
  );
  const failureReason = useProjectAnalysisStore(
    (state) => state.snapshot.languageService.failure?.reason,
  );
  const bibtexActive =
    activePath !== null && BIBTEX_DOCUMENT.test(activePath);
  const setupRequired =
    projectId !== null && readiness === "setup_required";

  useSilentRetry({
    failing: projectId !== null && readiness === "unavailable",
    recovered: readiness === "ready",
    retry: retryActiveLanguageService,
    policy: LANGUAGE_SERVICE_RETRY_POLICY,
    scope: "language service unavailable",
    detail:
      failureMessage ??
      analysisReasonEnglishText(failureReason ?? reason ?? START_FAILED),
    resetKey: projectId,
  });
  const offered = useSetupAvailable({ kind, setupRequired, bibtexActive });

  if (!projectId) return null;

  return (
    <LanguageServiceSetupDialog
      key={`${projectId}:${kind ?? "none"}`}
      kind={kind}
      offered={offered}
      setupRequired={setupRequired}
    />
  );
}

type SetupDisclosure = ReturnType<typeof getLanguageServiceSetupDisclosure>;

function resolveSetupDisclosure(
  kind: LanguageServiceKind | null,
  wanted: boolean,
): { disclosure: SetupDisclosure | null; disclosureFailure: string | null } {
  if (!wanted || kind !== "texlab") return { disclosure: null, disclosureFailure: null };
  try {
    return { disclosure: getLanguageServiceSetupDisclosure(kind), disclosureFailure: null };
  } catch (error) {
    const disclosureFailure =
      error instanceof Error ? error.message : "TexLab setup metadata is invalid";
    return { disclosure: null, disclosureFailure };
  }
}

function useSetupAvailable({
  kind,
  setupRequired,
  bibtexActive,
}: {
  kind: LanguageServiceKind | null;
  setupRequired: boolean;
  bibtexActive: boolean;
}): boolean {
  const { disclosure, disclosureFailure } = resolveSetupDisclosure(
    kind,
    setupRequired,
  );

  useEffect(() => {
    if (disclosureFailure === null) return;
    void logError("read the language service setup details", disclosureFailure);
  }, [disclosureFailure]);

  return setupRequired && !bibtexActive && disclosure !== null;
}

interface LanguageServiceSetupDialogProps {
  kind: LanguageServiceKind | null;
  offered: boolean;
  setupRequired: boolean;
}

function LanguageServiceSetupDialog({
  kind,
  offered,
  setupRequired,
}: Readonly<LanguageServiceSetupDialogProps>) {
  const { t } = useTranslation(["common", "intelligence"]);
  const [setupOpen, setSetupOpen] = useState(false);
  const [installPending, setInstallPending] = useState(false);
  const [installFailure, setInstallFailure] = useState<string | null>(
    null,
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { disclosure } = resolveSetupDisclosure(
    kind,
    setupRequired || setupOpen,
  );
  const installLabel = (detail: SetupDisclosure): string => {
    if (installPending) {
      return t(($) => $.intelligence.languageService.installing, {
        name: detail.displayName,
      });
    }
    if (installFailure) {
      return t(($) => $.intelligence.languageService.retryDownload, {
        name: detail.displayName,
      });
    }
    return t(($) => $.intelligence.languageService.install, {
      name: detail.displayName,
      version: detail.version,
    });
  };

  useEffect(() => {
    if (!offered) return;
    return offerLanguageServiceSetup(() => {
      setInstallFailure(null);
      setSetupOpen(true);
    });
  }, [offered]);

  const install = async () => {
    if (!disclosure || installPending) return;
    setInstallPending(true);
    setInstallFailure(null);
    try {
      await setupActiveLanguageService();
      if (!mounted.current) return;
      setSetupOpen(false);
    } catch {
      if (!mounted.current) return;
      setInstallFailure(
        t(($) => $.intelligence.languageService.reasons.setupFailed),
      );
    } finally {
      if (mounted.current) setInstallPending(false);
    }
  };

  return (
    <>
      {disclosure ? (
        <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {t(($) => $.intelligence.languageService.installTitle, {
                  name: disclosure.displayName,
                  version: disclosure.version,
                })}
              </DialogTitle>
              <DialogDescription>
                {disclosure.purpose}
              </DialogDescription>
            </DialogHeader>

            <dl className="grid gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
              <div className="grid gap-1">
                <dt className="font-medium text-foreground">
                  {t(($) => $.intelligence.languageService.licenseAndSource)}
                </dt>
                <dd className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                  <a
                    className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground focus-visible:rounded-sm focus-visible:bg-muted focus-visible:text-foreground"
                    href={disclosure.license.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {t(($) => $.intelligence.languageService.licenseLink, {
                      spdx: disclosure.license.spdx,
                    })}
                    <ExternalLink
                      aria-hidden="true"
                      className="size-3"
                    />
                  </a>
                  <a
                    className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground focus-visible:rounded-sm focus-visible:bg-muted focus-visible:text-foreground"
                    href={disclosure.sourceUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {t(($) => $.intelligence.languageService.sourceLink)}
                    <ExternalLink
                      aria-hidden="true"
                      className="size-3"
                    />
                  </a>
                </dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-medium text-foreground">
                  {t(($) => $.intelligence.languageService.verification)}
                </dt>
                <dd className="text-muted-foreground">
                  {t(($) => $.intelligence.languageService.verificationDetail)}
                </dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-medium text-foreground">
                  {t(($) => $.intelligence.languageService.destination)}
                </dt>
                <dd className="break-all font-mono text-xs text-muted-foreground">
                  {disclosure.destination}
                </dd>
              </div>
            </dl>

            {installFailure ? (
              <p
                aria-live="polite"
                className="text-sm text-destructive"
                role="status"
              >
                {installFailure}
              </p>
            ) : null}

            <DialogFooter>
              <DialogClose asChild>
                <Button
                  disabled={installPending}
                  type="button"
                  variant="outline"
                >
                  {t(($) => $.common.actions.cancel)}
                </Button>
              </DialogClose>
              <Button
                disabled={installPending}
                onClick={() => void install()}
                type="button"
              >
                {installPending ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                  />
                ) : (
                  <Download aria-hidden="true" />
                )}
                {installLabel(disclosure)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
