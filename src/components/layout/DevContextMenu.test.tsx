// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ openDevtools: vi.fn(async () => {}) }));

vi.mock("@/lib/tauri", () => ({ openDevtools: mocks.openDevtools }));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { DevContextMenu } from "./DevContextMenu";

const copy = enShell.devMenu;

function openMenu(x = 20, y = 30) {
  fireEvent.contextMenu(document.body, { clientX: x, clientY: y });
}

beforeEach(() => {
  mocks.openDevtools.mockClear();
});

describe("DevContextMenu", () => {
  it("stays closed until a context menu is requested", () => {
    render(<DevContextMenu />);
    expect(screen.queryByText(copy.inspect)).not.toBeInTheDocument();
  });

  it("offers the developer actions where the pointer is", async () => {
    render(<DevContextMenu />);
    openMenu();
    expect(await screen.findByText(copy.refreshApp)).toBeInTheDocument();
    expect(screen.getByText(copy.inspect)).toBeInTheDocument();
  });

  it("opens the devtools from its own entry", async () => {
    render(<DevContextMenu />);
    openMenu();
    fireEvent.click(await screen.findByText(copy.inspect));
    await waitFor(() => expect(mocks.openDevtools).toHaveBeenCalled());
    expect(screen.queryByText(copy.inspect)).not.toBeInTheDocument();
  });

  it("closes on escape, on a click outside and on a resize", async () => {
    render(<DevContextMenu />);
    openMenu();
    await screen.findByText(copy.inspect);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByText(copy.inspect)).not.toBeInTheDocument(),
    );

    openMenu();
    await screen.findByText(copy.inspect);
    fireEvent.mouseDown(document.body);
    await waitFor(() =>
      expect(screen.queryByText(copy.inspect)).not.toBeInTheDocument(),
    );

    openMenu();
    await screen.findByText(copy.inspect);
    fireEvent(window, new Event("resize"));
    await waitFor(() =>
      expect(screen.queryByText(copy.inspect)).not.toBeInTheDocument(),
    );
  });

  it("yields to a component that already handled the event", () => {
    render(<DevContextMenu />);
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    document.body.dispatchEvent(event);
    expect(screen.queryByText(copy.inspect)).not.toBeInTheDocument();
  });
});
