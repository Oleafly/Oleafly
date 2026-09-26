// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useOpenFolderFlowStore } from "@/store/open-folder-flow";
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";

const mocks = vi.hoisted(() => ({ openFolderWithPicker: vi.fn() }));
vi.mock("@/features/open-folder", () => ({ openFolderWithPicker: mocks.openFolderWithPicker }));

import { LibraryStartChoices } from "./LibraryStartChoices";
import { OpenFolderButton } from "./OpenFolderButton";
import { OpenFolderNotice } from "./OpenFolderNotice";

beforeEach(() => {
  mocks.openFolderWithPicker.mockReset();
  mocks.openFolderWithPicker.mockResolvedValue("cancelled");
  useFilesStore.setState({ projectId: null });
  useHomeViewStore.setState({ page: "library" });
});

afterEach(() => {
  useOpenFolderFlowStore.setState({ prompt: null, refusal: null, opening: false });
});

describe("OpenFolderButton", () => {
  it("opens the folder picker and names its shortcut", async () => {
    const user = userEvent.setup();
    render(<OpenFolderButton />);
    const button = screen.getByRole("button", { name: enLibrary.home.openFolder });
    expect(button).toHaveTextContent(enLibrary.home.openFolder);
    expect(button).not.toHaveAttribute("aria-label");
    fireEvent.mouseEnter(button.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      `Open folder (${shortcutLabel(useShortcutStore.getState().bindings.openFolder)})`,
    );
    await user.click(button);
    expect(mocks.openFolderWithPicker).toHaveBeenCalledWith();
  });

  it("waits while a folder is opening", () => {
    useOpenFolderFlowStore.setState({ opening: true });
    render(<OpenFolderButton />);
    expect(screen.getByRole("button", { name: enLibrary.home.openFolder })).toBeDisabled();
  });
});

describe("LibraryStartChoices", () => {
  it("offers a new project and an existing folder as two keyboard-reachable choices", async () => {
    const user = userEvent.setup();
    const onNewProject = vi.fn();
    const { container } = render(<LibraryStartChoices onNewProject={onNewProject} />);

    const create = screen.getByRole("button", { name: new RegExp(enLibrary.start.newProjectTitle) });
    const open = screen.getByRole("button", { name: new RegExp(enLibrary.start.openFolderTitle) });
    expect(create).toHaveAttribute("data-testid", "create-first-project");
    expect(create).toHaveAccessibleDescription(enLibrary.start.newProjectDescription);
    expect(open).toHaveAccessibleDescription(enLibrary.start.openFolderDescription);

    await user.tab();
    expect(create).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onNewProject).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(open).toHaveFocus();
    await user.keyboard(" ");
    expect(mocks.openFolderWithPicker).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).not.toMatch(/(^|[\s"])(focus-visible:)?(ring|outline)-/);
  });

  it("explains a refusal right under the choices", () => {
    useOpenFolderFlowStore.setState({
      refusal: { title: null, message: "Documents holds too much.", hint: null, browse: null },
    });
    render(<LibraryStartChoices onNewProject={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Documents holds too much.");
  });
});

describe("OpenFolderNotice", () => {
  it("renders nothing without a refusal", () => {
    const { container } = render(<OpenFolderNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers to choose a subfolder inside a folder that was too broad", async () => {
    const user = userEvent.setup();
    useOpenFolderFlowStore.setState({
      refusal: {
        title: "Couldn't open Documents",
        message: "Documents holds too much.",
        hint: null,
        browse: "scope-1",
      },
    });
    render(<OpenFolderNotice />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Couldn't open Documents")).toBeInTheDocument();
    expect(within(alert).getByText("Documents holds too much.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enShell.openFolder.chooseSubfolder }));
    expect(mocks.openFolderWithPicker).toHaveBeenCalledWith("scope-1");
    expect(useOpenFolderFlowStore.getState().refusal).toBeNull();
  });

  it("can be dismissed and never offers a subfolder it cannot browse", async () => {
    const user = userEvent.setup();
    useOpenFolderFlowStore.setState({
      refusal: { title: null, message: "Oleafly can't find this folder.", hint: null, browse: null },
    });
    render(<OpenFolderNotice />);
    expect(
      screen.queryByRole("button", { name: enShell.openFolder.chooseSubfolder }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enLibrary.openFolder.dismiss }));
    expect(useOpenFolderFlowStore.getState().refusal).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows what to do next under the reason", () => {
    useOpenFolderFlowStore.setState({
      refusal: {
        title: "Couldn't open Private",
        message: "Oleafly doesn't have permission to open this folder.",
        hint: "Check that your account can read this folder, then try again.",
        browse: null,
      },
    });
    render(<OpenFolderNotice />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Couldn't open Private")).toBeInTheDocument();
    expect(
      within(alert).getByText("Check that your account can read this folder, then try again."),
    ).toBeInTheDocument();
  });

  it("forgets the refusal once a project opens", () => {
    useOpenFolderFlowStore.setState({
      refusal: { title: null, message: "Oleafly can't find this folder.", hint: null, browse: null },
    });
    const { unmount } = render(<OpenFolderNotice />);
    act(() => useFilesStore.setState({ projectId: "thesis-1" }));
    unmount();
    expect(useOpenFolderFlowStore.getState().refusal).toBeNull();
  });
});
