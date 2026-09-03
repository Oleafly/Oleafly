import { describe, expect, it } from "vitest";
import { inProcessProjectIntelligenceWorkerFactory } from "./in-process-worker";
import { PROJECT_INTELLIGENCE_PROTOCOL_VERSION } from "./types";
import { ProjectIntelligenceWorkerClient } from "./worker-client";
import { createProjectIntelligenceWorker } from "./worker-core";
import {
  isProjectIntelligenceWorkerRequest,
  isProjectIntelligenceWorkerResponse,
  PROJECT_INTELLIGENCE_LIMITS,
  type AnalyzeProjectIntelligenceRequest,
  type ProjectIntelligenceWorkerResponse,
} from "./worker-protocol";

const identity = {
  projectId: "project",
  projectRevision: 1,
  requestGeneration: 1,
};

const sources: Readonly<Record<string, string>> = {
  "main.tex": String.raw`\documentclass{article}
\begin{document}
\section{Intro}\label{sec:intro}
See \ref{sec:intro} and \cite{alpha}.
\bibliography{refs}
\end{document}`,
  "refs.bib": `@article{alpha,
  author = {Ada Lovelace},
  title = {Engines},
  journal = {J},
  year = {1843},
  doi = {10.1/x}
}
@book{beta, editor={B}, title={Two}, publisher={P}, year={2026}}`,
};

function analyzeInput() {
  return {
    identity,
    reset: true,
    mainDocument: "main.tex",
    knownFiles: Object.keys(sources).sort(),
    upserts: Object.entries(sources).map(([file, text]) => ({
      file,
      sourceRevision: 1,
      text,
    })),
    removals: [],
    unreadable: [],
  };
}

function analyzeRequest(requestId = 1): AnalyzeProjectIntelligenceRequest {
  return {
    protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
    type: "analyze",
    requestId,
    ...analyzeInput(),
  };
}

function directWorker() {
  const posted: ProjectIntelligenceWorkerResponse[] = [];
  let closed = false;
  const handle = createProjectIntelligenceWorker({
    postMessage: (message) => posted.push(structuredClone(message)),
    close: () => {
      closed = true;
    },
  });
  return { handle, posted, isClosed: () => closed };
}

function resultOf(response: ProjectIntelligenceWorkerResponse) {
  if (response.type !== "result") {
    throw new Error(`Expected a result, received ${response.type}`);
  }
  return response.snapshot;
}

describe("project intelligence worker transfer", () => {
  it("sends the flattened arrays once, without a per-file copy or field maps", () => {
    const { handle, posted } = directWorker();
    handle(analyzeRequest());
    expect(posted).toHaveLength(1);
    expect(isProjectIntelligenceWorkerResponse(posted[0])).toBe(true);
    const snapshot = resultOf(posted[0]);
    expect(snapshot.protocolVersion).toBe(2);
    expect("files" in snapshot).toBe(false);
    expect(Object.keys(snapshot.fileStates).sort()).toEqual([
      "main.tex",
      "refs.bib",
    ]);
    expect(snapshot.fileStates["main.tex"]).toMatchObject({
      engine: "latex",
      sourceRevision: 1,
      status: "success",
    });
    for (const entry of snapshot.bibliography.entries) {
      expect("fields" in entry).toBe(false);
      expect("typeRange" in entry).toBe(false);
    }
    expect(
      snapshot.bibliography.entries.map((entry) => [
        entry.key,
        entry.author,
        entry.title,
        entry.year,
        entry.display,
      ]),
    ).toEqual([
      ["alpha", "Ada Lovelace", "Engines", "1843", "Ada Lovelace · 1843 · Engines"],
      ["beta", "B", "Two", "2026", "B · 2026 · Two"],
    ]);
    expect(snapshot.uses.filter((use) => use.kind === "citation")).toEqual([
      expect.objectContaining({ name: "alpha", resolution: "resolved" }),
    ]);
  });

  it("answers field lookups for the retained snapshot and refuses other identities", () => {
    const { handle, posted } = directWorker();
    handle(analyzeRequest());
    const snapshot = resultOf(posted[0]);
    const [alpha, beta] = snapshot.bibliography.entries;
    handle({
      protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
      type: "bibliography-entries",
      requestId: 2,
      identity,
      entryIds: [beta.id, "bib:missing", alpha.id],
    });
    const response = posted[1];
    expect(isProjectIntelligenceWorkerResponse(response)).toBe(true);
    if (response.type !== "bibliography-entries") {
      throw new Error(`Expected bibliography entries, received ${response.type}`);
    }
    expect(response.entries.map((entry) => entry.key)).toEqual([
      "beta",
      "alpha",
    ]);
    expect(
      response.entries[1].fields.map((field) => [field.name, field.value]),
    ).toEqual([
      ["author", "Ada Lovelace"],
      ["title", "Engines"],
      ["journal", "J"],
      ["year", "1843"],
      ["doi", "10.1/x"],
    ]);
    expect(response.entries[1].display).toBe(alpha.display);

    handle({
      protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
      type: "bibliography-entries",
      requestId: 3,
      identity: { ...identity, requestGeneration: 5 },
      entryIds: [alpha.id],
    });
    expect(posted[2]).toMatchObject({
      type: "error",
      requestId: 3,
      error: { code: "stale_snapshot", retryable: false },
    });
  });

  it("rejects requests from another protocol version and oversized queries", () => {
    const { handle, posted } = directWorker();
    handle({ ...analyzeRequest(), protocolVersion: 1 });
    expect(posted[0]).toMatchObject({
      type: "error",
      requestId: 1,
      error: { code: "invalid_request" },
    });
    expect(
      isProjectIntelligenceWorkerRequest({
        protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
        type: "bibliography-entries",
        requestId: 4,
        identity,
        entryIds: Array.from(
          { length: PROJECT_INTELLIGENCE_LIMITS.maxBibliographyQueryIds + 1 },
          (_, index) => `bib:${index}`,
        ),
      }),
    ).toBe(false);
    expect(
      isProjectIntelligenceWorkerRequest({
        protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
        type: "bibliography-entries",
        requestId: 4,
        identity,
        entryIds: ["bib:1", ""],
      }),
    ).toBe(false);
  });

  it("clears retained analysis on dispose", () => {
    const { handle, posted, isClosed } = directWorker();
    handle(analyzeRequest());
    handle({
      protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
      type: "dispose",
    });
    expect(isClosed()).toBe(true);
    handle({
      protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
      type: "bibliography-entries",
      requestId: 2,
      identity,
      entryIds: [resultOf(posted[0]).bibliography.entries[0].id],
    });
    expect(posted[1]).toMatchObject({
      type: "error",
      error: { code: "stale_snapshot" },
    });
  });
});

describe("project intelligence worker client", () => {
  it("round-trips analysis and field lookups through a structured-clone transfer", async () => {
    const wire: ProjectIntelligenceWorkerResponse[] = [];
    const client = new ProjectIntelligenceWorkerClient(
      inProcessProjectIntelligenceWorkerFactory({
        onPost: (message) => wire.push(message),
      }),
      5_000,
    );
    const snapshot = await client.analyze(analyzeInput());
    expect("files" in snapshot).toBe(false);
    expect(wire[0].type).toBe("result");
    const entry = snapshot.bibliography.entries[0];
    const details = await client.bibliographyEntries(identity, [entry.id]);
    expect(details).toHaveLength(1);
    expect(details[0].fields.map((field) => field.name)).toEqual([
      "author",
      "title",
      "journal",
      "year",
      "doi",
    ]);
    await expect(
      client.bibliographyEntries(
        { ...identity, requestGeneration: 9 },
        [entry.id],
      ),
    ).rejects.toMatchObject({ code: "stale_snapshot" });
    client.dispose();
    await expect(
      client.bibliographyEntries(identity, [entry.id]),
    ).rejects.toMatchObject({ code: "disposed" });
  });

  it("fails the worker when a response type does not match its request", async () => {
    const client = new ProjectIntelligenceWorkerClient(
      inProcessProjectIntelligenceWorkerFactory({
        transfer: (message) =>
          message.type === "result"
            ? {
                protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
                type: "bibliography-entries",
                requestId: message.requestId,
                identity: message.identity,
                entries: [],
              }
            : message,
      }),
      5_000,
    );
    await expect(client.analyze(analyzeInput())).rejects.toMatchObject({
      code: "protocol_error",
    });
    client.dispose();
  });
});
