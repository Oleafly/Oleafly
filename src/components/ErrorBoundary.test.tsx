// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";

const mocks = vi.hoisted(() => ({
  appendAppLog: vi.fn(() => Promise.resolve()),
  reportCrashToGithub: vi.fn(() => Promise.resolve()),
  writeText: vi.fn(async (_text: string) => {}),
}));

vi.mock("@/lib/tauri", () => ({ appendAppLog: mocks.appendAppLog }));
vi.mock("@/lib/crash-report", () => ({
  reportCrashToGithub: mocks.reportCrashToGithub,
}));
vi.mock("@/components/SpecimenIllustration", () => ({
  SpecimenIllustration: () => <div data-testid="specimen" />,
}));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { ErrorBoundary } from "./ErrorBoundary";

const copy = enShell.errorBoundary;

function crashed(surface: "chat" | "diagramComposer" | "pdfPreview"): string {
  return i18n.t(($) => $.shell.errorBoundary.surfaceCrashed, {
    surface: i18n.t(($) => $.shell.errorBoundary.surfaces[surface]),
  });
}

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
          <p>{"editor content"}</p>
        </ErrorBoundary>
        <ErrorBoundary surface="PDF preview">
          <Bomb />
        </ErrorBoundary>
        <ErrorBoundary surface="chat">
          <p>{"chat content"}</p>
        </ErrorBoundary>
      </div>,
    );

    expect(screen.getByText("editor content")).toBeInTheDocument();
    expect(screen.getByText("chat content")).toBeInTheDocument();
    expect(screen.getByText(crashed("pdfPreview"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: i18n.t(($) => $.common.actions.retry) }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: i18n.t(($) => $.shell.errorBoundary.copyDiagnostics),
      }),
    ).toBeInTheDocument();
  });

  it("retry renders the children again", () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("transient");
      return <p>{"recovered"}</p>;
    }

    render(
      <ErrorBoundary surface="chat">
        <Flaky />
      </ErrorBoundary>,
    );

    expect(screen.getByText(crashed("chat"))).toBeInTheDocument();
    shouldThrow = false;
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t(($) => $.common.actions.retry) }),
    );

    expect(screen.getByText("recovered")).toBeInTheDocument();
    expect(screen.queryByText(crashed("chat"))).not.toBeInTheDocument();
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

    fireEvent.click(
      screen.getByRole("button", {
        name: i18n.t(($) => $.shell.errorBoundary.copyDiagnostics),
      }),
    );

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]?.[0] ?? "";
    expect(copied).toContain("Error: preview exploded");
    expect(copied).toContain("componentStack");
  });

  it("still renders the custom fallback node when one is provided", () => {
    render(
      <ErrorBoundary fallback={<p>{"custom fallback"}</p>}>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText("custom fallback")).toBeInTheDocument();
  });
});

function Boom({ crash = true }: { crash?: boolean }) {
  if (crash) throw new Error("kaboom");
  return <div data-testid="child" />;
}

function setupUser() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
  return user;
}

describe("ErrorBoundary crash screen", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.appendAppLog.mockClear();
    mocks.reportCrashToGithub.mockClear();
    mocks.writeText.mockClear();
    mocks.writeText.mockResolvedValue(undefined);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("renders its children while nothing throws", () => {
    render(
      <ErrorBoundary>
        <Boom crash={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("logs a caught error to the app log", () => {
    render(
      <ErrorBoundary fallback={<div data-testid="quiet" />}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("quiet")).toBeInTheDocument();
    expect(mocks.appendAppLog).toHaveBeenCalled();
  });

  it("copies the diagnostics of a crashed surface", async () => {
    render(
      <ErrorBoundary surface="PDF preview">
        <Boom />
      </ErrorBoundary>,
    );
    const user = setupUser();
    await user.click(screen.getByRole("button", { name: copy.copyDiagnostics }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalled());
    expect(mocks.writeText.mock.calls[0][0]).toContain("kaboom");
  });

  it("gives a scoped surface one fresh attempt on a new reset key", () => {
    const { rerender } = render(
      <ErrorBoundary surface="editor" resetKey={1}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("surface-error-boundary")).toBeInTheDocument();
    rerender(
      <ErrorBoundary surface="editor" resetKey={2}>
        <Boom crash={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("shows the full crash screen with the stack and the report action", async () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-boundary")).toBeInTheDocument();
    expect(screen.getByText(copy.runtimeError)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();
    expect(screen.getByText(copy.description)).toBeInTheDocument();
    expect(screen.getByText(copy.stackTrace)).toBeInTheDocument();
    expect(screen.getByText("Error: kaboom")).toBeInTheDocument();
    expect(screen.getByText(copy.specimenViewer)).toBeInTheDocument();
    expect(screen.getByText(copy.halted)).toBeInTheDocument();

    const user = setupUser();
    await user.click(screen.getByRole("button", { name: enCommon.actions.copy }));
    await waitFor(() =>
      expect(mocks.writeText).toHaveBeenCalledWith("Error: kaboom"),
    );
    expect(
      await screen.findByRole("button", { name: enCommon.actions.copied }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: copy.report }));
    expect(mocks.reportCrashToGithub).toHaveBeenCalledWith("Error: kaboom");
  });

  it("survives a clipboard that refuses to write", async () => {
    mocks.writeText.mockRejectedValue(new Error("denied"));
    render(
      <ErrorBoundary surface="chat">
        <Boom />
      </ErrorBoundary>,
    );
    const user = setupUser();
    await user.click(screen.getByRole("button", { name: copy.copyDiagnostics }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalled());
    expect(screen.getByTestId("surface-error-boundary")).toBeInTheDocument();
  });
});
