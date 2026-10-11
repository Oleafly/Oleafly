// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabServer } from "@/lib/tauri";
import { COLLAB_ERROR_CODES, collabErrorMessage } from "./errors";
import { account, capabilities, collabError, deferred, fill, server } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabServerProbe: vi.fn(),
  collabServerSignIn: vi.fn(),
  collabServerSignInCancel: vi.fn(),
  collabServersList: vi.fn(),
  collabServerSignOut: vi.fn(),
  collabServerRemove: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

import { AddServerDialog, normalizeServerAddress } from "./AddServerDialog";
import { useCollabStore } from "./store";

const copy = enCollab.addServer;
const github = fill(copy.continueWith, { provider: "GitHub" });

function renderDialog(initialUrl: string | null = null) {
  const onClose = vi.fn();
  render(<AddServerDialog open initialUrl={initialUrl} onClose={onClose} />);
  return { onClose };
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabServerSignInCancel.mockResolvedValue(undefined);
  useCollabStore.setState({ servers: [], status: "ready", loadError: null, pending: {} });
});

describe("normalizeServerAddress", () => {
  it("adds https when no scheme is given and leaves everything else to the backend", () => {
    expect(normalizeServerAddress("collab.uni.edu")).toBe("https://collab.uni.edu");
    expect(normalizeServerAddress("  uni.edu/oleafly/ ")).toBe("https://uni.edu/oleafly/");
    expect(normalizeServerAddress("HTTPS://Uni.edu/oleafly")).toBe("HTTPS://Uni.edu/oleafly");
    expect(normalizeServerAddress("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(normalizeServerAddress("   ")).toBe("");
  });
});

describe("AddServerDialog", () => {
  it("checks the address, signs in with the chosen option and says who you are", async () => {
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    mocks.collabServerSignIn.mockResolvedValue(server());
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText(copy.addressLabel), "collab.uni.edu");
    await user.click(screen.getByRole("button", { name: copy.continue }));
    expect(mocks.collabServerProbe).toHaveBeenCalledWith("https://collab.uni.edu");
    expect(await screen.findByText("Smith Lab")).toBeInTheDocument();
    expect(screen.getByText(fill(copy.version, { version: "1.0.0" }))).toBeInTheDocument();
    expect(screen.queryByText(copy.setupTitle)).toBeNull();
    await user.click(screen.getByRole("button", { name: github }));
    expect(mocks.collabServerSignIn).toHaveBeenCalledWith("https://collab.uni.edu", "github", undefined);
    expect(
      await screen.findByText(fill(copy.doneDescription, { server: "Smith Lab", name: "Alice Chen" })),
    ).toBeInTheDocument();
    expect(useCollabStore.getState().servers).toEqual([server()]);
  });

  it("asks for the setup code on a new server and sends it with the sign-in", async () => {
    mocks.collabServerProbe.mockResolvedValue(capabilities({ needs_setup: true }));
    mocks.collabServerSignIn.mockResolvedValue(server({ account: account({ server_role: "admin" }) }));
    const user = userEvent.setup();
    renderDialog("https://collab.uni.edu");
    expect(await screen.findByText(copy.setupTitle)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: github })).toBeDisabled();
    await user.type(screen.getByLabelText(copy.setupCodeLabel), " 4F7K-Q2ZX ");
    await user.click(screen.getByRole("button", { name: github }));
    expect(mocks.collabServerSignIn).toHaveBeenCalledWith("https://collab.uni.edu", "github", "4F7K-Q2ZX");
  });

  it("offers a sign-in option of a kind this version does not know", async () => {
    mocks.collabServerProbe.mockResolvedValue(
      capabilities({ providers: [{ id: "future", kind: "unknown", label: "Future login" }] }),
    );
    renderDialog("https://collab.uni.edu");
    expect(
      await screen.findByRole("button", { name: fill(copy.continueWith, { provider: "Future login" }) }),
    ).toBeEnabled();
  });

  it("waits with a spinner and cancels the browser sign-in", async () => {
    const pending = deferred<CollabServer>();
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    mocks.collabServerSignIn.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderDialog("https://collab.uni.edu");
    await user.click(await screen.findByRole("button", { name: github }));
    expect(screen.getByText(copy.waitingTitle)).toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: copy.cancel }));
    expect(mocks.collabServerSignInCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: github })).toBeEnabled();
    await act(async () => {
      pending.reject(collabError("sign_in_cancelled"));
      await pending.promise.catch(() => undefined);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(copy.doneTitle)).toBeNull();
  });

  it("cancels the browser sign-in when the dialog closes while waiting", async () => {
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    mocks.collabServerSignIn.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    const { onClose } = renderDialog("https://collab.uni.edu");
    await user.click(await screen.findByRole("button", { name: github }));
    await user.keyboard("{Escape}");
    expect(mocks.collabServerSignInCancel).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows every error code in plain words where it happened", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText(copy.addressLabel), "collab.uni.edu");
    for (const code of COLLAB_ERROR_CODES) {
      mocks.collabServerProbe.mockRejectedValueOnce(collabError(code));
      await user.click(screen.getByRole("button", { name: copy.continue }));
      expect(await screen.findByRole("alert")).toHaveTextContent(collabErrorMessage(code));
    }
  });

  it("keeps the sign-in options when the server has not added you", async () => {
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    mocks.collabServerSignIn.mockRejectedValue(collabError("not_admitted"));
    const user = userEvent.setup();
    renderDialog("https://collab.uni.edu");
    await user.click(await screen.findByRole("button", { name: github }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.not_admitted);
    expect(screen.getByRole("button", { name: github })).toBeEnabled();
  });

  it("says so when a server has no way to sign in, and goes back to the address", async () => {
    mocks.collabServerProbe.mockResolvedValue(capabilities({ providers: [] }));
    const user = userEvent.setup();
    renderDialog("https://collab.uni.edu");
    expect(await screen.findByText(copy.noProviders)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.back }));
    expect(screen.getByLabelText(copy.addressLabel)).toHaveValue("https://collab.uni.edu");
  });

  it("closes from the done step without cancelling anything", async () => {
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    mocks.collabServerSignIn.mockResolvedValue(server());
    const user = userEvent.setup();
    const { onClose } = renderDialog("https://collab.uni.edu");
    await user.click(await screen.findByRole("button", { name: github }));
    await user.click(await screen.findByRole("button", { name: copy.done }));
    expect(onClose).toHaveBeenCalled();
    expect(mocks.collabServerSignInCancel).not.toHaveBeenCalled();
  });
});
