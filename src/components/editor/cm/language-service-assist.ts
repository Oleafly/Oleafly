import {
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  showTooltip,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import { open as openExternalUrl } from "@tauri-apps/plugin-shell";
import {
  currentInteractiveDocument,
  interactiveRequestStillCurrent,
  type CurrentInteractiveDocument,
} from "@/lib/analysis/interactive-document";
import {
  currentInteractiveLanguageService,
  subscribeInteractiveLanguageService,
} from "@/lib/analysis/interactive-language-service";
import {
  isRecord,
  offsetRange,
  projectPathForUri,
  strictOffset,
  type OffsetRange,
} from "@/lib/analysis/language-service-results";
import {
  TextPositionIndex,
  type JsonValue,
  type LanguageServiceFeature,
} from "@/lib/language-service";
import { logError } from "@/lib/log";
import { openProjectLocation } from "@/lib/open-location";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const TYPST_PATH = /\.typ$/i;
const SIGNATURE_HELP_DELAY_MS = 60;
const SIGNATURE_HELP_TIMEOUT_MS = 2_500;
const DOCUMENT_DECORATION_DELAY_MS = 400;
const VIEWPORT_DELAY_MS = 180;
const DECORATION_TIMEOUT_MS = 5_000;
const MAX_SIGNATURE_TEXT = 2_000;
const MAX_HINTS = 2_000;

function typstDocument(
  view: EditorView,
  feature: LanguageServiceFeature,
): CurrentInteractiveDocument | null {
  const path = useFilesStore.getState().activePath;
  if (!path || !TYPST_PATH.test(path)) return null;
  const current = currentInteractiveDocument(path, view.state.doc.toString());
  return current?.session.client.supports(feature) ? current : null;
}

function requestOptions(
  current: CurrentInteractiveDocument,
  signal: AbortSignal,
  timeoutMs: number,
) {
  return {
    signal,
    timeoutMs,
    projectRevision: current.session.projectRevision,
    documentUri: current.document.uri,
    documentVersion: current.document.version,
  };
}

function plainText(value: unknown, limit: number): string | null {
  const text =
    typeof value === "string"
      ? value
      : isRecord(value) && typeof value.value === "string"
        ? value.value
        : null;
  const trimmed = text?.replaceAll("\0", "").trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

export interface SignatureHelpView {
  pos: number;
  label: string;
  active: OffsetRange | null;
  documentation: string | null;
  raw: JsonValue;
}

function parameterRange(
  label: string,
  parameter: unknown,
  searchFrom: number,
): OffsetRange | null {
  if (!isRecord(parameter)) return null;
  const value = parameter.label;
  if (typeof value === "string" && value) {
    const start = label.indexOf(value, searchFrom);
    return start < 0 ? null : { from: start, to: start + value.length };
  }
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isInteger(value[0]) &&
    Number.isInteger(value[1]) &&
    value[0] >= 0 &&
    value[1] >= value[0] &&
    value[1] <= label.length
  ) {
    return { from: value[0], to: value[1] };
  }
  return null;
}

function integerIn(value: unknown, length: number): number | null {
  return Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) < length
    ? (value as number)
    : null;
}

export function signatureHelpFromValue(
  value: unknown,
  pos: number,
): SignatureHelpView | null {
  if (!isRecord(value) || !Array.isArray(value.signatures)) return null;
  const signatures = value.signatures;
  if (signatures.length === 0) return null;
  const signature =
    signatures[integerIn(value.activeSignature, signatures.length) ?? 0];
  if (!isRecord(signature) || typeof signature.label !== "string") return null;
  const label = signature.label.slice(0, MAX_SIGNATURE_TEXT);
  const parameters = Array.isArray(signature.parameters)
    ? signature.parameters
    : [];
  const ranges: Array<OffsetRange | null> = [];
  let searchFrom = Math.max(0, label.indexOf("("));
  for (const parameter of parameters) {
    const range = parameterRange(label, parameter, searchFrom);
    ranges.push(range);
    if (range) searchFrom = range.to;
  }
  const activeIndex =
    integerIn(signature.activeParameter, ranges.length) ??
    integerIn(value.activeParameter, ranges.length);
  return {
    pos,
    label,
    active: activeIndex === null ? null : ranges[activeIndex],
    documentation: plainText(signature.documentation, MAX_SIGNATURE_TEXT),
    raw: value as JsonValue,
  };
}

const setSignatureHelp = StateEffect.define<SignatureHelpView | null>();

function signatureTooltip(help: SignatureHelpView): Tooltip {
  return {
    pos: help.pos,
    above: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-signature-help";
      const label = document.createElement("div");
      label.className = "cm-signature-help-label";
      const { active } = help;
      if (active) {
        label.append(help.label.slice(0, active.from));
        const strong = document.createElement("span");
        strong.className = "cm-signature-help-active";
        strong.textContent = help.label.slice(active.from, active.to);
        label.append(strong, help.label.slice(active.to));
      } else {
        label.textContent = help.label;
      }
      dom.appendChild(label);
      if (help.documentation) {
        const documentation = document.createElement("div");
        documentation.className = "cm-signature-help-documentation";
        documentation.textContent = help.documentation;
        dom.appendChild(documentation);
      }
      return { dom };
    },
  };
}

const signatureHelpField = StateField.define<SignatureHelpView | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSignatureHelp)) return effect.value;
    }
    if (!value || !transaction.docChanged) return value;
    return { ...value, pos: transaction.changes.mapPos(value.pos) };
  },
  provide: (field) =>
    showTooltip.from(field, (help) => (help ? signatureTooltip(help) : null)),
});

function typedCharacter(update: ViewUpdate): string | null {
  if (!update.transactions.some((transaction) => transaction.isUserEvent("input.type"))) {
    return null;
  }
  const head = update.state.selection.main.head;
  return head > 0 ? update.state.sliceDoc(head - 1, head) : null;
}

const signatureHelpPlugin = ViewPlugin.define((view) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abort: AbortController | null = null;
  let generation = 0;
  let disposed = false;

  const close = () => {
    if (view.state.field(signatureHelpField, false)) {
      view.dispatch({ effects: setSignatureHelp.of(null) });
    }
  };

  const request = (triggerKind: 1 | 2 | 3, triggerCharacter?: string) => {
    timer = null;
    abort?.abort();
    const current = typstDocument(view, "signatureHelp");
    if (!current) {
      close();
      return;
    }
    const controller = new AbortController();
    abort = controller;
    const requestGeneration = ++generation;
    const text = view.state.doc.toString();
    const head = view.state.selection.main.head;
    const active = view.state.field(signatureHelpField, false);
    void current.session.client
      .requestSignatureHelp(
        {
          textDocument: { uri: current.document.uri },
          position: new TextPositionIndex(text).offsetToPosition(
            head,
            current.session.positionEncoding,
          ),
          context: {
            triggerKind,
            ...(triggerCharacter ? { triggerCharacter } : {}),
            isRetrigger: Boolean(active),
            ...(active ? { activeSignatureHelp: active.raw } : {}),
          },
        },
        requestOptions(current, controller.signal, SIGNATURE_HELP_TIMEOUT_MS),
      )
      .then((response) => {
        if (
          disposed ||
          requestGeneration !== generation ||
          view.state.doc.toString() !== text ||
          !interactiveRequestStillCurrent(current.session, current.document, text)
        ) {
          return;
        }
        view.dispatch({
          effects: setSignatureHelp.of(signatureHelpFromValue(response, head)),
        });
      })
      .catch(() => {
        if (!disposed && requestGeneration === generation) close();
      });
  };

  const schedule = (triggerKind: 1 | 2 | 3, triggerCharacter?: string) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(
      () => request(triggerKind, triggerCharacter),
      SIGNATURE_HELP_DELAY_MS,
    );
  };

  return {
    update(update: ViewUpdate) {
      const active = update.state.field(signatureHelpField, false);
      const typed = typedCharacter(update);
      const session = currentInteractiveLanguageService();
      const triggers = session?.client.supports("signatureHelp")
        ? session.client.capabilities.signatureHelp.triggerCharacters
        : [];
      if (typed && triggers.includes(typed)) {
        schedule(2, typed);
      } else if (active && (update.docChanged || update.selectionSet)) {
        schedule(3);
      }
    },
    destroy() {
      disposed = true;
      ++generation;
      abort?.abort();
      if (timer !== null) clearTimeout(timer);
    },
  };
});

const signatureHelpKeymap = Prec.highest(
  keymap.of([
    {
      key: "Escape",
      run: (view) => {
        if (view.state.field(signatureHelpField, false)) {
          view.dispatch({ effects: setSignatureHelp.of(null) });
        }
        return false;
      },
    },
  ]),
);

class InlayHintWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly paddingLeft: boolean,
    readonly paddingRight: boolean,
  ) {
    super();
  }

  eq(other: InlayHintWidget): boolean {
    return (
      other.label === this.label &&
      other.paddingLeft === this.paddingLeft &&
      other.paddingRight === this.paddingRight
    );
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-inlay-hint";
    span.textContent = `${this.paddingLeft ? " " : ""}${this.label}${this.paddingRight ? " " : ""}`;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function inlayHintLabel(value: unknown): string | null {
  if (typeof value === "string") return value.slice(0, 200) || null;
  if (!Array.isArray(value)) return null;
  const text = value
    .map((part) => (isRecord(part) && typeof part.value === "string" ? part.value : ""))
    .join("");
  return text ? text.slice(0, 200) : null;
}

export function inlayHintDecorations(
  value: unknown,
  text: string,
  encoding: CurrentInteractiveDocument["session"]["positionEncoding"],
): Range<Decoration>[] {
  if (!Array.isArray(value)) return [];
  const index = new TextPositionIndex(text);
  const ranges: Range<Decoration>[] = [];
  for (const hint of value.slice(0, MAX_HINTS)) {
    if (!isRecord(hint) || !isRecord(hint.position)) continue;
    const { line, character } = hint.position;
    if (typeof line !== "number" || typeof character !== "number") continue;
    const offset = strictOffset(index, { line, character }, encoding);
    const label = inlayHintLabel(hint.label);
    if (offset === null || !label) continue;
    ranges.push(
      Decoration.widget({
        widget: new InlayHintWidget(
          label,
          hint.paddingLeft === true,
          hint.paddingRight === true,
        ),
        side: -1,
      }).range(offset),
    );
  }
  return ranges;
}

function colorChannel(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null;
}

export function cssColorFromValue(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const red = colorChannel(value.red);
  const green = colorChannel(value.green);
  const blue = colorChannel(value.blue);
  const alpha = colorChannel(value.alpha);
  if (red === null || green === null || blue === null || alpha === null) {
    return null;
  }
  const byte = (channel: number) => Math.round(channel * 255);
  return `rgba(${byte(red)}, ${byte(green)}, ${byte(blue)}, ${Number(alpha.toFixed(3))})`;
}

class ColorSwatchWidget extends WidgetType {
  constructor(readonly color: string) {
    super();
  }

  eq(other: ColorSwatchWidget): boolean {
    return other.color === this.color;
  }

  toDOM(): HTMLElement {
    const swatch = document.createElement("span");
    swatch.className = "cm-color-swatch";
    swatch.style.backgroundColor = this.color;
    swatch.setAttribute("aria-hidden", "true");
    return swatch;
  }
}

export function colorDecorations(
  value: unknown,
  text: string,
  encoding: CurrentInteractiveDocument["session"]["positionEncoding"],
): Range<Decoration>[] {
  if (!Array.isArray(value)) return [];
  const index = new TextPositionIndex(text);
  const ranges: Range<Decoration>[] = [];
  for (const item of value.slice(0, MAX_HINTS)) {
    if (!isRecord(item)) continue;
    const range = offsetRange(item.range, index, encoding);
    const color = cssColorFromValue(item.color);
    if (!range || !color) continue;
    ranges.push(
      Decoration.widget({ widget: new ColorSwatchWidget(color), side: -1 }).range(
        range.from,
      ),
    );
  }
  return ranges;
}

export interface DocumentLinkTarget extends OffsetRange {
  target: string;
}

export function documentLinksFromValue(
  value: unknown,
  text: string,
  encoding: CurrentInteractiveDocument["session"]["positionEncoding"],
): DocumentLinkTarget[] {
  if (!Array.isArray(value)) return [];
  const index = new TextPositionIndex(text);
  const links: DocumentLinkTarget[] = [];
  for (const item of value.slice(0, MAX_HINTS)) {
    if (!isRecord(item) || typeof item.target !== "string") continue;
    const range = offsetRange(item.range, index, encoding);
    if (range) links.push({ ...range, target: item.target });
  }
  return links;
}

const replaceDecorations = StateEffect.define<{
  key: "inlay" | "color";
  text: string;
  ranges: Range<Decoration>[];
}>();

function decorationField(key: "inlay" | "color") {
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, transaction) {
      let next = value.map(transaction.changes);
      for (const effect of transaction.effects) {
        if (!effect.is(replaceDecorations) || effect.value.key !== key) continue;
        next =
          transaction.state.doc.toString() === effect.value.text
            ? Decoration.set(effect.value.ranges, true)
            : Decoration.none;
      }
      return next;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

const inlayHintField = decorationField("inlay");
const colorField = decorationField("color");

const documentLinks = new WeakMap<EditorState["doc"], DocumentLinkTarget[]>();

export function documentLinkAt(
  state: EditorState,
  pos: number,
): DocumentLinkTarget | null {
  return (
    documentLinks
      .get(state.doc)
      ?.find((link) => pos >= link.from && pos <= link.to) ?? null
  );
}

export function openDocumentLinkTarget(target: string): boolean {
  if (/^https?:\/\//iu.test(target)) {
    void openExternalUrl(target).catch((error: unknown) =>
      logError("open document link", error),
    );
    return true;
  }
  const session = currentInteractiveLanguageService();
  const root = session?.client.workspaceRoot;
  const path = root ? projectPathForUri(root, target) : null;
  if (!path) return false;
  void openProjectLocation({ path }).catch((error: unknown) =>
    logError("open document link", error),
  );
  return true;
}

function inlayHintsEnabled(): boolean {
  return useSettingsStore.getState().typstInlayHints;
}

const documentDecorationsPlugin = ViewPlugin.define((view) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abort: AbortController | null = null;
  let generation = 0;
  let disposed = false;

  const clear = (key: "inlay" | "color") => {
    const field = key === "inlay" ? inlayHintField : colorField;
    if (view.state.field(field, false)?.size) {
      view.dispatch({
        effects: replaceDecorations.of({
          key,
          text: view.state.doc.toString(),
          ranges: [],
        }),
      });
    }
  };

  const refresh = () => {
    timer = null;
    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    const requestGeneration = ++generation;
    const text = view.state.doc.toString();
    const doc = view.state.doc;
    const stillCurrent = (current: CurrentInteractiveDocument) =>
      !disposed &&
      !controller.signal.aborted &&
      requestGeneration === generation &&
      view.state.doc.toString() === text &&
      interactiveRequestStillCurrent(current.session, current.document, text);

    const hints = inlayHintsEnabled() ? typstDocument(view, "inlayHints") : null;
    if (hints) {
      const index = new TextPositionIndex(text);
      const encoding = hints.session.positionEncoding;
      const from = view.visibleRanges[0]?.from ?? 0;
      const to = view.visibleRanges.at(-1)?.to ?? text.length;
      void hints.session.client
        .requestInlayHints(
          {
            textDocument: { uri: hints.document.uri },
            range: {
              start: index.offsetToPosition(from, encoding),
              end: index.offsetToPosition(to, encoding),
            },
          },
          requestOptions(hints, controller.signal, DECORATION_TIMEOUT_MS),
        )
        .then((response) => {
          if (!stillCurrent(hints)) return;
          view.dispatch({
            effects: replaceDecorations.of({
              key: "inlay",
              text,
              ranges: inlayHintDecorations(response, text, encoding),
            }),
          });
        })
        .catch(() => {});
    } else {
      clear("inlay");
    }

    const colors = typstDocument(view, "documentColors");
    if (colors) {
      void colors.session.client
        .requestDocumentColors(
          { textDocument: { uri: colors.document.uri } },
          requestOptions(colors, controller.signal, DECORATION_TIMEOUT_MS),
        )
        .then((response) => {
          if (!stillCurrent(colors)) return;
          view.dispatch({
            effects: replaceDecorations.of({
              key: "color",
              text,
              ranges: colorDecorations(
                response,
                text,
                colors.session.positionEncoding,
              ),
            }),
          });
        })
        .catch(() => {});
    } else {
      clear("color");
    }

    const links = typstDocument(view, "documentLinks");
    if (links) {
      void links.session.client
        .requestDocumentLinks(
          { textDocument: { uri: links.document.uri } },
          requestOptions(links, controller.signal, DECORATION_TIMEOUT_MS),
        )
        .then((response) => {
          if (!stillCurrent(links)) return;
          documentLinks.set(
            doc,
            documentLinksFromValue(response, text, links.session.positionEncoding),
          );
        })
        .catch(() => {});
    }
  };

  const schedule = (delay: number) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(refresh, delay);
  };

  const unsubscribeSession = subscribeInteractiveLanguageService(() => schedule(0));
  const unsubscribeSettings = useSettingsStore.subscribe((state, previous) => {
    if (state.typstInlayHints !== previous.typstInlayHints) schedule(0);
  });
  queueMicrotask(() => {
    if (!disposed) schedule(0);
  });

  return {
    update(update: ViewUpdate) {
      if (update.docChanged) {
        ++generation;
        abort?.abort();
        schedule(DOCUMENT_DECORATION_DELAY_MS);
      } else if (update.viewportChanged && inlayHintsEnabled()) {
        schedule(VIEWPORT_DELAY_MS);
      }
    },
    destroy() {
      disposed = true;
      ++generation;
      abort?.abort();
      if (timer !== null) clearTimeout(timer);
      unsubscribeSession();
      unsubscribeSettings();
    },
  };
});

const documentLinkClicks = Prec.highest(
  EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
      const path = useFilesStore.getState().activePath;
      if (!path || !TYPST_PATH.test(path)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const link = documentLinkAt(view.state, pos);
      if (!link || !openDocumentLinkTarget(link.target)) return false;
      event.preventDefault();
      return true;
    },
  }),
);

const assistTheme = EditorView.baseTheme({
  ".cm-signature-help": {
    maxWidth: "min(36rem, 80vw)",
    padding: "0.375rem 0.625rem",
    fontFamily: "var(--font-mono)",
    fontSize: "0.75rem",
    lineHeight: "1.45",
  },
  ".cm-signature-help-label": {
    whiteSpace: "pre-wrap",
  },
  ".cm-signature-help-active": {
    fontWeight: "700",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  ".cm-signature-help-documentation": {
    marginTop: "0.375rem",
    maxHeight: "8rem",
    overflow: "auto",
    whiteSpace: "pre-wrap",
    opacity: "0.8",
  },
  ".cm-inlay-hint": {
    color: "var(--cm-comment)",
    fontSize: "0.85em",
    opacity: "0.85",
    borderRadius: "3px",
    padding: "0 2px",
    backgroundColor: "color-mix(in srgb, var(--cm-comment) 12%, transparent)",
  },
  ".cm-color-swatch": {
    display: "inline-block",
    width: "0.75em",
    height: "0.75em",
    marginRight: "0.25em",
    verticalAlign: "middle",
    borderRadius: "2px",
    border: "1px solid color-mix(in srgb, currentColor 35%, transparent)",
  },
});

export function languageServiceAssistExtensions(): Extension[] {
  return [
    signatureHelpField,
    signatureHelpPlugin,
    signatureHelpKeymap,
    inlayHintField,
    colorField,
    documentDecorationsPlugin,
    documentLinkClicks,
    assistTheme,
  ];
}
