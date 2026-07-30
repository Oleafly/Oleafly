import {
  DEFAULT_POSITION_ENCODING,
  type Position,
  type PositionEncoding,
} from "./position";
import { JsonRpcProtocolError, type JsonValue } from "./json-rpc";

export type DocumentUri = string;

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: DocumentUri;
  range: Range;
}

export interface TextDocumentIdentifier {
  uri: DocumentUri;
}

export interface VersionedTextDocumentIdentifier
  extends TextDocumentIdentifier {
  version: number;
}

export interface TextDocumentItem extends VersionedTextDocumentIdentifier {
  languageId: string;
  text: string;
}

export interface TextDocumentPositionParams {
  textDocument: TextDocumentIdentifier;
  position: Position;
}

export interface CompletionContext {
  triggerKind: 1 | 2 | 3;
  triggerCharacter?: string;
}

export interface CompletionParams extends TextDocumentPositionParams {
  context?: CompletionContext;
}

export type HoverParams = TextDocumentPositionParams;
export type DefinitionParams = TextDocumentPositionParams;

export interface ReferenceContext {
  includeDeclaration: boolean;
}

export interface ReferenceParams extends TextDocumentPositionParams {
  context: ReferenceContext;
}

export interface DocumentSymbolParams {
  textDocument: TextDocumentIdentifier;
}

export interface WorkspaceSymbolParams {
  query: string;
}

export interface DocumentDiagnosticParams {
  textDocument: TextDocumentIdentifier;
  identifier?: string;
  previousResultId?: string;
}

export interface PreviousResultId {
  uri: DocumentUri;
  value: string;
}

export interface WorkspaceDiagnosticParams {
  identifier?: string;
  previousResultIds: PreviousResultId[];
}

export interface SemanticTokensParams {
  textDocument: TextDocumentIdentifier;
}

export interface SemanticTokensRangeParams extends SemanticTokensParams {
  range: Range;
}

export interface DidOpenTextDocumentParams {
  textDocument: TextDocumentItem;
}

export interface TextDocumentContentChangeEvent {
  range?: Range;
  rangeLength?: number;
  text: string;
}

export interface DidChangeTextDocumentParams {
  textDocument: VersionedTextDocumentIdentifier;
  contentChanges: TextDocumentContentChangeEvent[];
}

export interface DidCloseTextDocumentParams {
  textDocument: TextDocumentIdentifier;
}

export interface DidSaveTextDocumentParams {
  textDocument: TextDocumentIdentifier;
  text?: string;
}

export interface Diagnostic {
  range: Range;
  severity?: 1 | 2 | 3 | 4;
  code?: string | number;
  codeDescription?: { href: string };
  source?: string;
  message: string;
  tags?: Array<1 | 2>;
  data?: JsonValue;
}

export interface PublishDiagnosticsParams {
  uri: DocumentUri;
  version?: number;
  diagnostics: Diagnostic[];
}

export interface ClientInfo {
  name: string;
  version?: string;
}

export interface WorkspaceFolder {
  uri: DocumentUri;
  name: string;
}

export interface InitializeParams {
  processId: number | null;
  rootUri: DocumentUri | null;
  clientInfo?: ClientInfo;
  locale?: string;
  initializationOptions?: JsonValue;
  workspaceFolders?: WorkspaceFolder[] | null;
  capabilities: {
    general: {
      positionEncodings: PositionEncoding[];
    };
    textDocument: {
      completion: Record<string, never>;
      hover: Record<string, never>;
      definition: Record<string, never>;
      references: Record<string, never>;
      documentSymbol: Record<string, never>;
      publishDiagnostics: { versionSupport: true };
      diagnostic: Record<string, never>;
      semanticTokens: {
        requests: { range: boolean; full: boolean };
        tokenTypes: string[];
        tokenModifiers: string[];
        formats: ["relative"];
      };
    };
    workspace: {
      symbol: Record<string, never>;
      diagnostics: { refreshSupport: boolean };
    };
  };
}

export interface InitializeOptions {
  processId?: number | null;
  rootUri: DocumentUri | null;
  clientInfo?: ClientInfo;
  locale?: string;
  initializationOptions?: JsonValue;
  workspaceFolders?: WorkspaceFolder[] | null;
}

export interface SemanticTokensLegend {
  tokenTypes: string[];
  tokenModifiers: string[];
}

export const STANDARD_SEMANTIC_TOKEN_TYPES = [
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
  "decorator",
] as const;

export const STANDARD_SEMANTIC_TOKEN_MODIFIERS = [
  "declaration",
  "definition",
  "readonly",
  "static",
  "deprecated",
  "abstract",
  "async",
  "modification",
  "documentation",
  "defaultLibrary",
] as const;

export interface NegotiatedServerCapabilities {
  positionEncoding: PositionEncoding;
  completion: boolean;
  hover: boolean;
  definition: boolean;
  references: boolean;
  documentSymbols: boolean;
  workspaceSymbols: boolean;
  diagnostics: {
    document: boolean;
    workspace: boolean;
  };
  semanticTokens: {
    full: boolean;
    range: boolean;
    legend: SemanticTokensLegend | null;
  };
  textDocumentSync: {
    openClose: boolean;
    change: "none" | "full" | "incremental";
    save: {
      enabled: boolean;
      includeText: boolean;
    };
  };
}

export const EMPTY_SERVER_CAPABILITIES: NegotiatedServerCapabilities = {
  positionEncoding: DEFAULT_POSITION_ENCODING,
  completion: false,
  hover: false,
  definition: false,
  references: false,
  documentSymbols: false,
  workspaceSymbols: false,
  diagnostics: { document: false, workspace: false },
  semanticTokens: { full: false, range: false, legend: null },
  textDocumentSync: {
    openClose: false,
    change: "none",
    save: { enabled: false, includeText: false },
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isAdvertised = (value: unknown): boolean =>
  value === true || isRecord(value);

const isPositionEncoding = (
  value: unknown,
): value is PositionEncoding =>
  value === "utf-8" || value === "utf-16" || value === "utf-32";

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return null;
  }
  return [...value];
}

function semanticTokenCapabilities(value: unknown) {
  if (!isRecord(value)) {
    return { full: false, range: false, legend: null };
  }
  const legendValue = value.legend;
  const tokenTypes = isRecord(legendValue)
    ? stringArray(legendValue.tokenTypes)
    : null;
  const tokenModifiers = isRecord(legendValue)
    ? stringArray(legendValue.tokenModifiers)
    : null;
  const legend =
    tokenTypes && tokenModifiers ? { tokenTypes, tokenModifiers } : null;
  const full = value.full === true || isRecord(value.full);
  const range = value.range === true || isRecord(value.range);
  return { full, range, legend };
}

function textDocumentSyncCapabilities(
  value: unknown,
): NegotiatedServerCapabilities["textDocumentSync"] {
  const changeKind = (
    candidate: unknown,
  ): "none" | "full" | "incremental" | null => {
    if (candidate === 0) return "none";
    if (candidate === 1) return "full";
    if (candidate === 2) return "incremental";
    return null;
  };
  if (typeof value === "number") {
    const change = changeKind(value);
    if (!change) {
      throw new JsonRpcProtocolError(
        `Language server advertised invalid textDocumentSync kind: ${String(value)}`,
      );
    }
    return {
      openClose: change !== "none",
      change,
      save: { enabled: false, includeText: false },
    };
  }
  if (value === undefined || value === null) {
    return {
      openClose: false,
      change: "none",
      save: { enabled: false, includeText: false },
    };
  }
  if (!isRecord(value)) {
    throw new JsonRpcProtocolError(
      "Language server advertised malformed textDocumentSync options",
    );
  }
  const change =
    value.change === undefined ? "none" : changeKind(value.change);
  if (!change) {
    throw new JsonRpcProtocolError(
      `Language server advertised invalid textDocumentSync change kind: ${String(value.change)}`,
    );
  }
  if (
    value.openClose !== undefined &&
    typeof value.openClose !== "boolean"
  ) {
    throw new JsonRpcProtocolError(
      "Language server advertised malformed textDocumentSync openClose",
    );
  }
  const saveValue = value.save;
  if (
    isRecord(saveValue) &&
    saveValue.includeText !== undefined &&
    typeof saveValue.includeText !== "boolean"
  ) {
    throw new JsonRpcProtocolError(
      "Language server advertised malformed textDocumentSync save options",
    );
  }
  if (
    saveValue !== undefined &&
    saveValue !== false &&
    saveValue !== true &&
    !isRecord(saveValue)
  ) {
    throw new JsonRpcProtocolError(
      "Language server advertised malformed textDocumentSync save capability",
    );
  }
  const save = saveValue === true
    ? { enabled: true, includeText: false }
    : isRecord(saveValue)
      ? {
          enabled: true,
          includeText: saveValue.includeText === true,
        }
      : { enabled: false, includeText: false };
  return {
    openClose: value.openClose === true,
    change,
    save,
  };
}

export function negotiateServerCapabilities(
  initializeResult: unknown,
  offeredPositionEncodings: readonly PositionEncoding[],
): NegotiatedServerCapabilities {
  if (!isRecord(initializeResult) || !isRecord(initializeResult.capabilities)) {
    throw new JsonRpcProtocolError(
      "Language server initialize result has no capabilities object",
    );
  }
  const capabilities = initializeResult.capabilities;
  const advertisedEncoding = capabilities.positionEncoding;
  const positionEncoding =
    advertisedEncoding === undefined
      ? DEFAULT_POSITION_ENCODING
      : isPositionEncoding(advertisedEncoding) &&
          offeredPositionEncodings.includes(advertisedEncoding)
        ? advertisedEncoding
        : null;
  if (!positionEncoding) {
    throw new JsonRpcProtocolError(
      `Language server selected unsupported position encoding: ${String(advertisedEncoding)}`,
    );
  }

  const diagnosticProvider = capabilities.diagnosticProvider;
  const semanticTokens = semanticTokenCapabilities(
    capabilities.semanticTokensProvider,
  );
  return {
    positionEncoding,
    completion: isAdvertised(capabilities.completionProvider),
    hover: isAdvertised(capabilities.hoverProvider),
    definition: isAdvertised(capabilities.definitionProvider),
    references: isAdvertised(capabilities.referencesProvider),
    documentSymbols: isAdvertised(capabilities.documentSymbolProvider),
    workspaceSymbols: isAdvertised(capabilities.workspaceSymbolProvider),
    diagnostics: {
      document: isRecord(diagnosticProvider),
      workspace:
        isRecord(diagnosticProvider) &&
        diagnosticProvider.workspaceDiagnostics === true,
    },
    semanticTokens,
    textDocumentSync: textDocumentSyncCapabilities(
      capabilities.textDocumentSync,
    ),
  };
}

export function createInitializeParams(
  options: InitializeOptions,
  positionEncodings: PositionEncoding[],
): InitializeParams {
  return {
    processId: options.processId ?? null,
    rootUri: options.rootUri,
    ...(options.clientInfo ? { clientInfo: options.clientInfo } : {}),
    ...(options.locale ? { locale: options.locale } : {}),
    ...(options.initializationOptions !== undefined
      ? { initializationOptions: options.initializationOptions }
      : {}),
    ...(options.workspaceFolders !== undefined
      ? { workspaceFolders: options.workspaceFolders }
      : {}),
    capabilities: {
      general: { positionEncodings },
      textDocument: {
        completion: {},
        hover: {},
        definition: {},
        references: {},
        documentSymbol: {},
        publishDiagnostics: { versionSupport: true },
        diagnostic: {},
        semanticTokens: {
          requests: { range: true, full: true },
          tokenTypes: [...STANDARD_SEMANTIC_TOKEN_TYPES],
          tokenModifiers: [...STANDARD_SEMANTIC_TOKEN_MODIFIERS],
          formats: ["relative"],
        },
      },
      workspace: {
        symbol: {},
        diagnostics: { refreshSupport: true },
      },
    },
  };
}

function isPosition(value: unknown): value is Position {
  return (
    isRecord(value) &&
    typeof value.line === "number" &&
    Number.isInteger(value.line) &&
    value.line >= 0 &&
    typeof value.character === "number" &&
    Number.isInteger(value.character) &&
    value.character >= 0
  );
}

function isRange(value: unknown): value is Range {
  return (
    isRecord(value) &&
    isPosition(value.start) &&
    isPosition(value.end)
  );
}

export function isDiagnostic(value: unknown): value is Diagnostic {
  if (!isRecord(value)) return false;
  return (
    isRange(value.range) &&
    typeof value.message === "string" &&
    (value.severity === undefined ||
      value.severity === 1 ||
      value.severity === 2 ||
      value.severity === 3 ||
      value.severity === 4) &&
    (value.code === undefined ||
      typeof value.code === "string" ||
      typeof value.code === "number") &&
    (value.source === undefined || typeof value.source === "string") &&
    (value.data === undefined ||
      value.data === null ||
      typeof value.data === "string" ||
      typeof value.data === "number" ||
      typeof value.data === "boolean" ||
      Array.isArray(value.data) ||
      isRecord(value.data))
  );
}

export function isPublishDiagnosticsParams(
  value: unknown,
): value is PublishDiagnosticsParams {
  if (!isRecord(value)) return false;
  return (
    typeof value.uri === "string" &&
    (value.version === undefined ||
      (typeof value.version === "number" &&
        Number.isInteger(value.version))) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(isDiagnostic)
  );
}
