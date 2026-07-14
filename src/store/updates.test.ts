import { describe, it, expect, beforeEach } from "vitest";
import type { Update } from "@tauri-apps/plugin-updater";
import { useUpdatesStore } from "./updates";

const fakeUpdate = (version: string) => ({ version }) as unknown as Update;

beforeEach(() => {
  useUpdatesStore.setState({
    available: null,
    version: null,
    lastCheckAt: null,
    lastCheckFailed: false,
    dismissed: [],
  });
});

describe("updates store", () => {
  it("setAvailable records the update, version, timestamp, and clears a prior failure", () => {
    useUpdatesStore.setState({ lastCheckFailed: true });
    useUpdatesStore.getState().setAvailable(fakeUpdate("0.2.0"));
    const s = useUpdatesStore.getState();
    expect(s.available?.version).toBe("0.2.0");
    expect(s.version).toBe("0.2.0");
    expect(s.lastCheckFailed).toBe(false);
    expect(typeof s.lastCheckAt).toBe("number");
  });

  it("setFailed flags the last check as failed with a timestamp and shows no prompt", () => {
    useUpdatesStore.getState().setFailed();
    const s = useUpdatesStore.getState();
    expect(s.lastCheckFailed).toBe(true);
    expect(typeof s.lastCheckAt).toBe("number");
    expect(s.available).toBeNull();
  });

  it("setUpToDate clears both the failure flag and any available prompt", () => {
    useUpdatesStore.setState({ lastCheckFailed: true, available: fakeUpdate("0.2.0") });
    useUpdatesStore.getState().setUpToDate();
    const s = useUpdatesStore.getState();
    expect(s.lastCheckFailed).toBe(false);
    expect(s.available).toBeNull();
  });

  it("dismiss hides the prompt and suppresses re-prompting for that same version only", () => {
    useUpdatesStore.getState().setAvailable(fakeUpdate("0.2.0"));
    useUpdatesStore.getState().dismiss();
    expect(useUpdatesStore.getState().available).toBeNull();

    useUpdatesStore.getState().setAvailable(fakeUpdate("0.2.0"));
    expect(useUpdatesStore.getState().available).toBeNull();

    useUpdatesStore.getState().setAvailable(fakeUpdate("0.3.0"));
    expect(useUpdatesStore.getState().available?.version).toBe("0.3.0");
  });
});
