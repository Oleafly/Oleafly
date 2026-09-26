import { describe, expect, it } from "vitest";
import { languageServiceContribution } from "./language-service-contribution";

const identity = { projectId: "p", projectRevision: 1, requestGeneration: 1 };

function definitionNames(source: string, name: string): string[] {
  const line = source.split("\n").length - 1;
  const result = languageServiceContribution({
    identity,
    provider: "texlab",
    workspaceRoot: "/project",
    texts: new Map([["main.tex", source]]),
    symbols: [
      {
        name,
        kind: 12,
        location: {
          uri: "file:///project/main.tex",
          range: {
            start: { line: 0, character: 0 },
            end: { line, character: source.split("\n").at(-1)?.length ?? 0 },
          },
        },
      },
    ],
  });
  return result.definitions.map((definition) => `${definition.kind}:${definition.name}`);
}

describe("languageServiceContribution", () => {
  it("keeps Unicode letters in XeTeX macro names", () => {
    expect(definitionNames(String.raw`\newcommand{\výsledek}{42}`, "výsledek")).toEqual(["macro:výsledek"]);
    expect(definitionNames(String.raw`\def\αβ{AB}`, "αβ")).toEqual(["macro:αβ"]);
    expect(definitionNames(String.raw`\newcommand{\foo}{x}`, "foo")).toEqual(["macro:foo"]);
  });
});
