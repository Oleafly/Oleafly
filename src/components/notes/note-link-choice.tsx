import type { Editor } from "@tiptap/core";
import type { NodeType, ResolvedPos } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useEditorState } from "@tiptap/react";
import { Globe, Link2, Play } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isImeEnter } from "@/components/ai/composer/ime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { allowRemoteImage } from "@/lib/remote-image";
import { safeHttpUrl } from "@/lib/system-browser";
import { caretAfterDrawnBlock } from "./block-views";
import { BOOKMARK_INFO, loadBookmark, serializeBookmark } from "./bookmark-block";
import { noteBlockName } from "./note-blocks";
import { bubblePlace } from "./note-bubble";
import { videoEmbed } from "./note-path";

interface LinkChoice {
  from: number;
  to: number;
  link: string;
  kind: "video" | "web" | "ask";
}

const linkChoiceKey = new PluginKey<LinkChoice | null>("noteLinkChoice");

export function linkChoicePlugin(): Plugin<LinkChoice | null> {
  return new Plugin<LinkChoice | null>({
    key: linkChoiceKey,
    state: {
      init: () => null,
      apply(tr, choice) {
        const next = tr.getMeta(linkChoiceKey) as LinkChoice | null | undefined;
        if (next !== undefined) return next;
        return choice && tr.docChanged ? null : choice;
      },
    },
  });
}

function webLink(text: string): boolean {
  return text !== "" && !/\s/u.test(text) && safeHttpUrl(text) !== null;
}

function emptyParagraph(state: EditorState): ResolvedPos | null {
  const { $from, empty } = state.selection;
  return empty && $from.depth > 0 && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0 ? $from : null;
}

function holds($from: ResolvedPos, type: NodeType | undefined): boolean {
  const index = $from.index(-1);
  return type !== undefined && $from.node(-1).canReplaceWith(index, index + 1, type);
}

export function pasteLink(view: EditorView, text: string): boolean {
  const link = text.trim();
  const { schema } = view.state;
  const $from = emptyParagraph(view.state);
  const mark = schema.marks.link;
  if (!$from || !mark || !webLink(link)) return false;
  const kind = videoEmbed(link) ? "video" : "web";
  if (!holds($from, kind === "video" ? schema.nodes.image : schema.nodes.codeBlock)) return false;
  const from = $from.pos;
  const tr = view.state.tr.insertText(link, from).addMark(from, from + link.length, mark.create({ href: link }));
  view.dispatch(tr.setMeta(linkChoiceKey, { from, to: from + link.length, link, kind }).scrollIntoView());
  return true;
}

export function canAskBookmark(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  if (linkChoiceKey.get(editor.state) === undefined) return false;
  return $from.depth > 0 && $from.parent.type.name === "paragraph" && holds($from, editor.schema.nodes.codeBlock);
}

export function askBookmark(editor: Editor): boolean {
  const $from = emptyParagraph(editor.state);
  if (!$from || !canAskBookmark(editor)) return false;
  editor.view.dispatch(editor.state.tr.setMeta(linkChoiceKey, { from: $from.pos, to: $from.pos, link: "", kind: "ask" }));
  return true;
}

function dismiss(editor: Editor): void {
  if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(linkChoiceKey, null));
}

function paragraphOf(editor: Editor, choice: LinkChoice): { from: number; to: number } | null {
  const $from = editor.state.doc.resolve(Math.min(choice.from, editor.state.doc.content.size));
  if ($from.depth === 0 || $from.parent.type.name !== "paragraph" || $from.parent.textContent !== choice.link) return null;
  return { from: $from.before(), to: $from.after() };
}

function embed(editor: Editor, choice: LinkChoice): void {
  const image = editor.schema.nodes.image;
  const range = paragraphOf(editor, choice);
  if (!image || !range) {
    dismiss(editor);
    return;
  }
  const video = videoEmbed(choice.link);
  if (video) allowRemoteImage(video.thumbnail ?? video.page);
  const tr = editor.state.tr.replaceWith(range.from, range.to, image.create({ src: choice.link, alt: "" }));
  editor.view.dispatch(tr.setMeta(linkChoiceKey, null).scrollIntoView());
  editor.commands.focus();
}

function fillBookmarks(editor: Editor, placeholder: string, source: string): void {
  if (editor.isDestroyed || !editor.isEditable || source === placeholder) return;
  const { tr } = editor.state;
  editor.state.doc.descendants((node, position) => {
    const bookmark = node.type.name === "codeBlock" && noteBlockName(String(node.attrs.language ?? "")) === BOOKMARK_INFO;
    if (bookmark && node.textContent === placeholder) {
      tr.insertText(source, tr.mapping.map(position + 1), tr.mapping.map(position + 1 + node.content.size));
    }
    return !node.isTextblock;
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}

function bookmarkCard(editor: Editor, choice: LinkChoice, url: string): void {
  const codeBlock = editor.schema.nodes.codeBlock;
  const range = paragraphOf(editor, choice);
  if (!codeBlock || !range) {
    dismiss(editor);
    return;
  }
  const placeholder = serializeBookmark({ url });
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(range.from, range.to, codeBlock.create({ language: BOOKMARK_INFO }, editor.schema.text(placeholder)));
      tr.setSelection(TextSelection.create(tr.doc, range.from + 1));
      return true;
    })
    .command(caretAfterDrawnBlock)
    .setMeta(linkChoiceKey, null)
    .scrollIntoView()
    .run();
  void loadBookmark(url, (source) => fillBookmarks(editor, placeholder, source));
}

function BookmarkAddress({ editor, choice }: Readonly<{ editor: Editor; choice: LinkChoice }>) {
  const { t } = useTranslation(["notes"]);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  useEffect(() => input.current?.focus(), []);
  const submit = () => {
    const url = value.trim();
    if (webLink(url)) bookmarkCard(editor, choice, url);
    else setInvalid(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") return;
    event.stopPropagation();
    if (event.key !== "Enter" || isImeEnter(event)) return;
    event.preventDefault();
    submit();
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          ref={input}
          aria-label={t(($) => $.notes.toolbar.linkAddress)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          placeholder={t(($) => $.notes.toolbar.linkPlaceholder)}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setInvalid(false);
          }}
          onKeyDown={onKeyDown}
          className="h-7 w-64 text-xs"
        />
        <Button variant="ghost" size="xs" onMouseDown={(event) => event.preventDefault()} onClick={submit}>
          <Globe aria-hidden />
          {t(($) => $.notes.blocks.bookmark.cardChoice)}
        </Button>
      </div>
      {invalid && (
        <p id={errorId} role="alert" className="px-1 text-xs text-destructive">
          {t(($) => $.notes.toolbar.linkInvalid)}
        </p>
      )}
    </div>
  );
}

export function NoteLinkChoice({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation(["notes"]);
  const choice = useEditorState({ editor, selector: ({ editor: current }) => (current.isDestroyed ? null : (linkChoiceKey.getState(current.state) ?? null)) });
  const [, follow] = useReducer((tick: number) => tick + 1, 0);
  const asking = choice?.kind === "ask";
  useEffect(() => {
    if (!choice) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dismiss(editor);
      if (asking && !editor.isDestroyed) editor.commands.focus();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", follow, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", follow, true);
    };
  }, [asking, choice, editor]);
  if (!choice) return null;
  const place = bubblePlace(editor.view.coordsAtPos(choice.from), editor.view.coordsAtPos(choice.to), { width: window.innerWidth });
  let label: string;
  if (choice.kind === "video") label = t(($) => $.notes.blocks.media.pasteChoice);
  else if (choice.kind === "web") label = t(($) => $.notes.blocks.bookmark.pasteChoice);
  else label = t(($) => $.notes.blocks.bookmark.ask);
  return (
    <fieldset
      data-note-link-choice
      aria-label={label}
      style={{ top: place.top, left: place.left }}
      className="fixed z-50 m-0 flex min-w-0 gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-xl"
    >
      {choice.kind === "ask" ? (
        <BookmarkAddress editor={editor} choice={choice} />
      ) : (
        <>
          <Button
            variant="ghost"
            size="xs"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => (choice.kind === "video" ? embed(editor, choice) : bookmarkCard(editor, choice, choice.link))}
          >
            {choice.kind === "video" ? <Play aria-hidden /> : <Globe aria-hidden />}
            {choice.kind === "video" ? t(($) => $.notes.blocks.media.embedChoice) : t(($) => $.notes.blocks.bookmark.cardChoice)}
          </Button>
          <Button variant="ghost" size="xs" onMouseDown={(event) => event.preventDefault()} onClick={() => dismiss(editor)}>
            <Link2 aria-hidden />
            {t(($) => $.notes.blocks.media.linkChoice)}
          </Button>
        </>
      )}
    </fieldset>
  );
}
