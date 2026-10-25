// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import en from "@/i18n/locales/en/ai.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";
import { RunNotice } from "./RunNotice";

beforeAll(async () => {
  const { initTestI18n } = await import("@/components/ai/acp/tests/ui-fixtures");
  await initTestI18n();
});

beforeEach(() => {
  useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general", settingsScrollTarget: null });
});

describe("RunNotice", () => {
  it("opens the search keys in Settings from the no-search notice", () => {
    render(<RunNotice text={en.web.searchUnavailable} />);
    fireEvent.click(screen.getByRole("button", { name: en.web.addSearchKey }));
    const settings = useSettingsStore.getState();
    expect(settings.settingsOpen).toBe(true);
    expect(settings.settingsInitialSection).toBe("integrations");
    expect(settings.settingsScrollTarget).toBe("citation-search");
  });

  it("shows any other notice as plain text", () => {
    render(<RunNotice text="page1.png was not sent." />);
    expect(screen.getByTestId("agent-notice")).toHaveTextContent("page1.png was not sent.");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
