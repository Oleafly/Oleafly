// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ linux: false }));
const api = vi.hoisted(() => ({
  overleafStatus: vi.fn(),
  overleafListProjects: vi.fn(),
  overleafImportProjects: vi.fn(),
}));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    get isLinux() {
      return platform.linux;
    },
  };
});
vi.mock("@/lib/overleaf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf")>()),
  ...api,
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => ({ refreshProjects: vi.fn(async () => {}) }) } }));

import { useOverleafImportStore } from "@/store/overleaf-import";
import { OverleafImportView } from "./OverleafImportView";

const SERVER = "https://www.overleaf.com";
const signedIn = { server: SERVER, signedIn: true, email: "ada@uni.edu" };
const thesis = {
  id: "a1",
  name: "Thesis",
  ownerName: "Ada Lovelace",
  owned: true,
  access: "owner",
  lastUpdated: null,
  lastUpdatedBy: null,
  archived: false,
  importedAs: null,
};

const startViewTransition = vi.fn((update: () => void) => {
  update();
  return { finished: Promise.resolve() };
});

beforeEach(() => {
  useOverleafImportStore.setState({
    server: SERVER,
    status: null,
    projects: [],
    phase: "idle",
    error: null,
    selected: [],
    progress: {},
    importing: false,
    run: null,
  });
  api.overleafStatus.mockResolvedValue(signedIn);
  api.overleafListProjects.mockResolvedValue({ status: signedIn, projects: [thesis] });
  api.overleafImportProjects.mockReturnValue(new Promise(() => {}));
  Object.defineProperty(document, "startViewTransition", {
    value: startViewTransition,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(document, "startViewTransition");
  startViewTransition.mockClear();
});

async function startImport() {
  render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
  fireEvent.click(await screen.findByText("Thesis"));
  fireEvent.click(screen.getByTestId("overleaf-import-selected"));
  expect(await screen.findByTestId("overleaf-import-run")).toBeInTheDocument();
}

describe("import view transition", () => {
  it("animates into the import run where the web view supports it", async () => {
    platform.linux = false;
    await startImport();
    expect(startViewTransition).toHaveBeenCalledOnce();
  });

  it("switches views directly on Linux, where WebKitGTK crashes on view transitions", async () => {
    platform.linux = true;
    await startImport();
    expect(startViewTransition).not.toHaveBeenCalled();
  });
});
