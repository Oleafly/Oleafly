// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadTypstParser, typstLanguage } from "../../../typst";
import { EMPTY_TYPST_FORM_CATALOG, staticTypstForms, type TypstFormsPort } from "../../../typst-forms";
import { readTypstFormsFixture, typstFormsGolden } from "../../../typst-forms-test-support";
import { parsedView } from "../../test-document";
import type { VisualPorts } from "../../types";
import { typstVisualField } from "../field";
import { typstVisualMode } from "../index";
import { typstFormsField } from "./state";

const views: EditorView[] = [];

beforeAll(async () => {
  await loadTypstParser();
});

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

function viewWith(port: TypstFormsPort | undefined, doc = readTypstFormsFixture("project/report.typ")): EditorView {
  const ports: VisualPorts = { resolveImage: async () => null, typstForms: port };
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [typstLanguage(), typstVisualMode(ports, "report.typ")] }),
  });
  views.push(view);
  return parsedView(view);
}

function flush(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

describe("the Typst forms catalog in the editor", () => {
  it("starts from the port's snapshot", () => {
    const golden = typstFormsGolden();
    const view = viewWith(staticTypstForms(golden));
    expect(view.state.field(typstFormsField)).toBe(golden);
  });

  it("takes a replaced catalog after a microtask and rebuilds the decorations", async () => {
    const port = staticTypstForms(EMPTY_TYPST_FORM_CATALOG);
    const view = viewWith(port);
    await flush();
    const before = view.state.field(typstVisualField);
    const golden = typstFormsGolden();
    port.set(golden);
    expect(view.state.field(typstFormsField)).toBe(EMPTY_TYPST_FORM_CATALOG);
    await flush();
    expect(view.state.field(typstFormsField)).toBe(golden);
    expect(view.state.field(typstVisualField)).not.toBe(before);
  });

  it("dispatches nothing when the port hands back the same catalog", async () => {
    const port = staticTypstForms(typstFormsGolden());
    const view = viewWith(port);
    await flush();
    const before = view.state;
    port.set(port.snapshot());
    await flush();
    expect(view.state).toBe(before);
  });

  it("stops listening when the view is destroyed", async () => {
    let listeners = 0;
    const port: TypstFormsPort = {
      snapshot: () => EMPTY_TYPST_FORM_CATALOG,
      subscribe() {
        listeners += 1;
        return () => {
          listeners -= 1;
        };
      },
      want: () => undefined,
    };
    const view = viewWith(port);
    expect(listeners).toBe(1);
    view.destroy();
    expect(listeners).toBe(0);
  });

  it("works without a port", () => {
    const view = viewWith(undefined);
    expect(view.state.field(typstFormsField)).toBe(EMPTY_TYPST_FORM_CATALOG);
  });

  it("tells the port which packages the document imports, once per change", () => {
    const port = staticTypstForms(EMPTY_TYPST_FORM_CATALOG);
    const asked: string[][] = [];
    const want = port.want.bind(port);
    port.want = (packages) => {
      asked.push([...packages]);
      want(packages);
    };
    const view = viewWith(port, '#import "@local/acme-report:0.1.0": info-box\nBody\n');
    view.dispatch({ changes: { from: view.state.doc.length, insert: "more" } });
    parsedView(view);
    view.dispatch({ changes: { from: 0, insert: '#import "@preview/other:1.0.0"\n' } });
    parsedView(view);
    expect(asked).toEqual([["@local/acme-report:0.1.0"], ["@preview/other:1.0.0", "@local/acme-report:0.1.0"]]);
  });
});
