// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function renderTabs(size?: "default" | "sm") {
  return render(
    <Tabs defaultValue="one">
      <TabsList size={size} aria-label={"Example views"}>
        <TabsTrigger value="one">{"One"}</TabsTrigger>
        <TabsTrigger value="two">{"Two"}</TabsTrigger>
      </TabsList>
      <TabsContent value="one">{"First panel"}</TabsContent>
      <TabsContent value="two">{"Second panel"}</TabsContent>
    </Tabs>,
  );
}

describe("Tabs", () => {
  it("keeps the default size when none is asked for", () => {
    renderTabs();
    const list = screen.getByRole("tablist", { name: "Example views" });
    expect(list.className).toContain("h-9");
    expect(list.className).toContain("p-1");
    const trigger = screen.getByRole("tab", { name: "One" });
    expect(trigger.className).toContain("text-sm");
    expect(trigger.className).toContain("px-3");
  });

  it("shrinks the list and its triggers under the sm size", () => {
    renderTabs("sm");
    const list = screen.getByRole("tablist", { name: "Example views" });
    expect(list.className).toContain("h-8");
    expect(list.className).toContain("p-0.5");
    expect(list.className).not.toContain("h-9");
    const trigger = screen.getByRole("tab", { name: "One" });
    expect(trigger.className).toContain("text-xs");
    expect(trigger.className).toContain("px-2");
    expect(trigger.className).toContain("[&_svg]:size-3.5");
    expect(trigger.className).not.toContain("text-sm");
  });

  it("keeps the shared radius, focus tint and active colours at every size", () => {
    renderTabs("sm");
    const list = screen.getByRole("tablist", { name: "Example views" });
    expect(list.className).toContain("rounded-lg");
    expect(list.className).toContain("bg-muted");
    const trigger = screen.getByRole("tab", { name: "One" });
    expect(trigger.className).toContain("rounded-md");
    expect(trigger.className).toContain("focus-visible:bg-accent/60");
    expect(trigger.className).not.toMatch(/(^|\s)\S*ring-/);
    expect(trigger.className).toContain("data-[state=active]:bg-background");
  });

  it("lets a trigger override the size it inherits from the list", () => {
    render(
      <Tabs defaultValue="one">
        <TabsList size="sm" aria-label={"Mixed views"}>
          <TabsTrigger value="one" size="default">
            {"One"}
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(screen.getByRole("tab", { name: "One" }).className).toContain("text-sm");
  });

  it("switches panels on click", async () => {
    const user = userEvent.setup();
    renderTabs("sm");
    expect(screen.getByText("First panel")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Two" }));
    expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Second panel")).toBeInTheDocument();
  });

  it("keeps a scrollable strip to its own width and shows no bar", () => {
    render(
      <Tabs defaultValue="one">
        <TabsList scrollable aria-label={"Scrolling views"}>
          <TabsTrigger value="one">{"One"}</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const list = screen.getByRole("tablist", { name: "Scrolling views" });
    expect(list).toHaveClass("flex", "flex-nowrap", "w-fit", "max-w-full", "overflow-x-auto", "no-scrollbar", "[&>*]:shrink-0");
    expect(list).not.toHaveClass("inline-flex");
    expect(list).not.toHaveClass("w-full");
  });

  it("shares the width of a fill strip between its tabs and lets labels shrink", () => {
    render(
      <Tabs defaultValue="one">
        <TabsList fill aria-label={"Panel views"}>
          <TabsTrigger value="one">{"One"}</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const list = screen.getByRole("tablist", { name: "Panel views" });
    expect(list).toHaveClass("flex", "h-auto", "[&>*]:min-w-0", "[&>*]:flex-1");
    expect(list).not.toHaveClass("inline-flex");
    expect(list).not.toHaveClass("h-9");
  });

  it("turns a vertical wheel into a horizontal scroll of the strip alone", () => {
    render(
      <Tabs defaultValue="one">
        <TabsList scrollable aria-label={"Scrolling views"}>
          <TabsTrigger value="one">{"One"}</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const list = screen.getByRole("tablist", { name: "Scrolling views" });
    Object.defineProperties(list, {
      clientWidth: { configurable: true, value: 320 },
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollWidth: { configurable: true, value: 640 },
    });
    const wheel = new WheelEvent("wheel", { deltaY: 80, bubbles: true, cancelable: true });
    fireEvent(list, wheel);
    expect(list.scrollLeft).toBe(80);
    expect(wheel.defaultPrevented).toBe(true);
  });

  it("leaves the wheel alone when the strip fits or the list is not scrollable", () => {
    render(
      <Tabs defaultValue="one">
        <TabsList aria-label={"Plain views"}>
          <TabsTrigger value="one">{"One"}</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const list = screen.getByRole("tablist", { name: "Plain views" });
    Object.defineProperties(list, {
      clientWidth: { configurable: true, value: 320 },
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollWidth: { configurable: true, value: 640 },
    });
    const wheel = new WheelEvent("wheel", { deltaY: 80, bubbles: true, cancelable: true });
    fireEvent(list, wheel);
    expect(list.scrollLeft).toBe(0);
    expect(wheel.defaultPrevented).toBe(false);
  });

  it("scrolls the selected tab into view", async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="one">
        <TabsList scrollable aria-label={"Scrolling views"}>
          <TabsTrigger value="one">{"One"}</TabsTrigger>
          <TabsTrigger value="two">{"Two"}</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const two = screen.getByRole("tab", { name: "Two" });
    const scrollIntoView = vi.fn();
    two.scrollIntoView = scrollIntoView;
    await user.click(two);
    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" }),
    );
  });
});
