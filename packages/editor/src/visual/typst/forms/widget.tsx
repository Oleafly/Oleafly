import { redo, undo } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import type { FC, ReactNode } from "react";
import { editorMessage } from "../../../messages";
import { reportEditorError } from "../../../error-report";
import type { TextRange } from "../../../typst-arguments";
import { anchorsOf, releaseAnchor } from "./anchors";
import { type CommitResult, commitFieldEdit } from "./commit";
import { FormFields, type HistoryCommand, historyCommand, shortSummary } from "./FormFields";
import type { TypstFormDefinition } from "../../../typst-forms";
import { renderWidget, unmountWidget, WidgetErrorBoundary } from "../../react-widget";
import type { FieldEdit, FormCallModel } from "./model";

export interface FormHost {
  readonly view: EditorView;
  readonly model: FormCallModel;
  // The call's source when the widget was drawn.
  readonly source: string;
  readonly readOnly: boolean;
  commit(field: number, edit: FieldEdit): Promise<CommitResult>;
  reveal(range: TextRange): void;
  history(command: HistoryCommand): void;
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

// WebKit focuses neither a button nor a checkbox on click, and a click on a form's own surface
// moves focus into the document around it, so the next key would edit the source. Focus stays
// on the clicked control, or where it was.
export function holdFormFocus(event: { readonly target: EventTarget | null; preventDefault(): void }): void {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest("input:not([type='checkbox']), textarea, select")) return;
  event.preventDefault();
  target.closest<HTMLElement>("button, input")?.focus({ preventScroll: true });
}

// The call each widget element last drew, so a widget that only moved isn't drawn again.
const drawn = new WeakMap<HTMLElement, { definition: TypstFormDefinition; source: string; readOnly: boolean }>();

// Undo or redo in the document from a form. Undo puts the selection back where it was, which
// may be far from here, so the form stays in view.
export function runFormHistory(view: EditorView, element: HTMLElement, command: HistoryCommand): void {
  (command === "redo" ? redo : undo)(view);
  const at = anchorsOf(view)?.at(element) ?? null;
  if (at !== null) view.dispatch({ effects: EditorView.scrollIntoView(at, { y: "nearest" }) });
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

  // A card is a labelled group whose keys the app's shortcuts leave to the form.
  protected readonly group: boolean = false;

  protected abstract content(host: FormHost, element: HTMLElement): ReactNode;

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement(this.tagName);
    element.className = this.className;
    if (this.group) {
      element.dataset.oflVisualForm = "";
      element.setAttribute("role", "group");
    }
    element.addEventListener("mousedown", holdFormFocus);
    anchorsOf(view)?.track(element, this.call.from);
    this.render(element, view);
    if (this.group) {
      // The app leaves a form's history keys to the form. Added after React's own listener on
      // this element, so a key a field already handled is skipped and one on a button isn't.
      element.addEventListener("keydown", (event) => {
        const command = historyCommand(event);
        if (!command || event.defaultPrevented) return;
        event.preventDefault();
        runFormHistory(view, element, command);
      });
    }
    return element;
  }

  // CodeMirror may offer the DOM of another call's widget; taking it would carry that call's
  // drafts and popover over.
  updateDOM(element: HTMLElement, view: EditorView): boolean {
    if (anchorsOf(view)?.at(element) !== this.call.from) return false;
    // Text typed above the call only moved it, and the anchor followed, so nothing needs drawing.
    const last = drawn.get(element);
    if (last?.definition === this.call.definition && last.source === this.call.source && last.readOnly === this.readOnly) {
      return true;
    }
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
    drawn.set(element, { definition: this.call.definition, source: this.call.source, readOnly: this.readOnly });
    let model: FormCallModel | null = null;
    try {
      model = this.call.read();
    } catch (error) {
      reportEditorError("Typst form could not be read", error);
    }
    if (!model) {
      renderWidget(element, <pre className="ofl-visual-form-source">{this.call.source}</pre>);
      return;
    }
    if (this.group) element.setAttribute("aria-label", model.definition.label);
    const definitionId = model.definition.id;
    const drawnFrom = model.range.from;
    // Positions in the model are where the call was when drawn; the anchor says where it is now.
    const anchor = () => anchorsOf(view)?.at(element) ?? null;
    const host: FormHost = {
      view,
      model,
      source: this.call.source,
      readOnly: this.readOnly,
      commit: (field, edit) =>
        new Promise((resolve) => {
          queueMicrotask(() => {
            const at = anchor();
            resolve(at === null ? { ok: false, reason: "stale" } : commitFieldEdit(view, at, definitionId, field, edit));
          });
        }),
      reveal: (range) => {
        const at = anchor();
        if (at === null) return;
        const shift = at - drawnFrom;
        view.dispatch({ selection: EditorSelection.range(range.from + shift, range.to + shift), scrollIntoView: true });
        view.focus();
      },
      history: (command) => runFormHistory(view, element, command),
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
    <pre className="ofl-visual-form-source">{host.source}</pre>
  </div>
);

export const FormHeader: FC<{ readonly host: FormHost }> = ({ host }) => {
  const summary = shortSummary(host.model.summary);
  return (
    <div className="ofl-visual-form-header">
      <span className="ofl-visual-form-title">{host.model.definition.label}</span>
      {summary && <span className="ofl-visual-form-summary">{summary}</span>}
      {!host.readOnly && (
        <button
          type="button"
          className="ofl-visual-form-action ofl-visual-form-reveal"
          onClick={() => host.reveal(host.model.range)}
        >
          {editorMessage("visual.typst.forms.editInSource")}
        </button>
      )}
    </div>
  );
};

// The form's header and fields, as both the card and the chip's popover show them.
export const FormBody: FC<{ readonly host: FormHost }> = ({ host }) => (
  <>
    <FormHeader host={host} />
    <FormFields
      model={host.model}
      readOnly={host.readOnly}
      onCommit={host.commit}
      onReveal={host.reveal}
      onHistory={host.history}
    />
  </>
);

export class TypstFormCardWidget extends TypstFormWidget {
  protected readonly className = "ofl-visual-form-card";

  protected readonly group = true;

  get estimatedHeight(): number {
    return 44 + this.call.definition.fields.length * 38;
  }

  protected content(host: FormHost): ReactNode {
    return <FormBody host={host} />;
  }
}
