// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

vi.mock("@/lib/tauri", () => ({
  appendAppLog: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/crash-report", () => ({
  reportCrashToGithub: vi.fn(() => Promise.resolve()),
}));

function Bomb(): never {
  throw new Error("preview exploded");
}

describe("ErrorBoundary surface mode", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("contains a crash to its own surface and leaves sibling surfaces alive", () => {
    render(
      <div>
        <ErrorBoundary surface="editor">
          <p>editor content</p>
        </ErrorBoundary>
        <ErrorBoundary surface="PDF preview">
          <Bomb />
        </ErrorBoundary>
        <ErrorBoundary surface="chat">
          <p>chat content</p>
        </ErrorBoundary>
      </div>,
    );

    expect(screen.getByText("editor content")).toBeInTheDocument();
    expect(screen.getByText("chat content")).toBeInTheDocument();
    expect(screen.getByText("The PDF preview crashed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy diagnostics" }),
    ).toBeInTheDocument();
  });

  it("retry renders the children again", () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("transient");
      return <p>recovered</p>;
    }

    render(
      <ErrorBoundary surface="chat">
        <Flaky />
      </ErrorBoundary>,
    );

    expect(screen.getByText("The chat crashed.")).toBeInTheDocument();
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByText("recovered")).toBeInTheDocument();
    expect(screen.queryByText("The chat crashed.")).not.toBeInTheDocument();
  });

  it("copy diagnostics puts the error and component stack on the clipboard", async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(
      <ErrorBoundary surface="diagram composer">
        <Bomb />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]?.[0] ?? "";
    expect(copied).toContain("Error: preview exploded");
    expect(copied).toContain("componentStack");
  });

  it("still renders the custom fallback node when one is provided", () => {
    render(
      <ErrorBoundary fallback={<p>custom fallback</p>}>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText("custom fallback")).toBeInTheDocument();
  });
});
