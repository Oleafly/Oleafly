import { renderMathExpression } from "@oleafly/editor/math-render";
import { isTauri } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import { CalendarPlus, Command, Copy, FilePlus2, NotebookPen, Plus, Trash2, Type, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDelegatedTooltips } from "@/components/ui/delegated-tooltip";
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ToolbarMenuButton, ToolbarMenuItem } from "@/components/ui/toolbar-overflow";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useCopyStatus } from "@/components/ui/use-copy-status";
import { readString, removeKey, writeString } from "@/lib/local-storage";
import { logError } from "@/lib/log";
import { NOTES_PERIODIC_KEY, readPeriodic } from "@/lib/notes-periodic";
import { quickCaptureOpenNotes, quickCaptureWindowButtons } from "@/lib/tauri";
import { cn, isMac } from "@/lib/utils";
import { withBlockViews } from "./block-views";
import { calloutNodeView } from "./NoteCallout";
import { NOTE_CORE_EXTENSIONS, noteBaseExtensions, parseNoteMarkdown, serializeNoteMarkdown } from "./note-markdown";
import { NoteSlash } from "./note-slash";
import { NoteSlashMenu } from "./NoteSlashMenu";
import { NoteToolbar, returnFocus } from "./NoteToolbar";
import {
  CAPTURE_EVENT,
  CAPTURE_REPLY_MS,
  CAPTURE_SHOWN_EVENT,
  CAPTURED_EVENT,
  type CaptureReply,
  type CaptureRequest,
  type CaptureTarget,
  captureDraft,
  countCharacters,
} from "./quick-capture";
import "./notes.css";

const DRAFT_KEY = "oleafly.notes.quickCapture.draft";
const SAVE_KEYS = "⌘↵";
const TODAY_KEYS = "⌘⇧↵";
const LAYERS = '[role="menu"], [role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper]';
const HOVER_ONLY =
  "pointer-events-none opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-data-[hovered]/capture:pointer-events-auto group-data-[hovered]/capture:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100";
const ROUND = "rounded-full border bg-popover text-popover-foreground shadow-md";

export interface CaptureBridge {
  submit: (request: CaptureRequest) => Promise<CaptureReply>;
  hide: () => void;
  onShown: (shown: () => void) => () => void;
  openNotes: () => void;
  windowButtons: (shown: boolean) => void;
}

function submitToMainWindow(request: CaptureRequest): Promise<CaptureReply> {
  return new Promise((resolve, reject) => {
    let stop: (() => void) | null = null;
    const timer = window.setTimeout(() => {
      stop?.();
      reject(new Error("The main window did not answer."));
    }, CAPTURE_REPLY_MS);
    listen<CaptureReply>(CAPTURED_EVENT, ({ payload }) => {
      if (payload.id !== request.id) return;
      window.clearTimeout(timer);
      stop?.();
      resolve(payload);
    })
      .then((unlisten) => {
        stop = unlisten;
        return emitTo("main", CAPTURE_EVENT, request);
      })
      .catch((error: unknown) => {
        window.clearTimeout(timer);
        stop?.();
        reject(error);
      });
  });
}

const desktopBridge: CaptureBridge = {
  submit: submitToMainWindow,
  hide: () => {
    if (isTauri()) void getCurrentWindow().hide().catch((error: unknown) => logError("hide quick capture", error));
  },
  onShown: (shown) => {
    if (!isTauri()) return () => {};
    const stop = listen(CAPTURE_SHOWN_EVENT, shown);
    return () => void stop.then((unlisten) => unlisten());
  },
  openNotes: () => {
    if (isTauri()) void quickCaptureOpenNotes().catch((error: unknown) => logError("open Notes from quick capture", error));
  },
  windowButtons: (shown) => {
    if (isTauri() && isMac) void quickCaptureWindowButtons(shown).catch((error: unknown) => logError("show the quick capture window buttons", error));
  },
};

function todayOffered(): boolean {
  return readPeriodic(readString(NOTES_PERIODIC_KEY)).daily.enabled;
}

function saveDraft(text: string): void {
  if (text.trim()) writeString(DRAFT_KEY, text);
  else removeKey(DRAFT_KEY);
}

function blankDoc(doc: ProseMirrorNode): boolean {
  const first = doc.firstChild;
  return doc.childCount === 1 && first?.type.name === "paragraph" && first.content.size === 0;
}

function captureExtensions(onEscape: () => void) {
  return [
    ...noteBaseExtensions({ renderMath: renderMathExpression }, { callout: calloutNodeView() }).map(withBlockViews),
    NoteSlash,
    Extension.create({
      name: "quickCapture",
      addKeyboardShortcuts: () => ({
        Escape: () => {
          onEscape();
          return true;
        },
      }),
      addProseMirrorPlugins: () => [
        new Plugin({ props: { attributes: (state): Record<string, string> => (blankDoc(state.doc) ? { "data-blank": "" } : {}) } }),
      ],
    }),
  ];
}

export function QuickCaptureWindow({ bridge = desktopBridge }: Readonly<{ bridge?: CaptureBridge }>) {
  const { t } = useTranslation(["notes", "common"]);
  const [initial] = useState(() => readString(DRAFT_KEY) ?? "");
  const hideRef = useRef(bridge.hide);
  hideRef.current = bridge.hide;
  const extensions = useMemo(() => captureExtensions(() => hideRef.current()), []);
  const label = t(($) => $.notes.quickCapture.field);
  const placeholder = t(($) => $.notes.quickCapture.placeholder);
  const options = useMemo(
    () => ({
      extensions,
      content: parseNoteMarkdown(initial).doc,
      enableCoreExtensions: NOTE_CORE_EXTENSIONS,
      autofocus: "end" as const,
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": label,
          "aria-placeholder": placeholder,
          class: "relative min-h-full",
          "data-testid": "quick-capture-text",
        },
      },
    }),
    [extensions, initial, label, placeholder],
  );
  const editor = useEditor(options);
  const [text, setText] = useState(initial);
  const [count, setCount] = useState(() => countCharacters(editor.state.doc.textContent));
  const [today, setToday] = useState(todayOffered);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const savingRef = useRef(false);
  const pointerRef = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const blockTooltips = useDelegatedTooltips(bodyRef);
  const copy = useCopyStatus({ onError: (error) => void logError("copy a quick capture", error) });

  useEffect(() => {
    const changed = () => {
      const markdown = serializeNoteMarkdown(editor.getJSON());
      setText(markdown);
      setCount(countCharacters(editor.state.doc.textContent));
      saveDraft(markdown);
    };
    editor.on("update", changed);
    return () => {
      editor.off("update", changed);
    };
  }, [editor]);

  useEffect(
    () =>
      bridge.onShown(() => {
        const stored = readString(DRAFT_KEY) ?? "";
        if (stored !== serializeNoteMarkdown(editor.getJSON())) editor.commands.setContent(parseNoteMarkdown(stored).doc);
        setToday(todayOffered());
        setFailed(false);
        setHovered(false);
        setMenuOpen(false);
        setFormatting(false);
        pointerRef.current = null;
        editor.commands.focus("end");
      }),
    [bridge, editor],
  );

  useEffect(() => {
    const move = (event: MouseEvent) => {
      const at = `${event.clientX},${event.clientY}`;
      if (pointerRef.current !== null && pointerRef.current !== at) setHovered(true);
      pointerRef.current = at;
    };
    const leave = (event: MouseEvent) => {
      if (event.relatedTarget !== null) return;
      pointerRef.current = null;
      setHovered(false);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseout", leave);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseout", leave);
    };
  }, []);

  useEffect(() => bridge.windowButtons(hovered), [bridge, hovered]);

  const submit = useCallback(
    async (target: CaptureTarget, hideAfter: boolean) => {
      const markdown = serializeNoteMarkdown(editor.getJSON());
      if (savingRef.current || !markdown.trim()) return;
      savingRef.current = true;
      setSaving(true);
      setFailed(false);
      editor.setEditable(false, false);
      let saved = false;
      try {
        const reply = await bridge.submit({ id: crypto.randomUUID(), text: markdown, target });
        if (reply.error !== undefined) throw new Error(reply.error);
        saved = true;
        editor.commands.clearContent(true);
        if (hideAfter) bridge.hide();
      } catch (error) {
        setFailed(true);
        void logError("save a quick capture", error);
      } finally {
        savingRef.current = false;
        setSaving(false);
        editor.setEditable(true, false);
        if (!saved || !hideAfter) editor.commands.focus("end");
      }
    },
    [bridge, editor],
  );

  const startNote = () => {
    if (serializeNoteMarkdown(editor.getJSON()).trim()) void submit("new", false);
    else editor.commands.focus("end");
  };

  const discard = () => {
    editor.commands.clearContent(true);
    setFailed(false);
  };

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return;
      if (event.key === "Enter") {
        if (event.shiftKey && !today) return;
        event.preventDefault();
        event.stopPropagation();
        void submit(event.shiftKey ? "today" : "new", true);
        return;
      }
      if (event.key.toLowerCase() === "k" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen((open) => !open);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof Node && editor.view.dom.contains(target)) return;
      if (target instanceof Element && target.closest(LAYERS)) return;
      event.preventDefault();
      bridge.hide();
    };
    window.addEventListener("keydown", onShortcut, true);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("keydown", onShortcut, true);
      window.removeEventListener("keydown", onEscape);
    };
  }, [bridge, editor, submit, today]);

  const empty = text.trim() === "";
  const title = captureDraft(text).title || t(($) => $.notes.quickCapture.untitled);
  const copied = t(($) => $.common.actions.copied);
  const back = returnFocus(editor);
  const closeFormatting = () => {
    setFormatting(false);
    editor.commands.focus();
  };

  return (
    <main
      aria-label={t(($) => $.notes.quickCapture.title)}
      data-testid="quick-capture"
      data-hovered={hovered || undefined}
      className="group/capture relative flex h-screen flex-col overflow-hidden bg-background text-foreground"
    >
      <header data-tauri-drag-region className="relative flex h-9 shrink-0 items-center justify-center px-24">
        {!isMac && (
          <div className={cn("absolute left-2 top-1", HOVER_ONLY)}>
            <TooltipIconButton label={t(($) => $.common.actions.close)} onClick={bridge.hide}>
              <X aria-hidden />
            </TooltipIconButton>
          </div>
        )}
        <h1 data-tauri-drag-region data-testid="quick-capture-title" className="truncate text-xs font-medium text-muted-foreground">
          {title}
        </h1>
        <div data-capture-controls className={cn("absolute right-2 top-1 flex items-center gap-0.5 p-0.5", ROUND, HOVER_ONLY)}>
          <ToolbarMenuButton
            label={t(($) => $.notes.quickCapture.actions.label)}
            icon={<Command aria-hidden className="size-4" />}
            chevron={false}
            align="end"
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onCloseAutoFocus={back}
            contentClassName="min-w-56"
          >
            <ToolbarMenuItem
              icon={FilePlus2}
              label={t(($) => $.notes.quickCapture.actions.saveNew)}
              keys={SAVE_KEYS}
              disabled={empty || saving}
              onSelect={() => void submit("new", true)}
            />
            {today && (
              <ToolbarMenuItem
                icon={CalendarPlus}
                label={t(($) => $.notes.quickCapture.actions.saveToday)}
                keys={TODAY_KEYS}
                disabled={empty || saving}
                onSelect={() => void submit("today", true)}
              />
            )}
            <DropdownMenuSeparator />
            <ToolbarMenuItem
              icon={Copy}
              label={t(($) => $.notes.quickCapture.actions.copy)}
              disabled={empty}
              onSelect={() => void copy.copy(serializeNoteMarkdown(editor.getJSON()))}
            />
            <ToolbarMenuItem icon={Trash2} label={t(($) => $.notes.quickCapture.actions.discard)} disabled={empty || saving} onSelect={discard} />
          </ToolbarMenuButton>
          <TooltipIconButton label={t(($) => $.notes.quickCapture.openNotes)} onClick={bridge.openNotes}>
            <NotebookPen aria-hidden />
          </TooltipIconButton>
          <TooltipIconButton label={t(($) => $.notes.quickCapture.newNote)} disabled={saving} onClick={startNote}>
            <Plus aria-hidden />
          </TooltipIconButton>
        </div>
      </header>
      <div ref={bodyRef} data-capture-body className="wysiwyg-content note-body min-h-0 flex-1 overflow-y-auto px-5 pb-2">
        <EditorContent editor={editor} className="h-full" />
      </div>
      {blockTooltips}
      <NoteSlashMenu editor={editor} />
      {failed && (
        <p role="alert" className="shrink-0 px-5 pb-1 text-xs text-destructive">
          {t(($) => $.notes.quickCapture.failed)}
        </p>
      )}
      <footer data-tauri-drag-region className="relative flex h-9 shrink-0 items-center justify-center px-12">
        <span data-tauri-drag-region aria-hidden={copy.copied || undefined} className="text-xs tabular-nums text-muted-foreground">
          {copy.copied ? copied : t(($) => $.notes.quickCapture.characters, { count })}
        </span>
        <span role="status" className="sr-only">
          {copy.copied ? copied : null}
        </span>
        {!formatting && (
          <div className={cn("absolute bottom-1.5 right-2", HOVER_ONLY)}>
            <TooltipIconButton label={t(($) => $.notes.quickCapture.format)} side="top" className={ROUND} onClick={() => setFormatting(true)}>
              <Type aria-hidden />
            </TooltipIconButton>
          </div>
        )}
      </footer>
      {formatting && (
        <div data-capture-format className="absolute inset-x-2 bottom-1.5 z-10 flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <NoteToolbar editor={editor} floating />
          </div>
          <TooltipIconButton label={t(($) => $.notes.quickCapture.closeFormat)} side="top" className={ROUND} onClick={closeFormatting}>
            <X aria-hidden />
          </TooltipIconButton>
        </div>
      )}
    </main>
  );
}
