import type { AnyExtension, Editor } from "@tiptap/core";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  createProofreading,
  type ProofreadingDocument,
  proofreadingModeFor,
  refreshVisualProofreading,
  resumeVisualProofreading,
  type VisualProofreadingIssue,
} from "@/components/editor/wysiwyg/proofreading";
import { ProofreadingPopover } from "@/components/editor/wysiwyg/ProofreadingPopover";
import { useDictionary } from "@/lib/dictionary";
import { createEmitter } from "@/lib/emitter";
import { effectiveDictionaryLocale } from "@/lib/proofreading/dictionary-catalog";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { plainTextTags } from "./note-tags";
import type { NoteItem } from "./types";
import { useEditorInert } from "./use-note-live";

interface OpenFinding {
  owner: NoteProofreading;
  issue: VisualProofreadingIssue;
}

let open: OpenFinding | null = null;
const openChanged = createEmitter();
let sequence = 0;

function setOpen(next: OpenFinding | null): void {
  if (open === next) return;
  open = next;
  openChanged.emit();
}

function closeFor(owner: NoteProofreading): void {
  if (open?.owner === owner) setOpen(null);
}

function subscribeOpen(listener: () => void): () => void {
  return openChanged.subscribe(listener);
}

function openFinding(): OpenFinding | null {
  return open;
}

type Settings = ReturnType<typeof useSettingsStore.getState>;

const PROOFREADING_SETTINGS = [
  "notesSpellcheck",
  "harper",
  "showRegionalism",
  "showWordChoice",
  "grammarDialect",
  "dictionaryLocale",
] as const satisfies readonly (keyof Settings)[];

function notesProofreadingMode(): ReturnType<typeof proofreadingModeFor> {
  const settings = useSettingsStore.getState();
  return proofreadingModeFor(settings.notesSpellcheck, settings.harper);
}

function homeLocale(home: NoteItem["home"]): string {
  const files = useFilesStore.getState();
  return effectiveDictionaryLocale({
    project: home && files.projectId === home.projectId ? files.projectDictionaryLocale : null,
    global: useSettingsStore.getState().dictionaryLocale,
  });
}

export class NoteProofreading {
  readonly extension: AnyExtension;
  readonly locale: () => string;

  constructor(note: Pick<NoteItem, "id" | "home">) {
    const home = note.home;
    const identity: ProofreadingDocument = {
      path: `notes/${++sequence}/${home?.path ?? note.id}`,
      projectId: home?.projectId ?? null,
      documentVersion: 0,
      format: "markdown",
    };
    this.locale = () => homeLocale(home);
    this.extension = createProofreading({
      surface: "notes",
      document: () => identity,
      active: (view) => view.dom.closest("[inert]") === null,
      mode: notesProofreadingMode,
      locale: this.locale,
      publish: (issue) => (issue ? setOpen({ owner: this, issue }) : closeFor(this)),
      protect: plainTextTags,
      replacesNativeSpellcheck: true,
    });
  }
}

export function useNoteProofreading(note: Pick<NoteItem, "id" | "home">): NoteProofreading {
  const [proofreading] = useState(() => new NoteProofreading(note));
  return proofreading;
}

export function NoteProofreadingPopover({
  editor,
  proofreading,
}: Readonly<{ editor: Editor; proofreading: NoteProofreading }>) {
  const inert = useEditorInert(editor);
  const finding = useSyncExternalStore(subscribeOpen, openFinding);

  useEffect(() => {
    if (inert) closeFor(proofreading);
    else resumeVisualProofreading(editor);
  }, [editor, inert, proofreading]);

  useEffect(() => {
    const refresh = () => {
      if (!editor.isDestroyed) refreshVisualProofreading(editor);
    };
    const stopSettings = useSettingsStore.subscribe((state, previous) => {
      if (PROOFREADING_SETTINGS.some((key) => state[key] !== previous[key])) refresh();
    });
    const stopWords = useDictionary.subscribe((state, previous) => {
      if (state.global !== previous.global || state.ignored !== previous.ignored) refresh();
    });
    return () => {
      stopSettings();
      stopWords();
    };
  }, [editor]);

  const close = useCallback(() => closeFor(proofreading), [proofreading]);
  const navigate = useCallback(
    (issue: VisualProofreadingIssue) => setOpen({ owner: proofreading, issue }),
    [proofreading],
  );

  if (inert || finding?.owner !== proofreading || editor.isDestroyed) return null;
  return (
    <ProofreadingPopover
      editor={editor}
      issue={finding.issue}
      locale={proofreading.locale()}
      onClose={close}
      onNavigate={navigate}
    />
  );
}
