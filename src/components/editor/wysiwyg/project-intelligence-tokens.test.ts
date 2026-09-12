import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en/intelligence.json" with { type: "json" };
import type {
  ProjectDefinition,
  ProjectIntelligenceSnapshot,
  ProjectUse,
  SourceRange,
} from "@/lib/project-intelligence/types";
import {
  rawInlineTokenAttributes,
  tokensFromRawInline,
} from "./project-intelligence";

const token = en.token;

const RANGE: SourceRange = {
  from: 0,
  to: 10,
  startLine: 1,
  startColumn: 0,
  endLine: 1,
  endColumn: 10,
};

function definition(overrides: Partial<ProjectDefinition>): ProjectDefinition {
  return {
    id: "def",
    source: "local",
    engine: "latex",
    kind: "label",
    name: "fig:one",
    location: { file: "main.tex", range: RANGE },
    ...overrides,
  } as ProjectDefinition;
}

function use(overrides: Partial<ProjectUse>): ProjectUse {
  return {
    id: "use",
    source: "local",
    engine: "latex",
    kind: "reference",
    name: "fig:one",
    location: { file: "main.tex", range: RANGE },
    resolution: "resolved",
    definitionIds: [],
    ...overrides,
  } as ProjectUse;
}

function snapshotWith(
  definitions: ProjectDefinition[],
  uses: ProjectUse[],
): ProjectIntelligenceSnapshot {
  return { definitions, uses } as unknown as ProjectIntelligenceSnapshot;
}

const attributes = (snapshot: ProjectIntelligenceSnapshot, source: string) =>
  rawInlineTokenAttributes(snapshot, "main.tex", source);

describe("visual project intelligence tokens", () => {
  it("finds the key tokens in a raw inline span", () => {
    expect(tokensFromRawInline("\\ref{fig:one}").map((entry) => entry.key)).toEqual(["fig:one"]);
    expect(tokensFromRawInline("plain prose")).toEqual([]);
  });

  it("returns nothing for a span with no key token", () => {
    expect(attributes(snapshotWith([], []), "plain prose")).toBeNull();
  });

  it("marks a resolved reference and names it for assistive tech", () => {
    const found = attributes(
      snapshotWith(
        [definition({ id: "def:fig", kind: "label" })],
        [use({ id: "use:fig", definitionIds: ["def:fig"] })],
      ),
      "\\ref{fig:one}",
    );

    expect(found?.class).toContain("is-resolved");
    expect(found?.role).toBe("link");
    expect(found?.["data-project-intelligence-key"]).toBe("fig:one");
    expect(found?.["data-project-intelligence-use-id"]).toBe("use:fig");
    expect(found?.title).toBe(
      token.title
        .replace("{{noun}}", token.reference)
        .replace("{{key}}", "fig:one")
        .replace("{{state}}", token.stateResolved),
    );
    expect(found?.["aria-label"]).toContain("fig:one");
  });

  it("marks an unresolved citation", () => {
    const found = attributes(snapshotWith([], []), "\\cite{knuth1984}");

    expect(found?.class).toContain("is-unresolved");
    expect(found?.["data-project-intelligence-kind"]).toBe("citation");
    expect(found?.title).toBe(
      token.title
        .replace("{{noun}}", token.citation)
        .replace("{{key}}", "knuth1984")
        .replace("{{state}}", token.stateUnresolved),
    );
  });

  it("marks a key that has more than one definition", () => {
    const found = attributes(
      snapshotWith(
        [
          definition({ id: "def:a", name: "knuth1984", kind: "bibentry" }),
          definition({ id: "def:b", name: "knuth1984", kind: "bibentry" }),
        ],
        [],
      ),
      "\\cite{knuth1984}",
    );

    expect(found?.class).toContain("is-duplicate");
    expect(found?.title).toContain(token.stateDuplicate);
  });

  it("reports the weakest state of a multi-key citation and records every one", () => {
    const found = attributes(
      snapshotWith(
        [definition({ id: "def:a", name: "knuth1984", kind: "bibentry" })],
        [
          use({
            id: "use:a",
            name: "knuth1984",
            kind: "citation",
            definitionIds: ["def:a"],
          }),
        ],
      ),
      "\\cite{knuth1984,missing2020}",
    );

    expect(found?.class).toContain("is-unresolved");
    const states = JSON.parse(
      found?.["data-project-intelligence-token-states"] ?? "[]",
    ) as { key: string; resolution: string }[];
    expect(states.map((state) => state.key)).toEqual(["knuth1984", "missing2020"]);
    expect(states.map((state) => state.resolution)).toEqual(["resolved", "unresolved"]);
  });
});
