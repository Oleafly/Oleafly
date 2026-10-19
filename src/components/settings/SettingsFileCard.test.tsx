// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  cloudSettingsDownload: vi.fn(),
  cloudSettingsApplied: vi.fn(async () => undefined),
  cloudState: vi.fn(),
  cloudConnectCancel: vi.fn(async () => undefined),
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  appVersion: vi.fn(async () => "0.4.6"),
  pickSettingsFile: vi.fn(),
  writeBytesFile: vi.fn(async () => undefined),
  pickSavePath: vi.fn(),
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/cloud", () => ({
  cloudSettingsDownload: mocks.cloudSettingsDownload,
  cloudSettingsApplied: mocks.cloudSettingsApplied,
  cloudState: mocks.cloudState,
  cloudConnectCancel: mocks.cloudConnectCancel,
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn(async () => undefined) }));
vi.mock("@/lib/tauri", () => ({
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
  appVersion: mocks.appVersion,
  writeBytesFile: mocks.writeBytesFile,
}));
vi.mock("@/lib/settings-file/native", () => ({ pickSettingsFile: mocks.pickSettingsFile }));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: mocks.pickSavePath }));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));
vi.mock("@/i18n/desktop", () => ({ changeLocalePreference: vi.fn(async () => undefined) }));

import { loadNamespace } from "@/i18n";
import { base64ToBytes } from "@/lib/base64";
import { useCloudStore } from "@/store/cloud";
import { useSettingsStore } from "@/store/settings";
import { ThemeProvider } from "@/lib/theme";
import SettingsFileCardView from "./SettingsFileCard";

function SettingsFileCard() {
  return (
    <ThemeProvider>
      <SettingsFileCardView />
    </ThemeProvider>
  );
}

const initialSettings = useSettingsStore.getState();
const initialCloud = useCloudStore.getState();

const config = {
  ai_system_prompt: "",
  ai_pdf_capture: true,
  ai_personas: [],
  ai_starter_personas_seeded: true,
  checkpoints_enabled: true,
  checkpoint_notifications: true,
} as unknown as AppConfig;

async function chooseLocalImport() {
  await userEvent.click(screen.getByTestId("settings-file-import"));
  await userEvent.click(await screen.findByTestId("settings-file-import-local"));
}

function connectedCloud() {
  useCloudStore.setState({ status: "connected" });
}

async function chooseCloudImport() {
  await userEvent.click(screen.getByTestId("settings-file-import"));
  await userEvent.click(await screen.findByTestId("settings-file-import-cloud"));
}

function settingsFile(body: Record<string, unknown>) {
  return { name: "class.json", text: JSON.stringify(body) };
}

beforeAll(async () => {
  await loadNamespace("settingsFile");
});

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState(initialSettings, true);
  useCloudStore.setState(initialCloud, true);
  mocks.getConfig.mockResolvedValue(config);
  mocks.setConfig.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SettingsFileCard", () => {
  it("exports the settings as pretty JSON to the chosen file", async () => {
    mocks.pickSavePath.mockResolvedValue("/Users/me/Desktop/oleafly-settings.json");
    render(<SettingsFileCard />);
    await userEvent.click(screen.getByTestId("settings-file-export"));
    await waitFor(() => expect(mocks.writeBytesFile).toHaveBeenCalledTimes(1));
    expect(mocks.pickSavePath).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "oleafly-settings.json" }),
    );
    const [destination, base64] = mocks.writeBytesFile.mock.calls[0] as unknown as [string, string];
    expect(destination).toBe("/Users/me/Desktop/oleafly-settings.json");
    const text = new TextDecoder().decode(base64ToBytes(base64));
    const exported = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(exported)[0]).toBe("general");
    expect(exported).not.toHaveProperty("oleafly");
    expect(exported).toMatchObject({
      appearance: { app: { fontSize: 16 }, editor: { fontSize: 13 }, terminal: { fontSize: 14 } },
    });
    expect(text.startsWith('{\n  "general": {\n')).toBe(true);
    expect(mocks.toast.success).toHaveBeenCalledWith("Exported oleafly-settings.json to disk");
  });

  it("does nothing when the save dialog is cancelled", async () => {
    mocks.pickSavePath.mockResolvedValue(null);
    render(<SettingsFileCard />);
    await userEvent.click(screen.getByTestId("settings-file-export"));
    await waitFor(() => expect(screen.getByTestId("settings-file-export")).toBeEnabled());
    expect(mocks.writeBytesFile).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("reports a failed export", async () => {
    mocks.pickSavePath.mockResolvedValue("/tmp/x.json");
    mocks.writeBytesFile.mockRejectedValueOnce(new Error("disk full"));
    render(<SettingsFileCard />);
    await userEvent.click(screen.getByTestId("settings-file-export"));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Couldn't save the settings file."));
  });

  it("lists rejected values and changes nothing", async () => {
    mocks.pickSettingsFile.mockResolvedValue(
      settingsFile({ appearance: { app: { fontSize: 99 }, editor: { lineWrap: "maybe" } } }),
    );
    render(<SettingsFileCard />);
    await chooseLocalImport();
    const problem = await screen.findByTestId("settings-file-problem");
    expect(problem).toHaveTextContent("class.json wasn't imported");
    expect(problem).toHaveTextContent(
      "The settings config you tried to import is invalid, please fix these errors and try importing again:",
    );
    expect(within(problem).getAllByRole("listitem")).toHaveLength(2);
    expect(problem).toHaveTextContent("appearance.app.fontSize must be one of: 13, 14, 15, 16, 17, 18, 20");
    expect(problem).toHaveTextContent("appearance.editor.lineWrap must be true or false");
    expect(useSettingsStore.getState().appFontSize).toBe(16);
    await userEvent.click(within(problem).getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("settings-file-problem")).not.toBeInTheDocument();
  });

  it("names a shortcut the operating system keeps for itself", async () => {
    mocks.pickSettingsFile.mockResolvedValue(settingsFile({ shortcuts: { app: { recompile: "Ctrl-c" } } }));
    render(<SettingsFileCard />);
    await chooseLocalImport();
    expect(await screen.findByTestId("settings-file-problem")).toHaveTextContent(
      "shortcuts.app.recompile Copy is reserved by the operating system.",
    );
  });

  it("names a file that isn't a settings file", async () => {
    mocks.pickSettingsFile.mockResolvedValue({ name: "notes.json", text: "{\"hello\": 1}" });
    render(<SettingsFileCard />);
    await chooseLocalImport();
    expect(await screen.findByTestId("settings-file-problem")).toHaveTextContent(
      "This isn't an Oleafly settings file.",
    );
  });

  it("asks before replacing settings and applies them at once", async () => {
    mocks.pickSettingsFile.mockResolvedValue(
      settingsFile({ appearance: { app: { fontSize: 18 }, editor: { fontSize: 20 } }, extra: true }),
    );
    render(<SettingsFileCard />);
    await chooseLocalImport();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Replace your settings?");
    expect(dialog).toHaveTextContent("Settings that will change: 2");
    expect(dialog).toHaveTextContent("Not recognized, so they'll be skipped: extra");
    await userEvent.click(within(dialog).getByRole("button", { name: /^Import/ }));
    expect(useSettingsStore.getState()).toMatchObject({ appFontSize: 18, editorFontSize: 20 });
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith("Settings imported."));
  });

  it("keeps settings when the import is cancelled", async () => {
    mocks.pickSettingsFile.mockResolvedValue(settingsFile({ appearance: { app: { fontSize: 18 } } }));
    render(<SettingsFileCard />);
    await chooseLocalImport();
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^Cancel/ }));
    expect(useSettingsStore.getState().appFontSize).toBe(16);
  });

  it("says so when the file matches the current settings", async () => {
    mocks.pickSettingsFile.mockResolvedValue(settingsFile({ appearance: { app: { fontSize: 16 } } }));
    render(<SettingsFileCard />);
    await chooseLocalImport();
    await waitFor(() => expect(mocks.toast.info).toHaveBeenCalledWith("Your settings already match class.json."));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("reports a file the picker couldn't read", async () => {
    mocks.pickSettingsFile.mockRejectedValue("The settings file is larger than 1 MB.");
    render(<SettingsFileCard />);
    await chooseLocalImport();
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Couldn't open that file."));
  });

  it("works outside the theme provider, the way the Settings harness renders it", async () => {
    render(<SettingsFileCardView />);
    await userEvent.click(screen.getByTestId("settings-file-view"));
    expect(await screen.findByTestId("settings-file-json")).toHaveTextContent('"theme": "system"');
  });

  it("shows the current settings as read-only JSON that follows changes", async () => {
    render(<SettingsFileCard />);
    const toggle = screen.getByTestId("settings-file-view");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const json = await screen.findByTestId("settings-file-json");
    expect(json).toHaveTextContent('"fontSize": 13');
    act(() => useSettingsStore.getState().setEditorFontSize(21));
    await waitFor(() => expect(screen.getByTestId("settings-file-json")).toHaveTextContent('"fontSize": 21'));
    await userEvent.click(toggle);
    expect(screen.queryByTestId("settings-file-json")).not.toBeInTheDocument();
  });

  it("offers this device and the cloud", async () => {
    mocks.pickSettingsFile.mockResolvedValue(settingsFile({ appearance: { app: { fontSize: 16 } } }));
    render(<SettingsFileCard />);
    await userEvent.click(screen.getByTestId("settings-file-import"));
    expect(await screen.findByTestId("settings-file-import-cloud")).toHaveTextContent("Import from cloud");
    await userEvent.click(screen.getByTestId("settings-file-import-local"));
    await waitFor(() => expect(mocks.toast.info).toHaveBeenCalledWith("Your settings already match class.json."));
  });

  it("imports the valid settings from Dropbox and records the string stamp", async () => {
    connectedCloud();
    mocks.cloudSettingsDownload.mockResolvedValue({
      values: {
        appearance: { app: { fontSize: 18 }, editor: { lineWrap: "maybe" } },
        experimentation: { webBrowser: true },
      },
      stamp: "18446744073709551615",
    });
    render(<SettingsFileCard />);
    await chooseCloudImport();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Settings from your Dropbox will replace yours.");
    expect(dialog).toHaveTextContent("Settings that will change: 1");
    await userEvent.click(within(dialog).getByRole("button", { name: /^Import/ }));
    await waitFor(() => expect(useSettingsStore.getState().appFontSize).toBe(18));
    await waitFor(() => expect(mocks.cloudSettingsApplied).toHaveBeenCalledTimes(1));
    const [stamp, values] = mocks.cloudSettingsApplied.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(stamp).toBe("18446744073709551615");
    expect(values).toMatchObject({ appearance: { app: { fontSize: 18 } } });
    expect(values).not.toHaveProperty("experimentation.webBrowser");
    expect(useSettingsStore.getState()).not.toHaveProperty("webBrowser");
    expect(useCloudStore.getState().applyingSettings).toBe(false);
    expect(mocks.toast.success).toHaveBeenCalledWith("Settings imported.");
  });

  it("names your Dropbox when its settings already match", async () => {
    connectedCloud();
    mocks.cloudSettingsDownload.mockResolvedValue({ values: { appearance: { app: { fontSize: 16 } } }, stamp: "7" });
    render(<SettingsFileCard />);
    await chooseCloudImport();
    await waitFor(() => expect(mocks.toast.info).toHaveBeenCalledWith("Your settings already match your Dropbox."));
    expect(mocks.cloudSettingsApplied).toHaveBeenCalledWith("7", expect.any(Object));
  });

  it("says so when Dropbox has no settings yet", async () => {
    connectedCloud();
    mocks.cloudSettingsDownload.mockResolvedValue({ values: null, stamp: "0" });
    render(<SettingsFileCard />);
    await chooseCloudImport();
    await waitFor(() =>
      expect(mocks.toast.info).toHaveBeenCalledWith(
        "Your Dropbox has no Oleafly settings yet. Turn on cloud sync on another computer first.",
      ),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("routes to Cloud sync when cloud import is chosen while disconnected", async () => {
    mocks.cloudState.mockResolvedValue({ status: "disconnected", projects: [] });
    render(<SettingsFileCard />);
    await chooseCloudImport();
    await waitFor(() => expect(useCloudStore.getState().navRequest).toBe("data-cloud"));
    expect(useCloudStore.getState().settingsImport).toBe("awaitingConnect");
    expect(mocks.cloudSettingsDownload).not.toHaveBeenCalled();
  });

  it("resumes the import once the connect flow it waited for succeeds", async () => {
    connectedCloud();
    useCloudStore.setState({ settingsImport: "resume" });
    mocks.cloudSettingsDownload.mockResolvedValue({ values: { appearance: { app: { fontSize: 18 } } }, stamp: "9" });
    render(<SettingsFileCard />);
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Settings from your Dropbox will replace yours.");
    expect(mocks.cloudSettingsDownload).toHaveBeenCalledTimes(1);
    expect(useCloudStore.getState().settingsImport).toBeNull();
  });

  it("never runs a pending import after the connect flow is cancelled", async () => {
    useCloudStore.getState().requestSettingsImport();
    useCloudStore.setState({ connectFlow: { flowId: "f1", authUrl: "https://a", paste: false } });
    useCloudStore.getState().cancelConnect();
    expect(useCloudStore.getState().settingsImport).toBeNull();
    expect(mocks.cloudConnectCancel).toHaveBeenCalledWith("f1");
    useCloudStore.setState({ status: "connected" });
    render(<SettingsFileCard />);
    await act(async () => {});
    expect(mocks.cloudSettingsDownload).not.toHaveBeenCalled();
  });
});
