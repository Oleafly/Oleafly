import { Prec, type Extension } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { i18n } from "@/i18n";
import {
  currentInteractiveDocument,
  interactiveRequestStillCurrent,
} from "@/lib/analysis/interactive-document";
import { currentInteractiveLanguageService } from "@/lib/analysis/interactive-language-service";
import { offsetEdits } from "@/lib/analysis/language-service-results";
import { TextPositionIndex } from "@/lib/language-service";
import { logError } from "@/lib/log";
import { getEditorView } from "./controller";
import { toast } from "@/lib/toast";
import { reportFileSaveFailure, useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

export type FormatScope = "document" | "selection";

export type FormatOutcome =
  | "formatted"
  | "unchanged"
  | "unavailable"
  | "stale"
  | "failed";

export const LANGUAGE_SERVICE_FORMAT_TOAST_KEY = "language-service:format";

const FORMAT_TIMEOUT_MS = 8_000;
const TYPST_PATH = /\.typ$/i;

function formattingFeature(
  view: EditorView,
  scope: FormatScope,
): "formatting" | "rangeFormatting" {
  return scope === "selection" && !view.state.selection.main.empty
    ? "rangeFormatting"
    : "formatting";
}

export function languageServiceFormattingAvailable(): boolean {
  const files = useFilesStore.getState();
  const path = files.activePath;
  const session = currentInteractiveLanguageService();
  return Boolean(
    path &&
      TYPST_PATH.test(path) &&
      session &&
      session.projectId === files.projectId &&
      session.client.supports("formatting") &&
      session.documentForPath(path),
  );
}

function reportFormatProblem(outcome: "unavailable" | "failed"): void {
  toast.infoUnique(
    LANGUAGE_SERVICE_FORMAT_TOAST_KEY,
    outcome === "unavailable"
      ? i18n.t(($) => $.editor.languageService.formatUnavailable)
      : i18n.t(($) => $.editor.languageService.formatFailed),
  );
}

async function requestFormattingEdits(
  view: EditorView,
  scope: FormatScope,
  quiet: boolean,
): Promise<FormatOutcome> {
  const path = useFilesStore.getState().activePath;
  const text = view.state.doc.toString();
  const current =
    path && TYPST_PATH.test(path)
      ? currentInteractiveDocument(path, text)
      : null;
  const feature = formattingFeature(view, scope);
  if (!current?.session.client.supports(feature)) {
    if (!quiet) reportFormatProblem("unavailable");
    return "unavailable";
  }
  const { session, document } = current;
  const encoding = session.positionEncoding;
  const textDocument = { uri: document.uri };
  const options = {
    tabSize: useSettingsStore.getState().typstFormatterIndent,
    insertSpaces: true,
  };
  const requestOptions = {
    timeoutMs: FORMAT_TIMEOUT_MS,
    projectRevision: session.projectRevision,
    documentUri: document.uri,
    documentVersion: document.version,
  };
  let response: unknown;
  try {
    if (feature === "rangeFormatting") {
      const positions = new TextPositionIndex(text);
      const { from, to } = view.state.selection.main;
      response = await session.client.requestRangeFormatting(
        {
          textDocument,
          options,
          range: {
            start: positions.offsetToPosition(from, encoding),
            end: positions.offsetToPosition(to, encoding),
          },
        },
        requestOptions,
      );
    } else {
      response = await session.client.requestFormatting(
        { textDocument, options },
        requestOptions,
      );
    }
  } catch (error) {
    if (view.state.doc.toString() !== text) return "stale";
    void logError("language-service format", error);
    if (!quiet) reportFormatProblem("failed");
    return "failed";
  }
  if (
    view.state.doc.toString() !== text ||
    !interactiveRequestStillCurrent(session, document, text)
  ) {
    return "stale";
  }
  const edits = offsetEdits(response, text, encoding);
  if (!edits) {
    if (!quiet) reportFormatProblem("failed");
    return "failed";
  }
  const changes = edits
    .filter((edit) => text.slice(edit.from, edit.to) !== edit.insert)
    .sort((left, right) => left.from - right.from);
  if (changes.length === 0) return "unchanged";
  view.dispatch({ changes, userEvent: "input.format" });
  return "formatted";
}

export function formatWithLanguageService(
  view: EditorView,
  scope: FormatScope = "document",
  options: { quiet?: boolean } = {},
): Promise<FormatOutcome> {
  return requestFormattingEdits(view, scope, options.quiet === true);
}

export function formatsOnSave(path: string | null): boolean {
  return Boolean(
    path && TYPST_PATH.test(path) && useSettingsStore.getState().typstFormatOnSave,
  );
}

export async function formatBeforeSave(view: EditorView): Promise<void> {
  if (!formatsOnSave(useFilesStore.getState().activePath)) return;
  try {
    await formatWithLanguageService(view, "document", { quiet: true });
  } catch (error) {
    void logError("format before save", error);
  }
}

export async function formatActiveBeforeSave(): Promise<void> {
  const view = getEditorView();
  if (view) await formatBeforeSave(view);
}

async function saveFormattedFile(projectId: string | null, path: string | null): Promise<void> {
  const files = useFilesStore.getState();
  if (!projectId || !path || files.projectId !== projectId) return;
  await files.saveFile(path, { overwrite: true });
}

export async function saveTypstDocument(view: EditorView): Promise<void> {
  const { projectId, activePath } = useFilesStore.getState();
  await formatBeforeSave(view);
  try {
    await saveFormattedFile(projectId, activePath);
  } catch (error) {
    if (projectId && activePath) {
      reportFileSaveFailure("editor save", projectId, activePath, error, true);
    } else {
      void logError("editor save", error);
    }
  }
}

function activeTypstPath(): boolean {
  const path = useFilesStore.getState().activePath;
  return Boolean(path && TYPST_PATH.test(path));
}

export function languageServiceFormattingKeymap(): Extension {
  return Prec.high(
    keymap.of([
      {
        key: "Shift-Alt-f",
        run: (view) => {
          if (!activeTypstPath()) return false;
          void formatWithLanguageService(view, "document");
          return true;
        },
      },
      {
        key: "Mod-s",
        run: (view) => {
          if (!activeTypstPath()) return false;
          void saveTypstDocument(view);
          return true;
        },
      },
    ]),
  );
}
