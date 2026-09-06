import { describe, expect, it, vi } from "vitest";
import {
  coalesceTranscriptEvents,
  createResearchArtifactAction,
  projectToolEntry,
  safeWebUrl,
  SKILLS_BUDGET_NOTICE,
  splitAgentNotices,
  stripAnsi,
} from "./chat-activity";

describe("splitAgentNotices", () => {
  it("keeps ordinary text untouched", () => {
    expect(splitAgentNotices("The revision is ready.")).toEqual({
      notices: [],
      text: "The revision is ready.",
    });
  });

  it("splits the Codex skills budget warning off the answer", () => {
    const split = splitAgentNotices(
      "Warning: Exceeded skills context budget of 4000 tokens.\nThe revision is ready.",
    );
    expect(split.notices).toEqual([SKILLS_BUDGET_NOTICE]);
    expect(split.text).toBe("The revision is ready.");
  });

  it("reports the warning once when it is the whole message", () => {
    const split = splitAgentNotices("warning: exceeded skills context budget of 4000 tokens.");
    expect(split.notices).toEqual([SKILLS_BUDGET_NOTICE]);
    expect(split.text).toBe("");
  });

  it("leaves the warning in place when it does not open the message", () => {
    const value = "Done.\nWarning: Exceeded skills context budget of 4000 tokens.";
    expect(splitAgentNotices(value)).toEqual({ notices: [], text: value });
  });
});

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

  it("requires a linked root identity before offering a file action", () => {
    const unscoped = projectToolEntry({
      name: "Read linked file",
      status: "done",
      output: JSON.stringify({ path: "notes.md", content: "linked notes" }),
    });
    const scoped = projectToolEntry({
      name: "read_linked_file",
      status: "done",
      output: JSON.stringify({
        root_id: "references",
        relative_path: "notes.md",
        path: "notes.md",
        content: "linked notes",
      }),
    });
    const ambiguous = projectToolEntry({
      name: "Read notes.md",
      status: "done",
      output: JSON.stringify({ path: "notes.md", content: "linked notes" }),
    });

    expect(unscoped.artifactTarget).toBeUndefined();
    expect(ambiguous.artifactTarget).toBeUndefined();
    expect(scoped.artifactTarget).toEqual({
      scope: "linked",
      rootId: "references",
      relativePath: "notes.md",
    });
  });

  it("never routes a linked source to a same-named manuscript file", async () => {
    const openProject = vi.fn();
    const inspectLinked = vi.fn().mockResolvedValue({
      relativePath: "notes.md",
      content: "linked notes",
      truncated: false,
      isBinary: false,
    });
    const openArtifact = createResearchArtifactAction("paper", {
      openProject,
      inspectLinked,
    });

    await openArtifact({
      scope: "linked",
      rootId: "references",
      relativePath: "notes.md",
    });

    expect(inspectLinked).toHaveBeenCalledWith("paper", {
      scope: "linked",
      rootId: "references",
      relativePath: "notes.md",
    });
    expect(openProject).not.toHaveBeenCalled();
  });
});

describe("delegation tool cards", () => {
  it("only exposes a session route when the output names a session", () => {
    const spawned = projectToolEntry({
      id: "spawn-1",
      name: "spawn_agent",
      status: "done",
      output: JSON.stringify({ id: "agent-1", taskPath: "/root/review", status: "running" }),
    });
    expect(spawned.kind).toBe("delegation");
    expect(spawned.threadId).toBeUndefined();

    const listed = projectToolEntry({
      id: "list-1",
      name: "wait_agent",
      status: "done",
      output: JSON.stringify({ id: "agent-1", sessionId: "thread-agent-1", status: "done" }),
    });
    expect(listed.threadId).toBe("thread-agent-1");
  });
});

describe("coalesceTranscriptEvents", () => {
  const entry = (sequence: number, event: { kind: string; text?: string; name?: string }) => ({
    sequence,
    event,
  });

  it("merges consecutive streamed text deltas into one entry per segment", () => {
    const merged = coalesceTranscriptEvents([
      entry(1, { kind: "status", text: "Starting" }),
      entry(2, { kind: "text", text: "The " }),
      entry(3, { kind: "text", text: "manuscript " }),
      entry(4, { kind: "text", text: "is ready." }),
      entry(5, { kind: "tool", name: "read_file" }),
      entry(6, { kind: "text", text: "Done." }),
    ]);

    expect(merged.map((item) => item.sequence)).toEqual([1, 2, 5, 6]);
    expect(merged[1].event).toEqual({ kind: "text", text: "The manuscript is ready." });
    expect(merged[3].event).toEqual({ kind: "text", text: "Done." });
  });

  it("keeps reasoning and text segments apart and leaves other kinds untouched", () => {
    const merged = coalesceTranscriptEvents([
      entry(1, { kind: "reasoning", text: "Think " }),
      entry(2, { kind: "reasoning", text: "harder." }),
      entry(3, { kind: "text", text: "Answer" }),
      entry(4, { kind: "status", text: "a" }),
      entry(5, { kind: "status", text: "b" }),
    ]);

    expect(merged.map((item) => item.event)).toEqual([
      { kind: "reasoning", text: "Think harder." },
      { kind: "text", text: "Answer" },
      { kind: "status", text: "a" },
      { kind: "status", text: "b" },
    ]);
  });

  it("does not mutate the input entries", () => {
    const first = entry(1, { kind: "text", text: "a" });
    const second = entry(2, { kind: "text", text: "b" });
    const merged = coalesceTranscriptEvents([first, second]);
    expect(first.event.text).toBe("a");
    expect(merged).toHaveLength(1);
    expect(merged[0]).not.toBe(first);
  });
});
