import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { selectNodeContent } from "../selection";
import { typesetNodeInto } from "../typeset";
import { BlockWidget } from "./base";

export interface FrameText {
  node: SyntaxNode;
  content: string;
}

export interface Frame {
  title: FrameText;
  subtitle?: FrameText;
}

export class FrameWidget extends BlockWidget {
  constructor(readonly frame: Frame) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("div");
    element.className = "ofl-visual-frame ofl-visual-divider";
    element.append(this.heading(view, this.frame.title, "ofl-visual-frame-title"));
    if (this.frame.subtitle) {
      element.append(this.heading(view, this.frame.subtitle, "ofl-visual-frame-subtitle"));
    }
    return element;
  }

  eq(other: FrameWidget): boolean {
    return (
      other.frame.title.content === this.frame.title.content &&
      other.frame.subtitle?.content === this.frame.subtitle?.content
    );
  }

  private heading(view: EditorView, text: FrameText, className: string): HTMLElement {
    const heading = document.createElement("div");
    heading.classList.add(className, "ofl-visual-heading");
    typesetNodeInto(text.node, heading, view.state);
    heading.addEventListener("mouseup", () => selectNodeContent(view, text.node));
    return heading;
  }
}
