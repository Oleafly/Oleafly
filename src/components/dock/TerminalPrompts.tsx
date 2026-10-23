import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { CodeBlock } from "@/components/ui/code-block";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  type ActiveTerminalPrompt,
  registerTerminalPromptHost,
  type TerminalStopReason,
  useTerminalPromptStore,
} from "@/lib/terminal-lifecycle";
import { useSettingsStore } from "@/store/settings";

type StopPrompt = Extract<ActiveTerminalPrompt, { kind: "stop" }>;
type LaunchPrompt = Extract<ActiveTerminalPrompt, { kind: "launch" }>;

/**
 * Renders the terminal prompts while mounted. The dialogs go to the document
 * body: the dock may be hidden (and so invisible) when a project closes or
 * the app quits.
 */
export function TerminalPrompts() {
  const prompt = useTerminalPromptStore((state) => state.prompt);
  useEffect(() => registerTerminalPromptHost(), []);
  if (!prompt || typeof document === "undefined") return null;
  return createPortal(
    prompt.kind === "stop" ? (
      <StopDialog key={prompt.id} prompt={prompt} />
    ) : (
      <LaunchDialog key={prompt.id} prompt={prompt} />
    ),
    document.body,
  );
}

function useStopConfirmLabel(reason: TerminalStopReason, many: boolean): string {
  const { t } = useTranslation(["workspace"]);
  switch (reason) {
    case "close-project":
      return t(($) => $.workspace.terminal.stop.closeProject);
    case "switch-project":
      return t(($) => $.workspace.terminal.stop.switchProject);
    case "quit":
      return t(($) => $.workspace.terminal.stop.quit);
    case "restart":
      return t(($) => $.workspace.terminal.stop.restart);
    default:
      return many
        ? t(($) => $.workspace.terminal.stop.closeMany)
        : t(($) => $.workspace.terminal.stop.closeOne);
  }
}

function StopDialog({ prompt }: Readonly<{ prompt: StopPrompt }>) {
  const { t } = useTranslation(["workspace"]);
  const [dontAsk, setDontAsk] = useState(false);
  const checkboxId = useId();
  const many = prompt.jobs.length > 1;
  const confirmLabel = useStopConfirmLabel(prompt.reason, many);
  const [job] = prompt.jobs;
  let description: string;
  if (many) {
    description = t(($) => $.workspace.terminal.stop.many, { count: prompt.jobs.length });
  } else if (job?.process) {
    description = t(($) => $.workspace.terminal.stop.named, { process: job.process, title: job.title });
  } else {
    description = t(($) => $.workspace.terminal.stop.unnamed, { title: job?.title ?? "" });
  }
  const answer = (ok: boolean) => {
    if (ok && dontAsk) useSettingsStore.getState().setTerminalConfirmClose(false);
    useTerminalPromptStore.getState().answer(prompt.id, ok);
  };
  return (
    <ConfirmationDialog
      open
      destructive
      title={many ? t(($) => $.workspace.terminal.stop.titleMany) : t(($) => $.workspace.terminal.stop.titleOne)}
      description={description}
      confirmLabel={confirmLabel}
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    >
      <label htmlFor={checkboxId} className="mt-4 flex items-center gap-2 text-xs">
        <Checkbox
          id={checkboxId}
          checked={dontAsk}
          onCheckedChange={(checked) => setDontAsk(checked === true)}
        />
        {t(($) => $.workspace.terminal.stop.dontAsk)}
      </label>
      <p className="mt-1 pl-6 text-xs text-muted-foreground">
        {t(($) => $.workspace.terminal.stop.dontAskHint)}
      </p>
    </ConfirmationDialog>
  );
}

function LaunchDialog({ prompt }: Readonly<{ prompt: LaunchPrompt }>) {
  const { t } = useTranslation(["workspace"]);
  const answer = (ok: boolean) => useTerminalPromptStore.getState().answer(prompt.id, ok);
  return (
    <ConfirmationDialog
      open
      // The terminal has just taken focus; a stray Enter must back out, not run the command.
      confirmOnEnter={false}
      title={t(($) => $.workspace.terminal.launch.title)}
      description={prompt.description}
      confirmLabel={t(($) => $.workspace.terminal.launch.run)}
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    >
      <CodeBlock code={prompt.commandLine} className="mt-3" data-testid="terminal-launch-command" />
    </ConfirmationDialog>
  );
}
