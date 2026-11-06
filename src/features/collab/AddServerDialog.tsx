import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Check, ExternalLink, Hash } from "lucide-react";
import { Copy, Github, KeyRound, Mail, Server } from "@/components/icons/pack";
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
import { useCopyStatus } from "@/components/ui/use-copy-status";
import { appModalCoordinator } from "@/components/ui/use-modal-accessibility";
import type {
  CollabCapabilities,
  CollabProvider,
  CollabServer,
  CollabSignInCode,
} from "@/lib/tauri";
import {
  collabServerProbe,
  collabServerSignInCancel,
  isCollabCommandError,
} from "@/lib/tauri-collab";
import { ConnectionChecks } from "./ConnectionChecks";
import { hasOleaflyServer, OLEAFLY_SERVER } from "./default-server";
import { collabErrorCode, collabErrorMessage, collabErrorText } from "./errors";
import { InlineAlert } from "./feedback";
import { useConnectionTest } from "./use-connection-test";
import { accountDetail, accountPerson } from "./people";
import { canManageServer, serverRoleAllows, toServerRole } from "./roles";
import { useCollabStore } from "./store";

type Step =
  | { kind: "address" }
  | { kind: "checking" }
  | { kind: "server"; url: string; capabilities: CollabCapabilities }
  | { kind: "signingIn"; url: string; capabilities: CollabCapabilities; provider: CollabProvider }
  | {
      kind: "code";
      url: string;
      capabilities: CollabCapabilities;
      code: CollabSignInCode | null;
      provider: CollabProvider | null;
    }
  | { kind: "done"; server: CollabServer };

export const CODE_OFFER_DELAY_MS = 20_000;

const SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;
const ADD_LINK = /^oleafly:\/\/server\/add\/?\?/i;

function addLinkTarget(link: string): string | null {
  if (!ADD_LINK.test(link)) return null;
  const query = link.slice(link.indexOf("?") + 1);
  const target = new URLSearchParams(query).get("url")?.trim() ?? "";
  return target === "" ? null : target;
}

export function normalizeServerAddress(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return "";
  const address = addLinkTarget(trimmed) ?? trimmed;
  return SCHEME.test(address) ? address : `https://${address}`;
}

const WELL_KNOWN = "/.well-known/oleafly-server";

// What went wrong when the first request to an address failed, in terms of
// what the person can do next. Most first-run mistakes reach the app as
// generic codes: a website answers 404, a captive portal answers with HTML,
// and a redirect arrives as `server` carrying the new location.
export type ProbeTrouble =
  | { kind: "notAServer" }
  | { kind: "moved"; target: string }
  | { kind: "unreachable" }
  | { kind: "other"; message: string };

function withoutTrailing(text: string, mark: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === mark) end -= 1;
  return text.slice(0, end);
}

// The server address a redirect from `probed` points at, read the way a
// browser reads a Location header: relative to the request, with or without
// a trailing slash. Null when it leads anywhere but another Oleafly server.
function movedTarget(location: string, probed: string): string | null {
  let resolved: URL;
  try {
    resolved = new URL(location, `${probed}${WELL_KNOWN}`);
  } catch {
    return null;
  }
  if (resolved.protocol !== "https:") return null;
  const path = withoutTrailing(resolved.pathname, "/");
  if (!path.endsWith(WELL_KNOWN)) return null;
  return `${resolved.origin}${path.slice(0, -WELL_KNOWN.length)}`;
}

export function probeTrouble(error: unknown, probed: string): ProbeTrouble {
  const code = collabErrorCode(error);
  const said = isCollabCommandError(error) ? error.message.trim() : "";
  if (code === "server" && (said.startsWith("https://") || said.startsWith("/"))) {
    const target = movedTarget(said, probed);
    return target ? { kind: "moved", target } : { kind: "notAServer" };
  }
  if (code === "server" && said !== "" && !said.startsWith("<")) {
    return { kind: "other", message: collabErrorText(error) };
  }
  if (code === "not_found" || code === "server" || code === "invalid") return { kind: "notAServer" };
  if (code === "unreachable") return { kind: "unreachable" };
  return { kind: "other", message: collabErrorText(error) };
}

function ProviderIcon({ provider }: Readonly<{ provider: CollabProvider }>) {
  if (provider.kind === "github") return <Github aria-hidden />;
  if (provider.kind === "email_link") return <Mail aria-hidden />;
  return <KeyRound aria-hidden />;
}

function cancelPendingSignIn() {
  collabServerSignInCancel().catch(() => undefined);
}

function codePageLink(code: CollabSignInCode, provider: CollabProvider | null): string {
  if (!provider) return code.verificationUriComplete;
  try {
    const link = new URL(code.verificationUriComplete);
    link.searchParams.set("provider", provider.id);
    return link.toString();
  } catch {
    return code.verificationUriComplete;
  }
}

function CodeValue({
  label,
  value,
  large,
  copied,
  onCopy,
}: Readonly<{ label: string; value: string; large: boolean; copied: boolean; onCopy: () => void }>) {
  const { t } = useTranslation(["common"]);
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <span
          className={
            large
              ? "min-w-0 flex-1 select-all font-mono text-xl tracking-widest"
              : "min-w-0 flex-1 select-all break-all font-mono text-xs"
          }
        >
          {value}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onCopy}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? t(($) => $.common.actions.copied) : t(($) => $.common.actions.copy)}
        </Button>
      </div>
    </div>
  );
}

export function AddServerDialog({
  open,
  initialUrl,
  onClose,
}: Readonly<{ open: boolean; initialUrl: string | null; onClose: () => void }>) {
  const { t, i18n } = useTranslation(["collab", "common"]);
  const signIn = useCollabStore((state) => state.signIn);
  const signInWithCode = useCollabStore((state) => state.signInWithCode);
  const servers = useCollabStore((state) => state.servers);
  const { copiedText, copy } = useCopyStatus();
  const addressId = useId();
  const setupId = useId();
  const oleaflyNameId = useId();
  const oleaflyDescriptionId = useId();
  const offerOleafly = (initialUrl ?? "").trim() === "" && !hasOleaflyServer(servers);
  const attempt = useRef(0);
  const [address, setAddress] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [step, setStep] = useState<Step>({ kind: "address" });
  const [error, setError] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<ProbeTrouble | null>(null);
  const [codeHint, setCodeHint] = useState<CollabProvider | null>(null);
  const [offerCode, setOfferCode] = useState(false);
  const waiting = step.kind === "signingIn";
  const {
    test: connectionTest,
    run: runConnectionTest,
    reset: resetConnectionTest,
  } = useConnectionTest(normalizeServerAddress(address));

  const probe = useCallback(async (raw: string) => {
    const url = normalizeServerAddress(raw);
    if (url === "") return;
    const current = ++attempt.current;
    setError(null);
    setTrouble(null);
    resetConnectionTest();
    setStep({ kind: "checking" });
    try {
      const capabilities = await collabServerProbe(url);
      if (current !== attempt.current) return;
      setStep({ kind: "server", url, capabilities });
    } catch (error_) {
      if (current !== attempt.current) return;
      setTrouble(probeTrouble(error_, url));
      setStep({ kind: "address" });
    }
  }, [resetConnectionTest]);

  const tryAddress = (target: string) => {
    setAddress(target);
    void probe(target);
  };

  const renderTrouble = () => {
    if (!trouble) return null;
    if (trouble.kind === "other") return <InlineAlert>{trouble.message}</InlineAlert>;
    if (trouble.kind === "notAServer") return <InlineAlert>{t(($) => $.collab.addServer.notAServer)}</InlineAlert>;
    if (trouble.kind === "moved") {
      return (
        <div className="space-y-2">
          <InlineAlert>{t(($) => $.collab.addServer.moved, { target: trouble.target })}</InlineAlert>
          <Button type="button" variant="outline" size="sm" onClick={() => tryAddress(trouble.target)}>
            {t(($) => $.collab.addServer.useMoved)}
          </Button>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        <InlineAlert>{collabErrorMessage("unreachable")}</InlineAlert>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={connectionTest.state === "running"}
          onClick={() => void runConnectionTest()}
        >
          {t(($) => $.collab.section.server.test)}
        </Button>
        {connectionTest.state === "running" ? (
          <LoadingState size="compact" label={t(($) => $.collab.section.checks.running)} />
        ) : null}
        {connectionTest.state === "done" ? <ConnectionChecks checks={connectionTest.checks} /> : null}
        {connectionTest.state === "failed" ? <InlineAlert>{connectionTest.message}</InlineAlert> : null}
      </div>
    );
  };

  const startSignIn = async (url: string, capabilities: CollabCapabilities, provider: CollabProvider) => {
    const current = ++attempt.current;
    setError(null);
    setCodeHint(null);
    setStep({ kind: "signingIn", url, capabilities, provider });
    try {
      const server = await signIn(url, provider.id, capabilities.needs_setup ? setupCode.trim() : undefined);
      if (current !== attempt.current) return;
      setStep({ kind: "done", server });
    } catch (error_) {
      if (current !== attempt.current) return;
      const code = collabErrorCode(error_);
      setError(collabErrorText(error_));
      setCodeHint(code === "sign_in_timed_out" ? provider : null);
      setStep({ kind: "server", url, capabilities });
    }
  };

  const startCodeSignIn = async (
    url: string,
    capabilities: CollabCapabilities,
    provider: CollabProvider | null,
  ) => {
    const current = ++attempt.current;
    setError(null);
    setCodeHint(null);
    setStep({ kind: "code", url, capabilities, code: null, provider });
    try {
      const server = await signInWithCode(
        url,
        capabilities.needs_setup ? setupCode.trim() : undefined,
        (code) => {
          if (current === attempt.current) setStep({ kind: "code", url, capabilities, code, provider });
        },
      );
      if (current !== attempt.current) return;
      setStep({ kind: "done", server });
    } catch (error_) {
      if (current !== attempt.current) return;
      setError(collabErrorText(error_));
      setCodeHint(collabErrorCode(error_) === "sign_in_timed_out" ? provider : null);
      setStep({ kind: "server", url, capabilities });
    }
  };

  const switchToCode = async (url: string, capabilities: CollabCapabilities, provider: CollabProvider) => {
    attempt.current += 1;
    await collabServerSignInCancel().catch(() => undefined);
    await startCodeSignIn(url, capabilities, provider);
  };

  const goTo = (next: Step) => {
    attempt.current += 1;
    setError(null);
    setTrouble(null);
    setCodeHint(null);
    setStep(next);
  };

  const cancelWaiting = (url: string, capabilities: CollabCapabilities) => {
    cancelPendingSignIn();
    goTo({ kind: "server", url, capabilities });
  };

  const close = () => {
    if (step.kind === "signingIn" || step.kind === "code") cancelPendingSignIn();
    attempt.current += 1;
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    attempt.current += 1;
    setAddress(initialUrl ?? "");
    setSetupCode("");
    setError(null);
    setTrouble(null);
    setCodeHint(null);
    resetConnectionTest();
    setStep({ kind: "address" });
    if (initialUrl) void probe(initialUrl);
  }, [open, initialUrl, probe, resetConnectionTest]);

  useEffect(() => {
    setOfferCode(false);
    if (!waiting) return;
    const timer = setTimeout(() => setOfferCode(true), CODE_OFFER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

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
      {offerOleafly ? (
        <Button
          type="button"
          variant="outline"
          className="h-auto w-full justify-start gap-3 whitespace-normal p-3 text-left"
          aria-labelledby={oleaflyNameId}
          aria-describedby={oleaflyDescriptionId}
          disabled={step.kind === "checking"}
          onClick={() => tryAddress(OLEAFLY_SERVER.url)}
        >
          <Avatar person={{ id: OLEAFLY_SERVER.url, name: OLEAFLY_SERVER.name }} size="md" fallbackIcon={<Server />} />
          <span className="min-w-0">
            <span id={oleaflyNameId} className="block truncate text-sm font-medium">
              {OLEAFLY_SERVER.name}
            </span>
            <span id={oleaflyDescriptionId} className="block text-xs font-normal text-muted-foreground">
              {t(($) => $.collab.addServer.oleaflyDescription)}
            </span>
          </span>
        </Button>
      ) : null}
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
      {step.kind === "address" ? renderTrouble() : null}
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
        ) : null}
        <div className="space-y-2">
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
                  onClick={() => void startSignIn(url, capabilities, provider)}
                >
                  <ProviderIcon provider={provider} />
                  {t(($) => $.collab.addServer.continueWith, { provider: provider.label })}
                </Button>
              ))}
            </div>
          )}
        </div>
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        {codeHint ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-muted-foreground">{t(($) => $.collab.addServer.codeHint)}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={codeMissing}
              onClick={() => void startCodeSignIn(url, capabilities, codeHint)}
            >
              <Hash aria-hidden />
              {t(($) => $.collab.addServer.codeSignIn)}
            </Button>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => goTo({ kind: "address" })}>
            {t(($) => $.collab.addServer.back)}
          </Button>
        </DialogFooter>
      </div>
    );
  };

  const renderWaiting = (url: string, capabilities: CollabCapabilities, provider: CollabProvider) => (
    <div className="space-y-4">
      <output className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
        <Spinner />
        <span className="min-w-0 text-sm font-medium">{t(($) => $.collab.addServer.waitingTitle)}</span>
      </output>
      {offerCode ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">{t(($) => $.collab.addServer.codeOffer)}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void switchToCode(url, capabilities, provider)}
          >
            <Hash aria-hidden />
            {t(($) => $.collab.addServer.codeSignIn)}
          </Button>
        </div>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => cancelWaiting(url, capabilities)}>
          {t(($) => $.collab.addServer.cancel)}
        </Button>
      </DialogFooter>
    </div>
  );

  const renderCode = (
    url: string,
    capabilities: CollabCapabilities,
    code: CollabSignInCode | null,
    provider: CollabProvider | null,
  ) => (
    <div className="space-y-4">
      {code === null ? (
        <LoadingState size="compact" label={t(($) => $.collab.addServer.codeRequesting)} />
      ) : (
        <>
          <CodeValue
            label={t(($) => $.collab.addServer.codeAddressLabel)}
            value={code.verificationUri}
            large={false}
            copied={copiedText === code.verificationUri}
            onCopy={() => void copy(code.verificationUri)}
          />
          <CodeValue
            label={t(($) => $.collab.addServer.codeLabel)}
            value={code.userCode}
            large
            copied={copiedText === code.userCode}
            onCopy={() => void copy(code.userCode)}
          />
          <p className="text-xs text-muted-foreground">
            {t(($) => $.collab.addServer.codeExpires, {
              time: new Date(code.expiresAt).toLocaleTimeString(i18n.language, { hour: "numeric", minute: "2-digit" }),
            })}
          </p>
          <output className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner />
            {t(($) => $.collab.addServer.codeWaiting)}
          </output>
        </>
      )}
      <DialogFooter>
        {code ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => void openExternal(codePageLink(code, provider)).catch(() => undefined)}
          >
            <ExternalLink aria-hidden />
            {t(($) => $.collab.addServer.codeOpen)}
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={() => cancelWaiting(url, capabilities)}>
          {t(($) => $.collab.addServer.cancel)}
        </Button>
      </DialogFooter>
    </div>
  );

  const renderDone = (server: CollabServer) => {
    const account = server.account ?? null;
    const detail = account ? accountDetail(account) : "";
    return (
      <div className="space-y-4">
        {account && detail !== "" ? (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <Avatar person={accountPerson(account)} size="md" />
            <p className="min-w-0 truncate text-sm">{detail}</p>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" onClick={close}>
            {t(($) => $.collab.addServer.done)}
          </Button>
        </DialogFooter>
      </div>
    );
  };

  const connectedDescription = (server: CollabServer) => {
    const role = toServerRole(server.account?.server_role);
    const name = server.account?.display_name ?? server.name;
    if (canManageServer(role)) return t(($) => $.collab.addServer.doneManageDescription, { name });
    const laterRole = server.account != null && role === null;
    if (laterRole || (role !== null && !serverRoleAllows(role, "shareProjects"))) {
      return t(($) => $.collab.addServer.doneGuestDescription, { name });
    }
    return t(($) => $.collab.addServer.doneDescription, { name });
  };

  const header = (): { title: string; description: string } => {
    switch (step.kind) {
      case "address":
      case "checking":
        return { title: t(($) => $.collab.addServer.title), description: t(($) => $.collab.addServer.description) };
      case "server":
        return step.capabilities.needs_setup
          ? {
              title: t(($) => $.collab.addServer.setupTitle, { server: step.capabilities.name }),
              description: t(($) => $.collab.addServer.setupDescription),
            }
          : {
              title: t(($) => $.collab.addServer.serverTitle, { server: step.capabilities.name }),
              description: t(($) => $.collab.addServer.serverDescription),
            };
      case "signingIn":
        return {
          title: t(($) => $.collab.addServer.signingInTitle),
          description:
            step.provider.kind === "email_link"
              ? t(($) => $.collab.addServer.waitingEmailDescription)
              : t(($) => $.collab.addServer.waitingDescription, { provider: step.provider.label }),
        };
      case "code":
        return { title: t(($) => $.collab.addServer.codeTitle), description: t(($) => $.collab.addServer.codeSteps) };
      case "done":
        return {
          title: t(($) => $.collab.addServer.doneTitle, { server: step.server.name }),
          description: connectedDescription(step.server),
        };
    }
  };

  const { title, description } = header();

  const renderStep = () => {
    switch (step.kind) {
      case "address":
      case "checking":
        return renderAddress();
      case "server":
        return renderServer(step.url, step.capabilities);
      case "signingIn":
        return renderWaiting(step.url, step.capabilities, step.provider);
      case "code":
        return renderCode(step.url, step.capabilities, step.code, step.provider);
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {renderStep()}
      </DialogContent>
    </Dialog>
  );
}
