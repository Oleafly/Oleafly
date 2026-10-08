// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
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
