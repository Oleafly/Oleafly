// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectInfo } from "@/lib/tauri";
import {
  ProjectGrid,
  ProjectList,
  type ProjectCardActions,
  type ProjectCardData,
} from "./ProjectCollection";

function project(index: number): ProjectInfo {
  return {
    id: `project-${index}`,
    name: `Project ${index}`,
    main_doc: "main.tex",
    engine: "tectonic",
    kind: "document",
    created_at: 1,
    updated_at: 1,
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
  };
}

const noop = () => {};
const actions: ProjectCardActions = {
  open: noop,
  openById: noop,
  toggleFavorite: noop,
  showPreview: noop,
  requestThumbnail: noop,
  releaseThumbnail: noop,
  reveal: noop,
  copyIntoLibrary: noop,
  setColor: noop,
  remove: noop,
  details: noop,
  history: noop,
  fork: noop,
  saveAsTemplate: noop,
  trash: noop,
};

const data: ProjectCardData = {
  colorOf: () => "#1982c4",
  folderStateOf: () => null,
  updatedAtOf: (item) => item.updated_at,
  favorites: new Set(),
  thumbs: {},
  forkNames: new Map(),
  hoverPreview: false,
  actions,
};

function Scroller({ layout, count }: Readonly<{ layout: "grid" | "list"; count: number }>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const projects = Array.from({ length: count }, (_, index) => project(index));
  return (
    <div ref={scrollRef} style={{ overflowY: "auto" }}>
      {layout === "grid" ? (
        <ProjectGrid projects={projects} data={data} scrollRef={scrollRef} />
      ) : (
        <ProjectList projects={projects} data={data} scrollRef={scrollRef} />
      )}
    </div>
  );
}

function FilteredGrid({ projects }: Readonly<{ projects: ProjectInfo[] }>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollRef} data-testid="scroller" style={{ overflowY: "auto" }}>
      <ProjectGrid projects={projects} data={data} scrollRef={scrollRef} />
    </div>
  );
}

function laidOutLibrary() {
  let scrollTop = 0;
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
    return this.getAttribute("data-testid") === "scroller" ? 600 : 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
    return this.getAttribute("data-testid") === "scroller" ? scrollTop : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const grid = this.getAttribute("data-testid") === "project-grid";
    const card = this.hasAttribute("data-row-window-item");
    const height = card ? (this.className.includes("pb-14") ? 256 : 200) : grid ? 0 : 600;
    const top = grid ? -scrollTop : 0;
    return { top, bottom: top + height, left: 0, right: 100, width: 100, height, x: 0, y: top, toJSON: () => ({}) };
  });
  return {
    scrollTo(scroller: HTMLElement, top: number) {
      scrollTop = top;
      act(() => {
        scroller.dispatchEvent(new Event("scroll"));
        for (const frame of frames.splice(0)) frame(0);
      });
    },
  };
}

function openButtons() {
  return screen.queryAllByRole("button", { name: /^Open Project \d+$/ });
}

function stubColumns(minWidthRem: number | null) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const wanted = /min-width: (\d+)rem/.exec(query);
    const matches = minWidthRem !== null && wanted !== null && Number(wanted[1]) <= minWidthRem;
    return {
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("project collection windowing", () => {
  it("mounts only the first rows of a large grid until it can measure them", () => {
    render(<Scroller layout="grid" count={300} />);
    expect(openButtons()).toHaveLength(8);
  });

  it("fills each grid row with as many cards as the window width allows", () => {
    stubColumns(80);
    render(<Scroller layout="grid" count={300} />);
    expect(openButtons()).toHaveLength(16);
  });

  it("asks the window for its width breakpoints once, not on every render", () => {
    stubColumns(80);
    const query = vi.spyOn(window, "matchMedia");
    const view = render(<Scroller layout="grid" count={40} />);
    const afterMount = query.mock.calls.length;
    for (let count = 41; count < 46; count += 1) view.rerender(<Scroller layout="grid" count={count} />);
    expect(query.mock.calls).toHaveLength(afterMount);
  });

  it("mounts only the first page of a large list until it can measure it", () => {
    render(<Scroller layout="list" count={300} />);
    expect(openButtons()).toHaveLength(16);
  });

  it("renders every project of a small library", () => {
    render(<Scroller layout="grid" count={5} />);
    expect(openButtons()).toHaveLength(5);
  });

  it("leaves the row gap off the last row so the grid ends where it did before windowing", () => {
    render(<Scroller layout="grid" count={5} />);
    const cells = [...screen.getByTestId("project-grid").children] as HTMLElement[];
    expect(cells.map((cell) => cell.classList.contains("pb-14"))).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(screen.getByTestId("project-grid")).not.toHaveClass("gap-y-14");
  });
});

describe("project collection windowing under a filter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the full row height after a filter leaves one card in the shorter last row", () => {
    stubColumns(null);
    const layout = laidOutLibrary();
    const all = Array.from({ length: 60 }, (_, index) => project(index));
    const view = render(<FilteredGrid projects={all} />);

    view.rerender(<FilteredGrid projects={[all[0]]} />);
    view.rerender(<FilteredGrid projects={all.slice(1)} />);
    layout.scrollTo(view.getByTestId("scroller"), 4_500);

    expect(screen.getByRole("button", { name: "Open Project 35" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Project 40" })).toBeInTheDocument();
  });
});

describe("project kind label", () => {
  it("names Overleaf for projects imported from it", () => {
    const projects = [project(1), { ...project(2), imported_from: "overleaf" }];
    function Grid() {
      const scrollRef = useRef<HTMLDivElement>(null);
      return (
        <div ref={scrollRef}>
          <ProjectGrid projects={projects} data={data} scrollRef={scrollRef} />
        </div>
      );
    }
    render(<Grid />);
    expect(screen.getByText("Overleaf")).toBeInTheDocument();
    expect(screen.getAllByText("document")).toHaveLength(1);
  });
});
