// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompileError, ComponentInfo } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  listFontComponents: vi.fn(),
  installFontComponent: vi.fn(),
  recompile: vi.fn(),
  refreshEngine: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  listFontComponents: mocks.listFontComponents,
  installFontComponent: mocks.installFontComponent,
}));
vi.mock("@/lib/toast", () => ({ toast: { error: mocks.error } }));
vi.mock("@/store/compile", () => ({
  useCompileStore: { getState: () => ({ recompile: mocks.recompile }) },
}));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ refreshEngine: mocks.refreshEngine }) },
}));

import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useFontPacksStore } from "@/store/font-packs";
import { CompileErrorDetails } from "./compile-log-details";

const warning = (message: string): CompileError => ({
  line: 3,
  file: "main.typ",
  message,
  kind: "warning",
  explanation: null,
});

const textPack = (installed: boolean): ComponentInfo => ({
  id: "typst-text",
  label: "Text",
  description: "",
  approx_bytes: 1,
  license: null,
  installed,
  kind: "typst-font",
  families: ["Liberation Sans"],
});

beforeEach(() => {
  vi.clearAllMocks();
  useFontPacksStore.setState({ packs: [], status: "idle", installing: null });
  mocks.listFontComponents.mockResolvedValue([textPack(false)]);
  mocks.installFontComponent.mockResolvedValue(undefined);
  mocks.refreshEngine.mockResolvedValue(undefined);
});

describe("missing Typst font hint", () => {
  it("offers the pack with the font and compiles again after downloading it", async () => {
    render(<CompileErrorDetails err={warning("unknown font family: liberation sans")} />);
    const label = enSettings.downloads.fontPacks["typst-text"].label;
    expect(
      await screen.findByText(
        enEditor.log.fontPack.replace("{{family}}", "liberation sans").replace("{{pack}}", label),
      ),
    ).toBeInTheDocument();
    mocks.listFontComponents.mockResolvedValue([textPack(true)]);
    await userEvent.click(screen.getByRole("button", { name: enEditor.log.fontPackAction }));
    await waitFor(() => expect(mocks.recompile).toHaveBeenCalledTimes(1));
    expect(mocks.installFontComponent).toHaveBeenCalledWith("typst-text");
    expect(mocks.refreshEngine).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("font-pack-hint")).not.toBeInTheDocument());
  });

  it("says so when the download fails and does not compile", async () => {
    mocks.installFontComponent.mockRejectedValue(new Error("offline"));
    render(<CompileErrorDetails err={warning("unknown font family: liberation sans")} />);
    await userEvent.click(await screen.findByRole("button", { name: enEditor.log.fontPackAction }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(enEditor.log.fontPackFailed));
    expect(mocks.recompile).not.toHaveBeenCalled();
  });

  it("stays quiet for fonts no pack provides and for other warnings", async () => {
    const { container } = render(<CompileErrorDetails err={warning("unknown font family: simsun")} />);
    await waitFor(() => expect(mocks.listFontComponents).toHaveBeenCalled());
    expect(screen.queryByTestId("font-pack-hint")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
