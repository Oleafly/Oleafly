import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Github, KeyRound, Mail, Server } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingState } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { appModalCoordinator } from "@/components/ui/use-modal-accessibility";
import {
  collabServerProbe,
  collabServerSignInCancel,
  type CollabCapabilities,
  type CollabProvider,
  type CollabServer,
} from "@/lib/tauri";
import { collabErrorCode, collabErrorMessage } from "./errors";
import { InlineAlert } from "./feedback";
import { accountPerson } from "./people";
import { useCollabStore } from "./store";

type Step =
  | { kind: "address" }
  | { kind: "checking" }
  | { kind: "server"; url: string; capabilities: CollabCapabilities }
  | { kind: "signingIn"; url: string; capabilities: CollabCapabilities }
  | { kind: "done"; server: CollabServer };

const SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

export function normalizeServerAddress(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return "";
  return SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function ProviderIcon({ provider }: Readonly<{ provider: CollabProvider }>) {
  if (provider.kind === "github") return <Github aria-hidden />;
  if (provider.kind === "email_link") return <Mail aria-hidden />;
  return <KeyRound aria-hidden />;
}

function cancelPendingSignIn() {
  collabServerSignInCancel().catch(() => undefined);
}

export function AddServerDialog({
  open,
  initialUrl,
  onClose,
}: Readonly<{ open: boolean; initialUrl: string | null; onClose: () => void }>) {
  const { t } = useTranslation(["collab", "common"]);
  const signIn = useCollabStore((state) => state.signIn);
  const addressId = useId();
  const setupId = useId();
  const attempt = useRef(0);
  const [address, setAddress] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [step, setStep] = useState<Step>({ kind: "address" });
  const [error, setError] = useState<string | null>(null);

  const probe = useCallback(async (raw: string) => {
    const url = normalizeServerAddress(raw);
    if (url === "") return;
    const current = ++attempt.current;
    setError(null);
    setStep({ kind: "checking" });
    try {
      const capabilities = await collabServerProbe(url);
      if (current !== attempt.current) return;
      setStep({ kind: "server", url, capabilities });
    } catch (failure) {
      if (current !== attempt.current) return;
      setError(collabErrorMessage(collabErrorCode(failure)));
      setStep({ kind: "address" });
    }
  }, []);

  const startSignIn = async (url: string, capabilities: CollabCapabilities, providerId: string) => {
    const current = ++attempt.current;
    setError(null);
    setStep({ kind: "signingIn", url, capabilities });
    try {
      const server = await signIn(url, providerId, capabilities.needs_setup ? setupCode.trim() : undefined);
      if (current !== attempt.current) return;
      setStep({ kind: "done", server });
    } catch (failure) {
      if (current !== attempt.current) return;
      setError(collabErrorMessage(collabErrorCode(failure)));
      setStep({ kind: "server", url, capabilities });
    }
  };

  const goTo = (next: Step) => {
    attempt.current += 1;
    setError(null);
    setStep(next);
  };

  const cancelWaiting = (url: string, capabilities: CollabCapabilities) => {
    cancelPendingSignIn();
    goTo({ kind: "server", url, capabilities });
  };

  const close = () => {
    if (step.kind === "signingIn") cancelPendingSignIn();
    attempt.current += 1;
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    attempt.current += 1;
    setAddress(initialUrl ?? "");
    setSetupCode("");
    setError(null);
    setStep({ kind: "address" });
    if (initialUrl) void probe(initialUrl);
  }, [open, initialUrl, probe]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modalId = appModalCoordinator.add(opener);
    return () => {
      appModalCoordinator.remove(modalId)?.focus({ preventScroll: true });
    };
  }, [open]);

  const renderAddress = () => (
    <form
      className="space-y-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void probe(address);
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor={addressId} className="text-xs font-medium">
          {t(($) => $.collab.addServer.addressLabel)}
        </label>
        <Input
          id={addressId}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder={t(($) => $.collab.addServer.addressPlaceholder)}
          autoComplete="url"
          spellCheck={false}
          disabled={step.kind === "checking"}
        />
      </div>
      {step.kind === "checking" ? (
        <LoadingState size="compact" label={t(($) => $.collab.addServer.checking)} />
      ) : null}
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close}>
          {t(($) => $.common.actions.cancel)}
        </Button>
        <Button type="submit" disabled={step.kind === "checking" || normalizeServerAddress(address) === ""}>
          {t(($) => $.collab.addServer.continue)}
        </Button>
      </DialogFooter>
    </form>
  );

  const renderServer = (url: string, capabilities: CollabCapabilities) => {
    const codeMissing = capabilities.needs_setup && setupCode.trim() === "";
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
          <Avatar
            person={{ id: capabilities.server_id, name: capabilities.name, imageUrl: capabilities.icon_url }}
            size="md"
            fallbackIcon={<Server />}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{capabilities.name}</p>
            <p className="truncate text-xs text-muted-foreground">{url}</p>
            <p className="text-[0.6875rem] text-muted-foreground">
              {t(($) => $.collab.addServer.version, { version: capabilities.version })}
            </p>
          </div>
        </div>
        {capabilities.needs_setup ? (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t(($) => $.collab.addServer.setupTitle)}</p>
            <p className="text-xs text-muted-foreground">{t(($) => $.collab.addServer.setupDescription)}</p>
            <div className="space-y-1">
              <label htmlFor={setupId} className="text-xs font-medium">
                {t(($) => $.collab.addServer.setupCodeLabel)}
              </label>
              <Input
                id={setupId}
                value={setupCode}
                onChange={(event) => setSetupCode(event.target.value)}
                autoComplete="one-time-code"
                spellCheck={false}
                className="font-mono"
              />
            </div>
          </div>
        ) : null}
        <div className="space-y-2">
          <p className="text-sm font-medium">{t(($) => $.collab.addServer.signInTitle)}</p>
          <p className="text-xs text-muted-foreground">{t(($) => $.collab.addServer.signInDescription)}</p>
          {capabilities.providers.length === 0 ? (
            <InlineAlert>{t(($) => $.collab.addServer.noProviders)}</InlineAlert>
          ) : (
            <div className="flex flex-col gap-2">
              {capabilities.providers.map((provider) => (
                <Button
                  key={provider.id}
                  type="button"
                  variant="outline"
                  disabled={codeMissing}
                  onClick={() => void startSignIn(url, capabilities, provider.id)}
                >
                  <ProviderIcon provider={provider} />
                  {t(($) => $.collab.addServer.continueWith, { provider: provider.label })}
                </Button>
              ))}
            </div>
          )}
        </div>
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => goTo({ kind: "address" })}>
            {t(($) => $.collab.addServer.back)}
          </Button>
        </DialogFooter>
      </div>
    );
  };

  const renderWaiting = (url: string, capabilities: CollabCapabilities) => (
    <div className="space-y-4">
      <output className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
        <Spinner className="mt-0.5" />
        <span className="min-w-0">
          <span className="block text-sm font-medium">{t(($) => $.collab.addServer.waitingTitle)}</span>
          <span className="block text-xs text-muted-foreground">
            {t(($) => $.collab.addServer.waitingDescription)}
          </span>
        </span>
      </output>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => cancelWaiting(url, capabilities)}>
          {t(($) => $.collab.addServer.cancel)}
        </Button>
      </DialogFooter>
    </div>
  );

  const renderDone = (server: CollabServer) => {
    const account = server.account ?? null;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
          {account ? <Avatar person={accountPerson(account)} size="md" /> : null}
          <div className="min-w-0">
            <p className="text-sm font-medium">{t(($) => $.collab.addServer.doneTitle)}</p>
            <p className="text-xs text-muted-foreground">
              {t(($) => $.collab.addServer.doneDescription, {
                server: server.name,
                name: account?.display_name ?? server.name,
              })}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={close}>
            {t(($) => $.collab.addServer.done)}
          </Button>
        </DialogFooter>
      </div>
    );
  };

  const renderStep = () => {
    switch (step.kind) {
      case "address":
      case "checking":
        return renderAddress();
      case "server":
        return renderServer(step.url, step.capabilities);
      case "signingIn":
        return renderWaiting(step.url, step.capabilities);
      case "done":
        return renderDone(step.server);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        className="z-[120] max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-md"
        overlayClassName="z-[120]"
      >
        <DialogHeader>
          <DialogTitle>{t(($) => $.collab.addServer.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.collab.addServer.description)}</DialogDescription>
        </DialogHeader>
        {renderStep()}
      </DialogContent>
    </Dialog>
  );
}
