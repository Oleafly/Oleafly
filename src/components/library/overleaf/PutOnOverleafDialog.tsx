import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloudUpload } from "lucide-react";
import { isImeEnter } from "@/components/ai/composer/ime";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { isOverleafError, overleafCreateFromLocal } from "@/lib/overleaf";
import type { ProjectInfo } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useOverleafImportStore } from "@/store/overleaf-import";
import { useSettingsStore } from "@/store/settings";

const EXPECTED = [
  "create_refused",
  "create_shared",
  "create_one_folder",
  "create_too_large",
  "create_unconfirmed",
  "sync_already_linked",
  "rate_limited",
];

export function PutOnOverleafDialog({
  project,
  onClose,
  onDone,
}: Readonly<{ project: ProjectInfo; onClose: () => void; onDone: (projectId: string) => void }>) {
  const { t } = useTranslation(["library"]);
  const server = useOverleafImportStore((state) => state.server);
  const status = useOverleafImportStore((state) => state.status);
  const refreshStatus = useOverleafImportStore((state) => state.refreshStatus);
  const [name, setName] = useState(project.name);
  const [account, setAccount] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const nameId = useId();

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const accounts = status?.accounts ?? [];
  const signedIn = status?.signedIn ?? false;
  const chosen = account ?? status?.userId ?? null;

  const dismiss = () => {
    if (!busyRef.current) onClose();
  };

  const submit = async () => {
    if (busyRef.current || !signedIn || !name.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await overleafCreateFromLocal(project.id, server, chosen, name);
      await useFilesStore.getState().refreshProjects();
      onDone(project.id);
    } catch (error_) {
      if (!EXPECTED.some((code) => isOverleafError(error_, code))) {
        void logError("put a project on overleaf", error_);
      }
      setError(error_);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogContent data-testid="put-on-overleaf-dialog" closeDisabled={busy} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(($) => $.library.import.overleaf.put.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.library.import.overleaf.put.description)}</DialogDescription>
        </DialogHeader>
        {status === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size="sm" />
            {t(($) => $.library.import.overleaf.checking)}
          </p>
        ) : null}
        {signedIn ? (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <label htmlFor={nameId} className="text-xs font-medium text-muted-foreground">
                {t(($) => $.library.import.overleaf.put.name)}
              </label>
              <Input
                id={nameId}
                data-testid="put-on-overleaf-name"
                value={name}
                maxLength={150}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !isImeEnter(event)) void submit();
                }}
              />
            </div>
            {accounts.length > 1 ? (
              <div className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t(($) => $.library.import.overleaf.put.account)}
                </span>
                <Select value={chosen ?? undefined} onValueChange={setAccount} disabled={busy}>
                  <SelectTrigger
                    data-testid="put-on-overleaf-account"
                    aria-label={t(($) => $.library.import.overleaf.put.account)}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((entry) => (
                      <SelectItem key={entry.userId} value={entry.userId}>
                        {entry.email ?? entry.userId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
        ) : null}
        {status !== null && !signedIn ? (
          <p data-testid="put-on-overleaf-signed-out" className="text-sm text-muted-foreground">
            {t(($) => $.library.import.overleaf.put.signedOut)}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="select-text text-sm text-destructive">
            {describeError(error)}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={dismiss}>
            {t(($) => $.library.import.overleaf.put.cancel)}
          </Button>
          {signedIn || status === null ? (
            <Button
              type="button"
              data-testid="put-on-overleaf-submit"
              disabled={busy || !signedIn || !name.trim()}
              onClick={() => void submit()}
            >
              {busy ? <Spinner size="sm" /> : <CloudUpload className="size-4" />}
              {busy
                ? t(($) => $.library.import.overleaf.put.working)
                : t(($) => $.library.import.overleaf.put.submit)}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => {
                onClose();
                useSettingsStore.getState().openSettingsAt("integrations");
              }}
            >
              {t(($) => $.library.import.overleaf.put.openSettings)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
