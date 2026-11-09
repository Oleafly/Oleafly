// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { DEFAULT_BOOK_COLOR } from "@/components/library/Book";
import { useProjectColorsStore } from "@/store/project-colors";
import { useToastStore } from "@/store/toast";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { RelatedProjectMenu } from "./RelatedProjectMenu";
import type { NoteItem } from "./types";

const mocks = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

const copy = enNotes.workspace;

const PROJECTS = [
  { id: "p1", name: "Vision" },
  { id: "p2", name: "Speech" },
];

const related: NoteItem = {
  id: "n1",
  title: "Masking ablation",
  project: "Vision",
  relatedProjectId: "p1",
  updatedAt: 1_700_000_000_000,
  author: "you",
  summary: "",
};

const loose: NoteItem = {
  id: "n2",
  title: "Loose ideas",
  project: "Notes",
  updatedAt: 1_700_000_000_000,
  author: "you",
  summary: "",
};

type SetRelatedProject = (noteId: string, projectId: string | null) => Promise<void>;

interface Setup {
  note?: NoteItem;
  projects?: NotesData["projects"] | null;
  setRelatedProject?: SetRelatedProject | null;
}

function renderMenu({ note = related, projects = PROJECTS, setRelatedProject = vi.fn<SetRelatedProject>(async () => {}) }: Setup = {}) {
  const data: NotesData = {
    notes: [note],
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    ...(projects ? { projects } : {}),
    ...(setRelatedProject ? { setRelatedProject } : {}),
    loadNote: vi.fn(),
    saveNote: vi.fn(),
  };
  render(
    <NotesDataProvider value={data}>
      <RelatedProjectMenu note={note} />
    </NotesDataProvider>,
  );
  return { setRelatedProject };
}

function menuLabel(project: string): string {
  return copy.projectMenu.replace("{{project}}", project);
}

function openMenu(project: string): HTMLElement {
  fireEvent.pointerDown(screen.getByRole("button", { name: menuLabel(project) }), { button: 0, ctrlKey: false });
  return screen.getByRole("menu");
}

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  mocks.logError.mockClear();
  useProjectColorsStore.setState({ colors: {} });
});

function dotOf(element: Element): string | null | undefined {
  return element.querySelector("[data-project-color]")?.getAttribute("data-project-color");
}

describe("RelatedProjectMenu", () => {
  it("names the related project on its trigger", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: menuLabel("Vision") });
    expect(trigger).toHaveTextContent("Vision");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  });

  it("shows the related project's colour on its trigger", () => {
    useProjectColorsStore.setState({ colors: { p1: "#cfbaf0" } });
    renderMenu();
    expect(dotOf(screen.getByRole("button", { name: menuLabel("Vision") }))).toBe("#cfbaf0");
  });

  it("shows a neutral dot on the trigger when the note has no project", () => {
    renderMenu({ note: loose });
    expect(dotOf(screen.getByRole("button", { name: menuLabel(copy.chooseProject) }))).toBe("none");
  });

  it("puts each project's colour next to its name in the menu", () => {
    useProjectColorsStore.setState({ colors: { p2: "#98f5e1" } });
    renderMenu();
    const menu = openMenu("Vision");
    expect(dotOf(within(menu).getByRole("menuitemradio", { name: copy.noProject }))).toBe("none");
    expect(dotOf(within(menu).getByRole("menuitemradio", { name: "Vision" }))).toBe(DEFAULT_BOOK_COLOR);
    expect(dotOf(within(menu).getByRole("menuitemradio", { name: "Speech" }))).toBe("#98f5e1");
  });

  it("asks to choose a project when the note has none", () => {
    renderMenu({ note: loose });
    const trigger = screen.getByRole("button", { name: menuLabel(copy.chooseProject) });
    expect(trigger).toHaveTextContent(copy.chooseProject);
    expect(trigger).not.toHaveTextContent("Notes");
  });

  it("lists No project and every project, with the related one checked", () => {
    renderMenu();
    const menu = openMenu("Vision");
    expect(within(menu).getByText(copy.project)).toBeInTheDocument();
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([copy.noProject, "Vision", "Speech"]);
    expect(within(menu).getByRole("menuitemradio", { name: "Vision" })).toHaveAttribute("aria-checked", "true");
    expect(within(menu).getByRole("menuitemradio", { name: copy.noProject })).toHaveAttribute("aria-checked", "false");
  });

  it("checks No project for a note without a related project", () => {
    renderMenu({ note: loose });
    const menu = openMenu(copy.chooseProject);
    expect(within(menu).getByRole("menuitemradio", { name: copy.noProject })).toHaveAttribute("aria-checked", "true");
  });

  it("relates the note to the project you choose", async () => {
    const user = userEvent.setup();
    const { setRelatedProject } = renderMenu({ note: loose });
    await user.click(within(openMenu(copy.chooseProject)).getByRole("menuitemradio", { name: "Speech" }));
    expect(setRelatedProject).toHaveBeenCalledExactlyOnceWith("n2", "p2");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("clears the related project when you choose No project", async () => {
    const user = userEvent.setup();
    const { setRelatedProject } = renderMenu();
    await user.click(within(openMenu("Vision")).getByRole("menuitemradio", { name: copy.noProject }));
    expect(setRelatedProject).toHaveBeenCalledExactlyOnceWith("n1", null);
  });

  it("does nothing when you choose the project it already has", async () => {
    const user = userEvent.setup();
    const { setRelatedProject } = renderMenu();
    await user.click(within(openMenu("Vision")).getByRole("menuitemradio", { name: "Vision" }));
    expect(setRelatedProject).not.toHaveBeenCalled();
  });

  it("does nothing when you choose No project for a note without one", async () => {
    const user = userEvent.setup();
    const { setRelatedProject } = renderMenu({ note: loose });
    await user.click(within(openMenu(copy.chooseProject)).getByRole("menuitemradio", { name: copy.noProject }));
    expect(setRelatedProject).not.toHaveBeenCalled();
  });

  it("tells the user and logs when the project could not be changed", async () => {
    const user = userEvent.setup();
    const failure = new Error("note is read-only");
    renderMenu({ setRelatedProject: vi.fn<SetRelatedProject>(async () => Promise.reject(failure)) });
    await user.click(within(openMenu("Vision")).getByRole("menuitemradio", { name: "Speech" }));
    await waitFor(() => expect(mocks.logError).toHaveBeenCalledExactlyOnceWith("set the note's project", failure));
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(
      enNotes.failures.linkNote.replace("{{name}}", "Masking ablation"),
    );
  });

  it("shows the project as plain text when the project list is missing", () => {
    useProjectColorsStore.setState({ colors: { p1: "#cfbaf0" } });
    renderMenu({ projects: null });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Vision").tagName).toBe("SPAN");
    expect(dotOf(screen.getByText("Vision").parentElement as HTMLElement)).toBe("#cfbaf0");
  });

  it("shows the project as plain text when projects cannot be changed", () => {
    renderMenu({ note: loose, setRelatedProject: null });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Notes").tagName).toBe("SPAN");
  });
});
