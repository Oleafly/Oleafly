// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "./breadcrumb";

const TRAIL = "Breadcrumb";
const PATH = "Path";

function trail(onHome = vi.fn()) {
  render(
    <Breadcrumb aria-label={TRAIL}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <button type="button" onClick={onHome}>
              {"Home"}
            </button>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="#components">{"Components"}</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{"Breadcrumb"}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>,
  );
  return screen.getByRole("navigation", { name: TRAIL });
}

describe("Breadcrumb", () => {
  it("lists each place in an ordered list inside a named navigation landmark", () => {
    const nav = trail();
    const list = within(nav).getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Home", "Components", "Breadcrumb"]);
  });

  it("draws a chevron between places and hides it from screen readers", () => {
    const nav = trail();
    const separators = nav.querySelectorAll('[data-slot="breadcrumb-separator"]');
    expect(separators).toHaveLength(2);
    for (const separator of separators) {
      expect(separator.tagName).toBe("LI");
      expect(separator).toHaveAttribute("aria-hidden", "true");
      expect(separator).toHaveAttribute("role", "presentation");
      expect(separator.querySelector("svg")).toHaveClass("lucide-chevron-right");
    }
  });

  it("marks the last place as the current page in the foreground colour, cut short with an ellipsis", () => {
    trail();
    const page = screen.getByText("Breadcrumb", { selector: "span" });
    expect(page).toHaveAttribute("aria-current", "page");
    expect(page).toHaveClass("truncate", "text-foreground");
    expect(screen.getByRole("list")).toHaveClass("text-muted-foreground");
  });

  it("renders a link as an anchor and styles a button handed to it", () => {
    const onHome = vi.fn();
    trail(onHome);
    const link = screen.getByRole("link", { name: "Components" });
    expect(link).toHaveAttribute("href", "#components");
    const button = screen.getByRole("button", { name: "Home" });
    expect(button).toHaveAttribute("data-slot", "breadcrumb-link");
    for (const crumb of [link, button]) {
      expect(crumb).toHaveClass("hover:bg-accent", "focus-visible:bg-accent", "data-[state=open]:bg-accent");
      expect(crumb.className).not.toMatch(/(?:^|\s)(?:\S+:)?(?:ring|outline)(?:-|\s|$)/);
    }
    fireEvent.click(button);
    expect(onHome).toHaveBeenCalledOnce();
  });

  it("lets a caller resize the list, the separator and a crumb", () => {
    render(
      <Breadcrumb aria-label={PATH}>
        <BreadcrumbList className="text-xs">
          <BreadcrumbItem>{"main.tex"}</BreadcrumbItem>
          <BreadcrumbSeparator className="[&>svg]:size-3" />
          <BreadcrumbItem>
            <BreadcrumbLink className="p-1" href="#methods">
              {"Methods"}
            </BreadcrumbLink>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    );
    expect(screen.getByRole("list")).toHaveClass("text-xs");
    expect(screen.getByRole("list")).not.toHaveClass("text-sm");
    const separator = document.querySelector('[data-slot="breadcrumb-separator"]');
    expect(separator).toHaveClass("[&>svg]:size-3");
    expect(separator).not.toHaveClass("[&>svg]:size-3.5");
    const link = screen.getByRole("link", { name: "Methods" });
    expect(link).toHaveClass("p-1");
    expect(link).not.toHaveClass("px-1");
  });
});
