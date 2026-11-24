// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  overleafStatus: vi.fn(),
  overleafCreateFromLocal: vi.fn(),
}));
const files = vi.hoisted(() => ({ refreshProjects: vi.fn(async () => {}) }));
const log = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));

vi.mock("@/lib/overleaf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf")>()),
  ...api,
}));
vi.mock("@/lib/log", () => log);
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => files } }));

import type { ProjectInfo } from "@/lib/tauri";
import { useOverleafImportStore } from "@/store/overleaf-import";
import { useSettingsStore } from "@/store/settings";
import { PutOnOverleafDialog } from "./PutOnOverleafDialog";

const SERVER = "https://www.overleaf.com";
const PROJECT: ProjectInfo = {
  id: "local-1",
  name: "Local paper",
  main_doc: "main.tex",
  engine: "latexmk",
  kind: "document",
  created_at: 1,
  updated_at: 1,
  has_preview: false,
  exports: [],
  forked_from: null,
  recovery_pending: false,
};
const TWO = {
  server: SERVER,
  signedIn: true,
  email: "ada@uni.edu",
  userId: "u-ada",
  accounts: [
    { userId: "u-ada", email: "ada@uni.edu" },
    { userId: "u-bea", email: "bea@uni.edu" },
  ],
};

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  files.refreshProjects.mockClear();
  log.logError.mockClear();
  useOverleafImportStore.setState({ server: SERVER, status: null });
});

describe("PutOnOverleafDialog", () => {
  it("puts the project on Overleaf under the chosen name and account, then hands it on", async () => {
    api.overleafStatus.mockResolvedValue(TWO);
    api.overleafCreateFromLocal.mockResolvedValue({ server: SERVER, remoteId: "r1", name: "Paper" });
    const onDone = vi.fn();
    render(<PutOnOverleafDialog project={PROJECT} onClose={vi.fn()} onDone={onDone} />);
    const name = await screen.findByTestId("put-on-overleaf-name");
    expect(name).toHaveValue("Local paper");
    expect(screen.getByTestId("put-on-overleaf-account")).toHaveTextContent("ada@uni.edu");
    fireEvent.change(name, { target: { value: "Paper" } });
    fireEvent.click(screen.getByTestId("put-on-overleaf-submit"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("local-1"));
    expect(api.overleafCreateFromLocal).toHaveBeenCalledWith("local-1", SERVER, "u-ada", "Paper");
    expect(files.refreshProjects).toHaveBeenCalled();
  });

  it("keeps the name open on the Enter that confirms an input method's text, and creates on a plain Enter", async () => {
    api.overleafStatus.mockResolvedValue({ ...TWO, accounts: [TWO.accounts[0]] });
    api.overleafCreateFromLocal.mockResolvedValue({ server: SERVER, remoteId: "r1", name: "論文" });
    const onDone = vi.fn();
    render(<PutOnOverleafDialog project={PROJECT} onClose={vi.fn()} onDone={onDone} />);
    const name = await screen.findByTestId("put-on-overleaf-name");
    fireEvent.change(name, { target: { value: "論文" } });
    fireEvent.keyDown(name, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(name, { key: "Enter", isComposing: true });
    expect(api.overleafCreateFromLocal).not.toHaveBeenCalled();
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("local-1"));
    expect(api.overleafCreateFromLocal).toHaveBeenCalledExactlyOnceWith("local-1", SERVER, "u-ada", "論文");
  });

  it("shows a refusal from Overleaf without logging it and stays open", async () => {
    api.overleafStatus.mockResolvedValue({ ...TWO, accounts: [TWO.accounts[0]] });
    api.overleafCreateFromLocal.mockRejectedValue(
      '@oleafly/error:{"code":"overleaf.create_one_folder","params":{}}',
    );
    const onDone = vi.fn();
    render(<PutOnOverleafDialog project={PROJECT} onClose={vi.fn()} onDone={onDone} />);
    fireEvent.click(await screen.findByTestId("put-on-overleaf-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Every file in this project is inside one folder");
    expect(screen.queryByTestId("put-on-overleaf-account")).not.toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(log.logError).not.toHaveBeenCalled();
  });

  it("asks for a sign-in first when no account is signed in", async () => {
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: false, email: null, accounts: [] });
    const openSettingsAt = vi.fn();
    useSettingsStore.setState({ openSettingsAt });
    const onClose = vi.fn();
    render(<PutOnOverleafDialog project={PROJECT} onClose={onClose} onDone={vi.fn()} />);
    expect(await screen.findByTestId("put-on-overleaf-signed-out")).toBeInTheDocument();
    expect(screen.queryByTestId("put-on-overleaf-submit")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onClose).toHaveBeenCalled();
    expect(openSettingsAt).toHaveBeenCalledWith("integrations");
    expect(api.overleafCreateFromLocal).not.toHaveBeenCalled();
  });
});
