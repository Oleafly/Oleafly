// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGithubStore } from "@/store/github";
import { PublishToGitHubDialog } from "./PublishToGitHubDialog";

const mocks = vi.hoisted(() => ({
  githubListRepos: vi.fn(),
}));

vi.mock("@/lib/github", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github")>()),
  githubListRepos: mocks.githubListRepos,
}));

beforeEach(() => {
  mocks.githubListRepos.mockResolvedValue([]);
  useGithubStore.setState({ status: "connected" });
});

describe("PublishToGitHubDialog", () => {
  it("right-aligns the create action at the bottom of the form", () => {
    render(
      <PublishToGitHubDialog
        open
        onClose={vi.fn()}
        projectId="project-1"
        projectName="Research notes"
        onPublished={vi.fn()}
      />,
    );

    const action = screen.getByRole("button", { name: "Create and push" });
    expect(action).toHaveClass("mt-auto", "ml-auto");
    expect(action).not.toHaveClass("w-full");

    const header = screen.getByRole("heading", { name: "Publish to GitHub" })
      .parentElement?.parentElement;
    expect(header).not.toHaveClass("border-b");
  });

  it("renders the repository search with a single outer border", async () => {
    const user = userEvent.setup();
    render(
      <PublishToGitHubDialog
        open
        onClose={vi.fn()}
        projectId="project-1"
        projectName="Research notes"
        onPublished={vi.fn()}
      />,
    );

    const tabs = screen.getByRole("tablist");
    expect(tabs).toHaveClass("rounded-lg", "bg-muted", "p-1");
    expect(tabs.parentElement).toHaveClass("py-2");

    await user.click(screen.getByRole("tab", { name: "Link existing" }));

    const search = screen.getByRole("textbox", { name: "Search repositories" });
    expect(search).toHaveClass("border-0", "focus-visible:ring-0");
    expect(search.parentElement).toHaveClass("border", "focus-within:ring-1");
  });
});
