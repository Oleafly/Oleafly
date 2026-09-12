// @vitest-environment jsdom

import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { agentDelegationPrompt, type DelegationTarget } from "@/lib/agent-mentions";
import { mentionInsertText } from "@/lib/composer-tokens";
import {
  buildMentionEntries,
  filterAgentTargets,
  filterMentionEntries,
  MentionMenu,
  type MentionEntry,
  type MentionMenuHandle,
  type MentionSelection,
} from "./MentionMenu";

const TREE = [
  { path: "main.tex", is_dir: false },
  { path: "sections", is_dir: true },
  { path: "sections/intro.tex", is_dir: false },
  { path: "sections/method.tex", is_dir: false },
  { path: "research", is_dir: true },
  { path: "research/notes", is_dir: true },
  { path: "my notes", is_dir: true },
];

const keyEvent = (key: string) => ({ key, preventDefault: () => {} });

function paths(entries: readonly MentionEntry[]) {
  return entries.map((entry) => entry.path);
}

describe("buildMentionEntries", () => {
  it("sorts the flat list and drops noise folders", () => {
    const entries = buildMentionEntries([
      { path: "zeta.tex", is_dir: false },
      { path: "alpha.tex", is_dir: false },
      { path: ".git", is_dir: true },
      { path: ".git/config", is_dir: false },
      { path: "node_modules/pkg/index.js", is_dir: false },
      { path: ".oleafly/build/main.pdf", is_dir: false },
    ]);

    expect(paths(entries)).toEqual(["alpha.tex", "zeta.tex"]);
  });

  it("keeps the directory flag for each entry", () => {
    expect(buildMentionEntries(TREE).find((entry) => entry.path === "sections")).toEqual({
      path: "sections",
      isDir: true,
    });
  });
});

describe("filterMentionEntries", () => {
  const entries = buildMentionEntries(TREE);

  it("ranks a basename prefix match above a deeper subsequence match", () => {
    expect(paths(filterMentionEntries(entries, "intro"))[0]).toBe("sections/intro.tex");
  });

  it("puts shorter paths first inside the same rank", () => {
    expect(paths(filterMentionEntries(entries, "sec"))).toEqual([
      "sections",
      "research",
      "research/notes",
      "sections/intro.tex",
      "sections/method.tex",
    ]);
  });

  it("matches a fragment spread across the path as a subsequence", () => {
    expect(paths(filterMentionEntries(entries, "secmet"))).toEqual(["sections/method.tex"]);
  });

  it("returns nothing when the fragment matches no entry", () => {
    expect(filterMentionEntries(entries, "zzz")).toEqual([]);
  });

  it("caps the list", () => {
    const many = buildMentionEntries(
      Array.from({ length: 40 }, (_, index) => ({
        path: `file-${index}.tex`,
        is_dir: false,
      })),
    );
    expect(filterMentionEntries(many, "file")).toHaveLength(12);
  });
});

describe("MentionMenu", () => {
  const entries = filterMentionEntries(buildMentionEntries(TREE), "");

  it("renders one row per entry with the folder name and its trailing slash", () => {
    render(<MentionMenu entries={entries} onSelect={() => {}} onClose={() => {}} />);

    expect(screen.getAllByRole("option")).toHaveLength(entries.length);
    expect(
      screen.getByRole("option", { name: /sections\/method\.tex/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "sections/" })).toBeInTheDocument();
  });

  it("renders nothing when there is no match", () => {
    const { container } = render(
      <MentionMenu entries={[]} onSelect={() => {}} onClose={() => {}} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("moves with the arrow keys and inserts the selected path on Enter", () => {
    const selected: MentionSelection[] = [];
    const ref = createRef<MentionMenuHandle>();
    render(
      <MentionMenu
        ref={ref}
        entries={entries}
        onSelect={(selection) => selected.push(selection)}
        onClose={() => {}}
      />,
    );

    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    act(() => void ref.current?.handleKeyDown(keyEvent("ArrowDown")));
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    act(() => void ref.current?.handleKeyDown(keyEvent("Enter")));

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ kind: "file", path: entries[1].path });
    expect(selected[0].text).toBe(mentionInsertText(entries[1].path, entries[1].isDir));
  });

  it("closes the token with Tab and appends a slash for a folder", () => {
    const selected: MentionSelection[] = [];
    const ref = createRef<MentionMenuHandle>();
    render(
      <MentionMenu
        ref={ref}
        entries={filterMentionEntries(buildMentionEntries(TREE), "sections")}
        onSelect={(selection) => selected.push(selection)}
        onClose={() => {}}
      />,
    );

    act(() => void ref.current?.handleKeyDown(keyEvent("Tab")));

    expect(selected[0]).toMatchObject({ path: "sections", isDir: true, text: "@sections/ " });
  });

  it("quotes a path that contains a space", () => {
    const selected: MentionSelection[] = [];
    render(
      <MentionMenu
        entries={filterMentionEntries(buildMentionEntries(TREE), "my notes")}
        onSelect={(selection) => selected.push(selection)}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("option", { name: /my notes/ }));

    expect(selected[0].text).toBe('@"my notes/" ');
  });

  it("closes on Escape and leaves Enter alone during composition", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const ref = createRef<MentionMenuHandle>();
    render(
      <MentionMenu ref={ref} entries={entries} onSelect={onSelect} onClose={onClose} />,
    );

    act(() => void ref.current?.handleKeyDown(keyEvent("Escape")));
    expect(onClose).toHaveBeenCalledOnce();

    const composing = {
      key: "Enter",
      shiftKey: false,
      nativeEvent: { isComposing: true },
      preventDefault: vi.fn(),
    };
    expect(ref.current?.handleKeyDown(composing)).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

const AGENTS: DelegationTarget[] = [
  { id: "local", label: "Local researcher", detail: "Ollama model llama", runtime: "built-in", providerId: "ollama", modelId: "llama" },
  { id: "reviewer", label: "CLI reviewer", detail: "Research CLI model chosen", runtime: "acp", agentId: "research-cli", modelId: "chosen" },
  { id: "writer", label: "Manuscript writer", detail: "Remote model draft", runtime: "built-in", providerId: "configured-provider", modelId: "draft" },
];

describe("filterAgentTargets", () => {
  it("matches across ids, labels and details, case-insensitively", () => {
    expect(filterAgentTargets(AGENTS, "CHOSEN").map((target) => target.id)).toEqual(["reviewer"]);
    expect(filterAgentTargets(AGENTS, "").map((target) => target.id)).toEqual(["local", "reviewer", "writer"]);
    expect(filterAgentTargets(AGENTS, "missing")).toEqual([]);
  });
});

describe("MentionMenu with agents", () => {
  const files = filterMentionEntries(buildMentionEntries(TREE), "");

  it("lists agents ahead of files under headings and reports the active key", () => {
    const onActive = vi.fn();
    render(
      <MentionMenu
        entries={files}
        agents={AGENTS}
        onSelect={() => {}}
        onClose={() => {}}
        onActiveEntryChange={onActive}
      />,
    );

    expect(screen.getByRole("listbox", { name: "Agents and project files" })).toBeInTheDocument();
    expect(screen.getByText("Delegate to an agent")).toBeInTheDocument();
    expect(screen.getByText("Project files")).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Local researcher");
    expect(options[0]).toHaveAttribute("id", "ai-mention-agent:local");
    expect(options[AGENTS.length]).toHaveTextContent("main.tex");
    expect(onActive).toHaveBeenLastCalledWith("agent:local");
  });

  it("selects an agent with the keyboard and produces a delegation token", () => {
    const selected: MentionSelection[] = [];
    const ref = createRef<MentionMenuHandle>();
    render(
      <MentionMenu
        ref={ref}
        entries={files}
        agents={filterAgentTargets(AGENTS, "chosen")}
        onSelect={(selection) => selected.push(selection)}
        onClose={() => {}}
      />,
    );

    act(() => void ref.current?.handleKeyDown(keyEvent("Enter")));
    expect(selected[0]).toMatchObject({ kind: "agent", text: "@reviewer " });
    const target = selected[0].kind === "agent" ? selected[0].target : null;
    expect(target).toEqual(AGENTS[1]);
    const prompt = agentDelegationPrompt("@reviewer review the methods", target ? [target] : []);
    expect(prompt).toContain('"runtime":"acp"');
    expect(prompt).toContain('"agentId":"research-cli"');
    expect(prompt).not.toContain('"providerId"');
  });

  it("wraps arrow navigation across agents and files", () => {
    const onActive = vi.fn();
    const ref = createRef<MentionMenuHandle>();
    render(
      <MentionMenu
        ref={ref}
        entries={files.slice(0, 1)}
        agents={AGENTS}
        onSelect={() => {}}
        onClose={() => {}}
        onActiveEntryChange={onActive}
      />,
    );

    act(() => void ref.current?.handleKeyDown(keyEvent("ArrowUp")));
    expect(onActive).toHaveBeenLastCalledWith("main.tex");
    act(() => void ref.current?.handleKeyDown(keyEvent("ArrowDown")));
    expect(onActive).toHaveBeenLastCalledWith("agent:local");
    act(() => void ref.current?.handleKeyDown(keyEvent("ArrowDown")));
    expect(onActive).toHaveBeenLastCalledWith("agent:reviewer");
  });

  it("selects an agent by mouse without stealing focus from the composer", () => {
    const onSelect = vi.fn();
    render(
      <>
        <textarea aria-label={"Composer"} />
        <MentionMenu entries={[]} agents={AGENTS} onSelect={onSelect} onClose={() => {}} />
      </>,
    );
    const composer = screen.getByLabelText("Composer");
    composer.focus();
    const option = screen.getByRole("option", { name: /CLI reviewer/ });
    expect(fireEvent.mouseDown(option)).toBe(false);
    expect(document.activeElement).toBe(composer);
    fireEvent.click(option);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: "agent", target: AGENTS[1], text: "@reviewer " });
  });
});
