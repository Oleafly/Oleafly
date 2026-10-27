import { EditorSelection } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";
import type { FC, ReactNode } from "react";
import { editorMessage } from "../../../messages";
import type { TextRange } from "../../../typst-arguments";
import { anchorsOf, releaseAnchor } from "./anchors";
import { type CommitResult, commitFieldEdit } from "./commit";
import { FormFields, shortSummary } from "./FormFields";
import type { TypstFormDefinition } from "../../../typst-forms";
import { renderWidget, unmountWidget, WidgetErrorBoundary } from "../../react-widget";
import type { FieldEdit, FormCallModel } from "./model";

export interface FormHost {
  readonly view: EditorView;
  readonly model: FormCallModel;
  readonly readOnly: boolean;
  commit(field: number, edit: FieldEdit): Promise<CommitResult>;
  reveal(range: TextRange): void;
}

// What a widget knows about its call. The field model is read only when the widget is
// drawn, so calls outside the viewport, and selection-only rebuilds, cost no model reads.
export interface FormCallRef {
  readonly definition: TypstFormDefinition;
  // Where the call's `#` is.
  readonly from: number;
  readonly source: string;
  read(): FormCallModel | null;
}

// Shared by the card and the chip.
export abstract class TypstFormWidget extends WidgetType {
  constructor(
    readonly call: FormCallRef,
    readonly readOnly: boolean,
  ) {
    super();
  }

  eq(other: TypstFormWidget): boolean {
    return (
      other.call.definition === this.call.definition &&
      other.call.from === this.call.from &&
      other.call.source === this.call.source &&
      other.readOnly === this.readOnly
    );
  }

  protected abstract readonly className: string;

  protected abstract content(host: FormHost, element: HTMLElement): ReactNode;

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement(this.tagName);
    element.className = this.className;
    anchorsOf(view)?.track(element, this.call.from);
    this.render(element, view);
    return element;
  }

  // CodeMirror may offer the DOM of another call's widget; taking it would carry that call's
  // drafts and popover over.
  updateDOM(element: HTMLElement, view: EditorView): boolean {
    if (anchorsOf(view)?.at(element) !== this.call.from) return false;
    this.render(element, view);
    return true;
  }

  destroy(element: HTMLElement): void {
    releaseAnchor(element);
    unmountWidget(element);
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "mouseup";
  }

  coordsAt(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect();
  }

  protected get tagName(): string {
    return "div";
  }

  private render(element: HTMLElement, view: EditorView): void {
    const model = this.call.read();
    if (!model) {
      renderWidget(element, <pre className="ofl-visual-form-source">{this.call.source}</pre>);
      return;
    }
    const definitionId = model.definition.id;
    const host: FormHost = {
      view,
      model,
      readOnly: this.readOnly,
      commit: (field, edit) =>
        new Promise((resolve) => {
          queueMicrotask(() => {
            const anchor = anchorsOf(view)?.at(element) ?? null;
            resolve(anchor === null ? { ok: false, reason: "stale" } : commitFieldEdit(view, anchor, definitionId, field, edit));
          });
        }),
      reveal: (range) => {
        view.dispatch({ selection: EditorSelection.range(range.from, range.to), scrollIntoView: true });
        view.focus();
      },
    };
    renderWidget(
      element,
      <WidgetErrorBoundary name="Typst form" fallback={<RawFormSource host={host} />}>
        {this.content(host, element)}
      </WidgetErrorBoundary>,
    );
  }
}

export const RawFormSource: FC<{ readonly host: FormHost }> = ({ host }) => (
  <div className="ofl-visual-form-error" role="alert">
    <div>{editorMessage("visual.typst.forms.renderFailed")}</div>
    <pre className="ofl-visual-form-source">{host.view.state.sliceDoc(host.model.range.from, host.model.range.to)}</pre>
  </div>
);

export const FormHeader: FC<{ readonly host: FormHost }> = ({ host }) => {
  const summary = shortSummary(host.model.summary);
  return (
    <div className="ofl-visual-form-header">
      <span className="ofl-visual-form-title">{host.model.definition.label}</span>
      {summary && <span className="ofl-visual-form-summary">{summary}</span>}
      <button
        type="button"
        className="ofl-visual-form-action ofl-visual-form-reveal"
        onClick={() => host.reveal(host.model.range)}
      >
        {editorMessage("visual.typst.forms.editInSource")}
      </button>
    </div>
  );
};

// The form's header and fields, as both the card and the chip's popover show them.
export const FormBody: FC<{ readonly host: FormHost }> = ({ host }) => (
  <>
    <FormHeader host={host} />
    <FormFields model={host.model} readOnly={host.readOnly} onCommit={host.commit} onReveal={host.reveal} />
  </>
);

export class TypstFormCardWidget extends TypstFormWidget {
  protected readonly className = "ofl-visual-form-card";

  get estimatedHeight(): number {
    return 44 + this.call.definition.fields.length * 38;
  }

  protected content(host: FormHost): ReactNode {
    return <FormBody host={host} />;
  }
}
