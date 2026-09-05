import { describe, expect, it } from "vitest";
import { projectToolEntry, safeWebUrl, stripAnsi } from "./chat-activity";

describe("research chat activity", () => {
  it("projects literature results without inventing citation verification", () => {
    const view = projectToolEntry({
      id: "search-1",
      name: "literature_search",
      status: "done",
      output: JSON.stringify({
        results: [
          {
            id: "https://openalex.org/W1",
            title: "A measured result",
            publication_year: 2025,
            doi: "https://doi.org/10.1000/example",
            authorships: [{ author: { display_name: "R. Chen" } }],
            primary_location: {
              landing_page_url: "https://example.org/paper",
              source: { display_name: "Research Notes" },
            },
          },
        ],
      }),
    });

    expect(view.kind).toBe("literature");
    expect(view.status).toBe("completed");
    expect(view.results?.[0]).toMatchObject({
      title: "A measured result",
      authors: ["R. Chen"],
      year: 2025,
      doi: "10.1000/example",
      source: "Research Notes",
    });
    expect(view.verified).toBeUndefined();
  });

  it("shows citation verification only when the tool reports it", () => {
    const verified = projectToolEntry({
      name: "verify_citation",
      status: "done",
      output: JSON.stringify({
        verified: true,
        source: "crossref-doi",
        doi: "10.1000/real",
        bibtex: "@article{real}",
      }),
    });
    const unknown = projectToolEntry({
      name: "verify_citation",
      status: "done",
      output: JSON.stringify({ doi: "10.1000/unconfirmed" }),
    });

    expect(verified.summary).toBe("Verified by the citation service");
    expect(unknown.verified).toBeUndefined();
    expect(unknown.summary).toBeUndefined();
  });

  it("keeps errors, declines, cancellations, and malformed output terminal", () => {
    expect(projectToolEntry({ name: "compile", status: "error" }).status).toBe("failed");
    expect(projectToolEntry({
      name: "verify_citation",
      status: "done",
      output: JSON.stringify({ declined: true }),
    }).status).toBe("declined");
    expect(projectToolEntry({
      name: "run_command",
      status: "done",
      output: JSON.stringify({ status: "stopped", exit_code: null }),
    }).status).toBe("cancelled");
    const malformed = projectToolEntry({ name: "unknown_tool", status: "done", output: "{partial" });
    expect(malformed.status).toBe("completed");
    expect(malformed.output).toBe("{partial");
  });

  it("projects compile diagnostics and command failures from explicit fields", () => {
    const compile = projectToolEntry({
      name: "compile",
      status: "done",
      output: JSON.stringify({
        success: false,
        errors: [{ message: "Undefined citation on line 18" }],
        has_pdf: false,
      }),
    });
    const command = projectToolEntry({
      name: "run_command",
      status: "done",
      output: JSON.stringify({
        exec: true,
        command: "pnpm test",
        output: "\u001b[31mfailed\u001b[0m",
        exit_code: 1,
      }),
    });

    expect(compile.status).toBe("failed");
    expect(compile.diagnostics).toEqual(["Undefined citation on line 18"]);
    expect(command).toMatchObject({ status: "failed", command: "pnpm test", exitCode: 1 });
    expect(command.output).toBe("failed");
  });

  it("accepts only web links and strips terminal control sequences", () => {
    expect(safeWebUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeWebUrl("file:///tmp/paper.pdf")).toBeUndefined();
    expect(safeWebUrl("https://example.org/paper")).toBe("https://example.org/paper");
    expect(stripAnsi("\u001b[32mok\u001b[0m")).toBe("ok");
  });
});
