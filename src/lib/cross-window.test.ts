import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/event", () => ({ emit: mocks.emit }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main-window" }),
}));

import {
  COMPILE_SUCCEEDED_EVENT,
  createCompileSuccessCheckpoint,
  fingerprintCompileOutput,
} from "./compile-checkpoint";
import {
  currentCompileProducerId,
  notifyCompileSucceeded,
} from "./cross-window";
import { currentProjectStateRevision } from "./project-state-revision";

beforeEach(() => {
  mocks.emit.mockReset().mockResolvedValue(undefined);
  mocks.isTauri.mockReturnValue(true);
});

describe("cross-window compile events", () => {
  it("emits the versioned success-only payload on its dedicated event", () => {
    const checkpoint = createCompileSuccessCheckpoint({
      projectId: "project",
      mainDocument: "main.tex",
      outputKind: "standard",
      producerId: currentCompileProducerId(),
      outputRevision: 2,
      outputId: fingerprintCompileOutput(new Uint8Array([1, 2])),
      previousCompletedAt: null,
      now: 100,
    });

    notifyCompileSucceeded(checkpoint);

    expect(mocks.emit).toHaveBeenCalledTimes(1);
    expect(mocks.emit).toHaveBeenCalledWith(
      COMPILE_SUCCEEDED_EVENT,
      {
        projectStateRevision: currentProjectStateRevision(),
        checkpoint,
      },
    );
    expect(COMPILE_SUCCEEDED_EVENT).not.toBe("compile:done");
  });

  it("does not emit outside the Tauri multi-window runtime", () => {
    mocks.isTauri.mockReturnValue(false);
    const checkpoint = createCompileSuccessCheckpoint({
      projectId: "project",
      mainDocument: "main.tex",
      outputKind: "standard",
      producerId: currentCompileProducerId(),
      outputRevision: 1,
      outputId: fingerprintCompileOutput(new Uint8Array([1])),
      previousCompletedAt: null,
      now: 100,
    });
    notifyCompileSucceeded(checkpoint);
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
