// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  appendAppLog: vi.fn(async () => {}),
}));

vi.mock("@/lib/crash-report", () => ({
  reportCrashToGithub: vi.fn(async () => {}),
}));

import { ErrorBoundary } from "./ErrorBoundary";

function Risky({ crash, label }: { crash: boolean; label: string }) {
  if (crash) throw new Error("preview failed");
  return <div>{label}</div>;
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

it("retries a scoped subtree when its render payload changes", () => {
  const view = render(
    <ErrorBoundary resetKey="first" fallback={<div>Preview unavailable</div>}>
      <Risky crash label="first PDF" />
    </ErrorBoundary>,
  );
  expect(screen.getByText("Preview unavailable")).toBeInTheDocument();

  view.rerender(
    <ErrorBoundary resetKey="second" fallback={<div>Preview unavailable</div>}>
      <Risky crash={false} label="second PDF" />
    </ErrorBoundary>,
  );

  expect(screen.getByText("second PDF")).toBeInTheDocument();
  expect(screen.queryByText("Preview unavailable")).not.toBeInTheDocument();
});
