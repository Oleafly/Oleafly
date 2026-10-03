import {
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { enclosingFrames, typstStyleVersion } from "./bibliography-styles";
import { createCompletionRequestGuard } from "./completion-request";
import { guardCompletionForSource } from "./latex";
import { editorMessage, type EditorMessageKey } from "./messages";

const CONTEXT_LIMIT = 4_000;
export const MULTIPLE_BIBLIOGRAPHIES_SINCE: readonly [number, number] = [0, 15];
const NAME_AT_END = /(?:^|[,(])\s*([A-Za-z_][\w-]*|)$/u;
const VALUE_AT_END = /(?:^|[,(])\s*(target|group)\s*:\s*([\w."-]*)$/u;

export type TypstBibliographyParameterKind = "name" | "target" | "group";

export interface TypstBibliographyParameter {
  readonly kind: TypstBibliographyParameterKind;
  readonly query: string;
}

interface ParameterOption {
  readonly label: string;
  readonly detail: EditorMessageKey;
  readonly template: string;
  readonly type: string;
}

const NAME_OPTIONS: readonly ParameterOption[] = [
  {
    label: "target",
    detail: "typst.bibliographyParameter.target",
    template: "target: ",
    type: "property",
  },
  {
    label: "group",
    detail: "typst.bibliographyParameter.group",
    template: "group: ",
    type: "property",
  },
];

const TARGET_OPTIONS: readonly ParameterOption[] = [
  {
    label: "auto",
    detail: "typst.bibliographyParameter.targetAuto",
    template: "auto",
    type: "keyword",
  },
  {
    label: "selector(cite).within(<label>)",
    detail: "typst.bibliographyParameter.targetWithin",
    template: "selector(cite).within(<${label}>)",
    type: "function",
  },
  {
    label: "selector(cite).after(<label>)",
    detail: "typst.bibliographyParameter.targetAfter",
    template: "selector(cite).after(<${label}>)",
    type: "function",
  },
  {
    label: "selector(cite).before(<label>)",
    detail: "typst.bibliographyParameter.targetBefore",
    template: "selector(cite).before(<${label}>)",
    type: "function",
  },
];

const GROUP_OPTIONS: readonly ParameterOption[] = [
  {
    label: "auto",
    detail: "typst.bibliographyParameter.groupAuto",
    template: "auto",
    type: "keyword",
  },
  {
    label: "none",
    detail: "typst.bibliographyParameter.groupNone",
    template: "none",
    type: "keyword",
  },
  {
    label: '"group"',
    detail: "typst.bibliographyParameter.groupNamed",
    template: '"${group}"',
    type: "text",
  },
];

const OPTIONS: Readonly<Record<TypstBibliographyParameterKind, readonly ParameterOption[]>> = {
  name: NAME_OPTIONS,
  target: TARGET_OPTIONS,
  group: GROUP_OPTIONS,
};

function minorVersion(version: string | null): readonly [number, number] | null {
  const match = version ? /^v?(\d+)\.(\d+)/u.exec(version.trim()) : null;
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function typstVersionAtLeast(version: string | null, since: readonly [number, number]): boolean {
  const minor = minorVersion(version);
  if (!minor) return true;
  return minor[0] > since[0] || (minor[0] === since[0] && minor[1] >= since[1]);
}

export function typstSupportsMultipleBibliographies(version: string | null): boolean {
  return typstVersionAtLeast(version, MULTIPLE_BIBLIOGRAPHIES_SINCE);
}

function insideBibliographyCall(text: string): boolean {
  const frame = enclosingFrames(text).at(-1);
  return frame?.code === true && frame.close === ")" && frame.callee === "bibliography";
}

export function typstBibliographyParameterAt(before: string): TypstBibliographyParameter | null {
  const value = VALUE_AT_END.exec(before);
  if (value) {
    const start = before.length - value[0].length + value[0].search(/target|group/u);
    if (!insideBibliographyCall(before.slice(0, start))) return null;
    return { kind: value[1] === "target" ? "target" : "group", query: value[2] };
  }
  const name = NAME_AT_END.exec(before);
  if (!name) return null;
  const start = before.length - name[1].length;
  if (!insideBibliographyCall(before.slice(0, start))) return null;
  return { kind: "name", query: name[1] };
}

export function typstBibliographyParameterCompletions(
  context: CompletionContext,
): CompletionResult | null {
  if (!typstSupportsMultipleBibliographies(typstStyleVersion())) return null;
  const before = context.state.sliceDoc(Math.max(0, context.pos - CONTEXT_LIMIT), context.pos);
  const parameter = typstBibliographyParameterAt(before);
  if (!parameter) return null;
  if (parameter.kind === "name" && parameter.query === "" && !context.explicit) return null;
  const guard = createCompletionRequestGuard(context);
  return {
    from: context.pos - parameter.query.length,
    validFor: parameter.kind === "name" ? /^[\w-]*$/u : /^[\w."-]*$/u,
    options: OPTIONS[parameter.kind].map((option) =>
      guardCompletionForSource(guard, {
        label: option.label,
        type: option.type,
        detail: editorMessage(option.detail),
        apply: option.template.includes("${") ? snippet(option.template) : option.template,
      } satisfies Completion),
    ),
  };
}
