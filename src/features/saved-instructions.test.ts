// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/tauri";

const tauri = vi.hoisted(() => ({
  getConfig: vi.fn(async (): Promise<AppConfig> => ({}) as AppConfig),
  setConfig: vi.fn(async (_config: AppConfig) => {}),
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...tauri,
}));

import { knownProviderConfig, resetProviderConfigCache } from "@/components/ai/provider-config";
import { SAVED_INSTRUCTION_LIMITS } from "@/lib/saved-instructions";
import { addSavedInstruction, recordSavedInstructionUse } from "./saved-instructions";

const keep = { id: "keep", name: "Keep formatting", text: "Keep the formatting." };
const quotes = { id: "quotes", name: "Quotes", text: "Don't change quoted text." };

function stored(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ai_provider: "openai",
    ai_system_prompt: "Written elsewhere",
    ai_saved_instructions: [keep, quotes],
    ...overrides,
  } as AppConfig;
}

const events: CustomEvent[] = [];
const listen = (event: Event) => events.push(event as CustomEvent);

beforeEach(() => {
  vi.clearAllMocks();
  events.length = 0;
  resetProviderConfigCache();
  window.addEventListener("oleafly:ai-config-changed", listen);
});

afterEach(() => {
  window.removeEventListener("oleafly:ai-config-changed", listen);
});

describe("addSavedInstruction", () => {
  it("appends to the settings as they are now and announces the change", async () => {
    tauri.getConfig.mockResolvedValue(stored());

    const added = await addSavedInstruction("  Formal ", " Use a formal tone. ");

    expect(added).toMatchObject({ name: "Formal", text: "Use a formal tone." });
    const written = tauri.setConfig.mock.calls[0][0];
    expect(written.ai_system_prompt).toBe("Written elsewhere");
    expect(written.ai_saved_instructions).toEqual([keep, quotes, added]);
    expect(events).toHaveLength(1);
    expect(events[0].detail).toBe(written);
  });

  it("writes nothing for a blank instruction or a full list", async () => {
    tauri.getConfig.mockResolvedValue(stored());
    await expect(addSavedInstruction("Name", "   ")).resolves.toBeNull();
    const full = Array.from({ length: SAVED_INSTRUCTION_LIMITS.count }, (_, index) => ({
      id: `n${index}`,
      name: `n${index}`,
      text: "t",
    }));
    tauri.getConfig.mockResolvedValue(stored({ ai_saved_instructions: full }));
    await expect(addSavedInstruction("Name", "Text")).resolves.toBeNull();
    expect(tauri.setConfig).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

describe("recordSavedInstructionUse", () => {
  it("counts each picked instruction once and drops counts for deleted ones", async () => {
    tauri.getConfig.mockResolvedValue(stored({ ai_saved_instruction_uses: { keep: 2, deleted: 9 } }));

    await recordSavedInstructionUse(["keep", "quotes", "keep", "unknown"]);

    const written = tauri.setConfig.mock.calls[0][0];
    expect(written.ai_saved_instruction_uses).toEqual({ keep: 3, quotes: 1 });
    expect(written.ai_system_prompt).toBe("Written elsewhere");
  });

  it("updates open views without announcing a settings change to sync", async () => {
    tauri.getConfig.mockResolvedValue(stored());

    await recordSavedInstructionUse(["quotes"]);

    expect(events).toEqual([]);
    expect(knownProviderConfig()?.ai_saved_instruction_uses).toEqual({ quotes: 1 });
  });

  it("writes nothing when no picked instruction still exists", async () => {
    tauri.getConfig.mockResolvedValue(stored());
    await recordSavedInstructionUse([]);
    await recordSavedInstructionUse(["gone"]);
    expect(tauri.setConfig).not.toHaveBeenCalled();
  });
});
