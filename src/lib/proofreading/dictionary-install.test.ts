import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetProgress } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  installDictionary: vi.fn(),
  withAssetProgress: vi.fn(),
  refreshDictionaryCatalog: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  installDictionary: mocks.installDictionary,
  withAssetProgress: mocks.withAssetProgress,
}));

vi.mock("./dictionary-catalog", () => ({
  refreshDictionaryCatalog: mocks.refreshDictionaryCatalog,
}));

import { dictionaryComponentId, installDictionaryPack } from "./dictionary-install";

function progress(component: string, done: number): AssetProgress {
  return { component, done, total: 10 } as unknown as AssetProgress;
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.installDictionary.mockReset();
  mocks.withAssetProgress.mockReset();
  mocks.refreshDictionaryCatalog.mockReset();
  mocks.installDictionary.mockImplementation(async (locale: string) => {
    mocks.calls.push(`install:${locale}`);
  });
  mocks.refreshDictionaryCatalog.mockImplementation(async () => {
    mocks.calls.push("refresh");
  });
});

describe("installDictionaryPack", () => {
  it("names the progress component after the locale", () => {
    expect(dictionaryComponentId("cs_CZ")).toBe("dictionary:cs_CZ");
  });

  it("installs and then refreshes the catalog without a progress listener", async () => {
    await installDictionaryPack("cs_CZ");

    expect(mocks.withAssetProgress).not.toHaveBeenCalled();
    expect(mocks.calls).toEqual(["install:cs_CZ", "refresh"]);
  });

  it("forwards only this pack's progress to the listener", async () => {
    mocks.withAssetProgress.mockImplementation(
      async (
        listeners: { component: (event: AssetProgress) => void },
        run: () => Promise<void>,
      ) => {
        listeners.component(progress("dictionary:de_DE", 1));
        listeners.component(progress("dictionary:cs_CZ", 4));
        listeners.component(progress("tinytex", 2));
        await run();
      },
    );
    const onProgress = vi.fn();

    await installDictionaryPack("cs_CZ", onProgress);

    expect(onProgress.mock.calls).toEqual([[progress("dictionary:cs_CZ", 4)]]);
    expect(mocks.calls).toEqual(["install:cs_CZ", "refresh"]);
  });

  it("does not refresh the catalog when the install fails", async () => {
    mocks.installDictionary.mockRejectedValue(new Error("offline"));

    await expect(installDictionaryPack("cs_CZ")).rejects.toThrow("offline");
    expect(mocks.refreshDictionaryCatalog).not.toHaveBeenCalled();
  });
});
