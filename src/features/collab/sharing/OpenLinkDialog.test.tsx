// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { useLinkInbox } from "@/components/collab/link-inbox";
import { loadNamespace } from "@/i18n";

const mocks = vi.hoisted(() => ({ collabOpenLink: vi.fn(), collabJoinProject: vi.fn() }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabOpenLink: mocks.collabOpenLink,
  collabJoinProject: mocks.collabJoinProject,
}));

import { OpenLinkDialog } from "./OpenLinkDialog";

const copy = enCollab.library.openLink;
const PROJECT = "0192a0b0-0000-7000-8000-0000000000aa";
const LINK = `https://collab.uni.edu/p/${PROJECT}`;
const APP_LINK = `oleafly://open?server=https%3A%2F%2Fcollab.uni.edu&project=${PROJECT}`;
const onClose = vi.fn();

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  useLinkInbox.setState({ links: [] });
});

describe("OpenLinkDialog", () => {
  it("hands a pasted project link to the link flow and closes", async () => {
    const user = userEvent.setup();
    render(<OpenLinkDialog onClose={onClose} />);
    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();
    const open = screen.getByRole("button", { name: copy.open });
    expect(open).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: copy.label }), `  ${LINK} `);
    await user.click(open);
    expect(useLinkInbox.getState().links).toEqual([APP_LINK]);
    expect(onClose).toHaveBeenCalled();
    expect(mocks.collabOpenLink).not.toHaveBeenCalled();
    expect(mocks.collabJoinProject).not.toHaveBeenCalled();
  });

  it("hands an app link over as it is", async () => {
    const user = userEvent.setup();
    render(<OpenLinkDialog onClose={onClose} />);
    await user.type(screen.getByRole("textbox", { name: copy.label }), `${APP_LINK}{Enter}`);
    expect(useLinkInbox.getState().links).toEqual([APP_LINK]);
    expect(onClose).toHaveBeenCalled();
  });

  it("says a mistyped or cut-off link isn't a project link, and stays open", async () => {
    const user = userEvent.setup();
    render(<OpenLinkDialog onClose={onClose} />);
    const field = screen.getByRole("textbox", { name: copy.label });
    await user.type(field, "https://collab.uni.edu/p/0192a0b0{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.not_a_link);
    expect(useLinkInbox.getState().links).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
    await user.type(field, "x");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never hands over a blank link, even if the form is sent", () => {
    render(<OpenLinkDialog onClose={onClose} />);
    const field = screen.getByRole("textbox", { name: copy.label });
    fireEvent.change(field, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: copy.open })).toBeDisabled();
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    expect(useLinkInbox.getState().links).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });
});
