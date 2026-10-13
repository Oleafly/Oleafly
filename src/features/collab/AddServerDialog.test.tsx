// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabCapabilities, CollabServer, CollabSignInCode } from "@/lib/tauri";
import { COLLAB_ERROR_CODES, collabErrorMessage } from "./errors";
import { account, capabilities, collabError, deferred, fill, server } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabServerProbe: vi.fn(),
  collabServerSignIn: vi.fn(),
  collabServerCodeSignIn: vi.fn(),
  collabServerSignInCancel: vi.fn(),
  collabServersList: vi.fn(),
  collabServerSignOut: vi.fn(),
  collabServerRemove: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

import { AddServerDialog, CODE_OFFER_DELAY_MS, normalizeServerAddress } from "./AddServerDialog";
import { useCollabStore } from "./store";

const copy = enCollab.addServer;
const github = fill(copy.continueWith, { provider: "GitHub" });
const shownCode: CollabSignInCode = {
  userCode: "BCDF-GHJK",
  verificationUri: "https://collab.uni.edu/auth/device",
  verificationUriComplete: "https://collab.uni.edu/auth/device?code=BCDF-GHJK",
  expiresAt: 1_760_000_600_000,
};

function codeSignInShowing(result: Promise<CollabServer>) {
  mocks.collabServerCodeSignIn.mockImplementation(
    (_url: string, _setup: string | undefined, onCode: (code: CollabSignInCode) => void) => {
      onCode(shownCode);
      return result;
    },
  );
}

function renderDialog(initialUrl: string | null = null) {
  const onClose = vi.fn();
  render(<AddServerDialog open initialUrl={initialUrl} onClose={onClose} />);
  return { onClose };
}

function expectHeader(title: string, description: string) {
  expect(screen.getByRole("dialog", { name: title })).toHaveAccessibleDescription(description);
}

async function signInAs(signedIn: CollabServer) {
  mocks.collabServerProbe.mockResolvedValue(capabilities());
  mocks.collabServerSignIn.mockResolvedValue(signedIn);
  const user = userEvent.setup();
  renderDialog("https://collab.uni.edu");
  await user.click(await screen.findByRole("button", { name: github }));
  await screen.findByRole("button", { name: copy.done });
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

  it("takes the server address out of an Add to Oleafly link", () => {
    expect(normalizeServerAddress("oleafly://server/add?url=https%3A%2F%2Fwww.cs.uni.edu%2Foleafly")).toBe(
      "https://www.cs.uni.edu/oleafly",
    );
    expect(normalizeServerAddress(" OLEAFLY://server/add/?url=collab.uni.edu ")).toBe("https://collab.uni.edu");
    expect(normalizeServerAddress("oleafly://server/add?url=")).toBe("oleafly://server/add?url=");
    expect(normalizeServerAddress("oleafly://server/add?name=lab")).toBe("oleafly://server/add?name=lab");
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
    expect(screen.queryByText(fill(copy.setupTitle, { server: "Smith Lab" }))).toBeNull();
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
    expect(
      await screen.findByRole("heading", { name: fill(copy.setupTitle, { server: "Smith Lab" }) }),
    ).toBeInTheDocument();
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
    expect(screen.queryByText(fill(copy.doneTitle, { server: "Smith Lab" }))).toBeNull();
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

  it("offers email sign-in when the server lists it and says where the link goes", async () => {
    mocks.collabServerProbe.mockResolvedValue(
      capabilities({
        providers: [
          { id: "github", kind: "github", label: "GitHub" },
          { id: "email-link", kind: "email_link", label: "Email" },
        ],
      }),
    );
    mocks.collabServerSignIn.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderDialog("https://collab.uni.edu");
    await user.click(await screen.findByRole("button", { name: fill(copy.continueWith, { provider: "Email" }) }));
    expect(mocks.collabServerSignIn).toHaveBeenCalledWith("https://collab.uni.edu", "email-link", undefined);
    expect(screen.getByText(copy.waitingEmailDescription)).toBeInTheDocument();
    expect(screen.queryByText(fill(copy.waitingDescription, { provider: "Email" }))).toBeNull();
  });

  it("signs in with a code, shows the code and the address, then says who you are", async () => {
    const pending = deferred<CollabServer>();
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    codeSignInShowing(pending.promise);
    const user = userEvent.setup();
    renderDialog("https://collab.uni.edu");
    await user.click(await screen.findByRole("button", { name: copy.codeSignIn }));
    expect(mocks.collabServerCodeSignIn).toHaveBeenCalledWith(
      "https://collab.uni.edu",
      undefined,
      expect.any(Function),
    );
    expect(await screen.findByText("BCDF-GHJK")).toBeInTheDocument();
    expect(screen.getByText("https://collab.uni.edu/auth/device")).toBeInTheDocument();
    expect(screen.getByText(copy.codeSteps)).toBeInTheDocument();
    expect(screen.getByText(copy.codeWaiting)).toBeInTheDocument();
    expect(mocks.collabServerSignIn).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve(server());
      await pending.promise;
    });
    expect(
      await screen.findByText(fill(copy.doneDescription, { server: "Smith Lab", name: "Alice Chen" })),
    ).toBeInTheDocument();
    expect(useCollabStore.getState().servers).toEqual([server()]);
  });

  it("sends the setup code with a code sign-in on a new server", async () => {
    mocks.collabServerProbe.mockResolvedValue(capabilities({ needs_setup: true }));
    codeSignInShowing(new Promise(() => undefined));
    const user = userEvent.setup();
    renderDialog("https://collab.uni.edu");
    expect(await screen.findByRole("button", { name: copy.codeSignIn })).toBeDisabled();
    await user.type(screen.getByLabelText(copy.setupCodeLabel), " 4F7K-Q2ZX ");
    await user.click(screen.getByRole("button", { name: copy.codeSignIn }));
    expect(mocks.collabServerCodeSignIn).toHaveBeenCalledWith(
      "https://collab.uni.edu",
      "4F7K-Q2ZX",
      expect.any(Function),
    );
  });

  it("cancels a code sign-in and goes back to the sign-in options", async () => {
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    codeSignInShowing(new Promise(() => undefined));
    const user = userEvent.setup();
    renderDialog("https://collab.uni.edu");
    await user.click(await screen.findByRole("button", { name: copy.codeSignIn }));
    await screen.findByText("BCDF-GHJK");
    await user.click(screen.getByRole("button", { name: copy.cancel }));
    expect(mocks.collabServerSignInCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: github })).toBeEnabled();
  });

  it("explains a code that ran out or was stopped", async () => {
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    mocks.collabServerCodeSignIn.mockRejectedValueOnce(collabError("sign_in_timed_out"));
    const user = userEvent.setup();
    renderDialog("https://collab.uni.edu");
    await user.click(await screen.findByRole("button", { name: copy.codeSignIn }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.sign_in_timed_out);
    mocks.collabServerCodeSignIn.mockRejectedValueOnce(collabError("not_admitted"));
    await user.click(screen.getByRole("button", { name: copy.codeSignIn }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.not_admitted);
  });

  it("suggests a code when the browser sign-in timed out", async () => {
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    mocks.collabServerSignIn.mockRejectedValue(collabError("sign_in_timed_out"));
    const user = userEvent.setup();
    renderDialog("https://collab.uni.edu");
    await user.click(await screen.findByRole("button", { name: github }));
    expect(await screen.findByText(copy.codeHint)).toBeInTheDocument();
  });

  it("offers a code while waiting when the browser has not come back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mocks.collabServerProbe.mockResolvedValue(capabilities());
      mocks.collabServerSignIn.mockReturnValue(new Promise(() => undefined));
      codeSignInShowing(new Promise(() => undefined));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderDialog("https://collab.uni.edu");
      await user.click(await screen.findByRole("button", { name: github }));
      expect(screen.queryByText(copy.codeOffer)).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(CODE_OFFER_DELAY_MS);
      });
      expect(screen.getByText(copy.codeOffer)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: copy.codeSignIn }));
      expect(mocks.collabServerSignInCancel).toHaveBeenCalledTimes(1);
      expect(mocks.collabServerCodeSignIn).toHaveBeenCalledTimes(1);
      expect(await screen.findByText("BCDF-GHJK")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the add server header while you enter and check the address", async () => {
    mocks.collabServerProbe.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderDialog();
    expectHeader(copy.title, copy.description);
    await user.type(screen.getByLabelText(copy.addressLabel), "collab.uni.edu");
    await user.click(screen.getByRole("button", { name: copy.continue }));
    expectHeader(copy.title, copy.description);
  });

  it("names the server in the header once it is found and asks how to sign in", async () => {
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    renderDialog("https://collab.uni.edu");
    await screen.findByRole("button", { name: github });
    expectHeader(fill(copy.serverTitle, { server: "Smith Lab" }), copy.serverDescription);
  });

  it("explains setup in the header of a server nobody has signed in to, and only there", async () => {
    mocks.collabServerProbe.mockResolvedValue(capabilities({ needs_setup: true }));
    renderDialog("https://collab.uni.edu");
    await screen.findByLabelText(copy.setupCodeLabel);
    expectHeader(fill(copy.setupTitle, { server: "Smith Lab" }), copy.setupDescription);
    expect(screen.getAllByText(copy.setupDescription)).toHaveLength(1);
  });

  it("tells you to finish in the browser with the service you picked", async () => {
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    mocks.collabServerSignIn.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderDialog("https://collab.uni.edu");
    await user.click(await screen.findByRole("button", { name: github }));
    const instruction = fill(copy.waitingDescription, { provider: "GitHub" });
    expectHeader(copy.signingInTitle, instruction);
    expect(screen.getAllByText(instruction)).toHaveLength(1);
    expect(screen.getByText(copy.waitingTitle)).toBeInTheDocument();
  });

  it("puts the emailed link instructions in the header while an email sign-in waits", async () => {
    mocks.collabServerProbe.mockResolvedValue(
      capabilities({ providers: [{ id: "email-link", kind: "email_link", label: "Email" }] }),
    );
    mocks.collabServerSignIn.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderDialog("https://collab.uni.edu");
    await user.click(await screen.findByRole("button", { name: fill(copy.continueWith, { provider: "Email" }) }));
    expectHeader(copy.signingInTitle, copy.waitingEmailDescription);
    expect(screen.getAllByText(copy.waitingEmailDescription)).toHaveLength(1);
  });

  it("explains the code steps in the header of a code sign-in, and only there", async () => {
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    codeSignInShowing(new Promise(() => undefined));
    const user = userEvent.setup();
    renderDialog("https://collab.uni.edu");
    await user.click(await screen.findByRole("button", { name: copy.codeSignIn }));
    await screen.findByText("BCDF-GHJK");
    expectHeader(copy.codeTitle, copy.codeSteps);
    expect(screen.getAllByText(copy.codeSteps)).toHaveLength(1);
  });

  it("says which server you joined and who you are once connected, without repeating it", async () => {
    await signInAs(server());
    expectHeader(fill(copy.doneTitle, { server: "Smith Lab" }), fill(copy.doneDescription, { name: "Alice Chen" }));
    expect(screen.getAllByText(/Alice Chen/)).toHaveLength(1);
    expect(screen.getAllByText(/Smith Lab/)).toHaveLength(1);
    expect(screen.getByText("alice@uni.edu")).toBeInTheDocument();
  });

  it.each(["admin", "maintainer"] as const)(
    "tells a server %s they can manage it from the admin console",
    async (role) => {
      await signInAs(server({ account: account({ server_role: role }) }));
      expectHeader(
        fill(copy.doneTitle, { server: "Smith Lab" }),
        fill(copy.doneManageDescription, { name: "Alice Chen" }),
      );
    },
  );

  it("tells a guest they can open the projects they're invited to", async () => {
    await signInAs(server({ account: account({ server_role: "guest" }) }));
    expectHeader(fill(copy.doneTitle, { server: "Smith Lab" }), fill(copy.doneGuestDescription, { name: "Alice Chen" }));
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

  it("copies the code or the address and marks only the one copied", async () => {
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    codeSignInShowing(new Promise(() => undefined));
    const user = userEvent.setup();
    renderDialog("https://collab.uni.edu");
    await user.click(await screen.findByRole("button", { name: copy.codeSignIn }));
    await screen.findByText("BCDF-GHJK");
    const [addressCopy, codeCopy] = screen.getAllByRole("button", { name: enCommon.actions.copy });
    await user.click(codeCopy);
    expect(await navigator.clipboard.readText()).toBe("BCDF-GHJK");
    expect(codeCopy).toHaveAccessibleName(enCommon.actions.copied);
    expect(addressCopy).toHaveAccessibleName(enCommon.actions.copy);
    await user.click(addressCopy);
    expect(await navigator.clipboard.readText()).toBe("https://collab.uni.edu/auth/device");
    expect(addressCopy).toHaveAccessibleName(enCommon.actions.copied);
    expect(codeCopy).toHaveAccessibleName(enCommon.actions.copy);
  });

  it("does not check an address of only spaces handed in by a link", () => {
    renderDialog("   ");
    expect(mocks.collabServerProbe).not.toHaveBeenCalled();
    expectHeader(copy.title, copy.description);
    expect(screen.getByRole("button", { name: copy.continue })).toBeDisabled();
  });

  it("keeps the newest address when an older check comes back late", async () => {
    const slow = deferred<CollabCapabilities>();
    const failing = deferred<CollabCapabilities>();
    mocks.collabServerProbe.mockImplementation((url: string) => {
      if (url === "https://old.uni.edu") return slow.promise;
      if (url === "https://down.uni.edu") return failing.promise;
      return Promise.resolve(capabilities());
    });
    const onClose = vi.fn();
    const { rerender } = render(<AddServerDialog open initialUrl="https://old.uni.edu" onClose={onClose} />);
    rerender(<AddServerDialog open initialUrl="https://down.uni.edu" onClose={onClose} />);
    rerender(<AddServerDialog open initialUrl="https://collab.uni.edu" onClose={onClose} />);
    await screen.findByRole("button", { name: github });
    await act(async () => {
      slow.resolve(capabilities({ name: "Old Lab" }));
      failing.reject(collabError("unreachable"));
      await Promise.allSettled([slow.promise, failing.promise]);
    });
    expectHeader(fill(copy.serverTitle, { server: "Smith Lab" }), copy.serverDescription);
    expect(screen.queryByText("Old Lab")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays on the sign-in options when a cancelled browser sign-in finishes anyway", async () => {
    const pending = deferred<CollabServer>();
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    mocks.collabServerSignIn.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderDialog("https://collab.uni.edu");
    await user.click(await screen.findByRole("button", { name: github }));
    await user.click(screen.getByRole("button", { name: copy.cancel }));
    await act(async () => {
      pending.resolve(server());
      await pending.promise;
    });
    expect(screen.getByRole("button", { name: github })).toBeEnabled();
    expect(screen.queryByRole("button", { name: copy.done })).toBeNull();
  });

  it("drops a cancelled code sign-in, whatever it reports later", async () => {
    const codes: Array<(code: CollabSignInCode) => void> = [];
    const first = deferred<CollabServer>();
    const second = deferred<CollabServer>();
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    mocks.collabServerCodeSignIn
      .mockImplementationOnce((_url: string, _setup: string | undefined, onCode: (code: CollabSignInCode) => void) => {
        codes.push(onCode);
        return first.promise;
      })
      .mockImplementationOnce(() => second.promise);
    const user = userEvent.setup();
    renderDialog("https://collab.uni.edu");
    await user.click(await screen.findByRole("button", { name: copy.codeSignIn }));
    expect(screen.getByText(copy.codeRequesting)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.cancel }));
    await act(async () => {
      codes[0]?.(shownCode);
      first.resolve(server());
      await first.promise;
    });
    expect(screen.queryByText("BCDF-GHJK")).toBeNull();
    expect(screen.queryByRole("button", { name: copy.done })).toBeNull();
    await user.click(screen.getByRole("button", { name: copy.codeSignIn }));
    await user.click(screen.getByRole("button", { name: copy.cancel }));
    await act(async () => {
      second.reject(collabError("sign_in_timed_out"));
      await second.promise.catch(() => undefined);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: github })).toBeEnabled();
  });

  it("names the server when the sign-in comes back without an account", async () => {
    await signInAs(server({ account: null }));
    expectHeader(fill(copy.doneTitle, { server: "Smith Lab" }), fill(copy.doneDescription, { name: "Smith Lab" }));
    expect(document.querySelector('[data-slot="avatar"]')).toBeNull();
  });

  it("leaves out the account line when the account has no address or sign-in name", async () => {
    await signInAs(server({ account: account({ emails: [], logins: [] }) }));
    expectHeader(fill(copy.doneTitle, { server: "Smith Lab" }), fill(copy.doneDescription, { name: "Alice Chen" }));
    expect(document.querySelector('[data-slot="avatar"]')).toBeNull();
  });
});
