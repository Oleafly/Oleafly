// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { ConfirmHost } from "@/components/ui/confirm-host";
import { confirmAction, useConfirmDialogStore } from "@/store/confirm-dialog";

const QUESTION = "Delete notes.tex?";
let crashDialog = false;

vi.mock("@/components/ui/confirmation-dialog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/confirmation-dialog")>();
  return {
    ...actual,
    ConfirmationDialog: (props: ComponentProps<typeof actual.ConfirmationDialog>) => {
      if (crashDialog) throw new Error("dialog broke");
      return <actual.ConfirmationDialog {...props} />;
    },
  };
});
const originalConfirm = window.confirm;

// What tauri-plugin-dialog installs in every webview: an async function, so
// its answer is a Promise, truthy before the user could say anything.
function installPluginConfirm(): string[] {
  const calls: string[] = [];
  window.confirm = async function pluginConfirm(message?: string) {
    calls.push(String(message));
    throw new Error("Command plugin:dialog|confirm not allowed");
  } as unknown as typeof window.confirm;
  return calls;
}

function dialogButton(label: string): HTMLElement {
  const dialog = screen.getByRole("alertdialog");
  const button = within(dialog)
    .getAllByRole("button")
    .find((candidate) => candidate.textContent?.trim().startsWith(label));
  if (!button) throw new Error(`no "${label}" button in ${dialog.textContent}`);
  return button;
}

function ask(request: Parameters<typeof confirmAction>[0]): Promise<boolean> {
  let answer: Promise<boolean> = Promise.resolve(false);
  act(() => {
    answer = confirmAction(request);
  });
  return answer;
}

afterEach(() => {
  window.confirm = originalConfirm;
  vi.restoreAllMocks();
  useConfirmDialogStore.setState({ queue: [] });
  crashDialog = false;
});

describe("confirmAction", () => {
  it("takes a synchronous confirm's answer", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await expect(confirmAction({ message: QUESTION })).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledWith(QUESTION);
    expect(useConfirmDialogStore.getState().queue).toEqual([]);
  });

  it("asks in the app's dialog when the dialog plugin replaced confirm", async () => {
    const calls = installPluginConfirm();
    render(<ConfirmHost />);
    const answer = ask({ message: QUESTION, confirmLabel: "Delete", destructive: true });
    expect(await screen.findByText(QUESTION)).toBeTruthy();
    expect(calls).toEqual([]);
    fireEvent.click(dialogButton("Delete"));
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByText(QUESTION)).toBeNull();
  });

  it("treats backing out of the app's dialog as no", async () => {
    installPluginConfirm();
    render(<ConfirmHost />);
    const answer = ask({ message: QUESTION });
    await screen.findByText(QUESTION);
    fireEvent.click(dialogButton("Cancel"));
    await expect(answer).resolves.toBe(false);
  });

  it("does not take a Promise from another replacement as a yes", async () => {
    const confirm = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => Promise.reject(new Error("denied")) as unknown as boolean);
    const answer = confirmAction({ message: QUESTION });
    const [pending] = useConfirmDialogStore.getState().queue;
    expect(confirm).toHaveBeenCalledOnce();
    expect(pending?.message).toBe(QUESTION);
    pending?.settle(false);
    await expect(answer).resolves.toBe(false);
  });

  it("asks one question at a time, oldest first", async () => {
    installPluginConfirm();
    render(<ConfirmHost />);
    const first = ask({ message: "First?" });
    const second = ask({ message: "Second?" });
    await screen.findByText("First?");
    expect(screen.queryByText("Second?")).toBeNull();
    fireEvent.click(dialogButton("Cancel"));
    await expect(first).resolves.toBe(false);
    await screen.findByText("Second?");
    fireEvent.click(dialogButton("Confirm"));
    await expect(second).resolves.toBe(true);
  });

  it("answers no when the dialog crashes, so the next question still shows", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    installPluginConfirm();
    render(<ConfirmHost />);
    crashDialog = true;
    const first = ask({ message: "First?" });
    await expect(first).resolves.toBe(false);

    crashDialog = false;
    const second = ask({ message: "Second?" });
    await screen.findByText("Second?");
    fireEvent.click(dialogButton("Confirm"));
    await expect(second).resolves.toBe(true);
  });
});
