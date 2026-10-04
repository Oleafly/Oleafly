// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";
import { PackagesDialog, showPackagesDialog, type PackageList, type PackagesProvider } from "./PackagesDialog";

interface Item {
  name: string;
  topic: string;
}

const labels = {
  title: () => "Sample packages",
  close: () => "Close sample packages",
  searchLabel: () => "Search samples",
  searchPlaceholder: () => "Search",
  categories: () => "Topics",
  allCategories: () => "All topics",
  loading: () => "Loading samples",
  empty: () => "Nothing matches",
  results: (count: number) => `${count} results`,
  resultsCapped: (shown: number, count: number) => `${shown} of ${count}`,
  stale: (date: string) => `Stale since ${date}`,
  staleOffline: (date: string) => `Offline since ${date}`,
};

function items(count: number): Item[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `pkg-${index}`,
    topic: index % 2 === 0 ? "math" : "graphics",
  }));
}

function provider(
  load: PackagesProvider<Item, string>["load"],
  extra: Partial<PackagesProvider<Item, string>> = {},
): PackagesProvider<Item, string> {
  return {
    id: "sample",
    labels,
    load,
    key: (item) => item.name,
    search: (packages, query, category) =>
      packages.filter(
        (item) => item.name.includes(query) && (category === null || item.topic === category),
      ),
    categories: (packages) => [...new Set(packages.map((item) => item.topic))],
    useRowContext: () => "context",
    renderRow: (item, context) => <p data-testid="row">{`${item.name}:${context}`}</p>,
    ...extra,
  };
}

const list = (packages: Item[], overrides: Partial<PackageList<Item>> = {}): PackageList<Item> => ({
  packages,
  fetchedAt: Date.UTC(2026, 0, 2),
  stale: false,
  ...overrides,
});

beforeEach(() => {
  useSettingsStore.setState({ offline: false });
});

describe("PackagesDialog", () => {
  it("loads, filters by topic and search, and caps long result lists", async () => {
    const load = vi.fn(async () => list(items(150)));
    render(<PackagesDialog provider={provider(load)} open onClose={vi.fn()} />);

    expect(screen.getByText("Loading samples")).toBeInTheDocument();
    expect(await screen.findByText("100 of 150")).toBeInTheDocument();
    expect(screen.getAllByTestId("row")).toHaveLength(100);
    expect(load).toHaveBeenCalledWith({ offline: false, refresh: false });

    fireEvent.click(screen.getByRole("button", { name: "graphics" }));
    expect(screen.getByRole("button", { name: "graphics" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("75 results")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "graphics" }));
    expect(screen.getByRole("button", { name: "All topics" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "math" }));
    fireEvent.click(screen.getByRole("button", { name: "All topics" }));
    expect(screen.getByText("100 of 150")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search samples"), { target: { value: "nothing" } });
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
    expect(screen.getByText("0 results")).toBeInTheDocument();
  });

  it("shows a failed load and retries with a refresh", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(list(items(2)));
    render(<PackagesDialog provider={provider(load)} open onClose={vi.fn()} />);

    expect(await screen.findByText("offline")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.retry }));

    expect(await screen.findByText("2 results")).toBeInTheDocument();
    expect(load).toHaveBeenLastCalledWith({ offline: false, refresh: true });
  });

  it("dates a stale list, mentions being offline, and prefers the partial notice", async () => {
    const stale = provider(async () => list(items(1), { stale: true }));
    const { unmount } = render(<PackagesDialog provider={stale} open onClose={vi.fn()} />);
    expect(await screen.findByText(/^Stale since/)).toBeInTheDocument();
    unmount();

    useSettingsStore.setState({ offline: true });
    const second = render(<PackagesDialog provider={stale} open onClose={vi.fn()} />);
    expect(await screen.findByText(/^Offline since/)).toBeInTheDocument();
    second.unmount();

    const partial = provider(async () => list(items(1), { stale: true, partial: true }), {
      labels: { ...labels, partial: (offline: boolean) => (offline ? "Partial offline" : "Partial") },
    });
    const third = render(<PackagesDialog provider={partial} open onClose={vi.fn()} />);
    expect(await screen.findByText("Partial offline")).toBeInTheDocument();
    third.unmount();

    const undated = provider(async () => list(items(1), { stale: true, fetchedAt: null }));
    render(<PackagesDialog provider={undated} open onClose={vi.fn()} />);
    expect(await screen.findByText("1 results")).toBeInTheDocument();
    expect(screen.queryByText(/since/)).toBeNull();
  });

  it("renders the provider's notice and footer and hides topics it does not have", async () => {
    const custom = provider(async () => list(items(1)), {
      categories: undefined,
      renderNotice: (context) => <p>{`notice:${context}`}</p>,
      renderFooter: (context) => <p>{`footer:${context}`}</p>,
    });
    render(<PackagesDialog provider={custom} open onClose={vi.fn()} />);

    expect(await screen.findByText("notice:context")).toBeInTheDocument();
    expect(screen.getByText("footer:context")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All topics" })).toBeNull();
  });

  it("ignores a load that finishes after the dialog closed", async () => {
    let finish: (value: PackageList<Item>) => void = () => {};
    let fail: (error: Error) => void = () => {};
    const load = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<PackageList<Item>>((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<PackageList<Item>>((_resolve, reject) => {
            fail = reject;
          }),
      );
    const sample = provider(load);
    const { rerender } = render(<PackagesDialog provider={sample} open onClose={vi.fn()} />);
    rerender(<PackagesDialog provider={sample} open={false} onClose={vi.fn()} />);
    rerender(<PackagesDialog provider={sample} open onClose={vi.fn()} />);
    rerender(<PackagesDialog provider={sample} open={false} onClose={vi.fn()} />);

    await act(async () => {
      finish(list(items(3)));
      fail(new Error("late"));
    });

    expect(screen.queryByText("3 results")).toBeNull();
    expect(screen.queryByText("late")).toBeNull();
  });
});

describe("showPackagesDialog", () => {
  it("opens one shared dialog and closes it from its close button", async () => {
    showPackagesDialog(provider(async () => list(items(2))));

    expect(await screen.findByText("2 results")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Close sample packages" }));
    await waitFor(() => expect(screen.queryByText("2 results")).toBeNull());

    showPackagesDialog(provider(async () => list(items(4))));
    expect(await screen.findByText("4 results")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-packages-dialog]")).toHaveLength(1);
  });
});
