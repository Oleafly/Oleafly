import { MapMode } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

interface Anchor {
  at: number | null;
  readonly source: string;
  readonly definition: string;
  readonly drafts: Map<string, string>;
}

interface KeptDrafts {
  readonly at: number;
  readonly definition: string;
  readonly drafts: ReadonlyMap<string, string>;
}

function rewrittenCall(update: ViewUpdate, at: number, source: string): number | null {
  let found: number | null = null;
  update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (found !== null || at < fromA || at >= toA || source === "") return;
    const expected = fromB + (at - fromA);
    const text = update.state.sliceDoc(fromB, Math.min(update.state.doc.length, toB + source.length));
    for (let index = text.indexOf(source); index >= 0 && fromB + index < toB; index = text.indexOf(source, index + 1)) {
      const candidate = fromB + index;
      if (found === null || Math.abs(candidate - expected) < Math.abs(found - expected)) found = candidate;
    }
  });
  return found;
}

class FormAnchors {
  private readonly anchors = new Map<HTMLElement, Anchor>();
  private kept: KeptDrafts[] = [];

  update(update: ViewUpdate): void {
    if (!update.docChanged) return;
    for (const anchor of this.anchors.values()) {
      if (anchor.at === null) continue;
      anchor.at = update.changes.mapPos(anchor.at, 1, MapMode.TrackAfter) ?? rewrittenCall(update, anchor.at, anchor.source);
    }
    this.kept = this.kept.flatMap((entry) => {
      const at = update.changes.mapPos(entry.at, 1, MapMode.TrackAfter);
      return at === null ? [] : [{ ...entry, at }];
    });
  }

  track(element: HTMLElement, anchor: Anchor): void {
    this.anchors.set(element, anchor);
    owners.set(element, this);
  }

  release(element: HTMLElement): void {
    const anchor = this.anchors.get(element);
    this.anchors.delete(element);
    if (anchor === undefined || anchor.at === null || anchor.drafts.size === 0) return;
    this.kept.push({ at: anchor.at, definition: anchor.definition, drafts: new Map(anchor.drafts) });
  }

  claim(at: number, definition: string): ReadonlyMap<string, string> | null {
    const index = this.kept.findIndex((entry) => entry.at === at && entry.definition === definition);
    if (index >= 0) return this.kept.splice(index, 1)[0].drafts;
    for (const anchor of this.anchors.values()) {
      if (anchor.at !== at || anchor.definition !== definition || anchor.drafts.size === 0) continue;
      const drafts = new Map(anchor.drafts);
      anchor.drafts.clear();
      return drafts;
    }
    return null;
  }

  at(element: HTMLElement): number | null {
    return this.anchors.get(element)?.at ?? null;
  }

  destroy(): void {
    this.anchors.clear();
    this.kept = [];
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
