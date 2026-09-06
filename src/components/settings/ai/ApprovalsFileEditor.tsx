import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { StreamLanguage } from "@codemirror/language";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { editorTheme } from "@/components/editor/cm/theme";
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
      setMessage({ ok: false, text: String(error) });
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
      setMessage({ ok: true, text: "Saved. The rules apply to the next tool call." });
      await client.invalidateQueries({ queryKey: ["project-approvals"] });
      const store = useApprovalModeStore.getState();
      if (projectId) await store.load(projectId);
    } catch (error) {
      setMessage({ ok: false, text: String(error) });
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
      <div className="text-sm font-medium">Approval rules file</div>
      <div className="mb-2 text-xs text-muted-foreground">
        The Custom approval mode reads this file. It lives at ~/.oleafly/approvals.toml
        and applies to every project on this device.
      </div>
      <details className="mb-2 rounded-md border bg-background px-2.5 py-2 text-xs">
        <summary className="cursor-pointer font-medium">How the file works</summary>
        <div className="mt-2 space-y-2 text-muted-foreground">
          <p>
            The first table, <code className="font-mono">["$approval_modes"]</code>, sets the
            approval mode per project: <code className="font-mono">"ask-for-approval"</code>,{" "}
            <code className="font-mono">"approve-for-me"</code>,{" "}
            <code className="font-mono">"full-access"</code> or{" "}
            <code className="font-mono">"custom"</code>. A project that is not listed uses
            Approve for me.
          </p>
          <p>
            Then one table per project id, holding a rule per tool:{" "}
            <code className="font-mono">"allow"</code> runs the tool without asking, and{" "}
            <code className="font-mono">"deny"</code> refuses it. Deny rules are honoured in
            every mode; allow rules take effect in Custom mode, and for run_command they also
            skip the prompt in the other modes.
          </p>
          <p>
            Project ids are the folder names under ~/.oleafly/projects.
            {projectId ? (
              <>
                {" "}
                The open project, {projectName || "this project"}, has the id{" "}
                <code className="font-mono">{projectId}</code>.
              </>
            ) : null}
          </p>
          <p>
            Tool names you can use: {TOOL_NAMES.map((name) => (
              <code key={name} className="mr-1 font-mono">
                {name}
              </code>
            ))}
            and any MCP tool by its full name from the Tools list.
          </p>
          <p>
            Comments starting with # are kept when you save here, but an "Always in this
            project" choice on an approval card rewrites the file without them.
          </p>
        </div>
      </details>
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
          {busy ? "Saving" : "Save"}
        </button>
        <button
          type="button"
          data-testid="approvals-file-reload"
          disabled={busy}
          onClick={() => void load()}
          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          {dirty ? "Discard changes" : "Reload"}
        </button>
        <button
          type="button"
          data-testid="approvals-file-example"
          onClick={insertExample}
          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          Insert an example
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
          <span className="text-xs text-muted-foreground">The file is empty so far.</span>
        )}
      </div>
    </div>
  );
}
