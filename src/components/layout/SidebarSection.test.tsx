// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FlaskConical } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { SidebarPanelHeader, SidebarSection } from "./SidebarSection";

const TITLE = "Explorer";
const RESEARCH = "Research workspace";
const BETA = "Beta";
const CONFIGURE = "Configure";
const SEARCH = "Search";
const REFS = "refs.tex";
const REFS_PATH = "appendix/refs.tex";

describe("SidebarSection", () => {
  it("shows the full title or its hint in the app tooltip, never in a native title", async () => {
    const { container } = render(
      <SidebarSection id="refs" title={REFS} titleHint={REFS_PATH} open onOpenChange={vi.fn()}>
        <div />
      </SidebarSection>,
    );
    expect(container.querySelector("[title]")).toBeNull();
    const label = screen.getByText(REFS);
    expect(label.closest(".truncate")).not.toBeNull();
    fireEvent.mouseEnter(label);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(REFS_PATH);
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
    "src/features/collab/sharing/CollabPane.tsx",
    "src/components/notes/ProjectNotesPanel.tsx",
  ];
  const LAZY_BRIDGES: Readonly<Record<string, string>> = {
    "src/components/collab/CollabSlots.tsx": "src/features/collab/sharing/CollabPane.tsx",
  };

  it("shows the title in the app tooltip and puts the actions in the header", async () => {
    render(
      <SidebarPanelHeader icon={FlaskConical} title={RESEARCH} adornment={<span>{BETA}</span>}>
        <button type="button">{CONFIGURE}</button>
      </SidebarPanelHeader>,
    );

    const title = screen.getByRole("heading", { name: RESEARCH });
    expect(title).not.toHaveAttribute("title");
    fireEvent.mouseEnter(within(title).getByText(RESEARCH));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(RESEARCH);
    const configure = screen.getByRole("button", { name: CONFIGURE });
    expect(configure.parentElement).toBe(title.closest("header"));
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
    for (const token of ["text-[0.6875rem]", "font-semibold", "uppercase", "tracking-[0.08em]"]) {
      expect(panelTitle).toContain(token);
      expect(sectionButton).toHaveClass(token);
    }
    expect(sectionButton).toHaveClass("[&_svg]:shrink-0");
  });

  it.each(RAIL_PANELS)("is the header of the %s rail panel", (path) => {
    const source = readFileSync(join(process.cwd(), path), "utf8");
    expect(source).toContain("<SidebarPanelHeader");
    expect(source).not.toContain("text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70");
    const copies = [...source.matchAll(/"[^"\n]*"|`[^`]*`/g)].filter(([value]) => {
      const tokens = value.split(/[\s"'`]+/);
      return tokens.includes("uppercase") && tokens.includes("text-[0.6875rem]") && tokens.some((token) => /^text-[a-z-]*foreground/.test(token));
    });
    expect(copies).toEqual([]);
  });

  it("covers every panel registered on the rail", () => {
    const tabs = readFileSync(join(process.cwd(), "src/contributions/tabs.tsx"), "utf8");
    const modules = [...tabs.matchAll(/panel:\s*(\w+)/g)].map(([, name]) => {
      const direct = new RegExp(String.raw`import \{[^}]*\b${name}\b[^}]*\} from "@/([^"]+)"`).exec(tabs);
      const lazy = new RegExp(String.raw`const ${name} = lazy\(\(\) =>\s*import\("@/([^"]+)"\)`).exec(tabs);
      const module = `src/${(direct ?? lazy)?.[1]}.tsx`;
      return LAZY_BRIDGES[module] ?? module;
    });
    expect(modules.length).toBeGreaterThanOrEqual(8);
    expect(new Set(modules)).toEqual(new Set(RAIL_PANELS));
  });

  it("is the only source of the sidebar title style", () => {
    const sidebarTitle = (classString: string) => {
      const tokens = classString.split(/[\s"'`]+/);
      return tokens.includes("uppercase") && tokens.some((token) => token.startsWith("text-sidebar-foreground"));
    };
    expect(sidebarTitle(`"text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70"`)).toBe(true);
    expect(sidebarTitle(`"text-xs uppercase text-muted-foreground"`)).toBe(false);

    const root = join(process.cwd(), "src");
    const offenders = readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((path) => /\.(ts|tsx)$/.test(path) && !/\.(test|spec)\.(ts|tsx)$/.test(path))
      .filter((path) => !path.endsWith(join("layout", "SidebarSection.tsx")))
      .flatMap((path) => {
        const source = readFileSync(join(root, path), "utf8");
        return [...source.matchAll(/"[^"\n]*"|`[^`]*`/g)]
          .filter(([value]) => sidebarTitle(value))
          .map(([value]) => `${path}: ${value}`);
      });
    expect(offenders).toEqual([]);
  });
});
