import { syntaxTree } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import type { Decoration, WidgetType } from "@codemirror/view";
import { typstLanguage } from "../../typst";
import { parsedState } from "../test-document";
import type { VisualPorts } from "../types";
import { typstVisualField } from "./field";
import { typstVisualMode } from "./index";

export interface Found<T> {
  from: number;
  to: number;
  widget: T;
  block: boolean;
}

export interface Hidden {
  from: number;
  to: number;
  block: boolean;
}

export const NO_PORTS: VisualPorts = { resolveImage: async () => null };

export function typstState(
  doc: string,
  options: { cursor?: number; ports?: VisualPorts; readOnly?: boolean; extensions?: Extension[] } = {},
): EditorState {
  const state = parsedState(
    EditorState.create({
      doc,
      selection: options.cursor === undefined ? undefined : { anchor: options.cursor },
      extensions: [
        typstLanguage(),
        typstVisualMode(options.ports ?? NO_PORTS),
        EditorState.readOnly.of(options.readOnly ?? false),
        ...(options.extensions ?? []),
      ],
    }),
  );
  if (syntaxTree(state).length !== doc.length || syntaxTree(state).type.name !== "Source") {
    throw new Error("the Typst tree did not finish parsing");
  }
  return state;
}

export function widgetsOf<T extends WidgetType>(
  state: EditorState,
  kind: abstract new (...args: never[]) => T,
): Found<T>[] {
  const found: Found<T>[] = [];
  const cursor = state.field(typstVisualField).decorations.iter();
  while (cursor.value) {
    const spec = (cursor.value as Decoration).spec;
    if (spec.widget instanceof kind) {
      found.push({ from: cursor.from, to: cursor.to, widget: spec.widget as T, block: Boolean(spec.block) });
    }
    cursor.next();
  }
  return found;
}

export function hiddenRanges(state: EditorState): Hidden[] {
  const found: Hidden[] = [];
  const cursor = state.field(typstVisualField).decorations.iter();
  while (cursor.value) {
    const spec = (cursor.value as Decoration).spec;
    if (!spec.widget && cursor.to > cursor.from) {
      found.push({ from: cursor.from, to: cursor.to, block: Boolean(spec.block) });
    }
    cursor.next();
  }
  return found;
}

export function replacedRanges(state: EditorState): Array<{ from: number; to: number }> {
  const found: Array<{ from: number; to: number }> = [];
  const cursor = state.field(typstVisualField).decorations.iter();
  while (cursor.value) {
    if (cursor.to > cursor.from) found.push({ from: cursor.from, to: cursor.to });
    cursor.next();
  }
  return found;
}

export function lineClassesAt(state: EditorState, pos: number): string[] {
  const line = state.doc.lineAt(pos);
  const classes: string[] = [];
  state.field(typstVisualField).decorations.between(line.from, line.from, (from, to, value) => {
    if (from === line.from && to === line.from) {
      const name = (value as Decoration).spec.class;
      if (typeof name === "string") classes.push(...name.split(" "));
    }
  });
  return classes;
}

export function rangeOf(doc: string, needle: string, occurrence = 0): { from: number; to: number } {
  let index = -1;
  for (let count = 0; count <= occurrence; count += 1) {
    index = doc.indexOf(needle, index + 1);
    if (index === -1) throw new Error(`"${needle}" not found`);
  }
  return { from: index, to: index + needle.length };
}
