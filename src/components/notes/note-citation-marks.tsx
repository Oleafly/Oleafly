import { type Editor, Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useEditorState } from "@tiptap/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { type CitationGroup, citationGroups, citekeyOf, inlineCitation, referenceLine } from "./note-citations";
import { NoteLinkSection, useNotePanelSections } from "./NoteListItem";
import { useNotesData } from "./notes-data";
import { redecorateTextblocks } from "./touched-textblocks";
import type { CitationItem, NoteItem } from "./types";

export interface LiteratureNote {
  readonly id: string;
  readonly title: string;
}

export interface CitationLibrary {
  readonly entries: ReadonlyMap<string, CitationItem>;
  readonly notes: ReadonlyMap<string, LiteratureNote>;
}

interface CitationState {
  readonly library: CitationLibrary;
  readonly decorations: DecorationSet;
}

const EMPTY_LIBRARY: CitationLibrary = { entries: new Map(), notes: new Map() };
const citationKey = new PluginKey<CitationState>("noteCitations");
const KNOWN = "rounded-sm bg-primary/10 text-primary";
const UNKNOWN = "underline decoration-muted-foreground/60 decoration-dashed underline-offset-2";
const LABEL = "ml-1 select-none rounded-sm text-xs text-muted-foreground";
const OPEN_LABEL = `${LABEL} cursor-pointer underline-offset-2 hover:text-foreground hover:underline`;
const OPEN_NOTE = "data-open-note";

function hoverText(group: CitationGroup, library: CitationLibrary): string {
  const lines = group.items.flatMap((item) => {
    const entry = library.entries.get(item.key);
    return entry ? [referenceLine(entry)] : [];
  });
  return lines.join("\n");
}

function labelWidget(group: CitationGroup, library: CitationLibrary): () => HTMLElement {
  return () => {
    const label = document.createElement("span");
    label.textContent = inlineCitation(group, library.entries);
    const note = group.items.map((item) => library.notes.get(item.key)).find(Boolean);
    label.className = note ? OPEN_LABEL : LABEL;
    label.contentEditable = "false";
    if (note) {
      label.setAttribute(OPEN_NOTE, note.id);
      label.dataset.tooltip = i18n.t(($) => $.notes.citations.openNote, { title: note.title });
    }
    return label;
  };
}

function blockDecorations(block: ProseMirrorNode, pos: number, library: CitationLibrary): Decoration[] {
  if (block.type.spec.code) return [];
  const found: Decoration[] = [];
  block.forEach((child, offset) => {
    if (!child.isText || !child.text || child.marks.some((mark) => mark.type.spec.code)) return;
    const start = pos + 1 + offset;
    for (const group of citationGroups(child.text)) {
      const keys = group.items.map((item) => item.key);
      const known = keys.every((key) => library.entries.has(key));
      const tooltip = known
        ? hoverText(group, library)
        : i18n.t(($) => $.notes.citations.unknown, { keys: keys.filter((key) => !library.entries.has(key)).join(", ") });
      found.push(
        Decoration.inline(start + group.from, start + group.to, { class: known ? KNOWN : UNKNOWN, "data-tooltip": tooltip }, { keys }),
      );
      if (known) {
        const label = inlineCitation(group, library.entries);
        found.push(Decoration.widget(start + group.to, labelWidget(group, library), { side: 1, key: `${keys.join(",")}:${label}`, ignoreSelection: true }));
      }
    }
  });
  return found;
}

function allDecorations(doc: ProseMirrorNode, library: CitationLibrary): DecorationSet {
  const found: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    found.push(...blockDecorations(node, pos, library));
    return false;
  });
  return DecorationSet.create(doc, found);
}

export function citedKeys(state: EditorState): string[] {
  const keys = new Set<string>();
  for (const decoration of citationKey.getState(state)?.decorations.find() ?? []) {
    for (const key of (decoration.spec as { keys?: readonly string[] }).keys ?? []) keys.add(key);
  }
  return [...keys];
}

export const NoteCitationMarks = Extension.create<unknown, { openNote: ((id: string) => void) | null }>({
  name: "noteCitationMarks",

  addStorage() {
    return { openNote: null };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<CitationState>({
        key: citationKey,
        state: {
          init: (_config, state) => ({ library: EMPTY_LIBRARY, decorations: allDecorations(state.doc, EMPTY_LIBRARY) }),
          apply: (tr, previous) => {
            const library = tr.getMeta(citationKey) as CitationLibrary | undefined;
            if (library) return { library, decorations: allDecorations(tr.doc, library) };
            if (!tr.docChanged) return previous;
            const decorations =
              redecorateTextblocks(previous.decorations, tr, (block, pos) => blockDecorations(block, pos, previous.library)) ??
              allDecorations(tr.doc, previous.library);
            return { library: previous.library, decorations };
          },
        },
        props: {
          decorations: (state) => citationKey.getState(state)?.decorations ?? DecorationSet.empty,
          handleDOMEvents: {
            mousedown: (_view, event) => {
              const target = event.target instanceof Element ? event.target.closest(`[${OPEN_NOTE}]`) : null;
              const id = target?.getAttribute(OPEN_NOTE);
              if (!id || !storage.openNote) return false;
              event.preventDefault();
              storage.openNote(id);
              return true;
            },
          },
        },
      }),
    ];
  },
});

function literatureNotes(notes: readonly NoteItem[], currentId: string): ReadonlyMap<string, LiteratureNote> {
  const found = new Map<string, LiteratureNote>();
  for (const note of notes) {
    const key = citekeyOf(note);
    if (note.id !== currentId && key && !found.has(key)) found.set(key, { id: note.id, title: note.title });
  }
  return found;
}

export function useNoteCitations(
  editor: Editor,
  note: Pick<NoteItem, "id" | "relatedProjectId">,
  openNote: (id: string) => void,
): { library: CitationLibrary; cited: readonly string[] } {
  const { citations, projectCitations, notes } = useNotesData();
  const citedText = useEditorState({ editor, selector: ({ editor: current }) => citedKeys(current.state).join("\n") });
  const cited = useMemo(() => (citedText ? citedText.split("\n") : []), [citedText]);
  const related = note.relatedProjectId;
  const wanted = cited.length > 0;
  const [found, setFound] = useState<readonly CitationItem[]>([]);
  useEffect(() => {
    if (!wanted || !related || !projectCitations) return;
    let live = true;
    projectCitations(related).then(
      (entries) => {
        if (live) setFound(entries);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [projectCitations, related, wanted]);
  const library = useMemo<CitationLibrary>(
    () => ({
      entries: new Map([...(citations ?? []), ...found].map((entry) => [entry.key, entry])),
      notes: literatureNotes(notes, note.id),
    }),
    [citations, found, note.id, notes],
  );
  useEffect(() => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(citationKey, library).setMeta("addToHistory", false));
  }, [editor, library]);
  const storage = editor.storage as unknown as Record<string, { openNote: ((id: string) => void) | null } | undefined>;
  const marks = storage.noteCitationMarks;
  if (marks) marks.openNote = openNote;
  return { library, cited };
}

export function NoteReferences({
  library,
  cited,
  className,
}: Readonly<{ library: CitationLibrary; cited: readonly string[]; className?: string }>) {
  const { t } = useTranslation(["notes"]);
  const open = useNotesPrefsStore((state) => state.referencesOpen);
  const panel = useNotePanelSections();
  const entries = cited.flatMap((key) => {
    const entry = library.entries.get(key);
    return entry ? [entry] : [];
  });
  if (entries.length === 0 && !panel) return null;
  return (
    <NoteLinkSection
      title={t(($) => $.notes.citations.references)}
      open={open}
      count={entries.length}
      empty={cited.length === 0 ? t(($) => $.notes.info.noReferences) : undefined}
      onOpenChange={(next) => useNotesPrefsStore.getState().set("referencesOpen", next)}
      className={className}
      data-note-references=""
    >
      {entries.map((entry) => (
        <li key={entry.key} className="px-2 py-1 text-sm">
          {referenceLine(entry)}
        </li>
      ))}
    </NoteLinkSection>
  );
}
