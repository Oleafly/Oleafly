import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyableBlock } from "@/components/ui/copyable-block";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { appModalCoordinator } from "@/components/ui/use-modal-accessibility";
import { describeError } from "@/lib/app-error";
import type { HostKeyPrompt } from "./compute-api";

export function ComputeHostKeyDialog({
  prompt,
  onClose,
  onTrust,
}: Readonly<{
  prompt: HostKeyPrompt;
  onClose: () => void;
  onTrust: (fingerprints: string[]) => Promise<void>;
}>) {
  const { t } = useTranslation(["researchTools"]);
  const [trusting, setTrusting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modalId = appModalCoordinator.add(opener);
    return () => {
      appModalCoordinator.remove(modalId)?.focus({ preventScroll: true });
    };
  }, []);

  const fingerprints = prompt.keys.map((key) => key.fingerprint);
  const listing = prompt.keys.map((key) => `${key.keyType} ${key.fingerprint}`).join("\n");

  const trust = async () => {
    setTrusting(true);
    setFailure(null);
    try {
      await onTrust(fingerprints);
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setTrusting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !trusting && onClose()}>
      <DialogContent
        closeDisabled={trusting}
        onEscapeKeyDown={(event) => trusting && event.preventDefault()}
        onPointerDownOutside={(event) => trusting && event.preventDefault()}
        className="z-[120] sm:max-w-lg"
        overlayClassName="z-[120]"
        data-testid="compute-host-key-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {prompt.changed
              ? t(($) => $.researchTools.compute.hostKey.changedTitle)
              : t(($) => $.researchTools.compute.hostKey.title)}
          </DialogTitle>
          <DialogDescription>
            {prompt.changed
              ? t(($) => $.researchTools.compute.hostKey.changed, { host: prompt.host })
              : t(($) => $.researchTools.compute.hostKey.body, { host: prompt.host })}
          </DialogDescription>
        </DialogHeader>
        {prompt.changed ? (
          <p className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
            <span>{prompt.host}</span>
          </p>
        ) : (
          <CopyableBlock source={listing}>
            <pre className="select-text overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed">
              {listing}
            </pre>
          </CopyableBlock>
        )}
        {failure ? (
          <p role="alert" className="select-text rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {failure}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={trusting} onClick={onClose}>
            {t(($) => $.researchTools.compute.form.cancel)}
          </Button>
          {prompt.changed || fingerprints.length === 0 ? null : (
            <Button type="button" disabled={trusting} onClick={() => void trust()} data-testid="compute-host-key-trust">
              {trusting ? <Spinner size="sm" aria-hidden /> : null}
              {t(($) => $.researchTools.compute.hostKey.trust)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
