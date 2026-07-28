import { describe, expect, it } from "vitest";
import { buildIndex } from "@/lib/index/build";
import type { ProjectAnalysisRequestIdentity } from "@/lib/analysis";
import { createProjectAnalysisStore } from "./project-analysis";

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
  it("starts with explicit not-run placeholders", () => {
    const store = createProjectAnalysisStore();
    const snapshot = store.getState().snapshot;
    expect(snapshot.identity.projectId).toBeNull();
    expect(snapshot.features.diagnostics).toMatchObject({
      status: "not_run",
      data: null,
      reason: "No project is active",
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
      .markFeatureUnsupported("semanticTokens", "not advertised");
    expect(
      store.getState().snapshot.features.semanticTokens,
    ).toMatchObject({
      status: "unsupported",
      data: null,
      reason: "not advertised",
    });
    store
      .getState()
      .markFeatureUnavailable("hover", "server missing", false);
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
          "parser recovered around malformed source",
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
