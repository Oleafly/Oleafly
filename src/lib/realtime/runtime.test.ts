import { describe, expect, it } from "vitest";
import type {
  DurableReceiptV1,
  FileId,
  ReplicaId,
  ServerInstanceId,
  ServerProfileId,
  SharedProjectId,
} from "@oleafly/realtime-protocol";
import type {
  DesktopSharedProjectBinding,
  MaterializationBatch,
  OpenSessionInput,
  PersistedMutation,
  RealtimeBindingIdentity,
  RealtimeDesktopPort,
  RealtimeTransportEvent,
  SessionHandle,
} from "./desktop-port";
import { RealtimeRuntime, type ExperimentalRealtimeConfig } from "./runtime";

const INSTANCE = "1134c268-3f07-4361-b5c0-0bede22fb36b" as ServerInstanceId;
const PROJECT = "0198cf35-0000-7000-8000-000000000010" as SharedProjectId;
const REPLICA = "0198cf35-0000-7000-8000-000000000021" as ReplicaId;
const FILE = "0198cf35-0000-7000-8000-000000000002" as FileId;

const binding = (path = "main.tex"): DesktopSharedProjectBinding => ({
  localProjectId: "local-project",
  serverProfileId: "0198cf35-0000-7000-8000-000000000051" as ServerProfileId,
  serverInstanceId: INSTANCE,
  projectId: PROJECT,
  replicaId: REPLICA,
  fileId: FILE,
  path,
  state: "shared_active",
});

const config = (): ExperimentalRealtimeConfig => ({
  baseUrl: "http://127.0.0.1:8787",
  projectId: PROJECT,
  replicaId: REPLICA,
  fileId: FILE,
  seedFromLocalFile: false,
});

class BindingPort implements RealtimeDesktopPort {
  stored: DesktopSharedProjectBinding | null = null;
  constructor(public binding: DesktopSharedProjectBinding | null) {}
  async discoverServer() {
    return {
      serverInstanceId: INSTANCE,
      protocolVersions: [1],
      webSocketUrlTemplate: "ws://127.0.0.1:8787/v1/projects/{projectId}/sync",
      experimental: true,
    };
  }
  async authenticate() { return { kind: "local" as const }; }
  async listProfiles() { return []; }
  async devBootstrap(): Promise<never> { throw new Error("unused"); }
  async loginLocal(): Promise<void> {}
  async getBinding(): Promise<DesktopSharedProjectBinding | null> { return this.binding; }
  async storeBinding(value: DesktopSharedProjectBinding): Promise<void> { this.stored = value; }
  async openProjectSession(_input: OpenSessionInput): Promise<SessionHandle> { throw new Error("unused"); }
  async closeProjectSession(): Promise<void> {}
  subscribe(_listener: (event: RealtimeTransportEvent) => void) { return () => {}; }
  async sendEphemeralFrame(): Promise<void> { throw new Error("unused"); }
  async hydrateReplica(_identity: RealtimeBindingIdentity): Promise<never> { throw new Error("unused"); }
  async persistMutationAndSend(_input: PersistedMutation): Promise<never> { throw new Error("unused"); }
  async persistReplicaState(): Promise<void> { throw new Error("unused"); }
  async acknowledgeMutation(
    _identity: RealtimeBindingIdentity,
    _receipt: DurableReceiptV1,
  ): Promise<void> { throw new Error("unused"); }
  async materialize(_batch: MaterializationBatch): Promise<void> { throw new Error("unused"); }
}

const settleProbe = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("RealtimeRuntime authoritative binding access", () => {
  it("keeps a saved shared binding fail-closed while disconnected and after malformed setup", async () => {
    const port = new BindingPort(binding());
    const runtime = new RealtimeRuntime(port);
    runtime.observeProject("local-project");
    expect(runtime.getDocumentAccess("local-project", "main.tex").kind).toBe("shared");
    await settleProbe();
    expect(runtime.getSnapshot().connection).toBe("off");
    expect(runtime.getDocumentAccess("local-project", "main.tex").kind).toBe("shared");

    await expect(runtime.connect(
      { ...config(), projectId: "malformed" },
      "local-project",
      "main.tex",
      "source",
    )).rejects.toThrow();
    expect(runtime.getDocumentAccess("local-project", "main.tex")).toMatchObject({
      kind: "shared",
      session: null,
    });
  });

  it("treats a project as solo only after the encrypted binding probe returns none", async () => {
    const runtime = new RealtimeRuntime(new BindingPort(null));
    runtime.observeProject("solo-project");
    expect(runtime.getDocumentAccess("solo-project", "main.tex").kind).toBe("shared");
    await settleProbe();
    expect(runtime.getDocumentAccess("solo-project", "main.tex")).toEqual({ kind: "solo" });

    await expect(runtime.connect(
      { ...config(), replicaId: "not-a-uuid" },
      "solo-project",
      "main.tex",
      "source",
    )).rejects.toThrow();
    expect(runtime.getDocumentAccess("solo-project", "main.tex").kind).toBe("shared");
  });

  it("rejects a path retarget without overwriting the saved binding", async () => {
    const port = new BindingPort(binding("main.tex"));
    const runtime = new RealtimeRuntime(port);
    await expect(runtime.connect(
      config(),
      "local-project",
      "chapters/retargeted.tex",
      "source",
    )).rejects.toThrow(/path/);
    expect(port.stored).toBeNull();
    expect(port.binding?.path).toBe("main.tex");
    expect(runtime.getDocumentAccess("local-project", "main.tex").kind).toBe("shared");
  });
});
