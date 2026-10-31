import { Decoration } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { TypstDecorationBuilder } from "../field";
import { TypstFormChipWidget } from "./chip";
import { hasErrorNode } from "../../../typst-arguments";
import { reportEditorError } from "../../../error-report";
import { type FormCallModel, readFormCall } from "./model";
import type { FormScope } from "./scope";
import { type FormCallRef, TypstFormCardWidget } from "./widget";

export function formDecorations(
  builder: TypstDecorationBuilder,
  scope: FormScope,
  hash: SyntaxNode,
  call: SyntaxNode,
  callee: string,
): boolean | undefined {
  const definition = scope.resolve(callee, hash.from);
  if (!definition) return undefined;
  const range = { from: hash.from, to: call.to };
  if (!builder.shouldDecorate(range)) return undefined;
  try {
    const { state } = builder;
    const args = call.getChild("Args");
    if (!args || hasErrorNode(args)) return undefined;
    const { doc } = state;
    let model: FormCallModel | null | undefined;
    const ref: FormCallRef = {
      definition,
      from: hash.from,
      source: state.sliceDoc(range.from, range.to),
      read: () => {
        model ??= readFormCall(doc, hash, call, definition);
        return model;
      },
    };
    const owned = builder.ownedLines(range);
    if (owned) {
      builder.push(Decoration.replace({ widget: new TypstFormCardWidget(ref, state.readOnly), block: true }).range(owned.from, owned.to));
    } else {
      builder.push(Decoration.replace({ widget: new TypstFormChipWidget(ref, state.readOnly) }).range(range.from, range.to));
    }
    return false;
  } catch (error) {
    reportEditorError("Typst form decoration failed", error);
    return undefined;
  }
}
