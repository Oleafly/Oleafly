// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setIconPack, setInstalledIconPack } from "@/components/icons/icon-pack";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";
import { COLOR_ICON_PREVIEW } from "./icon-pack-preview";
import { IconPackCard } from "./IconPackCard";

// The built pack is not in the repository, so the tests pin the preview as if it were the pack.
vi.mock("@/lib/icon-pack-pin", async () => {
  const { createHash } = await import("node:crypto");
  const { COLOR_ICON_PREVIEW: text } = await import("./icon-pack-preview");
  return {
    COLOR_ICON_PACK: { file: "oleafly-color.json", version: 1, bytes: 108_000, sha256: createHash("sha256").update(text).digest("hex") },
  };
});

const copy = enSettings.appearance.app.iconPack;
const respond = (body: string, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 503, text: async () => body }));
const neutral = () => screen.getByTestId("settings-icon-pack-neutral");
const color = () => screen.getByTestId("settings-icon-pack-color");

beforeEach(() => {
  localStorage.clear();
  setInstalledIconPack(null);
  useSettingsStore.getState().setIconPack("neutral");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setIconPack("neutral");
});

describe("Icons card", () => {
  it("previews eight icons in each pack before anything is downloaded", () => {
    const { container } = render(<IconPackCard />);
    expect(neutral().querySelectorAll("svg.lucide")).toHaveLength(8);
    expect(color().querySelectorAll("svg[data-oleafly-icon]")).toHaveLength(8);
    expect(neutral()).toHaveAttribute("aria-pressed", "true");
    expect(within(color()).getByTestId("settings-icon-pack-download")).toHaveTextContent("Download (105.5 KB)");
    // The preview brings its own styles while the full pack is not showing.
    expect(container.querySelector('style[data-icon-pack="color-preview"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: copy.remove })).toBeNull();
  });

  it("downloads the Color pack, switches to it and offers to remove it", async () => {
    vi.stubGlobal("fetch", respond(COLOR_ICON_PREVIEW));
    const { container } = render(<IconPackCard />);
    fireEvent.click(color());
    await waitFor(() => expect(color()).toHaveAttribute("aria-pressed", "true"));
    expect(useSettingsStore.getState().iconPack).toBe("color");
    expect(screen.queryByTestId("settings-icon-pack-download")).toBeNull();
    expect(container.querySelector('style[data-icon-pack="color-preview"]')).toBeNull();

    fireEvent.click(neutral());
    expect(useSettingsStore.getState().iconPack).toBe("neutral");
    expect(neutral()).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(color());
    await waitFor(() => expect(useSettingsStore.getState().iconPack).toBe("color"));
    fireEvent.click(screen.getByRole("button", { name: copy.remove }));
    expect(useSettingsStore.getState().iconPack).toBe("neutral");
    expect(localStorage.getItem("oleafly.iconPack.color")).toBeNull();
    expect(screen.getByTestId("settings-icon-pack-download")).toBeInTheDocument();
  });

  it("says the connection failed and stays on Neutral when the download fails", async () => {
    vi.stubGlobal("fetch", respond("", false));
    render(<IconPackCard />);
    fireEvent.click(color());
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.failedNetwork);
    expect(useSettingsStore.getState().iconPack).toBe("neutral");
    expect(color()).not.toBeDisabled();
  });

  it("says the file was refused when it does not match the pinned hash", async () => {
    vi.stubGlobal("fetch", respond(`${COLOR_ICON_PREVIEW} `));
    render(<IconPackCard />);
    fireEvent.click(color());
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.failedCheck);
    expect(useSettingsStore.getState().iconPack).toBe("neutral");
  });
});
