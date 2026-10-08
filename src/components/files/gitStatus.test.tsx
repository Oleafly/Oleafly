// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { GitFileChange } from "@oleafly/backend-port";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { i18n } from "@/i18n";
import { GitFolderDot, GitStatusBadge, gitDecorations, gitStatusMeta } from "./gitStatus";

const status = enShell.sourceControl.status;
const change = (path: string, value: string, staged = false, conflict = false): GitFileChange => ({
  path,
  status: value,
  staged,
  conflict,
});

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("gitDecorations", () => {
  it("maps each changed file to its badge and marks every folder above it", () => {
    const { files, folders } = gitDecorations([
      change("main.tex", "?"),
      change("chapters/intro/one.tex", "M"),
    ]);

    expect(files.get("main.tex")?.label).toBe("U");
    expect(files.get("chapters/intro/one.tex")?.label).toBe("M");
    expect([...folders.keys()].sort()).toEqual(["chapters", "chapters/intro"]);
    expect(files.has("chapters")).toBe(false);
  });

  it("prefers a conflict, then the working tree, over the staged side", () => {
    const { files } = gitDecorations([
      change("both.tex", "A", true),
      change("both.tex", "M"),
      change("merge.tex", "M", true),
      change("merge.tex", "UU", false, true),
      change("staged.tex", "A", true),
    ]);

    expect(files.get("both.tex")?.name).toBe("modified");
    expect(files.get("merge.tex")?.name).toBe("conflict");
    expect(files.get("staged.tex")?.name).toBe("added");
  });

  it("gives a folder the colour of its most urgent change, including deleted files", () => {
    const { folders } = gitDecorations([
      change("figs/new.png", "?"),
      change("figs/old.png", "D"),
      change("notes/draft.md", "?"),
    ]);

    expect(folders.get("figs")?.name).toBe("deleted");
    expect(folders.get("notes")?.name).toBe("untracked");
  });

  it("returns nothing for a clean tree", () => {
    const { files, folders } = gitDecorations([]);
    expect(files.size).toBe(0);
    expect(folders.size).toBe(0);
  });
});

describe("Git status badges", () => {
  it("names a badge by its status instead of its letter", () => {
    render(<GitStatusBadge meta={gitStatusMeta("?")} testId="badge" />);

    const badge = screen.getByTestId("badge");
    expect(badge).toHaveTextContent("U");
    expect(badge).toHaveAttribute("title", status.untracked);
    expect(badge).toHaveAccessibleName(status.untracked);
    expect(screen.getByText("U")).toHaveAttribute("aria-hidden");
  });

  it("falls back to the status letter for codes without a colour", () => {
    const meta = gitStatusMeta("T");
    expect(meta.label).toBe("T");
    expect(meta.text).toBe("text-muted-foreground");
  });

  it("labels a folder dot", () => {
    render(<GitFolderDot meta={gitStatusMeta("M")} />);
    expect(screen.getByRole("img", { name: status.containsChanges })).toHaveClass(
      "text-amber-600",
    );
  });
});
