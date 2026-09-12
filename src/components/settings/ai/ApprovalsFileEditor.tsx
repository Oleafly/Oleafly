import { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { StreamLanguage } from "@codemirror/language";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { editorTheme } from "@/components/editor/cm/theme";
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/app-error";
import { approvalsReadRaw, approvalsWriteRaw } from "@/lib/tauri";
import { useApprovalModeStore } from "@/store/approval-mode";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const TOOL_NAMES = [
  "write_file",
  "replace_in_file",
  "create_file",
  "rename_file",
  "delete_file",
  "run_command",
  "compile",
  "insert_figure",
  "set_main_doc",
];

export function approvalsExample(projectId: string | null): string {
  const id = projectId ?? "my-project";
  return `["$approval_modes"]
${id} = "custom"

[${id}]
run_command = "deny"
write_file = "allow"
`;
}

export function ApprovalsFileEditor() {
  const { t } = useTranslation(["common", "settings"]);
  const projectId = useFilesStore((s) => s.projectId);
  const projectName = useFilesStore((s) => s.projectName);
  const editorThemeId = useSettingsStore((s) => s.editorTheme);
  const client = useQueryClient();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [loaded, setLoaded] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const text = await approvalsReadRaw();
      setLoaded(text);
      setMessage(null);
      const view = viewRef.current;
      if (view) {
        const current = view.state.doc.toString();
        if (current !== text) {
          view.dispatch({ changes: { from: 0, to: current.length, insert: text } });
        }
      }
      setDirty(false);
    } catch (error) {
      setMessage({ ok: false, text: describeError(error) });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          StreamLanguage.define(toml),
          editorTheme(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setDirty(true);
          }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    void load();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [load]);

  const save = async () => {
    const view = viewRef.current;
    if (!view) return;
    const text = view.state.doc.toString();
    setBusy(true);
    try {
      await approvalsWriteRaw(text);
      setLoaded(text);
      setDirty(false);
      setMessage({ ok: true, text: t(($) => $.settings.ai.approvals.file.saved) });
      await client.invalidateQueries({ queryKey: ["project-approvals"] });
      const store = useApprovalModeStore.getState();
      if (projectId) await store.load(projectId);
    } catch (error) {
      setMessage({ ok: false, text: describeError(error) });
    } finally {
      setBusy(false);
    }
  };

  const insertExample = () => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    const example = approvalsExample(projectId);
    const next = current.trim() ? `${current.replace(/\s+$/, "")}\n\n${example}` : example;
    view.dispatch({ changes: { from: 0, to: current.length, insert: next } });
    view.focus();
  };

  return (
    <div className="rounded-lg border bg-card p-3" data-testid="approvals-file-editor">
      <div className="text-sm font-medium">{t(($) => $.settings.ai.approvals.file.title)}</div>
      <div className="mb-2 text-xs text-muted-foreground">
        {t(($) => $.settings.ai.approvals.file.description)}
      </div>
      <div className="mb-2 rounded-md border bg-background px-2.5 py-2 text-xs">
        <button
          type="button"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen((current) => !current)}
          className="flex w-full items-center gap-1 text-left font-medium"
        >
          <ChevronRight className={cn("size-3 transition-transform", helpOpen && "rotate-90")} />
          {t(($) => $.settings.ai.approvals.file.helpToggle)}
        </button>
        <div className={cn("mt-2 min-w-0 space-y-2 break-words text-muted-foreground", !helpOpen && "hidden")}>
          <p>
            <Trans
              ns="settings"
              i18nKey={($) => $.settings.ai.approvals.file.help.modes}
              components={{
                modesTable: <code className="font-mono" />,
                ask: <code className="font-mono" />,
                approve: <code className="font-mono" />,
                full: <code className="font-mono" />,
                custom: <code className="font-mono" />,
              }}
            />
          </p>
          <p>
            <Trans
              ns="settings"
              i18nKey={($) => $.settings.ai.approvals.file.help.rules}
              components={{
                allow: <code className="font-mono" />,
                deny: <code className="font-mono" />,
              }}
            />
          </p>
          <p>
            {t(($) => $.settings.ai.approvals.file.help.projectIds)}
            {projectId ? (
              <>
                {" "}
                <Trans
                  ns="settings"
                  i18nKey={($) => $.settings.ai.approvals.file.help.openProject}
                  values={{
                    name:
                      projectName || t(($) => $.settings.ai.approvals.project.thisProject),
                    id: projectId,
                  }}
                  components={{ projectId: <code className="font-mono" /> }}
                />
              </>
            ) : null}
          </p>
          <p className="break-words">
            <Trans
              ns="settings"
              i18nKey={($) => $.settings.ai.approvals.file.help.toolNames}
              values={{ names: TOOL_NAMES.join(" ") }}
              components={{ names: <code className="font-mono" /> }}
            />
          </p>
          <p>{t(($) => $.settings.ai.approvals.file.help.comments)}</p>
        </div>
      </div>
      <div
        ref={hostRef}
        data-testid="approvals-file-source"
        data-editor-theme={editorThemeId}
        className="max-h-80 min-h-32 overflow-auto rounded-md border bg-background text-xs [&_.cm-editor]:min-h-32 [&_.cm-scroller]:font-mono"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          data-testid="approvals-file-save"
          disabled={busy || !dirty}
          onClick={() => void save()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy
            ? t(($) => $.settings.ai.approvals.file.saving)
            : t(($) => $.common.actions.save)}
        </button>
        <button
          type="button"
          data-testid="approvals-file-reload"
          disabled={busy}
          onClick={() => void load()}
          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          {dirty
            ? t(($) => $.settings.ai.approvals.file.discard)
            : t(($) => $.settings.ai.approvals.file.reload)}
        </button>
        <button
          type="button"
          data-testid="approvals-file-example"
          onClick={insertExample}
          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          {t(($) => $.settings.ai.approvals.file.insertExample)}
        </button>
        {message && (
          <span
            data-testid="approvals-file-message"
            className={message.ok ? "text-xs text-emerald-600 dark:text-emerald-400" : "text-xs text-destructive"}
          >
            {message.text}
          </span>
        )}
        {!message && loaded === "" && !dirty && (
          <span className="text-xs text-muted-foreground">
            {t(($) => $.settings.ai.approvals.file.emptyFile)}
          </span>
        )}
      </div>
    </div>
  );
}
