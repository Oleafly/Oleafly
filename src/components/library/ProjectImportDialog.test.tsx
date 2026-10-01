// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const githubState = { status: "connected" as string, refresh: vi.fn() };

vi.mock("@/store/github", () => ({
  useGithubStore: (selector: (state: unknown) => unknown) => selector(githubState),
}));

vi.mock("@/lib/github", () => ({
  githubListRepos: vi.fn(async () => [
    { full_name: "oleafly/paper", html_url: "https://github.com/oleafly/paper", private: false },
    { full_name: "oleafly/notes", html_url: "https://github.com/oleafly/notes", private: true },
  ]),
}));

vi.mock("@/features/project-import", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/project-import")>(),
  importGitHubRepository: vi.fn(async () => {}),
  importSelectedFile: vi.fn(async () => {}),
  importArxivPaper: vi.fn(async () => true),
  importFileKind: (path: string) => {
    if (path.endsWith(".zip")) return "project";
    if (path.endsWith(".docx")) return "word";
    if (path.endsWith(".md")) return "markdown";
    if (path.endsWith(".html")) return "html";
    if (path.endsWith(".typ")) return "typst";
    return null;
  },
  importTargetsForKind: (kind: string) => {
    if (kind === "html") {
      return [
        { target: "latex", label: "LaTeX project", recommended: true },
        { target: "markdown", label: "Markdown project" },
        { target: "typst", label: "Typst project" },
      ];
    }
    return [];
  },
}));

vi.mock("@/lib/native-file-dialog", () => ({
  pickOpenPath: vi.fn(async () => "/tmp/paper.zip"),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn(async () => {}) }));

import {
  importArxivPaper,
  importGitHubRepository,
  importSelectedFile,
} from "@/features/project-import";
import { pickOpenPath } from "@/lib/native-file-dialog";
import { CHOICE_ART } from "./choice-art";
import { ProjectImportDialog } from "./ProjectImportDialog";

const LOCAL_CARDS = [
  ["project-import-project", CHOICE_ART.importArchive, "Existing project", "A .zip archive of a project folder."],
  ["project-import-word", CHOICE_ART.importWord, "Word document", "A .docx file, converted on the way in."],
  ["project-import-markdown", CHOICE_ART.importMarkdown, "Markdown document", "A .md file, kept as Markdown."],
  ["project-import-html", CHOICE_ART.importHtml, "HTML page", "Convert HTML to LaTeX, Markdown, or Typst."],
  ["project-import-typst", CHOICE_ART.importTypst, "Typst document", "Convert Typst to LaTeX or Markdown."],
] as const;
const CLOUD_CARDS = [
  ["project-import-arxiv", CHOICE_ART.importArxiv, "arXiv paper", "Download a paper's LaTeX source by its arXiv id."],
  ["project-import-github", CHOICE_ART.importGithub, "GitHub", "Pick from the repositories you can reach."],
] as const;
const ALL_CARDS = [...LOCAL_CARDS, ...CLOUD_CARDS];

function section(heading: string): HTMLElement {
  const element = screen.getByRole("heading", { name: heading }).closest("section");
  if (!element) throw new Error(`no section for ${heading}`);
  return element;
}

beforeEach(() => {
  vi.clearAllMocks();
  githubState.status = "connected";
  vi.mocked(pickOpenPath).mockResolvedValue("/tmp/paper.zip");
  vi.mocked(importArxivPaper).mockResolvedValue(true);
});

describe("ProjectImportDialog", () => {
  it("imports a chosen file and closes only after the import finishes", async () => {
    const onImported = vi.fn();
    render(<ProjectImportDialog open onClose={vi.fn()} onImported={onImported} />);

    expect(screen.getByTestId("project-import-dialog")).toHaveTextContent("Import a project");
    fireEvent.click(screen.getByTestId("project-import-project"));

    await waitFor(() => expect(importSelectedFile).toHaveBeenCalledWith("/tmp/paper.zip"));
    expect(pickOpenPath).toHaveBeenCalledOnce();
    expect(onImported).toHaveBeenCalledOnce();
  });

  it("lists repositories behind the GitHub step and imports the chosen one", async () => {
    render(<ProjectImportDialog open onClose={vi.fn()} />);
    expect(screen.queryByText("oleafly/paper")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("project-import-github"));

    expect(await screen.findByText("oleafly/paper")).toBeInTheDocument();
    expect(screen.getByLabelText("Private repository")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("project-import-repository-oleafly/paper"));
    await waitFor(() =>
      expect(importGitHubRepository).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: "oleafly/paper" }),
      ),
    );
  });

  it("returns from the GitHub step to the sources", async () => {
    render(<ProjectImportDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("project-import-github"));
    await screen.findByText("oleafly/paper");

    fireEvent.click(screen.getByTestId("project-import-back"));

    expect(screen.getByTestId("project-import-word")).toBeInTheDocument();
    expect(screen.queryByText("oleafly/paper")).not.toBeInTheDocument();
  });

  it("asks for the project type when the registry offers several targets", async () => {
    vi.mocked(pickOpenPath).mockResolvedValue("/tmp/paper.html");
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("project-import-html"));

    expect(await screen.findByTestId("project-import-target-latex")).toBeInTheDocument();
    expect(screen.getByTestId("project-import-target-typst")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("project-import-target-typst"));

    await waitFor(() =>
      expect(importSelectedFile).toHaveBeenCalledWith("/tmp/paper.html", "typst"),
    );
  });

  it("imports an arXiv paper by id", async () => {
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("project-import-arxiv"));
    fireEvent.change(screen.getByTestId("project-import-arxiv-id"), {
      target: { value: "2301.01234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import/ }));

    await waitFor(() => expect(importArxivPaper).toHaveBeenCalledWith("2301.01234"));
  });

  it("offers the Settings route when GitHub is not connected", () => {
    githubState.status = "disconnected";
    render(<ProjectImportDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("project-import-github"));

    expect(screen.getByRole("button", { name: /Connect GitHub/ })).toBeInTheDocument();
    expect(importGitHubRepository).not.toHaveBeenCalled();
  });
});


describe("ProjectImportDialog source cards", () => {
  it("lists the local sources, then the cloud ones, in keyboard order", () => {
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    const testIds = (container: HTMLElement) =>
      within(container).getAllByRole("button").map((button) => button.dataset.testid);
    expect(testIds(section("On this computer"))).toEqual(LOCAL_CARDS.map(([testId]) => testId));
    expect(testIds(section("From the cloud"))).toEqual(CLOUD_CARDS.map(([testId]) => testId));
    expect(
      testIds(screen.getByTestId("project-import-dialog")).filter((testId) => testId !== undefined),
    ).toEqual(ALL_CARDS.map(([testId]) => testId));
  });

  it("gives every source its own decorative picture", () => {
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    for (const [testId, picture] of ALL_CARDS) {
      const image = screen.getByTestId(testId).querySelector("img");
      expect(image).toHaveAttribute("src", picture);
      expect(image).toHaveAttribute("alt", "");
      expect(image).toHaveAttribute("aria-hidden", "true");
    }
    expect(new Set(ALL_CARDS.map(([, picture]) => picture)).size).toBe(ALL_CARDS.length);
    // Decorative pictures add nothing to the accessibility tree.
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("names each card by its title and describes it by its description", () => {
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    for (const [testId, , title, description] of ALL_CARDS) {
      const card = screen.getByTestId(testId);
      expect(card).toHaveAccessibleName(expect.stringContaining(title));
      expect(card).toHaveAccessibleDescription(description);
    }
  });

  it("tells a signed-out user that GitHub needs connecting first", () => {
    githubState.status = "disconnected";
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    const github = screen.getByTestId("project-import-github");
    expect(github).toBeEnabled();
    expect(github).toHaveAccessibleDescription("Connect your account to list repositories.");
  });

  it("disables every card while the file picker is open and spins only on the chosen card", async () => {
    let answer!: (path: string | null) => void;
    vi.mocked(pickOpenPath).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("project-import-word"));

    expect(await screen.findByRole("status")).toHaveTextContent("Importing your project");
    for (const [testId] of ALL_CARDS) {
      expect(screen.getByTestId(testId)).toBeDisabled();
      if (testId === "project-import-word") {
        expect(screen.getByTestId(testId)).toHaveAttribute("aria-busy", "true");
      } else {
        expect(screen.getByTestId(testId)).not.toHaveAttribute("aria-busy");
      }
    }

    answer(null);

    await waitFor(() => expect(screen.getByTestId("project-import-word")).toBeEnabled());
    expect(screen.getByTestId("project-import-word")).not.toHaveAttribute("aria-busy");
    expect(importSelectedFile).not.toHaveBeenCalled();
  });

  it("keeps the chosen card spinning while its file imports", async () => {
    let finish!: () => void;
    vi.mocked(pickOpenPath).mockResolvedValueOnce("/tmp/paper.docx");
    vi.mocked(importSelectedFile).mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve(true); }));
    const onClose = vi.fn();
    render(<ProjectImportDialog open onClose={onClose} />);

    fireEvent.click(screen.getByTestId("project-import-word"));

    await waitFor(() => expect(importSelectedFile).toHaveBeenCalledWith("/tmp/paper.docx"));
    expect(screen.getByTestId("project-import-word")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("project-import-github")).not.toHaveAttribute("aria-busy");

    finish();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.getByTestId("project-import-word")).not.toHaveAttribute("aria-busy");
  });

  it("opens straight on the arXiv step and goes back to the cards", () => {
    render(<ProjectImportDialog open initialView="arxiv" onClose={vi.fn()} />);

    expect(screen.getByTestId("project-import-arxiv-id")).toBeInTheDocument();
    expect(screen.queryByTestId("project-import-project")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("project-import-back"));

    expect(screen.queryByTestId("project-import-arxiv-id")).not.toBeInTheDocument();
    for (const [testId] of ALL_CARDS) expect(screen.getByTestId(testId)).toBeEnabled();
  });
});

describe("import recovery", () => {
  it("keeps an arXiv error and input available for retry", async () => {
    vi.mocked(importArxivPaper).mockRejectedValueOnce(new Error("Source download failed"));
    const onClose = vi.fn();
    render(<ProjectImportDialog open initialView="arxiv" onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("arXiv id or paper link"), { target: { value: "2301.01234" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Source download failed");
    expect(screen.getByLabelText("arXiv id or paper link")).toHaveValue("2301.01234");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
  it("ignores repeated Enter submissions while an import is running", async () => {
    let finish!: (value: boolean) => void;
    vi.mocked(importArxivPaper).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const onClose = vi.fn();
    render(<ProjectImportDialog open initialView="arxiv" onClose={onClose} />);
    const input = screen.getByLabelText("arXiv id or paper link");
    fireEvent.change(input, { target: { value: "2301.01234" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(importArxivPaper).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    finish(true);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
  it("reports file-picker failure and allows another attempt", async () => {
    vi.mocked(pickOpenPath).mockRejectedValueOnce(new Error("File picker unavailable"));
    render(<ProjectImportDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("project-import-project"));
    expect(await screen.findByRole("alert")).toHaveTextContent("File picker unavailable");
    expect(importSelectedFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("project-import-project"));
    await waitFor(() => expect(importSelectedFile).toHaveBeenCalledOnce());
  });
  it("explains a refused repository import instead of showing the raw error", async () => {
    vi.mocked(importGitHubRepository).mockRejectedValueOnce(
      '@oleafly/error:{"code":"git.nested_repository","params":{}}',
    );
    const onClose = vi.fn();
    render(<ProjectImportDialog open onClose={onClose} />);
    fireEvent.click(screen.getByTestId("project-import-github"));
    fireEvent.click(await screen.findByTestId("project-import-repository-oleafly/paper"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("inside another Git repository");
    expect(alert).not.toHaveTextContent("@oleafly/error");
    expect(onClose).not.toHaveBeenCalled();
  });
  it("keeps the selected file and target choices when conversion cannot start", async () => {
    vi.mocked(pickOpenPath).mockResolvedValueOnce("/tmp/paper.html");
    vi.mocked(importSelectedFile).mockResolvedValueOnce(false);
    const onClose = vi.fn();
    render(<ProjectImportDialog open onClose={onClose} />);
    fireEvent.click(screen.getByTestId("project-import-html"));
    fireEvent.click(await screen.findByTestId("project-import-target-typst"));
    expect(await screen.findByRole("alert")).toHaveTextContent("converter is unavailable");
    expect(screen.getByText("paper.html")).toBeInTheDocument();
    expect(screen.getByTestId("project-import-target-typst")).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
