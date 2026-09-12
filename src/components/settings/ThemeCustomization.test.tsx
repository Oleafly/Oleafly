// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    preference: "light",
    theme: "light",
    setPreference: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import {
  THEME_TOKEN_NAMES,
  readThemeCustomization,
  resetThemeCustomization,
} from "@/lib/theme-customization";
import { ThemeCustomization } from "./ThemeCustomization";

const customTheme = enSettings.appearance.customTheme;

function open() {
  render(<ThemeCustomization />);
  fireEvent.click(screen.getByTestId("theme-customization-toggle"));
}

function tokenInput(tokenLabel: string, mode: "light" | "dark" = "light") {
  return screen.getByLabelText(
    (mode === "light" ? customTheme.tokenInputLight : customTheme.tokenInputDark).replace(
      "{{token}}",
      tokenLabel,
    ),
  );
}

beforeEach(() => {
  resetThemeCustomization();
  for (const node of document.querySelectorAll("style[data-oleafly-custom-theme]")) {
    node.remove();
  }
});

describe("ThemeCustomization", () => {
  it("lists an input for every theme token", () => {
    open();

    expect(screen.getByText(customTheme.description)).toBeInTheDocument();
    for (const token of THEME_TOKEN_NAMES) {
      expect(screen.getByTitle(token)).toBeInTheDocument();
    }
    expect(
      screen.getByLabelText(customTheme.modeFieldsetAriaLabel),
    ).toBeInTheDocument();
  });

  it("stores a token for the mode being edited and restores it", async () => {
    open();

    const field = tokenInput(customTheme.tokens.background);
    fireEvent.change(field, { target: { value: "#112233" } });
    fireEvent.blur(field, { target: { value: "#112233" } });
    await waitFor(() =>
      expect(readThemeCustomization().light.background).toBe("#112233"),
    );

    fireEvent.click(screen.getByRole("button", { name: customTheme.resetMode }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      customTheme.lightRestored,
    );
    expect(readThemeCustomization().light.background).toBeUndefined();
  });

  it("edits the dark palette separately", async () => {
    open();

    fireEvent.click(screen.getByRole("button", { name: customTheme.modeDark }));
    const field = tokenInput(customTheme.tokens.foreground, "dark");
    fireEvent.change(field, { target: { value: "#eeeeee" } });
    fireEvent.blur(field, { target: { value: "#eeeeee" } });
    await waitFor(() =>
      expect(readThemeCustomization().dark.foreground).toBe("#eeeeee"),
    );

    fireEvent.click(screen.getByRole("button", { name: customTheme.resetMode }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      customTheme.darkRestored,
    );
  });

  it("rejects a token value it cannot use and clears it again", async () => {
    open();

    const field = tokenInput(customTheme.tokens.primary);
    fireEvent.blur(field, { target: { value: "url(evil)" } });
    expect(await screen.findByRole("status")).toBeInTheDocument();

    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field, { target: { value: "" } });
    await waitFor(() => expect(readThemeCustomization().light.primary).toBeUndefined());
  });

  it("stores the corner radius and the scoped CSS", async () => {
    open();

    const radius = screen.getByLabelText(customTheme.radius.label);
    fireEvent.change(radius, { target: { value: "8px" } });
    fireEvent.blur(radius, { target: { value: "8px" } });
    await waitFor(() => expect(readThemeCustomization().radius).toBe("8px"));

    const css = screen.getByLabelText(customTheme.customCss.label);
    fireEvent.change(css, { target: { value: "color: #202020" } });
    fireEvent.blur(css, { target: { value: "color: #202020" } });
    await waitFor(() =>
      expect(readThemeCustomization().customCss).toBe("color: #202020"),
    );
  });

  it("reports a radius and a CSS block it cannot use", async () => {
    open();

    fireEvent.blur(screen.getByLabelText(customTheme.radius.label), {
      target: { value: "url(evil)" },
    });
    expect(await screen.findByRole("status")).toBeInTheDocument();

    fireEvent.blur(screen.getByLabelText(customTheme.customCss.label), {
      target: { value: "@import url(evil)" },
    });
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("clears every customization", async () => {
    open();

    const field = tokenInput(customTheme.tokens.background);
    fireEvent.blur(field, { target: { value: "#112233" } });
    await waitFor(() =>
      expect(readThemeCustomization().light.background).toBe("#112233"),
    );

    fireEvent.click(screen.getByRole("button", { name: customTheme.resetAll }));
    expect(await screen.findByRole("status")).toHaveTextContent(customTheme.cleared);
    expect(readThemeCustomization().light.background).toBeUndefined();
  });

  it("exports the current theme as a file", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:theme");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    open();

    fireEvent.click(screen.getByRole("button", { name: customTheme.exportTheme }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:theme");
  });

  it("imports a theme file and reports the tokens it skipped", async () => {
    open();

    const input = screen.getByLabelText(customTheme.importFileAriaLabel);
    const payload = {
      cssVars: {
        light: { background: "#101010", "not-a-token": "#fff" },
        dark: {},
      },
    };
    const file = new File([JSON.stringify(payload)], "theme.json", {
      type: "application/json",
    });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(readThemeCustomization().light.background).toBe("#101010"),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      customTheme.importedSkipped_one
        .replace("{{count}}", "1")
        .replace("{{tokens}}", "not-a-token"),
    );
  });

  it("refuses a theme file that is too large", async () => {
    open();

    const input = screen.getByLabelText(customTheme.importFileAriaLabel);
    const file = new File(["{}"], "theme.json", { type: "application/json" });
    Object.defineProperty(file, "size", { value: 200 * 1024 });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole("status")).toHaveTextContent(
      customTheme.fileTooLarge,
    );
  });

  it("reports a theme file it cannot parse", async () => {
    open();

    const input = screen.getByLabelText(customTheme.importFileAriaLabel);
    const file = new File(["{oops"], "theme.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("opens the file picker from the Import button", () => {
    open();

    const input = screen.getByLabelText(customTheme.importFileAriaLabel);
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: customTheme.importTheme }));
    expect(click).toHaveBeenCalled();
  });
});
