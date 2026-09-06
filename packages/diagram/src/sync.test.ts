import { describe, expect, it } from "vitest";
import type { DiagramModel } from "@oleafly/latex";
import {
  drawnSync,
  emptySync,
  readSync,
  shouldPublishModel,
  shouldReadCode,
  shouldWriteCode,
  sourceToCompile,
  typedSync,
} from "./sync";

const drawn: DiagramModel = {
  version: 1,
  nodes: [{ id: "a", shape: "rectangle", x: 0, y: 0, w: 80, h: 40, label: "A" }],
  edges: [],
};

const blank: DiagramModel = { version: 1, nodes: [], edges: [] };

describe("shouldReadCode", () => {
  it("reads a buffer the canvas did not write", () => {
    expect(shouldReadCode({ ...emptySync(), codeDirty: true }, "\\node (a) {A};")).toBe(true);
  });

  it("leaves a buffer the canvas generated alone", () => {
    expect(shouldReadCode(emptySync(), "\\node (a) {A};")).toBe(false);
  });

  it("does not read the same buffer twice, so canvas edits survive a tab flip", () => {
    const sync = readSync("\\node (a) {A};", drawn);
    expect(shouldReadCode(sync, "\\node (a) {A};")).toBe(false);
    expect(shouldReadCode(sync, "\\node (a) {B};")).toBe(true);
  });

  it("never re-reads the buffer once the canvas has moved ahead of it", () => {
    const sync = drawnSync(readSync("\\node (a) {A};", drawn));
    expect(shouldReadCode(sync, "\\node (a) {B};")).toBe(false);
  });
});

describe("shouldWriteCode", () => {
  it("mirrors the canvas into the buffer it owns", () => {
    expect(shouldWriteCode(emptySync(), true)).toBe(true);
  });

  it("never writes over hand-written source", () => {
    expect(shouldWriteCode({ ...emptySync(), codeDirty: true }, true)).toBe(false);
  });

  it("writes once the canvas has been edited, even over adopted source", () => {
    expect(shouldWriteCode(drawnSync(readSync("hand", drawn)), true)).toBe(true);
  });

  it("has nothing to write with an empty canvas", () => {
    expect(shouldWriteCode(emptySync(), false)).toBe(false);
  });
});

describe("shouldPublishModel", () => {
  it("ignores a re-emit of the model just read out of the code", () => {
    const sync = readSync("x", drawn);
    expect(shouldPublishModel(sync, { ...drawn, nodes: [{ ...drawn.nodes[0] }] })).toBe(false);
  });

  it("publishes once the canvas actually differs", () => {
    const sync = readSync("x", drawn);
    expect(shouldPublishModel(sync, { ...drawn, nodes: [{ ...drawn.nodes[0], x: 200 }] })).toBe(true);
  });

  it("publishes when nothing was adopted", () => {
    expect(shouldPublishModel(emptySync(), drawn)).toBe(true);
  });
});

describe("sourceToCompile", () => {
  it("compiles the drawing when the canvas owns the buffer", () => {
    expect(sourceToCompile(emptySync(), "draw", drawn, "stale")).toContain("\\node (a)");
  });

  it("compiles exactly what the user wrote when they wrote it", () => {
    const sync = readSync("hand", drawn);
    expect(sourceToCompile(sync, "draw", drawn, "hand")).toBe("hand");
    expect(sourceToCompile(sync, "code", drawn, "hand")).toBe("hand");
  });

  it("compiles the drawing while a canvas edit is still waiting to be written out", () => {
    const sync = drawnSync(readSync("hand", drawn));
    expect(sourceToCompile(sync, "draw", drawn, "hand")).toContain("\\node (a)");
    expect(sourceToCompile(sync, "code", drawn, "hand")).toContain("\\node (a)");
  });

  it("hands the buffer back to the typist", () => {
    const sync = typedSync(drawnSync(emptySync()));
    expect(sourceToCompile(sync, "code", drawn, "typed")).toBe("typed");
  });

  it("compiles the buffer when there is no drawing", () => {
    expect(sourceToCompile(emptySync(), "draw", blank, "only code")).toBe("only code");
  });
});
