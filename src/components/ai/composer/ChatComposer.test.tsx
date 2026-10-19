// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/ai.json" with { type: "json" };
import { TREE_DRAG_TYPE } from "@/lib/tree-drag";

const mocks = vi.hoisted(() => ({
  linux: false,
  takeNativeDrop: vi.fn(),
}));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    get isLinux() {
      return mocks.linux;
    },
  };
});
vi.mock("@/lib/native-drop", () => ({ takeNativeDrop: mocks.takeNativeDrop }));

import { promptHistory, useComposerDrafts } from "@/store/composer-drafts";
import { useSettingsStore } from "@/store/settings";
import { ChatComposer, type ChatComposerHandle, type ChatComposerProps } from "./ChatComposer";

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

type Props = Partial<ChatComposerProps>;

function Harness(props: Props & { initial?: string; handleRef?: React.Ref<ChatComposerHandle> }) {
  const { initial = "", handleRef, ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <ChatComposer
      ref={handleRef}
      composerId="p1:builtin"
      value={value}
      onChange={setValue}
      onSubmit={vi.fn()}
      placeholder={"Ask AI"}
      attachments={[]}
      {...rest}
    />
  );
}

function textarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText("Ask AI") as HTMLTextAreaElement;
}

function dataTransfer(types: string[], data: Record<string, string> = {}, files: File[] = []) {
  return {
    types,
    files,
    effectAllowed: "all",
    dropEffect: "none",
    getData: (type: string) => data[type] ?? "",
  };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ObserverStub);
  localStorage.clear();
  useComposerDrafts.setState({ drafts: {} });
  useSettingsStore.setState({ aiComposerHeight: 56 });
  mocks.linux = false;
  mocks.takeNativeDrop.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatComposer", () => {
  it("sends on Enter and keeps Shift+Enter as a newline", () => {
    const onSubmit = vi.fn();
    render(<Harness initial="hello" onSubmit={onSubmit} />);
    fireEvent.keyDown(textarea(), { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("does not send the Enter that confirms an IME composition", () => {
    const onSubmit = vi.fn();
    render(<Harness initial="翻訳" onSubmit={onSubmit} />);
    fireEvent.keyDown(textarea(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(textarea(), { key: "Enter", keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("queues on Enter while busy and offers Stop instead of Send", () => {
    const onQueue = vi.fn();
    const onStop = vi.fn();
    render(<Harness initial="next" busy onQueue={onQueue} onStop={onStop} />);
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(onQueue).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: en.composer.stop }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: en.composer.send })).not.toBeInTheDocument();
  });

  it("lets the user type while sending is disabled", () => {
    const onSubmit = vi.fn();
    render(<Harness disabled onSubmit={onSubmit} />);
    expect(textarea()).not.toBeDisabled();
    fireEvent.change(textarea(), { target: { value: "typed" } });
    expect(textarea()).toHaveValue("typed");
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: en.composer.send })).toBeDisabled();
  });

  it("waits for attachments that are still being prepared", () => {
    const onSubmit = vi.fn();
    render(
      <Harness
        initial="look"
        onSubmit={onSubmit}
        attachments={[{ id: "a", name: "a.png", mime: "image/png", size: 1, status: "processing" }]}
      />,
    );
    expect(screen.getByRole("button", { name: en.composer.send })).toBeDisabled();
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("recalls earlier prompts with Up in an empty box and Down walks back", () => {
    render(<Harness history={["one", "two"]} />);
    fireEvent.keyDown(textarea(), { key: "ArrowUp" });
    expect(textarea()).toHaveValue("two");
    fireEvent.keyDown(textarea(), { key: "ArrowUp" });
    expect(textarea()).toHaveValue("one");
    fireEvent.keyDown(textarea(), { key: "ArrowDown" });
    expect(textarea()).toHaveValue("two");
    fireEvent.keyDown(textarea(), { key: "ArrowDown" });
    expect(textarea()).toHaveValue("");
  });

  it("remembers what was sent for the project", () => {
    render(<Harness initial="  summarize section 2 " />);
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(promptHistory("p1:builtin").at(-1)).toBe("summarize section 2");
  });

  it("attaches pasted screenshots and leaves pasted text to the textarea", () => {
    const onAddFiles = vi.fn();
    render(<Harness onAddFiles={onAddFiles} />);
    const shot = new File([new Uint8Array([1])], "image.png", { type: "image/png" });
    const pasted = fireEvent.paste(textarea(), { clipboardData: { types: ["Files"], files: [shot] } });
    expect(pasted).toBe(false);
    expect(onAddFiles).toHaveBeenCalledWith([shot]);
    onAddFiles.mockClear();
    fireEvent.paste(textarea(), {
      clipboardData: { types: ["text/plain", "Files"], files: [shot], getData: () => "x" },
    });
    expect(onAddFiles).not.toHaveBeenCalled();
  });

  it("attaches files dropped from the computer before the window drop guard can refuse them", () => {
    const onAddFiles = vi.fn();
    const { container } = render(<Harness onAddFiles={onAddFiles} />);
    const root = container.querySelector("[data-chat-composer]") as HTMLElement;
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    const transfer = dataTransfer(["Files"], {}, [file]);
    expect(fireEvent.dragOver(root, { dataTransfer: transfer })).toBe(false);
    expect(fireEvent.drop(root, { dataTransfer: transfer })).toBe(false);
    expect(onAddFiles).toHaveBeenCalledWith([file]);
  });

  it("mentions a file dragged from the project tree, Windows paths included", () => {
    const onDropProjectPaths = vi.fn();
    const { container } = render(<Harness onDropProjectPaths={onDropProjectPaths} />);
    const root = container.querySelector("[data-chat-composer]") as HTMLElement;
    fireEvent.drop(root, {
      dataTransfer: dataTransfer([TREE_DRAG_TYPE, "text/plain"], {
        [TREE_DRAG_TYPE]: "figures\\plot one.png",
      }),
    });
    expect(onDropProjectPaths).toHaveBeenCalledWith(["figures/plot one.png"]);
  });

  it("accepts a tree drag whose source allows only moving", () => {
    const { container } = render(<Harness onDropProjectPaths={vi.fn()} />);
    const root = container.querySelector("[data-chat-composer]") as HTMLElement;
    const transfer = { ...dataTransfer([TREE_DRAG_TYPE]), effectAllowed: "move" };
    expect(fireEvent.dragOver(root, { dataTransfer: transfer })).toBe(false);
    expect(transfer.dropEffect).toBe("move");
  });

  it("reads Linux file drops through the native drop bridge", async () => {
    mocks.linux = true;
    const file = new File(["x"], "data.csv", { type: "text/csv" });
    mocks.takeNativeDrop.mockResolvedValue([{ name: "data.csv", read: async () => file }]);
    const onAddFiles = vi.fn();
    const { container } = render(<Harness onAddFiles={onAddFiles} />);
    const root = container.querySelector("[data-chat-composer]") as HTMLElement;
    fireEvent.drop(root, { dataTransfer: dataTransfer(["text/uri-list"]) });
    await waitFor(() => expect(onAddFiles).toHaveBeenCalledWith([file]));
  });

  it("runs an action command and inserts a skill from the slash menu", async () => {
    const onSlashSelect = vi.fn();
    render(
      <Harness
        initial="/"
        onSlashSelect={onSlashSelect}
        slashItems={[
          { id: "archive", label: "Archive chat", description: "Move it out of the list" },
          { id: "skill:lit", label: "Literature sweep", insertText: "/lit-sweep ", command: "lit-sweep" },
        ]}
      />,
    );
    fireEvent.click(await screen.findByText("Literature sweep"));
    expect(textarea()).toHaveValue("/lit-sweep ");
    expect(onSlashSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: "skill:lit" }));
    fireEvent.change(textarea(), { target: { value: "/" } });
    fireEvent.click(await screen.findByText("Archive chat"));
    expect(textarea()).toHaveValue("");
    expect(onSlashSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: "archive" }));
  });

  it("takes focus back after a command that inserts text, but not from a picker an action opened", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    const picker = document.createElement("button");
    document.body.append(picker);
    render(
      <Harness
        initial="/"
        onSlashSelect={(item) => {
          if (item.id === "model") picker.focus();
        }}
        slashItems={[
          { id: "model", label: "Change model", description: "Opens the model picker" },
          { id: "skill:lit", label: "Literature sweep", insertText: "/lit-sweep ", command: "lit-sweep" },
        ]}
      />,
    );
    fireEvent.click(await screen.findByText("Change model"));
    expect(picker).toHaveFocus();
    fireEvent.change(textarea(), { target: { value: "/" } });
    fireEvent.click(await screen.findByText("Literature sweep"));
    expect(textarea()).toHaveFocus();
    picker.remove();
  });

  it("says the box is expanded only while a slash or mention menu shows", async () => {
    const { unmount } = render(
      <Harness
        initial="/zzz"
        slashItems={[{ id: "skill:lit", label: "Literature sweep", insertText: "/lit-sweep ", command: "lit-sweep" }]}
      />,
    );
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(textarea()).toHaveAttribute("aria-expanded", "false");
    expect(textarea()).not.toHaveAttribute("aria-controls");
    expect(textarea()).not.toHaveAttribute("aria-activedescendant");

    fireEvent.change(textarea(), { target: { value: "/lit" } });
    expect(await screen.findByRole("listbox")).toHaveAttribute("id", "ai-slash-command-menu");
    expect(textarea()).toHaveAttribute("aria-expanded", "true");
    expect(textarea()).toHaveAttribute("aria-controls", "ai-slash-command-menu");
    await waitFor(() => expect(textarea()).toHaveAttribute("aria-activedescendant", "ai-slash-command-skill:lit"));
    unmount();

    render(
      <Harness initial="see @ma" mentionItems={() => [{ id: "main", label: "main.tex", kind: "file", path: "main.tex" }]} />,
    );
    fireEvent.select(textarea(), { target: { selectionStart: 7, selectionEnd: 7 } });
    expect(await screen.findByRole("listbox")).toHaveAttribute("id", "ai-mention-menu");
    expect(textarea()).toHaveAttribute("aria-expanded", "true");
    expect(textarea()).toHaveAttribute("aria-controls", "ai-mention-menu");
  });

  it("closes the slash menu once a command is followed by a space", () => {
    render(
      <Harness
        initial="/lit-sweep x"
        slashItems={[{ id: "skill:lit", label: "Literature sweep", insertText: "/lit-sweep ", command: "lit-sweep" }]}
      />,
    );
    expect(screen.queryByText("Literature sweep")).not.toBeInTheDocument();
  });

  it("inserts a mention at the @ token, from sync and async providers", async () => {
    const onMentionSelect = vi.fn();
    const items = [{ id: "main", label: "main.tex", kind: "file" as const, path: "main.tex" }];
    const { unmount } = render(
      <Harness initial="see @ma" mentionItems={() => items} onMentionSelect={onMentionSelect} />,
    );
    fireEvent.select(textarea(), { target: { selectionStart: 7, selectionEnd: 7 } });
    fireEvent.click(await screen.findByText("main.tex"));
    expect(textarea()).toHaveValue("see @main.tex ");
    expect(onMentionSelect).toHaveBeenCalledWith(items[0]);
    unmount();

    render(<Harness initial="@ag" mentionItems={async () => [{ id: "codex", label: "Codex", kind: "agent", detail: "CLI agent" }]} />);
    fireEvent.select(textarea(), { target: { selectionStart: 3, selectionEnd: 3 } });
    fireEvent.click(await screen.findByText("Codex"));
    expect(textarea()).toHaveValue("@codex ");
  });

  it("opens the file picker through its handle", () => {
    const ref = createRef<ChatComposerHandle>();
    const { container } = render(<Harness handleRef={ref} onAddFiles={vi.fn()} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    act(() => ref.current?.openFilePicker());
    expect(click).toHaveBeenCalledOnce();
  });

  it("keeps the controls row a size container with the expected test ids", () => {
    render(<Harness controls={<span>{"left"}</span>} trailingControls={<span>{"right"}</span>} />);
    const row = screen.getByTestId("ai-composer-controls");
    expect(row.className).toContain("[container-type:inline-size]");
    expect(screen.getByTestId("ai-composer-controls-left")).toHaveTextContent("left");
    expect(screen.getByTestId("ai-composer-controls-right")).toHaveTextContent("right");
  });

  it("never goes past 60% of the panel or below two lines", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    render(<Harness />);
    const handle = screen.getByRole("separator", { name: en.composer.resizeHandle });
    expect(handle).toHaveAttribute("aria-valuemax", "480");
    fireEvent.pointerDown(handle, { button: 0, clientY: 900, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(useSettingsStore.getState().aiComposerHeight).toBe(480);
    fireEvent.doubleClick(handle);
    expect(useSettingsStore.getState().aiComposerHeight).toBe(56);
  });
});
