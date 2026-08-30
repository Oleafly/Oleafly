// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getNativeWebviewOccluded } from "@/lib/native-webview-occlusion";

vi.mock("@/store/github", () => ({
  useGithubStore: (selector: (state: unknown) => unknown) =>
    selector({ status: "disconnected", refresh: vi.fn() }),
}));

vi.mock("@/lib/github", () => ({
  githubListRepos: vi.fn(async () => []),
}));

vi.mock("@/features/project-import", () => ({
  importGitHubRepository: vi.fn(),
  importSelectedFile: vi.fn(),
}));

vi.mock("@oleafly/templates", () => ({
  NewProjectDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">New project</div> : null,
}));

vi.mock("@/features/template-generate", () => ({
  generateTemplateAvailable: vi.fn(async () => false),
}));

vi.mock("@/components/library/TemplateGenerateModal", () => ({
  TemplateGenerateModal: () => null,
}));

import { ProjectImportMenu } from "./ProjectImportMenu";
import { NewProjectDialog } from "./NewProjectDialog";

describe("ProjectImportMenu", () => {
  it("shows the shared import choices", () => {
    render(
      <ProjectImportMenu
        trigger={() => <button type="button">Open import menu</button>}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Open import menu" }), {
      button: 0,
      ctrlKey: false,
    });

    expect(screen.getByText("Local")).toBeInTheDocument();
    expect(screen.getByText("Cloud")).toBeInTheDocument();
    expect(screen.getByText("Existing project (.zip)")).toBeInTheDocument();
    expect(screen.getByText("Word document")).toBeInTheDocument();
    expect(screen.getByText("Markdown document")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });

  it("shows a tooltip when the trigger requests one", () => {
    vi.useFakeTimers();
    render(
      <ProjectImportMenu
        triggerTooltip="Import"
        trigger={() => (
          <button type="button" aria-label="Import">
            Icon
          </button>
        )}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Import" });
    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
    act(() => vi.advanceTimersByTime(300));

    expect(screen.getByRole("tooltip")).toHaveTextContent("Import");
    expect(getNativeWebviewOccluded()).toBe(true);
    fireEvent.mouseLeave(trigger.parentElement as HTMLElement);
    expect(getNativeWebviewOccluded()).toBe(false);
    vi.useRealTimers();
  });

  it("occludes native webviews only while the new-project dialog is open", () => {
    const view = render(
      <NewProjectDialog
        open
        templates={[]}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    expect(getNativeWebviewOccluded()).toBe(true);

    view.rerender(
      <NewProjectDialog
        open={false}
        templates={[]}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(getNativeWebviewOccluded()).toBe(false);
  });
});
