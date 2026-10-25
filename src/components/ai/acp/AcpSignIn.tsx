import { useRef, useState } from "react";
import { KeyRound, SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  acpAuthenticate, acpDisconnect, acpReconnect, acpSignInCommand,
  type AcpAgentStatus, type AcpAuthMethod, type AcpSession,
} from "@/lib/acp";
import { describeError } from "@/lib/app-error";
import { useAcpSessionsStore } from "@/store/acp-sessions";

function isTerminalMethod(method: AcpAuthMethod): boolean {
  return method.kind === "terminal" || !!method.terminalCommand;
}

/**
 * Opens the agent's sign-in command in a project terminal. With `confirmText`
 * the terminal shows the whole command line first and the user must agree.
 */
export async function signInInTerminal(
  projectId: string | null,
  agentId: string,
  sessionId: string | null,
  methodId: string,
  confirmText?: string,
): Promise<void> {
  const [launch, { openTerminalWith }] = await Promise.all([
    acpSignInCommand(projectId, agentId, sessionId, methodId),
    import("@/lib/terminal-launch"),
  ]);
  await openTerminalWith({
    title: launch.title,
    command: launch.program,
    args: launch.args,
    env: launch.env,
    ...(confirmText ? { confirmText } : {}),
  });
}

/** Sign-in choices for an agent that needs one: terminal, API key or the agent's own flow. */
export function AcpSignIn({
  projectId,
  session,
  agent,
  busy,
  perform,
}: Readonly<{
  projectId: string;
  session: AcpSession;
  agent: AcpAgentStatus | undefined;
  busy: boolean;
  perform(action: () => Promise<void>): void;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const keyInput = useRef<HTMLInputElement>(null);
  const [terminalOpened, setTerminalOpened] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const apiMethod = session.authMethods.find((method) => method.apiKeyProvider);
  // A conversation on another machine signs in there; a terminal here would sign in the wrong one.
  const remote = !!session.remote;
  const agentName = agent?.definition.name ?? session.agentId;

  const openTerminal = (method: AcpAuthMethod) => {
    setNotice(null);
    const confirmText = t(($) => $.ai.acp.signIn.confirmTerminal, { agent: agentName });
    void signInInTerminal(projectId, session.agentId, session.id, method.id, confirmText)
      .then(() => setTerminalOpened(true))
      .catch(async (error: unknown) => {
        const { TerminalLaunchError } = await import("@/lib/terminal-launch");
        if (error instanceof TerminalLaunchError) {
          // The launcher already showed the tab-limit toast.
          if (error.reason === "no-project") setNotice(t(($) => $.ai.acp.signIn.noProject));
          else if (error.reason === "invalid") setNotice(error.message);
          return;
        }
        setNotice(describeError(error));
      });
  };

  const sendKey = (method: AcpAuthMethod) => {
    const input = keyInput.current;
    const key = input?.value.trim() ?? "";
    if (!key) {
      input?.focus();
      return;
    }
    perform(async () => {
      try {
        useAcpSessionsStore.getState().setSnapshot(await acpAuthenticate(projectId, session.id, method.id, key));
      } finally {
        if (keyInput.current) keyInput.current.value = "";
      }
    });
  };

  return (
    <div data-testid="acp-sign-in" className="space-y-2 border-t border-border p-3 text-xs">
      <p>{agent?.signInHint ?? t(($) => $.ai.acp.signInFallback)}</p>
      {remote && (
        <p data-testid="acp-sign-in-remote" className="text-muted-foreground">
          {t(($) => $.ai.acp.signIn.remote)}
        </p>
      )}
      {session.agentId === "gemini" && (
        <p className="text-muted-foreground">{t(($) => $.ai.acp.signIn.geminiGoogle)}</p>
      )}
      {apiMethod && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            sendKey(apiMethod);
          }}
        >
          <label className="sr-only" htmlFor={`acp-api-key-${session.id}`}>
            {t(($) => $.ai.acp.signIn.apiKeyLabel, { provider: apiMethod.apiKeyProvider ?? apiMethod.name })}
          </label>
          <Input
            id={`acp-api-key-${session.id}`}
            ref={keyInput}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={t(($) => $.ai.acp.signIn.apiKeyPlaceholder)}
            aria-label={t(($) => $.ai.acp.signIn.apiKeyLabel, { provider: apiMethod.apiKeyProvider ?? apiMethod.name })}
            className="h-7 min-w-0 flex-1 text-xs"
            disabled={busy}
          />
          <Button type="submit" variant="outline" size="sm" disabled={busy}>
            <KeyRound className="size-3.5" /> {apiMethod.name}
          </Button>
        </form>
      )}
      <div className="flex flex-wrap gap-2">
        {session.authMethods
          .filter((method) => !method.apiKeyProvider && !(remote && isTerminalMethod(method)))
          .map((method) =>
            isTerminalMethod(method) ? (
              <Button key={method.id} variant="outline" size="sm" type="button" disabled={busy} onClick={() => openTerminal(method)}>
                <SquareTerminal className="size-3.5" />
                {t(($) => $.ai.acp.signIn.inTerminal, { name: method.terminalCommand?.label ?? method.name })}
              </Button>
            ) : (
              <Button
                key={method.id}
                variant="outline"
                size="sm"
                type="button"
                disabled={busy}
                onClick={() => perform(async () => {
                  useAcpSessionsStore.getState().setSnapshot(await acpAuthenticate(projectId, session.id, method.id));
                })}
              >
                {method.name}
              </Button>
            ),
          )}
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={busy}
          onClick={() => perform(async () => {
            await acpDisconnect(projectId, session.id);
            useAcpSessionsStore.getState().setSnapshot(await acpReconnect(projectId, session.id));
          })}
        >
          {t(($) => $.ai.acp.reconnectAfterSignIn)}
        </Button>
      </div>
      {terminalOpened && <p className="text-muted-foreground">{t(($) => $.ai.acp.signIn.afterTerminal)}</p>}
      {notice && <p role="alert" className="text-destructive">{notice}</p>}
    </div>
  );
}
