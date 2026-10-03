import { i18n } from "@/i18n";
import type { DocumentSettingChanges, DocumentSettingState, DocumentSettingsEdit } from "@/features/document-settings";
import type { TypstFontSourceKind } from "@/lib/typst-options";
import {
  latexSettingsEdits,
  latexSupportsSystemFonts,
  readLatexDocumentSettings,
  validateLatexSetting,
  type LatexEnvironment,
  type LatexSettingKey,
} from "@/features/latex-document-settings";
import {
  markdownSettingsEdits,
  readMarkdownDocumentSettings,
  validateMarkdownSetting,
  type MarkdownSettingKey,
} from "@/features/markdown-document-settings";
import {
  parseTypstSource,
  readTypstDocumentSettings,
  typstSettingsEdits,
  validateTypstSetting,
  type TypstSettingChanges,
  type TypstSettingKey,
} from "@/features/typst-document-settings";

export type DocumentSettingsEngine = "typst" | "latex" | "markdown";
export type SettingsSectionId = "page" | "text" | "paragraph" | "numbering";
export type LockedSetting = Extract<DocumentSettingState, { status: "locked" }>;

export interface ProviderContext {
  readonly engineId?: string;
  readonly texFlavor?: string | null;
}

export type ProviderRead =
  | { status: "ready"; fields: Record<string, DocumentSettingState>; notices: string[] }
  | { status: "error"; message: string };

export interface DocumentSettingsProvider {
  readonly id: DocumentSettingsEngine;
  readonly file: RegExp;
  readonly sections: readonly { id: SettingsSectionId; fields: readonly string[] }[];
  readonly selectOptions: Readonly<Record<string, readonly string[]>>;
  readonly fontField: string;
  readonly fontSources: readonly TypstFontSourceKind[];
  description(file: string): string;
  noMainFile(): string;
  read(text: string, context: ProviderContext): Promise<ProviderRead>;
  edits(text: string, changes: DocumentSettingChanges<string>, context: ProviderContext): Promise<DocumentSettingsEdit[]>;
  validate(key: string, value: string): boolean;
  label(key: string): string;
  placeholder(key: string): string | undefined;
  invalid(key: string): string;
  option(key: string, option: string): string;
  locked(state: LockedSetting): string;
}

type TypstPlaceholder = "margin" | "columns" | "font" | "fontSize" | "lang" | "region" | "leading";
const TYPST_PLACEHOLDERS = new Set<string>(["margin", "columns", "font", "fontSize", "lang", "region", "leading"]);

function typstLabel(key: TypstSettingKey): string {
  return i18n.t(($) => $.editor.typstSettings.fields[key]);
}

function lockedMessage(state: LockedSetting): string {
  const name = state.owner ?? "";
  switch (state.reason) {
    case "template":
      return i18n.t(($) => $.editor.typstSettings.locked.template);
    case "class":
      return i18n.t(($) => $.editor.documentSettings.locked.class, { name });
    case "package":
      return i18n.t(($) => $.editor.documentSettings.locked.package, { name });
    case "engine":
      return i18n.t(($) => $.editor.documentSettings.locked.engine);
    case "sides":
      return i18n.t(($) => $.editor.documentSettings.locked.sides);
    case "conditional":
      return i18n.t(($) => $.editor.documentSettings.locked.conditional);
    default:
      return i18n.t(($) => $.editor.typstSettings.locked.expression);
  }
}

const typstProvider: DocumentSettingsProvider = {
  id: "typst",
  file: /\.typ$/iu,
  sections: [
    { id: "page", fields: ["paper", "margin", "columns"] },
    { id: "text", fields: ["font", "fontSize", "lang", "region"] },
    { id: "paragraph", fields: ["justify", "leading"] },
    { id: "numbering", fields: ["headingNumbering", "equationNumbering"] },
  ],
  selectOptions: {
    paper: ["a4", "a5", "a3", "us-letter", "us-legal", "iso-b5"],
    justify: ["true", "false"],
    headingNumbering: ["none", "1.", "1.1", "1.1.1", "1.a", "I.", "A."],
    equationNumbering: ["none", "(1)", "(1.1)", "1"],
  },
  fontField: "font",
  fontSources: ["project", "system", "embedded"],
  description: (file) => i18n.t(($) => $.editor.typstSettings.description, { file }),
  noMainFile: () => i18n.t(($) => $.editor.typstSettings.noMainFile),
  async read(text) {
    const settings = readTypstDocumentSettings(text, await parseTypstSource(text));
    return {
      status: "ready",
      fields: settings.fields,
      notices: settings.templateApplied ? [i18n.t(($) => $.editor.typstSettings.templateNotice)] : [],
    };
  },
  async edits(text, changes) {
    return typstSettingsEdits(text, await parseTypstSource(text), changes as TypstSettingChanges);
  },
  validate: (key, value) => validateTypstSetting(key as TypstSettingKey, value),
  label: (key) => typstLabel(key as TypstSettingKey),
  placeholder: (key) =>
    TYPST_PLACEHOLDERS.has(key) ? i18n.t(($) => $.editor.typstSettings.placeholders[key as TypstPlaceholder]) : undefined,
  invalid(key) {
    switch (key) {
      case "margin":
        return i18n.t(($) => $.editor.typstSettings.invalid.margin);
      case "columns":
        return i18n.t(($) => $.editor.typstSettings.invalid.columns);
      case "lang":
        return i18n.t(($) => $.editor.typstSettings.invalid.lang);
      case "region":
        return i18n.t(($) => $.editor.typstSettings.invalid.region);
      default:
        return i18n.t(($) => $.editor.typstSettings.invalid.length);
    }
  },
  option(key, option) {
    if (option === "none") return i18n.t(($) => $.editor.typstSettings.options.off);
    if (key === "justify") {
      return option === "true"
        ? i18n.t(($) => $.editor.typstSettings.options.justified)
        : i18n.t(($) => $.editor.typstSettings.options.ragged);
    }
    return option;
  },
  locked: lockedMessage,
};

function sharedLabel(key: string): string {
  switch (key) {
    case "paper":
    case "margin":
    case "columns":
    case "font":
    case "fontSize":
    case "lang":
    case "equationNumbering":
      return typstLabel(key);
    case "lineSpacing":
      return typstLabel("leading");
    case "secnumdepth":
      return i18n.t(($) => $.editor.documentSettings.fields.secnumdepth);
    case "numberSections":
      return i18n.t(($) => $.editor.documentSettings.fields.numberSections);
    default:
      return i18n.t(($) => $.editor.documentSettings.fields.documentClass);
  }
}

const SHARED_OPTION_LABELS: ReadonlyMap<string, ReadonlyMap<string, () => string>> = new Map([
  [
    "columns",
    new Map([
      ["onecolumn", () => i18n.t(($) => $.editor.documentSettings.options.onecolumn)],
      ["twocolumn", () => i18n.t(($) => $.editor.documentSettings.options.twocolumn)],
    ]),
  ],
  [
    "lineSpacing",
    new Map([
      ["single", () => i18n.t(($) => $.editor.documentSettings.options.single)],
      ["onehalf", () => i18n.t(($) => $.editor.documentSettings.options.onehalf)],
      ["double", () => i18n.t(($) => $.editor.documentSettings.options.double)],
    ]),
  ],
  [
    "equationNumbering",
    new Map([
      ["section", () => i18n.t(($) => $.editor.documentSettings.options.bySection)],
      ["chapter", () => i18n.t(($) => $.editor.documentSettings.options.byChapter)],
      ["subsection", () => i18n.t(($) => $.editor.documentSettings.options.bySubsection)],
    ]),
  ],
  [
    "numberSections",
    new Map([
      ["true", () => i18n.t(($) => $.editor.documentSettings.options.numbered)],
      ["false", () => i18n.t(($) => $.editor.documentSettings.options.unnumbered)],
    ]),
  ],
]);

function sharedOption(key: string, option: string): string {
  if (key === "secnumdepth") return depthLabel(option);
  const label = SHARED_OPTION_LABELS.get(key)?.get(option);
  return label ? label() : option;
}

function depthLabel(option: string): string {
  switch (option) {
    case "-1":
      return i18n.t(($) => $.editor.documentSettings.options.depthNone);
    case "0":
      return i18n.t(($) => $.editor.documentSettings.options.depthChapters);
    case "1":
      return i18n.t(($) => $.editor.documentSettings.options.depthSections);
    case "2":
      return i18n.t(($) => $.editor.documentSettings.options.depthSubsections);
    case "3":
      return i18n.t(($) => $.editor.documentSettings.options.depthSubsubsections);
    case "4":
      return i18n.t(($) => $.editor.documentSettings.options.depthParagraphs);
    case "5":
      return i18n.t(($) => $.editor.documentSettings.options.depthSubparagraphs);
    default:
      return option;
  }
}

function sharedPlaceholder(key: string, engine: "latex" | "markdown"): string | undefined {
  switch (key) {
    case "margin":
      return i18n.t(($) => $.editor.typstSettings.placeholders.margin);
    case "font":
      return i18n.t(($) => $.editor.typstSettings.placeholders.font);
    case "lang":
      return engine === "latex"
        ? i18n.t(($) => $.editor.documentSettings.placeholders.latexLang)
        : i18n.t(($) => $.editor.documentSettings.placeholders.markdownLang);
    case "lineSpacing":
      return i18n.t(($) => $.editor.documentSettings.placeholders.lineStretch);
    default:
      return undefined;
  }
}

function sharedInvalid(key: string, engine: "latex" | "markdown"): string {
  switch (key) {
    case "font":
      return i18n.t(($) => $.editor.documentSettings.invalid.fontName);
    case "lang":
      return engine === "latex"
        ? i18n.t(($) => $.editor.documentSettings.invalid.latexLang)
        : i18n.t(($) => $.editor.documentSettings.invalid.markdownLang);
    case "lineSpacing":
      return i18n.t(($) => $.editor.documentSettings.invalid.lineStretch);
    default:
      return i18n.t(($) => $.editor.documentSettings.invalid.length);
  }
}

function latexEnvironment(text: string, context: ProviderContext): LatexEnvironment {
  return { unicodeFonts: latexSupportsSystemFonts(context.engineId, context.texFlavor, text) };
}

const latexProvider: DocumentSettingsProvider = {
  id: "latex",
  file: /\.(?:tex|ltx|latex)$/iu,
  sections: [
    { id: "page", fields: ["paper", "columns", "margin"] },
    { id: "text", fields: ["font", "fontSize", "lang"] },
    { id: "paragraph", fields: ["lineSpacing"] },
    { id: "numbering", fields: ["secnumdepth", "equationNumbering"] },
  ],
  selectOptions: {
    paper: ["a4paper", "letterpaper", "a5paper", "b5paper", "legalpaper", "executivepaper"],
    columns: ["onecolumn", "twocolumn"],
    fontSize: ["10pt", "11pt", "12pt"],
    lineSpacing: ["single", "onehalf", "double"],
    secnumdepth: ["-1", "0", "1", "2", "3", "4", "5"],
    equationNumbering: ["section", "chapter", "subsection"],
  },
  fontField: "font",
  fontSources: ["system"],
  description: (file) => i18n.t(($) => $.editor.documentSettings.latexDescription, { file }),
  noMainFile: () => i18n.t(($) => $.editor.documentSettings.noLatexMainFile),
  read(text, context) {
    const settings = readLatexDocumentSettings(text, latexEnvironment(text, context));
    if (!settings.documentClass) {
      return Promise.resolve({ status: "error", message: i18n.t(($) => $.editor.documentSettings.noDocumentClass) });
    }
    const notices: string[] = [];
    if (settings.lockingClass) {
      notices.push(i18n.t(($) => $.editor.documentSettings.classNotice, { name: settings.lockingClass }));
    }
    if (settings.layoutStyle) {
      notices.push(i18n.t(($) => $.editor.documentSettings.styleNotice, { name: settings.layoutStyle }));
    }
    if (settings.externalPreamble) notices.push(i18n.t(($) => $.editor.documentSettings.externalPreamble));
    return Promise.resolve({ status: "ready", fields: settings.fields, notices });
  },
  edits(text, changes, context) {
    return Promise.resolve(latexSettingsEdits(text, changes, latexEnvironment(text, context)));
  },
  validate: (key, value) => validateLatexSetting(key as LatexSettingKey, value),
  label: sharedLabel,
  placeholder: (key) => sharedPlaceholder(key, "latex"),
  invalid: (key) => sharedInvalid(key, "latex"),
  option: sharedOption,
  locked: lockedMessage,
};

const markdownProvider: DocumentSettingsProvider = {
  id: "markdown",
  file: /\.(?:md|markdown)$/iu,
  sections: [
    { id: "page", fields: ["documentClass", "paper", "columns", "margin"] },
    { id: "text", fields: ["font", "fontSize", "lang"] },
    { id: "paragraph", fields: ["lineSpacing"] },
    { id: "numbering", fields: ["numberSections"] },
  ],
  selectOptions: {
    documentClass: ["article", "report", "book", "scrartcl", "scrreprt", "memoir"],
    paper: ["a4", "letter", "a5", "legal"],
    columns: ["onecolumn", "twocolumn"],
    fontSize: ["10pt", "11pt", "12pt"],
    numberSections: ["true", "false"],
  },
  fontField: "font",
  fontSources: ["system"],
  description: (file) => i18n.t(($) => $.editor.documentSettings.markdownDescription, { file }),
  noMainFile: () => i18n.t(($) => $.editor.documentSettings.noMarkdownMainFile),
  read(text) {
    const settings = readMarkdownDocumentSettings(text);
    if (settings.frontMatter === "unclosed") {
      return Promise.resolve({ status: "error", message: i18n.t(($) => $.editor.documentSettings.unclosedFrontMatter) });
    }
    const notices = settings.frontMatter === "absent" ? [i18n.t(($) => $.editor.documentSettings.noFrontMatter)] : [];
    return Promise.resolve({ status: "ready", fields: settings.fields, notices });
  },
  edits(text, changes) {
    return Promise.resolve(markdownSettingsEdits(text, changes));
  },
  validate: (key, value) => validateMarkdownSetting(key as MarkdownSettingKey, value),
  label: sharedLabel,
  placeholder: (key) => sharedPlaceholder(key, "markdown"),
  invalid: (key) => sharedInvalid(key, "markdown"),
  option: sharedOption,
  locked: lockedMessage,
};

const PROVIDERS: readonly DocumentSettingsProvider[] = [typstProvider, latexProvider, markdownProvider];

export function documentSettingsProvider(engineId: string | undefined, mainDoc: string): DocumentSettingsProvider {
  if (engineId === "typst") return typstProvider;
  if (engineId === "latex" || engineId === "latexmk") return latexProvider;
  if (engineId === "markdown") return markdownProvider;
  return PROVIDERS.find((provider) => provider.file.test(mainDoc)) ?? typstProvider;
}
