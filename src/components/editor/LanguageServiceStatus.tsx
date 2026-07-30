import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Download,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  LANGUAGE_SERVICE_SETUP_FAILURE_REASON,
  retryActiveLanguageService,
  setupActiveLanguageService,
} from "@/lib/analysis/language-service-actions";
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
  const bibtexActive =
    activePath !== null && BIBTEX_DOCUMENT.test(activePath);

  if (!projectId) return null;

  return (
    <LanguageServiceFailureStatus
      key={`${projectId}:${kind ?? "none"}`}
      failureMessage={failureMessage}
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
  kind: LanguageServiceKind | null;
  reason?: string;
  setupRequired: boolean;
  visible: boolean;
}

function LanguageServiceFailureStatus({
  failureMessage,
  kind,
  reason,
  setupRequired,
  visible,
}: LanguageServiceFailureStatusProps) {
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
          : "TexLab setup metadata is invalid";
    }
  }
  const canSetUp = setupRequired && disclosure !== null;
  const actionLabel = canSetUp ? "Set up" : "Retry";
  const unavailableLabel =
    failureMessage ??
    reason ??
    "The project language service could not be started.";
  const statusMessage = setupRequired
    ? disclosureFailure
      ? "Language service setup details unavailable"
      : "Language service setup required"
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
      setInstallFailure(LANGUAGE_SERVICE_SETUP_FAILURE_REASON);
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
                Install {disclosure.displayName}{" "}
                {disclosure.version}?
              </DialogTitle>
              <DialogDescription>
                {disclosure.purpose}
              </DialogDescription>
            </DialogHeader>

            <dl className="grid gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
              <div className="grid gap-1">
                <dt className="font-medium text-foreground">
                  License and source
                </dt>
                <dd className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                  <a
                    className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={disclosure.license.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {disclosure.license.spdx} license
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
                    Pinned corresponding source
                    <ExternalLink
                      aria-hidden="true"
                      className="size-3"
                    />
                  </a>
                </dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-medium text-foreground">
                  Verification
                </dt>
                <dd className="text-muted-foreground">
                  Oleafly verifies the downloaded archive and
                  extracted executable against their
                  manifest-pinned sizes and SHA-256 checksums.
                </dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-medium text-foreground">
                  Destination
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
                Setup failed: {installFailure}. You can retry.
              </p>
            ) : null}

            <DialogFooter>
              <DialogClose asChild>
                <Button
                  disabled={installPending}
                  type="button"
                  variant="outline"
                >
                  Cancel
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
                  ? `Installing ${disclosure.displayName}…`
                  : installFailure
                    ? `Retry ${disclosure.displayName} download`
                    : `Install ${disclosure.displayName} ${disclosure.version}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
