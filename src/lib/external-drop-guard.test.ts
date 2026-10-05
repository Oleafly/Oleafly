// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { carriesFilePaths, carriesFiles, installExternalDropGuard } from "./external-drop-guard";

function drag(type: "dragenter" | "dragover" | "drop", target: Element, types: string[]) {
  const transfer = { types, dropEffect: "copy" };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  target.dispatchEvent(event);
  return { event, transfer };
}

let uninstall: () => void;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="tree"><span id="row">main.tex</span></div>
    <div contenteditable="true"><p id="editor">text</p></div>
    <textarea id="field"></textarea>
    <div id="zone"></div>
  `;
  uninstall = installExternalDropGuard(window);
});

afterEach(() => {
  uninstall();
  document.body.innerHTML = "";
});

const element = (id: string) => document.getElementById(id) as HTMLElement;

describe("installExternalDropGuard", () => {
  it("refuses a file dragged over a surface that does not take it, so the window never navigates to it", () => {
    const over = drag("dragover", element("row"), ["Files"]);
    expect(over.event.defaultPrevented).toBe(true);
    expect(over.transfer.dropEffect).toBe("none");

    const drop = drag("drop", element("row"), ["Files", "text/uri-list"]);
    expect(drop.event.defaultPrevented).toBe(true);
  });

  it("refuses a file as soon as it enters a surface, since WebKitGTK may drop before the next dragover", () => {
    const enter = drag("dragenter", element("row"), ["text/uri-list", "text/html"]);
    expect(enter.event.defaultPrevented).toBe(true);
    expect(enter.transfer.dropEffect).toBe("none");

    expect(drag("dragenter", element("editor"), ["Files"]).event.defaultPrevented).toBe(false);
  });

  it("refuses a dropped link outside text fields", () => {
    expect(drag("dragover", element("tree"), ["text/uri-list"]).event.defaultPrevented).toBe(true);
    expect(drag("drop", element("tree"), ["text/uri-list"]).event.defaultPrevented).toBe(true);
  });

  it("leaves rich editors to handle their own drops, files included", () => {
    expect(drag("dragover", element("editor"), ["Files"]).event.defaultPrevented).toBe(false);
    expect(drag("drop", element("editor"), ["Files"]).event.defaultPrevented).toBe(false);
  });

  it("lets text fields take dropped text but not files", () => {
    expect(drag("dragover", element("field"), ["text/plain"]).event.defaultPrevented).toBe(false);
    expect(drag("drop", element("field"), ["text/plain"]).event.defaultPrevented).toBe(false);
    expect(drag("dragover", element("field"), ["Files"]).event.defaultPrevented).toBe(true);
  });

  it("keeps the drop effect a drop zone already chose", () => {
    element("zone").addEventListener("dragover", (event) => {
      event.preventDefault();
      const transfer = (event as DragEvent).dataTransfer;
      if (transfer) transfer.dropEffect = "copy";
    });
    const over = drag("dragover", element("zone"), ["Files"]);
    expect(over.event.defaultPrevented).toBe(true);
    expect(over.transfer.dropEffect).toBe("copy");
  });

  it("stops guarding once uninstalled", () => {
    uninstall();
    expect(drag("dragover", element("row"), ["Files"]).event.defaultPrevented).toBe(false);
    uninstall = () => {};
  });
});

describe("carriesFiles", () => {
  it("recognises a drag that carries files", () => {
    expect(carriesFiles({ types: ["Files", "text/uri-list"] } as unknown as DataTransfer)).toBe(true);
    expect(carriesFiles({ types: ["text/plain"] } as unknown as DataTransfer)).toBe(false);
    expect(carriesFiles(null)).toBe(false);
  });
});

describe("carriesFilePaths", () => {
  it("recognises the link list WebKitGTK passes for files dropped from a Linux file manager", () => {
    const links = { types: ["text/uri-list", "text/html"] } as unknown as DataTransfer;
    expect(carriesFilePaths(links, true)).toBe(true);
    expect(carriesFilePaths(links, false)).toBe(false);
    expect(carriesFilePaths({ types: ["text/plain"] } as unknown as DataTransfer, true)).toBe(false);
    expect(carriesFilePaths(null, true)).toBe(false);
  });
});
