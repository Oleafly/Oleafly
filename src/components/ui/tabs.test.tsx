// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function renderTabs(size?: "default" | "sm") {
  return render(
    <Tabs defaultValue="one">
      <TabsList size={size} aria-label="Example views">
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
      </TabsList>
      <TabsContent value="one">First panel</TabsContent>
      <TabsContent value="two">Second panel</TabsContent>
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

  it("keeps the shared radius, focus ring and active colours at every size", () => {
    renderTabs("sm");
    const list = screen.getByRole("tablist", { name: "Example views" });
    expect(list.className).toContain("rounded-lg");
    expect(list.className).toContain("bg-muted");
    const trigger = screen.getByRole("tab", { name: "One" });
    expect(trigger.className).toContain("rounded-md");
    expect(trigger.className).toContain("focus-visible:ring-ring");
    expect(trigger.className).toContain("data-[state=active]:bg-background");
  });

  it("lets a trigger override the size it inherits from the list", () => {
    render(
      <Tabs defaultValue="one">
        <TabsList size="sm" aria-label="Mixed views">
          <TabsTrigger value="one" size="default">
            One
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
});
