import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  renderTypstSnippet: vi.fn(),
  setTypstMathHost: vi.fn(),
  state: {
    projectId: "p1" as string | null,
    engine: { typst_resolved: { version: "0.13.1", source: "downloaded" } as { version: string; source: string } | null },
  },
}));

vi.mock("@/lib/tauri", () => ({ renderTypstSnippet: mocks.renderTypstSnippet }));
vi.mock("@oleafly/editor/math-render", () => ({ setTypstMathHost: mocks.setTypstMathHost }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.state } }));
vi.mock("@/lib/app-error", () => ({ describeError: (error: unknown) => `described: ${String(error)}` }));

import { installTypstMathHost } from "./typst-math-host";

function installedHost() {
  installTypstMathHost();
  return mocks.setTypstMathHost.mock.calls.at(-1)?.[0] as {
    render(source: string): Promise<unknown>;
    typstVersion(): string | null;
  };
}

beforeEach(() => {
  mocks.state.projectId = "p1";
  mocks.state.engine.typst_resolved = { version: "0.13.1", source: "downloaded" };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("installTypstMathHost", () => {
  it("renders SVG with the open project's pinned Typst", async () => {
    mocks.renderTypstSnippet.mockResolvedValue({ status: "rendered", image: { format: "svg", svg: "<svg/>" }, diagnostics: [] });
    const host = installedHost();
    await expect(host.render("$x$")).resolves.toEqual({ status: "rendered", svg: "<svg/>" });
    expect(mocks.renderTypstSnippet).toHaveBeenCalledWith({ source: "$x$", format: "svg", projectId: "p1" });
    expect(host.typstVersion()).toBe("0.13.1");
  });

  it("uses the bundled Typst without a project", async () => {
    mocks.state.projectId = null;
    mocks.state.engine.typst_resolved = null;
    mocks.renderTypstSnippet.mockResolvedValue({ status: "rendered", image: { format: "svg", svg: "<svg/>" }, diagnostics: [] });
    const host = installedHost();
    await host.render("$x$");
    expect(mocks.renderTypstSnippet).toHaveBeenCalledWith({ source: "$x$", format: "svg" });
    expect(host.typstVersion()).toBeNull();
  });

  it("passes on the first Typst error", async () => {
    mocks.renderTypstSnippet.mockResolvedValue({
      status: "failed",
      diagnostics: [
        { severity: "warning", message: "unused", line: 1, column: 1 },
        { severity: "error", message: "unknown variable: foo", line: 2, column: 2 },
      ],
    });
    await expect(installedHost().render("$foo$")).resolves.toEqual({ status: "failed", message: "unknown variable: foo" });
  });

  it("describes a failed bridge call", async () => {
    mocks.renderTypstSnippet.mockRejectedValue("offline");
    await expect(installedHost().render("$x$")).resolves.toEqual({ status: "failed", message: "described: offline" });
  });
});
