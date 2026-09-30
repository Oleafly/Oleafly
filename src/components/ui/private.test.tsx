// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));

import { Private, PrivatePath, PrivateText, usePrivateGroup } from "@/components/ui/private";
import { resetDisplayHomes, setDisplayHomes } from "@/lib/display-path";
import { usePersonalDetailsStore } from "@/store/personal-details";

const SIZE = "1.2 GB";
const ACCOUNT = "ada";
const LOGIN = "octocat";

function hide(hidden: boolean) {
  act(() => usePersonalDetailsStore.getState().setHidden(hidden));
}

beforeEach(() => setDisplayHomes(["/Users/ada"]));

afterEach(() => {
  cleanup();
  hide(false);
  resetDisplayHomes();
});

describe("Private", () => {
  it("marks its value and only joins the tab order while details are hidden", () => {
    render(<Private>{SIZE}</Private>);
    const value = screen.getByText("1.2 GB");
    expect(value).toHaveAttribute("data-private");
    expect(value).not.toHaveAttribute("tabindex");

    hide(true);
    expect(screen.getByText("1.2 GB")).toHaveAttribute("tabindex", "0");
  });

  it("stays out of the tab order inside a control", () => {
    hide(true);
    render(
      <button type="button">
        <Private focusable={false}>{ACCOUNT}</Private>
      </button>,
    );
    expect(screen.getByText("ada")).not.toHaveAttribute("tabindex");
  });

  it("keeps the real text in the page for screen readers and copy", () => {
    hide(true);
    render(<Private>{LOGIN}</Private>);
    expect(screen.getByText("octocat")).not.toHaveAttribute("aria-hidden");
    expect(document.body.textContent).toContain("octocat");
  });
});

describe("PrivatePath", () => {
  it("shows the path through the shared display helper and marks it", () => {
    render(<PrivatePath path="/Users/ada/Library/TinyTeX/bin" />);
    const path = screen.getByText("~/Library/TinyTeX/bin");
    expect(path).toHaveAttribute("data-private");
  });
});

describe("PrivateText", () => {
  it("renders plain text while details are shown", () => {
    const { container } = render(<PrivateText text="Saved ~/paper/main.tex" />);
    expect(container.innerHTML).toBe("Saved ~/paper/main.tex");
  });

  it("marks only the personal runs while details are hidden", () => {
    hide(true);
    const { container } = render(<PrivateText text="Saved ~/paper/main.tex for ada" />);
    const marked = [...container.querySelectorAll("[data-private]")].map((node) => node.textContent);
    expect(marked).toEqual(["~/paper/main.tex", "ada"]);
    expect(container.textContent).toBe("Saved ~/paper/main.tex for ada");
    const group = container.querySelector("[data-private-group]");
    expect(group).toHaveAttribute("tabindex", "0");
  });

  it("marks the values it is given, such as a size inside a sentence", () => {
    hide(true);
    const { container } = render(<PrivateText text="Uses 3.4 GB in total" values={["3.4 GB"]} />);
    expect(container.querySelector("[data-private]")?.textContent).toBe("3.4 GB");
  });
});

describe("usePrivateGroup", () => {
  function Group() {
    return (
      <pre data-testid="group" {...usePrivateGroup()}>
        {SIZE}
      </pre>
    );
  }

  it("makes a block of free text one focus stop while details are hidden", () => {
    render(<Group />);
    expect(screen.getByTestId("group")).not.toHaveAttribute("tabindex");
    hide(true);
    expect(screen.getByTestId("group")).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("group")).toHaveAttribute("data-private-group");
  });

  it("adds no focus stop for a block whose text holds nothing personal", () => {
    function Log({ text }: Readonly<{ text: string }>) {
      return (
        <pre data-testid="log" {...usePrivateGroup(text)}>
          {text}
        </pre>
      );
    }
    hide(true);
    const { rerender } = render(<Log text="Output written on main.pdf." />);
    expect(screen.getByTestId("log")).not.toHaveAttribute("tabindex");
    expect(screen.getByTestId("log")).not.toHaveAttribute("data-private-group");

    rerender(<Log text="(/Users/ada/paper/main.tex" />);
    expect(screen.getByTestId("log")).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("log")).toHaveAttribute("data-private-group");
  });
});

describe("blur styles", () => {
  const css = readFileSync(resolve(__dirname, "private.css"), "utf8");

  it("blurs by about 4px and never uses an outline or ring", () => {
    expect(css).toMatch(/filter:\s*blur\(4px\)/);
    expect(css).not.toMatch(/outline|ring|box-shadow/);
  });

  it("shows a value on hover and on keyboard focus, with a background tint", () => {
    expect(css).toMatch(/\[data-private\]:hover/);
    expect(css).toMatch(/\[data-private\]:focus-visible/);
    expect(css).toMatch(/background-image:\s*linear-gradient\(/);
  });

  it("draws the focus tint over an element's own background instead of replacing it", () => {
    // These rules sit outside Tailwind's layers, so a background colour here
    // would beat `bg-primary` and leave a user bubble's white text on a pale tint.
    expect(css).not.toMatch(/background-color:|background:/);
  });

  it("leaves a focused block's own corners alone", () => {
    const groupRules = [...css.matchAll(/([^{}]*\[data-private-group\][^{}]*)\{([^}]*)\}/g)];
    expect(groupRules.length).toBeGreaterThan(0);
    for (const [, , body] of groupRules) expect(body).not.toMatch(/border-radius/);
  });

  it("turns the transition off for reduced motion", () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*transition:\s*none/);
  });
});
