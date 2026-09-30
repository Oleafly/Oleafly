import { describe, expect, it } from "vitest";
import { installUiDom } from "./ui-fixtures";

describe("installUiDom", () => {
  it("lets a render the last test queued finish before it removes the DOM", async () => {
    const { restore } = installUiDom();
    const { createElement, useState } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    let setLabel: (label: string) => void = () => {};
    function Label() {
      const [label, set] = useState("first");
      setLabel = set;
      return createElement("span", null, label);
    }
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => createRoot(container).render(createElement(Label)));

    const uncaught: unknown[] = [];
    const record = (error: unknown) => uncaught.push(error);
    process.on("uncaughtException", record);
    try {
      // Outside act, React queues this render on setImmediate, the way a
      // promise that settles as a test ends does.
      setLabel("second");
      await restore();
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("uncaughtException", record);
    }
    expect(uncaught).toEqual([]);
  });
});
