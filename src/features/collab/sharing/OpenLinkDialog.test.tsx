// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { collabError, fill } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({ collabOpenLink: vi.fn() }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabOpenLink: mocks.collabOpenLink,
}));

import { OpenLinkDialog } from "./OpenLinkDialog";

const copy = enCollab.library.openLink;
const LINK = "https://collab.uni.edu/p/0192a0b0";
const onClose = vi.fn();
const refreshProjects = vi.fn(async () => undefined);
const openProject = vi.fn(async () => undefined);

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general" });
  useFilesStore.setState({ refreshProjects, openProject });
});

describe("OpenLinkDialog", () => {
  it("opens the project behind a pasted link", async () => {
    mocks.collabOpenLink.mockResolvedValue("grant-local");
    const user = userEvent.setup();
    render(<OpenLinkDialog onClose={onClose} />);
    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();
    const open = screen.getByRole("button", { name: copy.open });
    expect(open).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: copy.label }), `  ${LINK} `);
    await user.click(open);
    expect(mocks.collabOpenLink).toHaveBeenCalledWith(LINK);
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("grant-local"));
    expect(refreshProjects).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("asks to add an unknown server first and offers Collaboration settings", async () => {
    mocks.collabOpenLink.mockRejectedValue(collabError("server_unknown", "https://collab.uni.edu"));
    const user = userEvent.setup();
    render(<OpenLinkDialog onClose={onClose} />);
    await user.type(screen.getByRole("textbox", { name: copy.label }), `${LINK}{Enter}`);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      fill(copy.serverUnknown, { server: "https://collab.uni.edu" }),
    );
    await user.click(screen.getByRole("button", { name: enCollab.share.openSettings }));
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: true, settingsInitialSection: "collaboration" });
    expect(onClose).toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
  });

  it("says when the person has no access", async () => {
    mocks.collabOpenLink.mockRejectedValue(collabError("not_found"));
    const user = userEvent.setup();
    render(<OpenLinkDialog onClose={onClose} />);
    await user.type(screen.getByRole("textbox", { name: copy.label }), `${LINK}{Enter}`);
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.noAccess);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("explains other failures in words", async () => {
    mocks.collabOpenLink.mockRejectedValue(collabError("unreachable"));
    const user = userEvent.setup();
    render(<OpenLinkDialog onClose={onClose} />);
    await user.type(screen.getByRole("textbox", { name: copy.label }), `${LINK}{Enter}`);
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.unreachable);
  });

  it("says a mistyped or cut-off link isn't a project link", async () => {
    mocks.collabOpenLink.mockRejectedValue(collabError("not_a_link", "not a shared project link"));
    const user = userEvent.setup();
    render(<OpenLinkDialog onClose={onClose} />);
    await user.type(screen.getByRole("textbox", { name: copy.label }), `${LINK}{Enter}`);
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.not_a_link);
  });

  it("shows the server's own sentence for a refusal it has no code for", async () => {
    mocks.collabOpenLink.mockRejectedValue(collabError("invalid", "That link has expired."));
    const user = userEvent.setup();
    render(<OpenLinkDialog onClose={onClose} />);
    await user.type(screen.getByRole("textbox", { name: copy.label }), `${LINK}{Enter}`);
    expect(await screen.findByRole("alert")).toHaveTextContent("That link has expired.");
  });

  it("never asks the server about a blank link, even if the form is sent", () => {
    render(<OpenLinkDialog onClose={onClose} />);
    const field = screen.getByRole("textbox", { name: copy.label });
    fireEvent.change(field, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: copy.open })).toBeDisabled();
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    expect(mocks.collabOpenLink).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
