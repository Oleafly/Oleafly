// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import type { CompileState } from "@/store/compile";
import { CompileLogControls } from "./CompileLogControls";

const copy = enPreview.toolbar;

type Errors = CompileState["errors"];

function issue(kind: "error" | "warning"): Errors[number] {
  return { kind, message: `${kind} text`, file: "main.tex", line: 3 } as Errors[number];
}

function renderControls(status: CompileState["status"], errors: Errors, compileTimeMs: number | null = 1234) {
  const onToggle = vi.fn();
  const view = render(
    <CompileLogControls active={false} onToggle={onToggle} status={status} errors={errors} compileTimeMs={compileTimeMs} />,
  );
  return { onToggle, view };
}

describe("CompileLogControls", () => {
  it("reports a clean build with its duration and opens the logs", () => {
    const { onToggle } = renderControls("success", []);

    const status = screen.getByTestId("compile-status");
    expect(status).toHaveAttribute("data-severity", "ok");
    expect(status).toHaveAttribute("title", copy.compiledSuccessfully);
    expect(status).toHaveTextContent("1.2");
    fireEvent.click(screen.getByRole("button", { name: copy.showLogs }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("reports warnings with their count", () => {
    renderControls("success", [issue("warning"), issue("warning")]);

    const status = screen.getByTestId("compile-status");
    expect(status).toHaveAttribute("data-severity", "warning");
    expect(status).toHaveAttribute("title", copy.compiledWithWarnings);
    expect(screen.getByRole("button", { name: copy.showLogs })).toHaveTextContent("2");
  });

  it("reports errors as a failure even with a duration", () => {
    renderControls("success", [issue("warning"), issue("error")]);

    const status = screen.getByTestId("compile-status");
    expect(status).toHaveAttribute("data-severity", "error");
    expect(status).toHaveAttribute("title", copy.compiledWithErrors);
    expect(status).toHaveTextContent(copy.failed);
  });

  it.each([
    ["clean", [], "ok", copy.compiledSuccessfully],
    ["warning", [issue("warning")], "warning", copy.compiledWithWarnings],
  ] as const)("reports a %s build with no recorded time as compiled, not failed", (_, errors, severity, label) => {
    renderControls("success", [...errors], null);

    const status = screen.getByTestId("compile-status");
    expect(status).toHaveAttribute("data-severity", severity);
    expect(status).toHaveTextContent(label);
    expect(status).not.toHaveTextContent(copy.failed);
  });

  it("treats an unavailable engine as an error", () => {
    renderControls("unavailable", [], null);
    expect(screen.getByTestId("compile-status")).toHaveAttribute("data-severity", "error");
  });

  it("says nothing about the result while compiling or before the first build", () => {
    const { view } = renderControls("compiling", []);
    expect(screen.queryByTestId("compile-status")).toBeNull();
    view.unmount();

    renderControls("idle", []);
    expect(screen.queryByTestId("compile-status")).toBeNull();
  });
});
