import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WebApi, WebMe } from "../api";
import { ProjectController } from "../controller";
import { resetWebState } from "../store";
import { FakeServer } from "../testing/fake-socket";
import { projectHref } from "./navigation";
import { ProjectView } from "./ProjectView";

const ME: WebMe = { accountId: "me", name: "Me", avatarUrl: null, login: null, email: null };

function api(): WebApi {
  return {
    me: vi.fn(async () => ME),
    projects: vi.fn(async () => []),
    project: vi.fn(),
    texts: vi.fn(async () => []),
    blob: vi.fn(),
    output: vi.fn(async () => null),
    putOutput: vi.fn(async () => null),
    signOut: vi.fn(async () => undefined),
  };
}

function shown(end: "too_large" | "no_access") {
  window.history.replaceState(null, "", projectHref("p1"));
  resetWebState({ me: ME, projectId: "p1", end, connection: "ended" });
  const controller = new ProjectController("p1", {
    api: api(),
    socketUrl: "wss://collab.test/web/ws?project=p1",
    createSocket: new FakeServer().factory,
  });
  render(<ProjectView controller={controller} api={api()} me={ME} onSignOut={() => undefined} signOutFailed={false} />);
  return controller;
}

function reloadPrevented(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("ProjectView", () => {
  it("says a project too large for the browser can't be opened, instead of waiting offline", () => {
    shown("too_large");
    expect(screen.getByText("This project is too large to open in a browser.")).toBeInTheDocument();
  });

  it("asks before a reload or the back arrow throws away edits the server has not confirmed", () => {
    const controller = shown("no_access");
    const unconfirmed = vi.spyOn(controller, "unconfirmed").mockReturnValue(true);
    expect(reloadPrevented()).toBe(true);
    fireEvent.click(screen.getByRole("link", { name: "Projects" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Leave this project?");
    expect(new URLSearchParams(window.location.search).get("project")).toBe("p1");
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave" }));
    expect(new URLSearchParams(window.location.search).get("project")).toBeNull();
    unconfirmed.mockReturnValue(false);
    expect(reloadPrevented()).toBe(false);
  });

  it("catches the browser's back button the same way, keeping the project until the person agrees", () => {
    const controller = shown("no_access");
    const unconfirmed = vi.spyOn(controller, "unconfirmed").mockReturnValue(true);
    const discard = vi.spyOn(controller, "discardUnsent");
    window.history.pushState(null, "", projectHref(null));
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(new URLSearchParams(window.location.search).get("project")).toBe("p1");
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave" }));
    expect(discard).toHaveBeenCalledOnce();
    expect(new URLSearchParams(window.location.search).get("project")).toBeNull();
    unconfirmed.mockReturnValue(false);
    window.history.pushState(null, "", projectHref("p1"));
    window.history.pushState(null, "", projectHref(null));
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(new URLSearchParams(window.location.search).get("project")).toBeNull();
  });
});
