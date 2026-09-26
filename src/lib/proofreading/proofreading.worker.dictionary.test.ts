// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingRequest,
  type ProofreadingWorkerResponse,
} from "@oleafly/editor";

const mocks = vi.hoisted(() => ({
  postMessage: vi.fn(),
  mounted: [] as string[],
  created: [] as string[],
  disposed: [] as string[],
  fetched: [] as string[],
}));

vi.mock("hunspell-asm", () => ({
  loadModule: async () => ({
    mountBuffer: (_bytes: Uint8Array, name?: string) => {
      if (name) mocks.mounted.push(name);
      return `/${name ?? "anonymous"}`;
    },
    create: (affPath: string) => {
      const locale = affPath.replace("/", "").replace(".aff", "");
      mocks.created.push(locale);
      return {
        spell: (word: string) => word === "hola",
        suggest: () => ["hola"],
        dispose: () => mocks.disposed.push(locale),
      };
    },
  }),
}));

function payload(): Uint8Array {
  return new Uint8Array([1, 2, 3]);
}

function deliver(locale: string) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        protocolVersion: PROOFREADING_PROTOCOL_VERSION,
        type: "dictionary",
        locale,
        aff: payload(),
        dic: payload(),
      },
    }),
  );
}

function request(
  requestId: number,
  dictionaryLocale: string,
  text = "hola holaa",
): ProofreadingRequest {
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "proofread",
    requestId,
    identity: {
      projectId: "project",
      path: `main-${requestId}.tex`,
      revision: requestId,
      requestGeneration: requestId,
      surface: "source",
    },
    format: "plaintext",
    mode: "spelling",
    text,
    ignoredWords: [],
    suppressions: [],
    preferences: {
      showRegionalism: true,
      showWordChoice: true,
      dialect: "american",
      dictionaryLocale,
    },
  };
}

async function analyze(
  value: ProofreadingRequest,
): Promise<ProofreadingWorkerResponse> {
  window.dispatchEvent(new MessageEvent("message", { data: value }));
  await vi.waitFor(() =>
    expect(mocks.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: value.requestId }),
    ),
  );
  return mocks.postMessage.mock.calls.find(
    ([response]) => response.requestId === value.requestId,
  )?.[0] as ProofreadingWorkerResponse;
}

beforeAll(async () => {
  mocks.postMessage.mockReset();
  vi.stubGlobal("postMessage", mocks.postMessage);
  vi.stubGlobal("fetch", async (input: URL | string) => {
    mocks.fetched.push(String(input));
    return {
      ok: true,
      arrayBuffer: async () => payload().buffer,
    } as unknown as Response;
  });
  await import("./proofreading.worker");
});

describe("worker dictionary delivery", () => {
  it("spell checks with a delivered pack instead of fetching a shipped one", async () => {
    deliver("es_ES");
    const response = await analyze(request(1, "es_ES"));

    expect(response.type).toBe("result");
    if (response.type !== "result") return;
    expect(response.status).toBe("ready");
    expect(response.activeDictionaryLocale).toBe("es_ES");
    expect(response.diagnostics).toHaveLength(1);
    expect(response.diagnostics[0]?.word).toBe("holaa");
    expect(mocks.created).toContain("es_ES");
    expect(mocks.fetched).toHaveLength(0);
  });

  it("reports an uninstalled pack instead of silently checking another language", async () => {
    const response = await analyze(request(2, "it_IT"));

    expect(response.type).toBe("error");
    if (response.type !== "error") return;
    expect(response.error.code).toBe("initialization_failed");
    expect(response.error.retryable).toBe(false);
    expect(mocks.created).not.toContain("it_IT");
  });

  it("keeps two dictionaries warm and disposes the least recently used", async () => {
    mocks.created.length = 0;
    mocks.disposed.length = 0;
    deliver("pt_BR");
    await analyze(request(3, "pt_BR", "hola holab"));
    await analyze(request(4, "es_ES", "hola holac"));
    expect(mocks.created).toEqual(["pt_BR"]);

    await analyze(request(5, "en_US", "hola holad"));
    expect(mocks.created).toEqual(["pt_BR", "en_US"]);
    expect(mocks.disposed).toEqual(["pt_BR"]);
    expect(mocks.fetched.some((url) => url.includes("en_US.dic"))).toBe(true);

    await analyze(request(6, "pt_BR", "hola holae"));
    expect(mocks.created).toEqual(["pt_BR", "en_US", "pt_BR"]);
    expect(mocks.disposed).toEqual(["pt_BR", "es_ES"]);
  });
});
