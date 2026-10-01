// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));

import { SettingsPath, SettingsPathText } from "@/components/settings/SettingsPath";
import { resetDisplayHomes, setDisplayHomes } from "@/lib/display-path";

beforeEach(() => setDisplayHomes(["/Users/ada"]));

afterEach(() => {
  cleanup();
  resetDisplayHomes();
});

describe("SettingsPath", () => {
  it("shows the path with ~ and blurs it, always, with a focus stop to reveal it", () => {
    render(<SettingsPath path="/Users/ada/Library/TinyTeX/bin" />);
    const path = screen.getByText("~/Library/TinyTeX/bin");
    expect(path).toHaveAttribute("data-settings-path");
    expect(path).toHaveAttribute("tabindex", "0");
  });

  it("stays out of the tab order inside a control, whose focus reveals it", () => {
    render(
      <button type="button">
        <SettingsPath focusable={false} path="/usr/bin/latexmk" />
      </button>,
    );
    expect(screen.getByText("/usr/bin/latexmk")).not.toHaveAttribute("tabindex");
  });

  it("keeps the text in the page for screen readers", () => {
    render(<SettingsPath path="/opt/tex/bin" />);
    expect(screen.getByText("/opt/tex/bin")).not.toHaveAttribute("aria-hidden");
  });
});

describe("SettingsPathText", () => {
  it("renders a message with no path as plain text", () => {
    const { container } = render(<SettingsPathText text="Claude Code 2.1 is ready" />);
    expect(container.innerHTML).toBe("Claude Code 2.1 is ready");
  });

  it("blurs only the paths in a message", () => {
    const { container } = render(
      <SettingsPathText text="Found ada's CLI at ~/.local/bin/claude, 12 MB, $0.40." />,
    );
    const blurred = [...container.querySelectorAll("[data-settings-path]")].map((node) => node.textContent);
    expect(blurred).toEqual(["~/.local/bin/claude"]);
    expect(container.textContent).toBe("Found ada's CLI at ~/.local/bin/claude, 12 MB, $0.40.");
  });
});

describe("Settings path styles", () => {
  const css = readFileSync(resolve(__dirname, "settings-path.css"), "utf8");

  it("blurs by about 4px and never uses an outline or ring", () => {
    expect(css).toMatch(/filter:\s*blur\(4px\)/);
    expect(css).not.toMatch(/outline|ring|box-shadow/);
  });

  it("shows a path on hover and on keyboard focus, with a background tint", () => {
    expect(css).toMatch(/\[data-settings-path\]:hover/);
    expect(css).toMatch(/\[data-settings-path\]:focus-visible/);
    expect(css).toMatch(/background-image:\s*linear-gradient\(/);
    expect(css).not.toMatch(/background-color:|background:/);
  });

  it("turns the transition off for reduced motion", () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*transition:\s*none/);
  });
});
