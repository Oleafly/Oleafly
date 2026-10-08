import { describe, expect, it } from "vitest";
import { buildIndex } from "@/lib/index/build";
import type { ProjectAnalysisRequestIdentity } from "@/lib/analysis";
import { PROJECT_ANALYSIS_FEATURES } from "@/lib/analysis/project-snapshot";
import {
  createProjectAnalysisStore,
  failProjectAnalysisFeature,
  useProjectAnalysisStore,
} from "./project-analysis";

function request(
  requestGeneration: number,
  overrides: Partial<ProjectAnalysisRequestIdentity> = {},
): ProjectAnalysisRequestIdentity {
  return {
    projectId: "project-a",
    projectRevision: 1,
    languageServiceGeneration: 1,
    requestGeneration,
    ...overrides,
  };
}

function activatedStore() {
  const store = createProjectAnalysisStore();
  store.getState().activateProject({
    projectId: "project-a",
    projectRevision: 1,
    languageServiceGeneration: 1,
  });
  return store;
}

describe("project analysis store", () => {
  it("marks every feature in one update", () => {
    const store = activatedStore();
    let updates = 0;
    const unsubscribe = store.subscribe(() => {
      updates += 1;
    });

    store
      .getState()
      .markFeaturesUnavailable(PROJECT_ANALYSIS_FEATURES, { text: "server missing" }, false);
    expect(updates).toBe(1);
    for (const feature of PROJECT_ANALYSIS_FEATURES) {
      expect(store.getState().snapshot.features[feature]).toMatchObject({
        status: "unavailable",
        retryable: false,
      });
    }

    store.getState().markFeaturesNotRun(PROJECT_ANALYSIS_FEATURES, { key: "starting" });
    store.getState().markFeaturesUnsupported(PROJECT_ANALYSIS_FEATURES, { key: "starting" });
    expect(updates).toBe(3);
    expect(store.getState().snapshot.features.hover).toMatchObject({ status: "unsupported" });
    unsubscribe();
  });

  it("starts with explicit not-run placeholders", () => {
    const store = createProjectAnalysisStore();
    const snapshot = store.getState().snapshot;
    expect(snapshot.identity.projectId).toBeNull();
    expect(snapshot.features.diagnostics).toMatchObject({
      status: "not_run",
      data: null,
      reason: { key: "noProject" },
    });
    expect(snapshot.projectIndex.status).toBe("not_run");
  });

  it("rejects out-of-order feature results", () => {
    const store = activatedStore();
    expect(
      store
        .getState()
        .setDocumentVersion("file:///project/main.tex", 1),
    ).toBe(true);
    const first = request(1, {
      documentUri: "file:///project/main.tex",
      documentVersion: 1,
    });
    const second = request(2, {
      documentUri: "file:///project/main.tex",
      documentVersion: 1,
    });
    expect(
      store.getState().beginFeature("completion", first),
    ).toBe(true);
    expect(
      store.getState().beginFeature("completion", second),
    ).toBe(true);
    expect(
      store.getState().beginFeature("completion", first),
    ).toBe(false);
    expect(
      store
        .getState()
        .resolveFeature("completion", first, ["old"]),
    ).toBe(false);
    expect(
      store
        .getState()
        .resolveFeature("completion", second, ["current"]),
    ).toBe(true);
    expect(store.getState().snapshot.features.completion).toMatchObject(
      {
        status: "success",
        data: ["current"],
        request: { requestGeneration: 2 },
      },
    );
  });

  it("invalidates project and document-scoped results on revision changes", () => {
    const store = activatedStore();
    store
      .getState()
      .setDocumentVersion("file:///project/main.tex", 1);
    const projectRequest = request(1);
    const documentRequest = request(2, {
      documentUri: "file:///project/main.tex",
      documentVersion: 1,
    });
    store.getState().beginFeature("workspaceSymbols", projectRequest);
    store.getState().beginFeature("hover", documentRequest);

    expect(store.getState().setProjectRevision(2)).toBe(true);
    expect(
      store
        .getState()
        .resolveFeature("workspaceSymbols", projectRequest, []),
    ).toBe(false);
    expect(store.getState().snapshot.features.hover.status).toBe(
      "not_run",
    );

    const currentDocumentRequest = request(3, {
      projectRevision: 2,
      documentUri: "file:///project/main.tex",
      documentVersion: 1,
    });
    expect(
      store.getState().beginFeature("hover", currentDocumentRequest),
    ).toBe(true);
    expect(
      store
        .getState()
        .setDocumentVersion("file:///project/main.tex", 2),
    ).toBe(true);
    expect(
      store
        .getState()
        .resolveFeature("hover", currentDocumentRequest, {}),
    ).toBe(false);
  });

  it("aggregates acknowledged diagnostics per URI and clears one document atomically", () => {
    const store = activatedStore();
    const firstUri = "file:///project/first.tex";
    const secondUri = "file:///project/second.tex";
    store.getState().setDocumentVersion(firstUri, 1);
    store.getState().setDocumentVersion(secondUri, 1);
    const firstRequest = request(1, {
      documentUri: firstUri,
      documentVersion: 1,
    });
    const secondRequest = request(2, {
      documentUri: secondUri,
      documentVersion: 1,
    });
    const nextFirstRequest = request(3, {
      documentUri: firstUri,
      documentVersion: 1,
    });
    const diagnostic = (uri: string, message: string) => ({
      id: `${uri}:${message}`,
      uri,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      severity: "error" as const,
      message,
      source: "test",
      projectRevision: 1,
      documentVersion: 1,
    });

    expect(
      store
        .getState()
        .beginDocumentDiagnostics(firstUri, 1, firstRequest),
    ).toBe(true);
    expect(store.getState().snapshot.features.diagnostics.status).toBe(
      "partial",
    );
    expect(
      store
        .getState()
        .resolveDocumentDiagnostics(
          firstUri,
          1,
          firstRequest,
          [diagnostic(firstUri, "first")],
        ),
    ).toBe(true);
    expect(
      store
        .getState()
        .beginDocumentDiagnostics(secondUri, 1, secondRequest),
    ).toBe(true);
    expect(
      store
        .getState()
        .resolveDocumentDiagnostics(
          secondUri,
          1,
          secondRequest,
          [diagnostic(secondUri, "second")],
        ),
    ).toBe(true);

    expect(
      store
        .getState()
        .beginDocumentDiagnostics(firstUri, 2, nextFirstRequest),
    ).toBe(true);
    expect(store.getState().snapshot.features.diagnostics).toMatchObject({
      status: "partial",
      data: [
        { uri: firstUri, message: "first" },
        { uri: secondUri, message: "second" },
      ],
    });
    expect(
      store
        .getState()
        .resolveDocumentDiagnostics(
          firstUri,
          1,
          firstRequest,
          [],
        ),
    ).toBe(false);
    expect(
      store
        .getState()
        .resolveDocumentDiagnostics(
          firstUri,
          2,
          nextFirstRequest,
          [],
        ),
    ).toBe(true);
    expect(store.getState().snapshot.features.diagnostics).toMatchObject({
      status: "success",
      data: [{ uri: secondUri, message: "second" }],
    });

    store.getState().clearDocumentDiagnostics(firstUri);
    expect(store.getState().snapshot.features.diagnostics).toMatchObject({
      status: "success",
      data: [{ uri: secondUri, message: "second" }],
    });
  });

  it("lets a later publication for the same epoch replace acknowledged diagnostics", () => {
    const store = activatedStore();
    const uri = "file:///project/main.tex";
    store.getState().setDocumentVersion(uri, 1);
    const current = request(1, { documentUri: uri, documentVersion: 1 });
    const diagnostic = (message: string) => ({
      id: `${uri}:${message}`,
      uri,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      severity: "error" as const,
      message,
      source: "test",
      projectRevision: 1,
      documentVersion: 1,
    });

    expect(store.getState().beginDocumentDiagnostics(uri, 1, current)).toBe(true);
    expect(
      store
        .getState()
        .resolveDocumentDiagnostics(uri, 1, current, [diagnostic("Undefined reference")]),
    ).toBe(true);
    expect(store.getState().resolveDocumentDiagnostics(uri, 1, current, [])).toBe(true);
    expect(store.getState().snapshot.diagnosticsByUri[uri]).toMatchObject({
      status: "acknowledged",
      data: [],
    });
    expect(
      store
        .getState()
        .resolveDocumentDiagnostics(
          uri,
          1,
          request(2, { documentUri: uri, documentVersion: 1 }),
          [diagnostic("other request")],
        ),
    ).toBe(false);
    expect(store.getState().snapshot.diagnosticsByUri[uri]?.data).toEqual([]);
  });

  it("invalidates language-service slots on restart but preserves the local index", () => {
    const store = activatedStore();
    const indexRequest = request(1);
    expect(store.getState().beginProjectIndex(indexRequest)).toBe(true);
    expect(
      store.getState().installProjectIndex({
        request: indexRequest,
        index: buildIndex({
          "a.tex": "\\label{shared}",
          "b.tex": "\\label{shared}",
        }),
      }),
    ).toBe(true);

    const definitions = store.getState().snapshot.projectIndex;
    expect(definitions.status).toBe("success");
    if (definitions.status !== "success") {
      throw new Error("Expected installed index");
    }
    expect(
      definitions.data.definitions.filter(
        (symbol) =>
          symbol.kind === "label" && symbol.name === "shared",
      ),
    ).toHaveLength(2);

    store.getState().invalidateLanguageService(2);
    expect(
      store.getState().snapshot.features.references.status,
    ).toBe("not_run");
    expect(store.getState().snapshot.projectIndex.status).toBe(
      "success",
    );
    expect(
      store.getState().beginFeature("references", request(2)),
    ).toBe(false);
  });

  it("represents unsupported, unavailable, partial, and error states explicitly", () => {
    const store = activatedStore();
    store
      .getState()
      .markFeatureUnsupported("semanticTokens", {
        key: "featureNotAdvertised",
        params: { feature: "semanticTokens" },
      });
    expect(
      store.getState().snapshot.features.semanticTokens,
    ).toMatchObject({
      status: "unsupported",
      data: null,
      reason: {
        key: "featureNotAdvertised",
        params: { feature: "semanticTokens" },
      },
    });
    store
      .getState()
      .markFeatureUnavailable("hover", { text: "server missing" }, false);
    expect(store.getState().snapshot.features.hover).toMatchObject({
      status: "unavailable",
      retryable: false,
    });

    const partialRequest = request(3);
    store.getState().beginFeature("diagnostics", partialRequest);
    expect(
      store
        .getState()
        .resolveFeaturePartial(
          "diagnostics",
          partialRequest,
          [{ message: "recovered" }],
          { text: "parser recovered around malformed source" },
        ),
    ).toBe(true);
    expect(store.getState().snapshot.features.diagnostics.status).toBe(
      "partial",
    );

    const errorRequest = request(4);
    store.getState().beginFeature("references", errorRequest);
    expect(
      store.getState().failFeature("references", errorRequest, {
        name: "TimeoutError",
        message: "analysis timed out",
        retryable: true,
      }),
    ).toBe(true);
    expect(store.getState().snapshot.features.references).toMatchObject(
      {
        status: "error",
        data: null,
        failure: { retryable: true },
      },
    );
  });
});

describe("project analysis guards", () => {
  const uri = "file:///project/main.tex";
  const other = "file:///project/other.tex";

  it("rejects negative or fractional revisions", () => {
    const store = activatedStore();

    expect(() =>
      store.getState().activateProject({ projectId: "p", projectRevision: -1, languageServiceGeneration: 0 }),
    ).toThrow(RangeError);
    expect(() => store.getState().setProjectRevision(1.5)).toThrow(RangeError);
    expect(() => store.getState().setDocumentVersion("", 1)).toThrow(RangeError);
    expect(() => store.getState().setLocalDocument(uri, -2, { key: "noProject" })).toThrow(RangeError);
    expect(() => store.getState().invalidateLanguageService(-1)).toThrow(RangeError);
  });

  it("tracks nothing until a project is active", () => {
    const store = createProjectAnalysisStore();

    expect(store.getState().setProjectRevision(3)).toBe(false);
    expect(store.getState().setDocumentVersion(uri, 1)).toBe(false);
    expect(store.getState().setLocalDocument(uri, 1, { key: "noProject" })).toBe(false);
    expect(store.getState().snapshot.documents).toEqual({});
  });

  it("keeps the same revision without clearing results", () => {
    const store = activatedStore();
    store.getState().beginFeature("workspaceSymbols", request(1));
    store.getState().resolveFeature("workspaceSymbols", request(1), ["symbol"]);

    expect(store.getState().setProjectRevision(1)).toBe(true);

    expect(store.getState().snapshot.features.workspaceSymbols.status).toBe("success");
  });

  it("refuses older document versions and accepts a repeated one", () => {
    const store = activatedStore();
    store.getState().setDocumentVersion(uri, 4);

    expect(store.getState().setDocumentVersion(uri, 3)).toBe(false);
    expect(store.getState().setDocumentVersion(uri, 4)).toBe(true);
    expect(store.getState().snapshot.documents[uri].version).toBe(4);
  });

  it("records a document analyzed only locally", () => {
    const store = activatedStore();
    const reason = { key: "languageServiceUnavailable" } as const;

    expect(store.getState().setLocalDocument(uri, 2, reason)).toBe(true);
    const first = store.getState().snapshot;
    expect(store.getState().setLocalDocument(uri, 2, reason)).toBe(true);
    expect(store.getState().snapshot).toBe(first);
    expect(store.getState().setLocalDocument(uri, 1, reason)).toBe(false);

    expect(first.documents[uri]).toEqual({
      uri,
      version: 2,
      analysis: "local_only",
      status: "not_run",
      reason,
    });
  });

  it("forgets a closed document and the results that depended on it", () => {
    const store = activatedStore();
    store.getState().setDocumentVersion(uri, 1);
    store.getState().setDocumentVersion(other, 1);
    const hover = request(1, { documentUri: uri, documentVersion: 1 });
    store.getState().beginFeature("hover", hover);
    store.getState().beginDocumentDiagnostics(uri, 1, request(2, { documentUri: uri, documentVersion: 1 }));
    const otherDiagnostics = request(3, { documentUri: other, documentVersion: 1 });
    store.getState().beginDocumentDiagnostics(other, 1, otherDiagnostics);
    store.getState().resolveDocumentDiagnostics(other, 1, otherDiagnostics, []);

    store.getState().removeDocument(uri);

    const snapshot = store.getState().snapshot;
    expect(snapshot.documents).not.toHaveProperty(uri);
    expect(snapshot.features.hover).toMatchObject({ status: "not_run", reason: { key: "documentClosed" } });
    expect(snapshot.features.diagnostics).toMatchObject({
      status: "success",
      request: { requestGeneration: 3 },
    });

    store.getState().removeDocument(other);
    expect(store.getState().snapshot.features.diagnostics).toMatchObject({
      status: "not_run",
      reason: { key: "diagnosticsNotRun" },
    });

    const unchanged = store.getState().snapshot;
    store.getState().removeDocument("file:///never-open.tex");
    expect(store.getState().snapshot).toBe(unchanged);
  });

  it("refuses diagnostics for the wrong document or an older epoch", () => {
    const store = activatedStore();
    store.getState().setDocumentVersion(uri, 1);
    store.getState().setDocumentVersion(other, 1);
    const diagnostics = request(5, { documentUri: uri, documentVersion: 1 });

    expect(store.getState().beginDocumentDiagnostics(other, 1, diagnostics)).toBe(false);
    expect(store.getState().beginDocumentDiagnostics(uri, -1, diagnostics)).toBe(false);
    expect(store.getState().beginDocumentDiagnostics(uri, 2, diagnostics)).toBe(true);
    expect(
      store.getState().beginDocumentDiagnostics(uri, 1, request(6, { documentUri: uri, documentVersion: 1 })),
    ).toBe(false);
    expect(
      store.getState().beginDocumentDiagnostics(uri, 2, request(4, { documentUri: uri, documentVersion: 1 })),
    ).toBe(false);
    expect(store.getState().resolveDocumentDiagnostics(uri, 1, diagnostics, [])).toBe(false);
    expect(
      store.getState().resolveDocumentDiagnostics(uri, 2, request(5, { projectRevision: 9, documentUri: uri }), []),
    ).toBe(false);
    expect(store.getState().snapshot.features.diagnostics.status).toBe("partial");
  });

  it("clears diagnostics of a document that has none as a no-op", () => {
    const store = activatedStore();
    const before = store.getState().snapshot;

    store.getState().clearDocumentDiagnostics(uri);

    expect(store.getState().snapshot).toBe(before);
  });

  it("drops feature work from another project revision", () => {
    const store = activatedStore();
    const stale = request(1, { projectRevision: 0 });

    expect(store.getState().beginFeature("references", stale)).toBe(false);
    expect(store.getState().beginProjectIndex(stale)).toBe(false);
    expect(store.getState().resolveFeaturePartial("references", stale, [], { key: "noProject" })).toBe(false);
    expect(store.getState().failFeature("references", stale, { name: "E", message: "m", retryable: true })).toBe(
      false,
    );
    expect(store.getState().failProjectIndex(stale, { name: "E", message: "m", retryable: true })).toBe(false);
  });

  it("refuses an older project index request and records a failed one", () => {
    const store = activatedStore();
    expect(store.getState().beginProjectIndex(request(2))).toBe(true);
    expect(store.getState().beginProjectIndex(request(1))).toBe(false);

    expect(
      store.getState().failProjectIndex(request(2), { name: "Error", message: "parse", retryable: true }),
    ).toBe(true);
    expect(store.getState().snapshot.projectIndex).toMatchObject({
      status: "error",
      data: null,
      failure: { message: "parse" },
    });
    expect(store.getState().failProjectIndex(request(2), { name: "Error", message: "again", retryable: true })).toBe(
      false,
    );
  });

  it("installs a partial project index with its reason", () => {
    const store = activatedStore();
    store.getState().beginProjectIndex(request(1));

    expect(
      store.getState().installProjectIndex({
        request: request(1),
        index: buildIndex({ "main.tex": "\\section{A}" }),
        partialReason: { key: "noProject" },
      }),
    ).toBe(true);
    expect(store.getState().snapshot.projectIndex).toMatchObject({ status: "partial", reason: { key: "noProject" } });
    expect(store.getState().installProjectIndex({ request: request(1), index: buildIndex({}) })).toBe(false);
  });

  it("converts thrown errors into feature failures", () => {
    const store = activatedStore();
    store.getState().beginFeature("documentSymbols", request(1));

    const failure = Object.assign(new Error("timed out"), { code: -32001, analysisReason: { key: "noProject" } });
    expect(failProjectAnalysisFeature(store, "documentSymbols", request(1), failure, false)).toBe(true);
    expect(store.getState().snapshot.features.documentSymbols).toMatchObject({
      status: "error",
      failure: { name: "Error", message: "timed out", code: -32001, reason: { key: "noProject" }, retryable: false },
    });

    store.getState().beginFeature("documentSymbols", request(2));
    expect(failProjectAnalysisFeature(store, "documentSymbols", request(2), "socket closed")).toBe(true);
    expect(store.getState().snapshot.features.documentSymbols).toMatchObject({
      failure: { name: "Error", message: "socket closed", retryable: true },
    });
  });

  it("keeps language-service capabilities unless an update replaces them", () => {
    const store = activatedStore();
    store.getState().setLanguageService({ capabilities: { hover: true } as never });
    store.getState().setLanguageService({ readiness: "ready" } as never);

    expect(store.getState().snapshot.languageService.capabilities).toEqual({ hover: true });

    store.getState().setLanguageService({ capabilities: null });
    expect(store.getState().snapshot.languageService.capabilities).toBeNull();
  });

  it("marks a feature as not run and resets the shared store", () => {
    useProjectAnalysisStore.getState().activateProject({
      projectId: "p",
      projectRevision: 0,
      languageServiceGeneration: 0,
    });
    useProjectAnalysisStore.getState().markFeatureNotRun("hover", { key: "documentClosed" });
    expect(useProjectAnalysisStore.getState().snapshot.features.hover).toMatchObject({
      status: "not_run",
      reason: { key: "documentClosed" },
    });

    useProjectAnalysisStore.getState().reset();
    expect(useProjectAnalysisStore.getState().snapshot.identity.projectId).toBeNull();
  });
});
