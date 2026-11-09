// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";

vi.mock("@/features/collab/sharing/surfaces", () => ({
  ShareDialog: (props: { projectId: string }) => <span>{`share dialog ${props.projectId}`}</span>,
}));

import { ShareDialogHost } from "./CollabSlots";
import { useShareDialog } from "./share-dialog";

function hosts() {
  return render(
    <>
      <div data-testid="workspace">
        <ShareDialogHost />
      </div>
      <div data-testid="notes">
        <ShareDialogHost overNotes />
      </div>
    </>,
  );
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  useShareDialog.setState({ projectId: null, fromCopy: false, sharing: false });
  useHomeViewStore.getState().goTo("library");
  useSettingsStore.setState({ notes: true });
});

describe("ShareDialogHost over Notes", () => {
  it("opens the dialog from the workspace host while Notes is closed", async () => {
    hosts();
    act(() => useShareDialog.getState().openFor("note-1"));
    const dialog = await screen.findByText("share dialog note-1");
    expect(screen.getByTestId("workspace")).toContainElement(dialog);
    expect(screen.getByTestId("notes")).toBeEmptyDOMElement();
  });

  it("opens the dialog from the Notes host while Notes is open", async () => {
    act(() => useHomeViewStore.getState().goTo("notes"));
    hosts();
    act(() => useShareDialog.getState().openFor("note-1"));
    const dialog = await screen.findByText("share dialog note-1");
    expect(screen.getByTestId("notes")).toContainElement(dialog);
    expect(screen.getByTestId("workspace")).toBeEmptyDOMElement();
  });

  it("keeps the workspace host when Notes is turned off", async () => {
    act(() => {
      useHomeViewStore.getState().goTo("notes");
      useSettingsStore.setState({ notes: false });
    });
    hosts();
    act(() => useShareDialog.getState().openFor("note-1"));
    expect(screen.getByTestId("workspace")).toContainElement(await screen.findByText("share dialog note-1"));
  });
});
