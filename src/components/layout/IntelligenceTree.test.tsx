// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import {
  IntelligenceFilter,
  IntelligenceTree,
  PanelBreadcrumb,
  PanelState,
  type IntelligenceTreeNode,
} from "./IntelligenceTree";

const copy = enWorkspace.tree;
const onActivate = vi.fn();

const TREE_LABEL = enWorkspace.structure.treeLabel;
const EMPTY_MESSAGE = enWorkspace.structure.empty;
const FILTER_LABEL = enWorkspace.structure.filterLabel;
const CUSTOM_PLACEHOLDER = enWorkspace.structure.filterPlaceholder;
const STATE_TITLE = enWorkspace.structure.unavailable.failed.title;
const STATE_DETAIL = enWorkspace.structure.unavailable.failed.detail;
const PENDING_TITLE = enWorkspace.structure.unavailable.mapping.title;
const PENDING_DETAIL = enWorkspace.structure.unavailable.mapping.detail;
const ACTION_LABEL = enWorkspace.structure.title;

const NODES: IntelligenceTreeNode[] = [
  {
    id: "group",
    label: "Sections",
    kind: "group",
    badge: "2",
    defaultExpanded: true,
    children: [
      {
        id: "intro",
        label: "Introduction",
        kind: "section",
        description: "in main.tex",
        provenance: "main.tex:1:1",
        target: { path: "main.tex", from: 0, to: 10 },
        searchText: "main.tex section",
        children: [
          {
            id: "intro-label",
            label: "sec:intro",
            kind: "label",
            tone: "warning",
            target: { path: "main.tex", from: 11, to: 20 },
          },
        ],
      },
      {
        id: "method",
        label: "Method",
        kind: "section",
        tone: "danger",
        target: { path: "chapter.tex", from: 0, to: 6 },
      },
    ],
  },
  {
    id: "orphan",
    label: "Unlinked",
    kind: "file",
    tone: "muted",
    defaultExpanded: false,
    children: [{ id: "orphan-child", label: "Buried", kind: "reference" }],
  },
];

function renderTree(query = "") {
  return render(
    <IntelligenceTree
      label={TREE_LABEL}
      nodes={NODES}
      query={query}
      onActivate={onActivate}
      emptyMessage={EMPTY_MESSAGE}
    />,
  );
}

beforeEach(() => {
  onActivate.mockClear();
});

describe("IntelligenceTree", () => {
  it("renders the expanded rows with their levels and badges", () => {
    renderTree();
    const tree = screen.getByRole("tree", { name: TREE_LABEL });
    expect(tree).toBeInTheDocument();
    const rows = screen.getAllByRole("treeitem");
    expect(rows[0]).toHaveAttribute("aria-level", "1");
    expect(rows[0].getAttribute("aria-label")).toContain("Sections");
    expect(rows[1].getAttribute("aria-label")).toContain("main.tex:1:1");
    expect(screen.queryByText("Buried")).not.toBeInTheDocument();
  });

  it("activates a row that carries a target", async () => {
    renderTree();
    const user = userEvent.setup();
    await user.click(screen.getByText("Introduction"));
    expect(onActivate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "intro" }),
    );
  });

  it("expands a collapsed row from its chevron", async () => {
    renderTree();
    const user = userEvent.setup();
    const orphan = screen
      .getAllByRole("treeitem")
      .find((row) => row.getAttribute("aria-label")?.startsWith("Unlinked"));
    if (!orphan) throw new Error("no orphan row");
    expect(orphan).toHaveAttribute("aria-expanded", "false");
    await user.click(orphan);
    await waitFor(() => expect(orphan).toHaveAttribute("aria-expanded", "true"));
  });

  it("walks the rows with the arrow keys", async () => {
    renderTree();
    const user = userEvent.setup();
    const rows = screen.getAllByRole("treeitem");
    rows[0].focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(document.activeElement).toBe(rows[1]));
    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(document.activeElement).toBe(rows[0]));
    await user.keyboard("{End}");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getAllByRole("treeitem").at(-1),
      ),
    );
    await user.keyboard("{Home}");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getAllByRole("treeitem")[0]),
    );
  });

  it("opens and closes a branch with the left and right arrows", async () => {
    renderTree();
    const user = userEvent.setup();
    const orphan = screen
      .getAllByRole("treeitem")
      .find((row) => row.getAttribute("aria-label")?.startsWith("Unlinked"));
    if (!orphan) throw new Error("no orphan row");
    orphan.focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(orphan).toHaveAttribute("aria-expanded", "true"));
    await user.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toContain(
        "Buried",
      ),
    );
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(document.activeElement).toBe(orphan));
    await user.keyboard("{ArrowLeft}");
    await waitFor(() =>
      expect(orphan).toHaveAttribute("aria-expanded", "false"),
    );
  });

  it("activates the focused row with Enter and toggles a group with it", async () => {
    renderTree();
    const user = userEvent.setup();
    const rows = screen.getAllByRole("treeitem");
    rows[1].focus();
    await user.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "intro" }),
    );
    rows[0].focus();
    await user.keyboard(" ");
    await waitFor(() => expect(rows[0]).toHaveAttribute("aria-expanded", "false"));
  });

  it("ignores a key it does not handle", async () => {
    renderTree();
    const user = userEvent.setup();
    const rows = screen.getAllByRole("treeitem");
    rows[0].focus();
    await user.keyboard("x");
    expect(document.activeElement).toBe(rows[0]);
  });

  it("filters to the matching branch", () => {
    renderTree("Method");
    const labels = screen
      .getAllByRole("treeitem")
      .map((row) => row.getAttribute("aria-label"));
    expect(labels.some((label) => label?.startsWith("Method"))).toBe(true);
    expect(labels.some((label) => label?.startsWith("Unlinked"))).toBe(false);
  });

  it("says when the filter matches nothing", () => {
    renderTree("zzzzq");
    expect(screen.getByRole("status")).toHaveTextContent(EMPTY_MESSAGE);
  });
});

describe("IntelligenceFilter", () => {
  it("reports typing and clears itself", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <IntelligenceFilter value="" onChange={onChange} label={FILTER_LABEL} />,
    );
    const user = userEvent.setup();
    const input = screen.getByLabelText(FILTER_LABEL);
    expect(input).toHaveAttribute("placeholder", copy.filterPlaceholder);
    await user.type(input, "a");
    expect(onChange).toHaveBeenCalledWith("a");
    expect(
      screen.queryByRole("button", { name: copy.clearFilter }),
    ).not.toBeInTheDocument();

    rerender(
      <IntelligenceFilter
        value="a"
        onChange={onChange}
        label={FILTER_LABEL}
        placeholder={CUSTOM_PLACEHOLDER}
      />,
    );
    expect(screen.getByLabelText(FILTER_LABEL)).toHaveAttribute(
      "placeholder",
      CUSTOM_PLACEHOLDER,
    );
    await user.click(screen.getByRole("button", { name: copy.clearFilter }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});

describe("PanelBreadcrumb", () => {
  it("says there is no project when nothing is open", () => {
    render(<PanelBreadcrumb />);
    expect(screen.getByLabelText(copy.noProject)).toBeInTheDocument();
  });

  it("names the project and the path", () => {
    render(<PanelBreadcrumb project="Paper" path="chapters/intro.tex" />);
    expect(
      screen.getByLabelText(
        copy.breadcrumbWithProject
          .replace("{{project}}", "Paper")
          .replace("{{path}}", "chapters/intro.tex"),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Paper")).toBeInTheDocument();
  });

  it("elides the middle of a deep path", () => {
    render(<PanelBreadcrumb path="a/b/c/d.tex" />);
    expect(screen.getByLabelText("a/b/c/d.tex")).toBeInTheDocument();
    expect(screen.getByText("…")).toBeInTheDocument();
    expect(screen.getByText("d.tex")).toBeInTheDocument();
  });

  it("shows a single segment on its own", () => {
    render(<PanelBreadcrumb path="main.tex" />);
    expect(screen.getByText("main.tex")).toBeInTheDocument();
  });
});

describe("PanelState", () => {
  it("announces an error assertively and a pending state politely", () => {
    const { rerender } = render(
      <PanelState state="error" title={STATE_TITLE} detail={STATE_DETAIL} />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    rerender(<PanelState state="pending" title={PENDING_TITLE} detail={PENDING_DETAIL} />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("renders every icon variant and an action", () => {
    for (const state of ["partial", "unsupported", "empty"] as const) {
      const { unmount } = render(
        <PanelState
          state={state}
          title={state}
          detail={STATE_DETAIL}
          action={<button type="button">{ACTION_LABEL}</button>}
        />,
      );
      expect(screen.getByRole("button", { name: ACTION_LABEL })).toBeInTheDocument();
      unmount();
    }
  });
});
