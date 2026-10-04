// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { clearExpansionState } from "./expansion-state";
import { ResearchToolCard } from "./ResearchToolCard";

beforeEach(clearExpansionState);

function header() {
  return screen.getAllByRole("button")[0];
}

describe("ResearchToolCard literature rows", () => {
  it("lists source, DOI and abstract, and skips the open button without a link", () => {
    render(
      <ResearchToolCard
        actions={{ openSource: vi.fn() }}
        tc={{
          name: "literature_search",
          status: "done",
          output: JSON.stringify({
            results: [
              { title: "Untitled lead", source: "Preprint server", abstract: "We study diffusion." },
              { title: "With DOI", doi: "10.1000/xyz" },
              { title: "Bare title" },
            ],
          }),
        }}
      />,
    );

    fireEvent.click(header());

    expect(screen.getByText("Preprint server")).toBeInTheDocument();
    expect(screen.getByText("We study diffusion.")).toBeInTheDocument();
    expect(screen.getByText(enAi.toolCard.doi.replace("{{doi}}", "10.1000/xyz"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open source: Untitled lead" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open source: With DOI" })).toBeInTheDocument();
    expect(screen.getByText("Bare title")).toBeInTheDocument();
  });
});

describe("ResearchToolCard header", () => {
  it.each([
    ["approved", enAi.toolCard.approved],
    ["rejected", enAi.toolCard.rejected],
  ] as const)("badges a %s call", (approval, label) => {
    render(<ResearchToolCard tc={{ name: "edit_file", status: "done", approval }} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("marks an unverified citation summary as a problem", () => {
    render(
      <ResearchToolCard
        tc={{ name: "verify_citation", status: "done", output: JSON.stringify({ verified: false }) }}
      />,
    );

    expect(screen.getByText(enCore.toolActivity.summary.citationUnverified)).toHaveClass("text-destructive");
  });

  it("lists each distinct compile diagnostic once", () => {
    render(
      <ResearchToolCard
        tc={{
          name: "compile",
          status: "error",
          output: JSON.stringify({
            errors: ["Undefined control sequence", { message: "Missing $ inserted" }],
            diagnostics: [{ text: "Undefined control sequence" }],
          }),
        }}
      />,
    );

    fireEvent.click(header());

    const items = [...document.querySelectorAll("ul li")].map((node) => node.textContent);
    expect(items).toEqual(["Undefined control sequence", "Missing $ inserted"]);
  });
});

describe("ResearchToolCard actions", () => {
  it("opens the cited source and the delegated task", () => {
    const openSource = vi.fn();
    const openSession = vi.fn();
    render(
      <ResearchToolCard
        actions={{ openSource, openSession }}
        tc={{
          name: "spawn_agent",
          status: "done",
          output: JSON.stringify({ url: "https://example.org/paper", doi: "10.1/abc", page: 4, threadId: "thread-9", note: "done" }),
        }}
      />,
    );

    fireEvent.click(header());
    fireEvent.click(screen.getByRole("button", { name: enAi.toolCard.openSource }));
    fireEvent.click(screen.getByRole("button", { name: enAi.toolCard.openTask }));

    expect(openSource).toHaveBeenCalledWith({ url: "https://example.org/paper", doi: "10.1/abc", page: 4 });
    expect(openSession).toHaveBeenCalledWith({ threadId: "thread-9" });
  });

  it("opens a project file without showing a preview", async () => {
    const openArtifact = vi.fn().mockResolvedValue(undefined);
    render(
      <ResearchToolCard
        actions={{ openArtifact }}
        tc={{ name: "read_file", status: "done", output: JSON.stringify({ path: "sections/intro.tex", line: 12, content: "Intro" }) }}
      />,
    );

    fireEvent.click(header());
    fireEvent.click(screen.getByRole("button", { name: enAi.toolCard.openFile }));

    expect(openArtifact).toHaveBeenCalledWith({ scope: "project", path: "sections/intro.tex", line: 12, page: undefined });
    await vi.waitFor(() => expect(screen.getByRole("button", { name: enAi.toolCard.openFile })).toBeEnabled());
    expect(screen.queryByText(enAi.toolCard.previewFailed)).toBeNull();
  });

  it("says a linked binary preview cannot be shown and that a long one was cut", async () => {
    const openArtifact = vi.fn().mockResolvedValue({
      relativePath: "data/scan.pdf",
      content: "",
      truncated: true,
      isBinary: true,
    });
    render(
      <ResearchToolCard
        actions={{ openArtifact }}
        tc={{
          name: "read_linked_file",
          status: "done",
          output: JSON.stringify({ root_id: "refs", relative_path: "data/scan.pdf", content: "x" }),
        }}
      />,
    );

    fireEvent.click(header());
    fireEvent.click(screen.getByRole("button", { name: enAi.toolCard.inspectSource }));

    expect(screen.getByRole("button", { name: enAi.toolCard.loadingSource })).toBeDisabled();
    expect(await screen.findByText(enAi.toolCard.binaryPreview)).toBeInTheDocument();
    expect(screen.getByText(enAi.toolCard.previewTruncated)).toBeInTheDocument();
  });

  it("says when a linked preview fails", async () => {
    const openArtifact = vi.fn().mockRejectedValue(new Error("gone"));
    render(
      <ResearchToolCard
        actions={{ openArtifact }}
        tc={{
          name: "read_linked_file",
          status: "done",
          output: JSON.stringify({ rootId: "refs", relativePath: "notes.md", content: "x" }),
        }}
      />,
    );

    fireEvent.click(header());
    fireEvent.click(screen.getByRole("button", { name: enAi.toolCard.inspectSource }));

    expect(await screen.findByText(enAi.toolCard.previewFailed)).toBeInTheDocument();
  });
});
