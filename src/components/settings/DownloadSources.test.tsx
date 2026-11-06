// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadSettings, DownloadSettingsInput } from "@/lib/tauri";
import errors from "@/i18n/locales/en/errors.json";

const mocks = vi.hoisted(() => ({
  getDownloadSettings: vi.fn<() => Promise<DownloadSettings>>(),
  setDownloadSettings: vi.fn<(input: DownloadSettingsInput) => Promise<DownloadSettings>>(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  getDownloadSettings: mocks.getDownloadSettings,
  setDownloadSettings: mocks.setDownloadSettings,
}));

const { DownloadSources } = await import("./DownloadSources");

const AUTOMATIC: DownloadSettings = {
  source: "automatic",
  mirrorUrl: null,
  texRepository: null,
  oleaflyMirror: "https://mirrors.oleafly.com",
  automaticTexRepository: "https://mirror.ctan.org/systems/texlive/tlnet",
  environmentSource: null,
  environmentTexRepository: null,
};

function saved(input: DownloadSettingsInput): DownloadSettings {
  return { ...AUTOMATIC, ...input };
}

function codedError(code: string): string {
  return `@oleafly/error:${JSON.stringify({ code, params: {}, detail: null })}`;
}

beforeEach(() => {
  mocks.getDownloadSettings.mockReset().mockResolvedValue(AUTOMATIC);
  mocks.setDownloadSettings.mockReset().mockImplementation(async (input) => saved(input));
});

describe("DownloadSources", () => {
  it("shows the saved choices once they load", async () => {
    render(<DownloadSources />);
    expect(await screen.findByTestId("download-source-automatic")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("download-source-original")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("download-repository-automatic")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("download-sources")).toHaveTextContent("mirrors.oleafly.com");
    expect(screen.getByTestId("download-sources")).toHaveTextContent("mirror.ctan.org");
  });

  it("saves original hosts at once and keeps the repository as it was", async () => {
    const user = userEvent.setup();
    render(<DownloadSources />);
    await user.click(await screen.findByTestId("download-source-original"));
    expect(mocks.setDownloadSettings).toHaveBeenCalledWith({
      source: "original",
      mirrorUrl: null,
      texRepository: null,
    });
    await waitFor(() =>
      expect(screen.getByTestId("download-source-original")).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("asks for an address before saving a custom mirror", async () => {
    const user = userEvent.setup();
    render(<DownloadSources />);
    await user.click(await screen.findByTestId("download-source-custom"));
    expect(mocks.setDownloadSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId("download-mirror-save")).toBeDisabled();
    expect(screen.getByTestId("download-source-custom").querySelector('[data-slot="check-badge"]')).toBeNull();
    expect(screen.getByTestId("download-source-automatic").querySelector('[data-slot="check-badge"]')).not.toBeNull();
    await user.type(screen.getByTestId("download-mirror-input"), "https://mirror.example.edu/oleafly");
    await user.click(screen.getByTestId("download-mirror-save"));
    expect(mocks.setDownloadSettings).toHaveBeenCalledWith({
      source: "custom",
      mirrorUrl: "https://mirror.example.edu/oleafly",
      texRepository: null,
    });
  });

  it("keeps the typed address and shows why it was refused", async () => {
    const user = userEvent.setup();
    mocks.setDownloadSettings.mockRejectedValueOnce(codedError("settings.download_url_not_https"));
    render(<DownloadSources />);
    await user.click(await screen.findByTestId("download-repository-custom"));
    await user.type(screen.getByTestId("download-repository-input"), "http://ctan.example.edu/tlnet");
    await user.click(screen.getByTestId("download-repository-save"));
    expect(await screen.findByTestId("download-repository-error")).toHaveTextContent(
      errors.settings.download_url_not_https,
    );
    expect(screen.getByTestId("download-repository-input")).toHaveValue("http://ctan.example.edu/tlnet");
    expect(mocks.setDownloadSettings).toHaveBeenCalledWith({
      source: "automatic",
      mirrorUrl: null,
      texRepository: "http://ctan.example.edu/tlnet",
    });
  });

  it("switching the repository back to automatic clears the saved address", async () => {
    const user = userEvent.setup();
    mocks.getDownloadSettings.mockResolvedValue({
      ...AUTOMATIC,
      texRepository: "https://ctan.example.edu/tlnet",
    });
    render(<DownloadSources />);
    expect(await screen.findByTestId("download-repository-input")).toHaveValue("https://ctan.example.edu/tlnet");
    await user.click(screen.getByTestId("download-repository-automatic"));
    expect(mocks.setDownloadSettings).toHaveBeenCalledWith({
      source: "automatic",
      mirrorUrl: null,
      texRepository: null,
    });
  });

  it("locks a choice the environment makes and says which variable to remove", async () => {
    mocks.getDownloadSettings.mockResolvedValue({
      ...AUTOMATIC,
      environmentSource: "https://lab.example.gov/mirror",
    });
    render(<DownloadSources />);
    const note = await screen.findByTestId("download-sources-environment");
    expect(note).toHaveTextContent("OLEAFLY_DOWNLOAD_MIRROR");
    expect(note).toHaveTextContent("https://lab.example.gov/mirror");
    for (const choice of ["automatic", "original", "custom"]) {
      expect(screen.getByTestId(`download-source-${choice}`)).toBeDisabled();
    }
    expect(screen.getByTestId("download-repository-automatic")).toBeEnabled();
  });

  it("reports a settings read that fails", async () => {
    mocks.getDownloadSettings.mockRejectedValue(codedError("settings.download_url_empty"));
    render(<DownloadSources />);
    expect(await screen.findByRole("alert")).toHaveTextContent(errors.settings.download_url_empty);
  });
});
