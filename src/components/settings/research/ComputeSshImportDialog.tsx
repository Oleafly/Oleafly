import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { sshConfigHosts, type ComputeTarget, type SshConfigHost } from "./compute-api";

function hostDetails(host: SshConfigHost) {
  const user = host.user ? `${host.user}@` : "";
  const port = host.port ? `:${host.port}` : "";
  return `${user}${host.hostName ?? host.alias}${port}`;
}

/** A new SSH target that uses the config alias, so the user's own settings apply. */
export function targetFromHost(host: SshConfigHost): ComputeTarget {
  return {
    kind: "ssh",
    id: "",
    label: host.alias,
    host: host.alias,
    user: null,
    port: null,
    remoteRoot: null,
    prelude: "",
  };
}

/** Picks hosts from the user's SSH config (read only) and adds them in order. */
export function ComputeSshImportDialog({
  existing,
  onClose,
  onImport,
}: Readonly<{
  existing: readonly ComputeTarget[];
  onClose: () => void;
  onImport: (targets: ComputeTarget[]) => Promise<void>;
}>) {
  const { t } = useTranslation(["researchTools"]);
  const [hosts, setHosts] = useState<SshConfigHost[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void sshConfigHosts()
      .then((found) => {
        if (live) setHosts(found);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setHosts([]);
        setFailure(describeError(error));
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modalId = appModalCoordinator.add(opener);
    return () => {
      appModalCoordinator.remove(modalId)?.focus({ preventScroll: true });
    };
  }, []);

  const added = new Set(
    existing.flatMap((target) => (target.kind === "cuaSpace" ? [] : [target.host.toLowerCase()])),
  );
  const chosen = (hosts ?? []).filter((host) => selected.has(host.alias));

  const importChosen = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await onImport(chosen.map(targetFromHost));
      onClose();
    } catch (error) {
      setFailure(describeError(error));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        closeDisabled={busy}
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onPointerDownOutside={(event) => busy && event.preventDefault()}
        className="z-[120] max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg"
        overlayClassName="z-[120]"
        data-testid="compute-ssh-import-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t(($) => $.researchTools.compute.import.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.researchTools.compute.import.body)}</DialogDescription>
        </DialogHeader>
        {hosts === null ? (
          <div className="flex justify-center py-4">
            <Spinner aria-hidden />
          </div>
        ) : null}
        {hosts && hosts.length === 0 && !failure ? (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            {t(($) => $.researchTools.compute.import.none)}
          </p>
        ) : null}
        {hosts && hosts.length > 0 ? (
          <ul className="space-y-2">
            {hosts.map((host, index) => {
              const id = `compute-ssh-import-${index}`;
              const already = added.has(host.alias.toLowerCase());
              return (
                <li key={host.alias}>
                  <label
                    htmlFor={id}
                    className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:disabled]:cursor-default has-[:disabled]:opacity-60"
                  >
                    <Checkbox
                      id={id}
                      className="mt-0.5"
                      disabled={already || busy}
                      checked={already || selected.has(host.alias)}
                      onCheckedChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked === true) next.add(host.alias);
                          else next.delete(host.alias);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 space-y-0.5">
                      <span className="block text-sm font-medium">{host.alias}</span>
                      <span className="block break-all text-xs text-muted-foreground">
                        {already ? t(($) => $.researchTools.compute.import.added) : hostDetails(host)}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : null}
        {failure ? (
          <p role="alert" className="select-text rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {failure}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t(($) => $.researchTools.compute.form.cancel)}
          </Button>
          <Button
            type="button"
            disabled={busy || chosen.length === 0}
            onClick={() => void importChosen()}
            data-testid="compute-ssh-import-add"
          >
            {busy ? <Spinner size="sm" aria-hidden /> : null}
            {t(($) => $.researchTools.compute.import.add, { count: chosen.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
