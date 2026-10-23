import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, type ReactNode } from "react";
import { Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ChatComposer, type ChatComposerHandle, type MentionItem, type SlashItem,
} from "@/components/ai/composer/ChatComposer";
import { buildMentionEntries } from "@/components/ai/MentionMenu";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { acpCancel, acpError, acpUsable, type AcpAgentStatus, type AcpSession } from "@/lib/acp";
import { mentionInsertText } from "@/lib/composer-tokens";
import { logError } from "@/lib/log";
import { isSkillAvailable, useSkills } from "@/lib/skills";
import { acpComposerId, useAcpSessionsStore, type AcpPromptDraft } from "@/store/acp-sessions";
import { EMPTY_ATTACHMENTS, useComposerDrafts } from "@/store/composer-drafts";
import { useFilesStore } from "@/store/files";
import { acpAttachmentKinds, acpMentionItems, acpSlashItems, composerMode } from "./acp-composer";
import { settleSelectionQuotes, unsettleSelectionQuote, useSelectionQuote } from "./selection-quote";

/** The composer a conversation's draft lives in; before one starts, the chosen agent's. */
export function acpDraftId(projectId: string, agentId: string | null, session: AcpSession | undefined): string {
  return session ? acpComposerId(projectId, session.agentId, session.id) : acpComposerId(projectId, agentId);
}

/** A snapshot of what the composer would send, and a way to clear it. */
function takeDraft(projectId: string, composerId: string): AcpPromptDraft {
  const draft = useComposerDrafts.getState().drafts[composerId];
  const composer = useAcpSessionsStore.getState().composers[projectId];
  return {
    text: draft?.text ?? "",
    // A file that could not be prepared stays out of the message, as in the
    // built-in composer. Clearing the draft removes its chip.
    attachments: (draft?.attachments ?? EMPTY_ATTACHMENTS).filter((item) => item.status === "ready"),
    mentions: [],
    selections: [...(composer?.selections ?? [])],
    skill: composer?.skill ?? null,
  };
}

function clearDraft(projectId: string, composerId: string): void {
  const drafts = useComposerDrafts.getState();
  drafts.setText(composerId, "");
  drafts.setAttachments(composerId, []);
  settleSelectionQuotes(projectId, useAcpSessionsStore.getState().composers[projectId]?.selections ?? []);
  useAcpSessionsStore.getState().setComposer(projectId, { skill: null, selections: [] });
}

/**
 * Puts a draft back after a failed send or start. What the user has typed
 * since stays: the restored text goes before it, and files join the ones
 * already attached.
 */
export function restoreDraft(projectId: string, composerId: string, draft: AcpPromptDraft): void {
  const drafts = useComposerDrafts.getState();
  const current = drafts.drafts[composerId];
  if (draft.text && !current?.text) drafts.setText(composerId, draft.text);
  else if (draft.text) drafts.setText(composerId, `${draft.text}\n\n${current?.text ?? ""}`);
  const known = new Set((current?.attachments ?? EMPTY_ATTACHMENTS).map((item) => item.id));
  drafts.addAttachments(composerId, draft.attachments.filter((item) => !known.has(item.id)));
  const composer = useAcpSessionsStore.getState().composers[projectId];
  if (!composer?.selections?.length && draft.selections.length > 0) unsettleSelectionQuote(projectId);
  useAcpSessionsStore.getState().setComposer(projectId, {
    skill: composer?.skill ?? draft.skill,
    selections: composer?.selections?.length ? composer.selections : draft.selections,
  });
}

function isEmpty(draft: AcpPromptDraft): boolean {
  return !draft.text.trim() && draft.attachments.length === 0 && draft.selections.length === 0 && !draft.skill;
}

export interface AcpComposerProps {
  projectId: string;
  session: AcpSession | undefined;
  agent: AcpAgentStatus | undefined;
  agentId: string | null;
  onStart(draft: AcpPromptDraft): void;
  /** A message is about to go to the agent. */
  onSend(): void;
  onError(message: string | null): void;
  leftControls: ReactNode;
  trailingControls?: ReactNode;
}

/** The CLI-agent composer: B's ChatComposer with the agent's commands, queueing and quotes. */
export const AcpComposer = forwardRef<ChatComposerHandle, AcpComposerProps>(function AcpComposer(
  { projectId, session, agent, agentId, onStart, onSend, onError, leftControls, trailingControls },
  ref,
) {
  const { t } = useTranslation(["common", "ai"]);
  const inner = useRef<ChatComposerHandle>(null);
  useImperativeHandle(ref, () => ({
    focus: () => inner.current?.focus(),
    setCaret: (position) => inner.current?.setCaret(position),
    insertText: (text) => inner.current?.insertText(text),
    openFilePicker: () => inner.current?.openFilePicker(),
  }), []);
  const composerId = acpDraftId(projectId, agentId, session);
  const text = useComposerDrafts((state) => state.drafts[composerId]?.text ?? "");
  const attachments = useComposerDrafts((state) => state.drafts[composerId]?.attachments ?? EMPTY_ATTACHMENTS);
  const tree = useFilesStore((state) => state.tree);
  const skillsQuery = useSkills(projectId);
  const sending = useAcpSessionsStore((state) => (session ? (state.sending[session.id] ?? 0) > 0 : false));
  const mode = composerMode(session, !!agent && acpUsable(agent), sending);
  const running = session?.status === "running" || session?.status === "cancelling";

  const setText = useCallback(
    (value: string) => useComposerDrafts.getState().setText(composerId, value),
    [composerId],
  );
  const mentionEntries = useMemo(() => buildMentionEntries(tree), [tree]);
  const mentionPaths = useMemo(() => new Set(mentionEntries.map((entry) => entry.path)), [mentionEntries]);
  const slashItems = useMemo<SlashItem[]>(() => acpSlashItems(
    session?.availableCommands ?? [],
    (skillsQuery.data ?? []).map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      valid: skill.validation.status === "valid",
      available: isSkillAvailable(skill),
    })),
    { commands: t(($) => $.ai.acp.slash.commands), skills: t(($) => $.ai.acp.slash.skills) },
  ), [session?.availableCommands, skillsQuery.data, t]);

  const onSlashSelect = useCallback((item: SlashItem) => {
    if (!item.id.startsWith("skill:")) return;
    const skillId = item.id.slice("skill:".length);
    useAcpSessionsStore.getState().setComposer(projectId, { skill: { id: skillId, name: item.label } });
  }, [projectId]);

  const mentionItems = useCallback(
    (query: string): MentionItem[] => acpMentionItems(mentionEntries, query),
    [mentionEntries],
  );

  const submit = useCallback(() => {
    const draft = takeDraft(projectId, composerId);
    if (isEmpty(draft)) return;
    const store = useAcpSessionsStore.getState();
    if (mode === "start") {
      clearDraft(projectId, composerId);
      onStart(draft);
      return;
    }
    if (mode !== "send" || !session) return;
    clearDraft(projectId, composerId);
    onError(null);
    onSend();
    void store.sendPrompt(projectId, session.id, draft).then((sent) => {
      if (!sent) restoreDraft(projectId, composerId, draft);
    }).catch((error: unknown) => {
      restoreDraft(projectId, composerId, draft);
      onError(acpError(error));
    });
  }, [composerId, mode, onError, onSend, onStart, projectId, session]);

  const queue = useCallback(() => {
    if (!session) return;
    const draft = takeDraft(projectId, composerId);
    if (isEmpty(draft)) return;
    useAcpSessionsStore.getState().enqueue(session.id, draft);
    clearDraft(projectId, composerId);
  }, [composerId, projectId, session]);

  const stop = useCallback(() => {
    if (!session || session.status !== "running") return;
    void acpCancel(projectId, session.id)
      .then(() => useAcpSessionsStore.getState().resync(projectId, session.id))
      .catch((error: unknown) => onError(acpError(error)));
  }, [onError, projectId, session]);

  const addFiles = useCallback((files: File[]) => {
    void import("@/lib/attachments-intake")
      .then(({ intakeFiles }) => intakeFiles(files, { composerId, scope: projectId, kinds: acpAttachmentKinds(session) }))
      .catch((error: unknown) => logError("attach files to agent prompt", error));
  }, [composerId, projectId, session]);

  const removeAttachment = useCallback(
    (id: string) => useComposerDrafts.getState().removeAttachments(composerId, [id]),
    [composerId],
  );

  const dropProjectPaths = useCallback((paths: string[]) => {
    const dirs = new Set(tree.filter((entry) => entry.is_dir).map((entry) => entry.path));
    for (const path of paths) inner.current?.insertText(mentionInsertText(path, dirs.has(path)));
  }, [tree]);

  useSelectionQuote(projectId);

  const placeholder = (() => {
    switch (mode) {
      case "send":
        return t(($) => $.ai.acp.composerPlaceholderReady);
      case "start":
        return t(($) => $.ai.acp.composerPlaceholderStart, { agent: agent?.definition.name ?? agentId ?? "" });
      case "queue":
        return session?.status === "connecting"
          ? t(($) => $.ai.acp.composerPlaceholderConnecting)
          : t(($) => $.ai.acp.composerPlaceholderRunning);
      default:
        return t(($) => $.ai.acp.composerPlaceholderIdle);
    }
  })();

  const controls = (
    <>
      {leftControls}
      <Tooltip label={t(($) => $.ai.acp.attachFile)}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t(($) => $.ai.acp.attachFile)}
          className="ai-composer-attach size-7 shrink-0 rounded-full text-muted-foreground"
          onClick={() => inner.current?.openFilePicker()}
        >
          <Paperclip />
        </Button>
      </Tooltip>
    </>
  );

  return (
    <ChatComposer
      ref={inner}
      composerId={composerId}
      value={text}
      onChange={setText}
      onSubmit={submit}
      busy={mode === "queue"}
      onQueue={queue}
      onStop={running ? stop : undefined}
      stopDisabled={session?.status === "cancelling"}
      disabled={mode === "blocked"}
      placeholder={placeholder}
      attachments={attachments}
      onAddFiles={addFiles}
      onRemoveAttachment={removeAttachment}
      onDropProjectPaths={dropProjectPaths}
      slashItems={slashItems}
      onSlashSelect={onSlashSelect}
      mentionItems={mentionItems}
      highlight={{ paths: mentionPaths }}
      labels={{
        textarea: t(($) => $.ai.acp.composerAriaLabel),
        send: t(($) => $.ai.acp.send),
        stop: t(($) => $.ai.acp.stop),
        stopTitle: t(($) => $.ai.acp.stopTitle),
      }}
      controlsTestId="acp-composer-controls"
      controls={controls}
      trailingControls={trailingControls}
    />
  );
});
