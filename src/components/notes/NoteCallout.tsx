import type { Editor, NodeViewRenderer } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  Anchor,
  BookOpen,
  Bug,
  Check,
  ChevronDown,
  CircleCheck,
  CircleHelp,
  ClipboardList,
  Flame,
  FlaskConical,
  Info,
  Lightbulb,
  List,
  MessageSquare,
  Pencil,
  Quote,
  Sigma,
  SquareCheck,
  TriangleAlert,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Root } from "react-dom/client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { i18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { CALLOUT_TYPES, calloutKind, calloutLabel } from "./note-callouts";
import { watchEditable } from "./note-editable";
import { nodeRoot } from "./node-root";

const ICONS: Readonly<Record<string, LucideIcon>> = {
  pencil: Pencil,
  "clipboard-list": ClipboardList,
  info: Info,
  "circle-check": CircleCheck,
  flame: Flame,
  check: Check,
  "circle-help": CircleHelp,
  "triangle-alert": TriangleAlert,
  x: X,
  zap: Zap,
  bug: Bug,
  list: List,
  quote: Quote,
  sigma: Sigma,
  "book-open": BookOpen,
  "square-check": SquareCheck,
  lightbulb: Lightbulb,
  anchor: Anchor,
  "flask-conical": FlaskConical,
  workflow: Workflow,
  "message-square": MessageSquare,
};

export function calloutIcon(type: string): LucideIcon {
  return ICONS[calloutKind(type).icon] ?? Pencil;
}

interface ChromeProps {
  type: string;
  folded: boolean;
  editable: boolean;
  onFold: () => void;
  onType: (type: string) => void;
}

export function CalloutChrome({ type, folded, editable, onFold, onType }: Readonly<ChromeProps>) {
  const Icon = calloutIcon(type);
  const current = calloutKind(type).id;
  const icon = <Icon aria-hidden className="size-[1.1em]" />;
  const typeLabel = i18n.t(($) => $.notes.kb.callouts.type, { type: calloutLabel(type) });
  const foldLabel = folded ? i18n.t(($) => $.notes.kb.callouts.unfold) : i18n.t(($) => $.notes.kb.callouts.fold);
  return (
    <>
      {editable ? (
        <DropdownMenu>
          <Tooltip label={typeLabel} side="top">
            <DropdownMenuTrigger
              aria-label={typeLabel}
              className="note-callout-icon rounded-md transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/10 motion-reduce:transition-none"
            >
              {icon}
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            {CALLOUT_TYPES.map((option) => {
              const OptionIcon = calloutIcon(option);
              return (
                <DropdownMenuItem
                  key={option}
                  data-callout-option={option}
                  data-tone={calloutKind(option).tone}
                  onSelect={() => onType(option)}
                  className={cn("note-callout-option gap-2 text-xs", option === current && "bg-accent")}
                >
                  <OptionIcon aria-hidden className="size-3.5" />
                  {calloutLabel(option)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="note-callout-icon">{icon}</span>
      )}
      <Tooltip label={foldLabel} side="top">
        <button
          type="button"
          aria-expanded={!folded}
          aria-label={foldLabel}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onFold}
          className="note-callout-fold rounded-md transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/10 motion-reduce:transition-none"
        >
          <ChevronDown aria-hidden className={cn("size-[1.1em] transition-transform motion-reduce:transition-none", folded && "-rotate-90")} />
        </button>
      </Tooltip>
    </>
  );
}

export function calloutNodeView(mount?: (host: HTMLElement) => Root): NodeViewRenderer {
  return ({ node, editor, getPos }) => {
    const dom = document.createElement("div");
    dom.className = "note-callout";
    const chrome = document.createElement("div");
    chrome.className = "note-callout-chrome";
    chrome.contentEditable = "false";
    const content = document.createElement("div");
    content.className = "note-callout-content";
    dom.append(chrome, content);
    const root = nodeRoot(chrome, mount);
    let current: ProseMirrorNode = node;
    let folded = node.attrs.fold === "-";
    const setType = (type: string) => changeType(editor, getPos, current, type);
    const paint = () => {
      const type = String(current.attrs.type);
      const kind = calloutKind(type);
      dom.dataset.tone = kind.tone;
      dom.dataset.kind = kind.id;
      dom.toggleAttribute("data-folded", folded);
      root.render(
        <CalloutChrome
          type={type}
          folded={folded}
          editable={editor.isEditable}
          onFold={() => {
            folded = !folded;
            paint();
          }}
          onType={setType}
        />,
      );
    };
    paint();
    const stopWatching = watchEditable(editor, paint);
    return {
      dom,
      contentDOM: content,
      update(next: ProseMirrorNode) {
        if (next.type !== current.type) return false;
        current = next;
        paint();
        return true;
      },
      ignoreMutation(mutation: MutationRecord | { type: "selection"; target: globalThis.Node }) {
        if (mutation.type === "selection") return false;
        return (mutation.type === "attributes" && mutation.target === dom) || chrome.contains(mutation.target);
      },
      stopEvent(event: Event) {
        return event.target instanceof globalThis.Node && chrome.contains(event.target);
      },
      destroy() {
        stopWatching();
        root.unmount();
      },
    };
  };
}

function changeType(editor: Editor, getPos: () => number | undefined, node: ProseMirrorNode, type: string): void {
  const position = getPos();
  if (position === undefined || !editor.isEditable) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, type }));
}
