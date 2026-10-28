// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LibraryStorageSummary } from "@/lib/tauri";
import { StorageBreakdown } from "./StorageBreakdown";

const MB = 1024 * 1024;

const summary: LibraryStorageSummary = {
  total_bytes: 1000 * MB,
  projects_bytes: 300 * MB,
  source_bytes: 70 * MB,
  image_bytes: 40 * MB,
  pdf_bytes: 60 * MB,
  git_bytes: 100 * MB,
  build_bytes: 30 * MB,
  recycle_bin_bytes: 10 * MB,
  app_data_bytes: 690 * MB,
  project_count: 4,
  recycled_project_count: 1,
  file_count: 100,
  directory_count: 10,
  image_count: 5,
  pdf_count: 6,
  unreadable_entries: 0,
  linked_folders_bytes: 0,
  linked_folder_count: 0,
  document_bytes: 50 * MB,
  media_bytes: 0,
  data_bytes: 15 * MB,
  other_project_bytes: 5 * MB,
  tex_distribution_bytes: 400 * MB,
  agents_bytes: 200 * MB,
  research_tasks_bytes: 0,
  tools_bytes: 40 * MB,
  checkpoints_bytes: 30 * MB,
  compile_cache_bytes: 0,
};

function segments(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>("[aria-hidden] > [data-part]")];
}

describe("StorageBreakdown", () => {
  it("draws the coloured parts in a fixed order and folds the rest into one Other segment", () => {
    const { container } = render(<StorageBreakdown summary={summary} />);

    expect(segments(container).map((segment) => segment.dataset.part)).toEqual([
      "documents",
      "images",
      "pdfs",
      "git",
      "build",
      "texDistribution",
      "agents",
      "other",
    ]);
    const grow = (part: string) =>
      Number(segments(container).find((segment) => segment.dataset.part === part)?.style.flexGrow);
    expect(grow("texDistribution")).toBeCloseTo(0.4);
    // Data files, other files, tools, checkpoints, settings and the Recycle Bin.
    expect(grow("other")).toBeCloseTo((15 + 5 + 40 + 30 + 20 + 10) / 1000);
  });

  it("names every part with its size and share, and leaves out empty ones", () => {
    render(<StorageBreakdown summary={summary} />);

    const appData = screen.getByRole("region", { name: /App data/ });
    const rows = within(appData).getAllByRole("listitem");
    expect(rows.map((row) => row.dataset.part)).toEqual([
      "texDistribution",
      "agents",
      "tools",
      "checkpoints",
      "otherAppData",
    ]);
    expect(rows[0]).toHaveTextContent("TeX distribution");
    expect(rows[0]).toHaveTextContent("400 MB");
    expect(rows[0]).toHaveTextContent("40%");
    expect(rows[4]).toHaveTextContent("20 MB");
    expect(screen.queryByText("Audio and video")).not.toBeInTheDocument();
    expect(screen.queryByText("Research tasks")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Elsewhere/ })).toHaveTextContent("Recycle Bin");
  });

  it("draws nothing for an empty data folder", () => {
    const { container } = render(<StorageBreakdown summary={{ ...summary, total_bytes: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
