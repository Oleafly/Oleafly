// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { FlaskConical } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { SidebarPanelHeader, SidebarSection } from "./SidebarSection";

const TITLE = "Explorer";
const ACTION_LABEL = "Expand all";
const CONTENT = "Section content";
const RESEARCH = "Research workspace";
const BETA = "Beta";
const CONFIGURE = "Configure";
const SEARCH = "Search";

describe("SidebarSection", () => {
  it("reveals actions from hover or focus anywhere in the section", () => {
    render(
      <SidebarSection
        id="test-section"
        title={TITLE}
        open
        onOpenChange={vi.fn()}
        actions={<button type="button">{ACTION_LABEL}</button>}
      >
        <div>{CONTENT}</div>
      </SidebarSection>,
    );

    const section = screen.getByTestId("test-section");
    const actions = screen.getByTestId("test-section-actions");
    expect(section).toHaveClass("group/section");
    expect(section.firstElementChild).not.toHaveClass("group/section");
    expect(actions).toHaveClass(
      "hidden",
      "group-hover/section:flex",
      "group-focus-within/section:flex",
      "has-[[data-state=open]]:flex",
    );
    expect(screen.getByRole("button", { name: ACTION_LABEL })).toBeInTheDocument();
  });

  it("keeps one clear divider at the end of collapsed and expanded sections", () => {
    const props = {
      id: "test-section",
      title: "Explorer",
      onOpenChange: vi.fn(),
      children: <div />,
    };
    const { rerender } = render(<SidebarSection {...props} open={false} />);

    const section = screen.getByTestId("test-section");
    const header = section.firstElementChild;
    expect(section).toHaveClass("border-b", "border-sidebar-border");
    expect(header).not.toHaveClass("border-b");

    rerender(<SidebarSection {...props} open />);
    expect(section.firstElementChild).toHaveClass(
      "border-b",
      "border-sidebar-border/65",
    );
  });
});

describe("SidebarPanelHeader", () => {
  const RAIL_PANELS = [
    "src/components/layout/Sidebar.tsx",
    "src/components/layout/SourceControl.tsx",
    "src/components/preflight/PreflightPanel.tsx",
    "src/components/layout/ReferencesPanel.tsx",
    "src/components/research/ResearchWorkspacePanel.tsx",
    "src/components/layout/McpActivityPanel.tsx",
  ];

  it("keeps the icon at full size and cuts a long title with an ellipsis", () => {
    const { container } = render(
      <SidebarPanelHeader icon={FlaskConical} title={RESEARCH} adornment={<span>{BETA}</span>}>
        <button type="button">{CONFIGURE}</button>
      </SidebarPanelHeader>,
    );

    expect(container.querySelector("svg")).toHaveClass("size-3.5", "shrink-0");
    const title = screen.getByRole("heading", { name: RESEARCH });
    expect(title).toHaveClass("min-w-0", "truncate", "text-[11px]", "uppercase");
    expect(title).toHaveAttribute("title", RESEARCH);
    const configure = screen.getByRole("button", { name: CONFIGURE });
    expect(configure.parentElement).toBe(title.parentElement);
    expect(configure.previousElementSibling).toHaveClass("flex-1");
  });

  it("uses the same title style as the Explorer sections", () => {
    render(
      <>
        <SidebarPanelHeader icon={FlaskConical} title={SEARCH} />
        <SidebarSection id="files" title={TITLE} open onOpenChange={vi.fn()}>
          <div />
        </SidebarSection>
      </>,
    );

    const panelTitle = screen.getByRole("heading", { name: SEARCH }).className;
    const sectionButton = screen.getByRole("button", { name: TITLE });
    for (const token of ["text-[11px]", "font-semibold", "uppercase", "tracking-[0.08em]"]) {
      expect(panelTitle).toContain(token);
      expect(sectionButton).toHaveClass(token);
    }
    expect(sectionButton).toHaveClass("[&_svg]:shrink-0");
  });

  it.each(RAIL_PANELS)("is the header of the %s rail panel", (path) => {
    const source = readFileSync(join(process.cwd(), path), "utf8");
    expect(source).toContain("<SidebarPanelHeader");
    expect(source).not.toContain("text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70");
  });
});
