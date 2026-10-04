import { describe, expect, it } from "vitest";
import {
  createInitializeParams,
  isDiagnostic,
  isPublishDiagnosticsParams,
  negotiateServerCapabilities,
} from "./protocol";

const offered = ["utf-8", "utf-16", "utf-32"] as const;

describe("textDocumentSync negotiation", () => {
  it.each([
    [
      0,
      {
        openClose: false,
        change: "none",
        save: { enabled: false, includeText: false },
      },
    ],
    [
      1,
      {
        openClose: true,
        change: "full",
        save: { enabled: false, includeText: false },
      },
    ],
    [
      2,
      {
        openClose: true,
        change: "incremental",
        save: { enabled: false, includeText: false },
      },
    ],
  ])("parses numeric synchronization kind %s", (value, expected) => {
    expect(
      negotiateServerCapabilities(
        { capabilities: { textDocumentSync: value } },
        [...offered],
      ).textDocumentSync,
    ).toEqual(expected);
  });

  it("parses open/close and save options without inventing defaults", () => {
    expect(
      negotiateServerCapabilities(
        {
          capabilities: {
            textDocumentSync: {
              openClose: true,
              change: 2,
              save: { includeText: true },
            },
          },
        },
        [...offered],
      ).textDocumentSync,
    ).toEqual({
      openClose: true,
      change: "incremental",
      save: { enabled: true, includeText: true },
    });
  });

  it("fails closed on malformed synchronization capabilities", () => {
    expect(() =>
      negotiateServerCapabilities(
        { capabilities: { textDocumentSync: 3 } },
        [...offered],
      ),
    ).toThrow("invalid textDocumentSync");
    expect(() =>
      negotiateServerCapabilities(
        {
          capabilities: {
            textDocumentSync: { change: "incremental" },
          },
        },
        [...offered],
      ),
    ).toThrow("invalid textDocumentSync");
  });
});

const TINYMIST_CAPABILITIES = {
  positionEncoding: "utf-16",
  colorProvider: true,
  completionProvider: {
    triggerCharacters: ["#", "(", "<", ",", ".", ":", "/", "\"", "@"],
  },
  documentFormattingProvider: true,
  documentLinkProvider: {},
  documentRangeFormattingProvider: true,
  executeCommandProvider: {
    commands: ["tinymist.pinMain", "tinymist.focusMain"],
  },
  inlayHintProvider: true,
  renameProvider: { prepareProvider: true },
  signatureHelpProvider: { triggerCharacters: ["(", ",", ":"] },
  textDocumentSync: { change: 2, openClose: true, save: true },
};

describe("Tinymist capability negotiation", () => {
  it("reads the editing features Tinymist 0.15.8 advertises", () => {
    const negotiated = negotiateServerCapabilities(
      { capabilities: TINYMIST_CAPABILITIES },
      [...offered],
    );
    expect(negotiated.completionTriggerCharacters).toEqual(
      TINYMIST_CAPABILITIES.completionProvider.triggerCharacters,
    );
    expect(negotiated.signatureHelp).toEqual({
      enabled: true,
      triggerCharacters: ["(", ",", ":"],
      retriggerCharacters: [],
    });
    expect(negotiated.inlayHints).toBe(true);
    expect(negotiated.documentLinks).toBe(true);
    expect(negotiated.documentColors).toBe(true);
    expect(negotiated.formatting).toBe(true);
    expect(negotiated.rangeFormatting).toBe(true);
    expect(negotiated.rename).toEqual({ enabled: true, prepare: true });
    expect(negotiated.executeCommands).toEqual([
      "tinymist.pinMain",
      "tinymist.focusMain",
    ]);
  });

  it("treats a missing or false provider as unsupported", () => {
    const negotiated = negotiateServerCapabilities(
      {
        capabilities: {
          renameProvider: true,
          colorProvider: false,
          executeCommandProvider: { commands: ["ok", 3] },
        },
      },
      [...offered],
    );
    expect(negotiated.rename).toEqual({ enabled: true, prepare: false });
    expect(negotiated.documentColors).toBe(false);
    expect(negotiated.signatureHelp.enabled).toBe(false);
    expect(negotiated.inlayHints).toBe(false);
    expect(negotiated.formatting).toBe(false);
    expect(negotiated.executeCommands).toEqual(["ok"]);
    expect(negotiated.completionTriggerCharacters).toEqual([]);
  });
});

describe("initialize request", () => {
  it("offers the editing features the editor renders", () => {
    const params = createInitializeParams({ rootUri: "file:///p" }, ["utf-16"]);
    expect(params.capabilities.textDocument).toMatchObject({
      signatureHelp: {
        contextSupport: true,
        signatureInformation: {
          activeParameterSupport: true,
          parameterInformation: { labelOffsetSupport: true },
        },
      },
      inlayHint: {},
      documentLink: {},
      colorProvider: {},
      formatting: {},
      rangeFormatting: {},
      rename: { prepareSupport: true },
    });
    expect(params.capabilities.workspace).toMatchObject({
      executeCommand: {},
      didChangeConfiguration: {},
      workspaceEdit: {
        documentChanges: true,
        resourceOperations: ["rename"],
      },
    });
  });
});

describe("capability negotiation edge cases", () => {
  it("needs a complete string legend before exposing semantic tokens", () => {
    const tokens = (semanticTokensProvider: unknown) =>
      negotiateServerCapabilities(
        { capabilities: { semanticTokensProvider } },
        [...offered],
      ).semanticTokens;
    expect(
      tokens({
        legend: { tokenTypes: ["macro", 3], tokenModifiers: [] },
        full: { delta: true },
        range: true,
      }),
    ).toEqual({ full: true, range: true, legend: null });
    expect(tokens({ legend: "none", full: false })).toEqual({
      full: false,
      range: false,
      legend: null,
    });
    expect(
      tokens({ legend: { tokenTypes: ["macro"], tokenModifiers: ["bold"] } }),
    ).toEqual({
      full: false,
      range: false,
      legend: { tokenTypes: ["macro"], tokenModifiers: ["bold"] },
    });
  });

  it("enables signature help advertised as a bare flag", () => {
    expect(
      negotiateServerCapabilities(
        { capabilities: { signatureHelpProvider: true } },
        [...offered],
      ).signatureHelp,
    ).toEqual({ enabled: true, triggerCharacters: [], retriggerCharacters: [] });
  });

  it("reads synchronization without a change kind as open/close only", () => {
    expect(
      negotiateServerCapabilities(
        { capabilities: { textDocumentSync: { openClose: true, save: false } } },
        [...offered],
      ).textDocumentSync,
    ).toEqual({
      openClose: true,
      change: "none",
      save: { enabled: false, includeText: false },
    });
  });

  it.each([
    [{ textDocumentSync: "full" }, "malformed textDocumentSync options"],
    [
      { textDocumentSync: { change: 1, save: { includeText: "yes" } } },
      "malformed textDocumentSync save options",
    ],
    [
      { textDocumentSync: { change: 1, save: "always" } },
      "malformed textDocumentSync save capability",
    ],
    [
      { textDocumentSync: { change: 1, openClose: "yes" } },
      "malformed textDocumentSync openClose",
    ],
    [{ positionEncoding: "utf-7" }, "unsupported position encoding: utf-7"],
  ])("rejects the capabilities %o", (capabilities, message) => {
    expect(() =>
      negotiateServerCapabilities({ capabilities }, [...offered]),
    ).toThrow(message);
  });

  it("rejects an encoding the client did not offer and a result without capabilities", () => {
    expect(() =>
      negotiateServerCapabilities(
        { capabilities: { positionEncoding: "utf-8" } },
        ["utf-16"],
      ),
    ).toThrow("unsupported position encoding: utf-8");
    expect(() => negotiateServerCapabilities(null, [...offered])).toThrow(
      "no capabilities object",
    );
  });
});

describe("initialize request options", () => {
  it("passes the locale, process, options and workspace folders through", () => {
    const params = createInitializeParams(
      {
        rootUri: "file:///p",
        processId: 42,
        clientInfo: { name: "Oleafly" },
        locale: "de",
        initializationOptions: { lint: true },
        workspaceFolders: [{ uri: "file:///p", name: "p" }],
      },
      ["utf-8"],
    );
    expect(params).toMatchObject({
      processId: 42,
      rootUri: "file:///p",
      clientInfo: { name: "Oleafly" },
      locale: "de",
      initializationOptions: { lint: true },
      workspaceFolders: [{ uri: "file:///p", name: "p" }],
      capabilities: { general: { positionEncodings: ["utf-8"] } },
    });
    const minimal = createInitializeParams({ rootUri: "file:///p" }, ["utf-16"]);
    expect(minimal.processId).toBeNull();
    expect(minimal).not.toHaveProperty("locale");
    expect(minimal).not.toHaveProperty("clientInfo");
    expect(minimal).not.toHaveProperty("workspaceFolders");
  });
});

describe("diagnostic guards", () => {
  const range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 },
  };

  it.each([
    [{ range, message: "ok", severity: 4, code: 7, source: "texlab", data: null }, true],
    [{ range, message: "ok", data: [1] }, true],
    [{ range, message: "ok", data: { fix: true } }, true],
    [{ range, message: "ok", data: "hint" }, true],
    ["not a diagnostic", false],
    [{ range, message: 3 }, false],
    [{ range, message: "ok", severity: 5 }, false],
    [{ range, message: "ok", code: true }, false],
    [{ range, message: "ok", source: 1 }, false],
    [{ range, message: "ok", data: () => {} }, false],
    [{ range: { start: { line: -1, character: 0 }, end: range.end }, message: "ok" }, false],
    [{ range: { start: { line: 0, character: 0.5 }, end: range.end }, message: "ok" }, false],
  ])("judges %o as a diagnostic: %s", (value, expected) => {
    expect(isDiagnostic(value)).toBe(expected);
  });

  it("validates published diagnostics payloads", () => {
    expect(
      isPublishDiagnosticsParams({ uri: "file:///p/a.tex", version: 3, diagnostics: [] }),
    ).toBe(true);
    expect(isPublishDiagnosticsParams("payload")).toBe(false);
    expect(
      isPublishDiagnosticsParams({ uri: "file:///p/a.tex", version: 1.5, diagnostics: [] }),
    ).toBe(false);
    expect(
      isPublishDiagnosticsParams({ uri: "file:///p/a.tex", diagnostics: [{}] }),
    ).toBe(false);
  });
});
