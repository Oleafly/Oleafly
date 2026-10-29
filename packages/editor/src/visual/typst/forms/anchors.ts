import { MapMode } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

// Where the call behind each live form widget starts, mapped through every change. A widget
// keeps its DOM (and its drafts and open popover) only while that DOM still belongs to the
// same call, and a commit finds its call however far the document moved it.
class FormAnchors {
  private readonly anchors = new Map<HTMLElement, number | null>();

  update(update: ViewUpdate): void {
    if (!update.docChanged) return;
    for (const [element, at] of this.anchors) {
      this.anchors.set(element, at === null ? null : update.changes.mapPos(at, 1, MapMode.TrackAfter));
    }
  }

  track(element: HTMLElement, at: number): void {
    this.anchors.set(element, at);
    owners.set(element, this);
  }

  release(element: HTMLElement): void {
    this.anchors.delete(element);
  }

  at(element: HTMLElement): number | null {
    return this.anchors.get(element) ?? null;
  }

  destroy(): void {
    this.anchors.clear();
  }
}

const owners = new WeakMap<HTMLElement, FormAnchors>();

export const formAnchors = ViewPlugin.fromClass(FormAnchors);

export function anchorsOf(view: EditorView): FormAnchors | null {
  return view.plugin(formAnchors);
}

export function releaseAnchor(element: HTMLElement): void {
  owners.get(element)?.release(element);
}
