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
import { toast } from "sonner";
import {
  retryActiveLanguageService,
  setupActiveLanguageService,
} from "@/lib/analysis/language-service-actions";
import {
  analysisReasonText,
  type AnalysisReason,
} from "@/lib/analysis/reason";
import { getLanguageServiceSetupDisclosure } from "@/lib/language-service/setup-disclosure";
import type { LanguageServiceKind } from "@/lib/language-service/transport";
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
import { i18n } from "@/i18n";

const BIBTEX_DOCUMENT = /\.bib$/i;

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

  if (!projectId) return null;

  return (
    <LanguageServiceFailureStatus
      key={`${projectId}:${kind ?? "none"}`}
      failureMessage={failureMessage}
      failureReason={failureReason}
      kind={kind}
      reason={reason}
      setupRequired={readiness === "setup_required"}
      visible={
        !bibtexActive &&
        (readiness === "setup_required" ||
          readiness === "unavailable")
      }
    />
  );
}

interface LanguageServiceFailureStatusProps {
  failureMessage?: string;
  failureReason?: AnalysisReason;
  kind: LanguageServiceKind | null;
  reason?: AnalysisReason;
  setupRequired: boolean;
  visible: boolean;
}

function LanguageServiceFailureStatus({
  failureMessage,
  failureReason,
  kind,
  reason,
  setupRequired,
  visible,
}: LanguageServiceFailureStatusProps) {
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
  let disclosure:
    | ReturnType<typeof getLanguageServiceSetupDisclosure>
    | null = null;
  let disclosureFailure: string | null = null;
  if ((setupRequired || setupOpen) && kind === "texlab") {
    try {
      disclosure = getLanguageServiceSetupDisclosure(kind);
    } catch (error) {
      disclosureFailure =
        error instanceof Error
          ? error.message
          : i18n.t(($) => $.intelligence.languageService.setupMetadataInvalid);
    }
  }
  const canSetUp = setupRequired && disclosure !== null;
  const actionLabel = canSetUp
    ? t(($) => $.intelligence.languageService.setUp)
    : t(($) => $.intelligence.languageService.retry);
  const unavailableLabel =
    analysisReasonText(failureReason) ??
    failureMessage ??
    analysisReasonText(reason) ??
    t(($) => $.intelligence.languageService.startFailed);
  const statusMessage = setupRequired
    ? disclosureFailure
      ? t(($) => $.intelligence.languageService.setupDetailsUnavailable)
      : t(($) => $.intelligence.languageService.setupRequired)
    : unavailableLabel;
  const toastId = `language-service:${kind ?? "unknown"}`;

  useEffect(() => {
    if (!visible) {
      toast.dismiss(toastId);
      return;
    }
    toast.warning(statusMessage, {
      id: toastId,
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: actionLabel,
        onClick: canSetUp
          ? () => {
              setInstallFailure(null);
              setSetupOpen(true);
            }
          : retryActiveLanguageService,
      },
    });
    return () => {
      toast.dismiss(toastId);
    };
  }, [
    actionLabel,
    canSetUp,
    statusMessage,
    toastId,
    visible,
  ]);

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
                    className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                {installPending
                  ? t(($) => $.intelligence.languageService.installing, {
                      name: disclosure.displayName,
                    })
                  : installFailure
                    ? t(($) => $.intelligence.languageService.retryDownload, {
                        name: disclosure.displayName,
                      })
                    : t(($) => $.intelligence.languageService.install, {
                        name: disclosure.displayName,
                        version: disclosure.version,
                      })}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
