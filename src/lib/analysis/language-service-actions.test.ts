import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LANGUAGE_SERVICE_SETUP_FAILURE_REASON,
  registerLanguageServiceLifecycleActions,
  retryActiveLanguageService,
  setupActiveLanguageService,
} from "./language-service-actions";

const cleanups: Array<() => void> = [];

function register(setup: () => Promise<void> | void = () => {}) {
  const actions = { retry: vi.fn(), setup: vi.fn(setup) };
  const unregister = registerLanguageServiceLifecycleActions(actions);
  cleanups.push(unregister);
  return { actions, unregister };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("language-service lifecycle actions", () => {
  it("routes retry and setup to the registered lifecycle owner", async () => {
    const { actions } = register(async () => {});
    retryActiveLanguageService();
    await setupActiveLanguageService();
    expect(actions.retry).toHaveBeenCalledTimes(1);
    expect(actions.setup).toHaveBeenCalledTimes(1);
  });

  it("replaces backend setup errors with one stable message", async () => {
    register(async () => {
      throw new Error("signed-url=secret /Users/private");
    });
    await expect(setupActiveLanguageService()).rejects.toThrow(
      new Error(LANGUAGE_SERVICE_SETUP_FAILURE_REASON),
    );
  });

  it("fails setup and ignores retry when no owner is registered", async () => {
    const { actions, unregister } = register();
    unregister();
    retryActiveLanguageService();
    expect(actions.retry).not.toHaveBeenCalled();
    await expect(setupActiveLanguageService()).rejects.toThrow(
      LANGUAGE_SERVICE_SETUP_FAILURE_REASON,
    );
  });

  it("keeps a newer owner when an older registration is removed", () => {
    const older = register();
    const newer = register();
    older.unregister();
    retryActiveLanguageService();
    expect(older.actions.retry).not.toHaveBeenCalled();
    expect(newer.actions.retry).toHaveBeenCalledTimes(1);
  });
});
