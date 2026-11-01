import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { agentListModels, type ProviderModel } from "@/lib/tauri";
import {
  describeModelListFailure,
  discoverCustomModels,
  trimEndpointPath,
  withApiVersion,
} from "./custom-provider-discovery";

vi.mock("@/lib/tauri", () => ({ agentListModels: vi.fn() }));

const mockList = vi.mocked(agentListModels);
const BONSAI: ProviderModel[] = [{ id: "Bonsai-8B-gguf", name: "Bonsai-8B-gguf", trust: "untested" }];
const discovery = enSettings.ai.customProvider.discovery;

function serve(routes: Record<string, ProviderModel[] | Error>) {
  mockList.mockImplementation(async ({ baseURL }) => {
    const answer = routes[baseURL ?? "saved"];
    if (answer === undefined) throw new Error("[provider] The provider returned 404. Not Found");
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

beforeEach(() => {
  mockList.mockReset();
});

describe("trimEndpointPath", () => {
  it("drops trailing slashes and a pasted endpoint path", () => {
    expect(trimEndpointPath(" http://localhost:13305/v1/ ")).toBe("http://localhost:13305/v1");
    expect(trimEndpointPath("http://localhost:1234/v1/chat/completions")).toBe("http://localhost:1234/v1");
    expect(trimEndpointPath("http://localhost:8080/v1/models/")).toBe("http://localhost:8080/v1");
    expect(trimEndpointPath("https://gw.example.test/v1/responses")).toBe("https://gw.example.test/v1");
  });

  it("keeps a base URL that only looks similar", () => {
    expect(trimEndpointPath("https://gw.example.test/my-models")).toBe("https://gw.example.test/my-models");
    expect(trimEndpointPath("https://gw.example.test/api/v4")).toBe("https://gw.example.test/api/v4");
  });
});

describe("withApiVersion", () => {
  it("adds /v1 to a root or an unversioned path", () => {
    expect(withApiVersion("http://localhost:13305")).toBe("http://localhost:13305/v1");
    expect(withApiVersion("http://localhost:13305/api")).toBe("http://localhost:13305/api/v1");
  });

  it("leaves a versioned path alone", () => {
    expect(withApiVersion("http://localhost:13305/v1")).toBeNull();
    expect(withApiVersion("http://localhost:13305/api/v0")).toBeNull();
    expect(withApiVersion("https://api.z.ai/api/coding/paas/v4")).toBeNull();
    expect(withApiVersion("https://generativelanguage.googleapis.com/v1beta")).toBeNull();
  });

  it("gives up on something that is not a URL", () => {
    expect(withApiVersion("localhost:13305")).toBeNull();
  });
});

describe("discoverCustomModels", () => {
  it("uses the address as given when it lists models", async () => {
    serve({ "http://localhost:13305/v1": BONSAI });

    const result = await discoverCustomModels({ providerId: "lemonade", baseURL: "http://localhost:13305/v1" });

    expect(result).toEqual({ ok: true, models: BONSAI, baseURL: "http://localhost:13305/v1" });
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it("finds a Lemonade server entered without /v1", async () => {
    serve({ "http://localhost:13305/v1": BONSAI });

    const result = await discoverCustomModels({ providerId: "lemonade", baseURL: "http://localhost:13305" });

    expect(result).toEqual({ ok: true, models: BONSAI, baseURL: "http://localhost:13305/v1" });
    expect(mockList.mock.calls.map(([args]) => args.baseURL)).toEqual([
      "http://localhost:13305",
      "http://localhost:13305/v1",
    ]);
  });

  it("does not retry when the server is not running", async () => {
    serve({ "http://localhost:13305": new Error("[transport] Could not reach the provider. refused") });

    const result = await discoverCustomModels({ providerId: "lemonade", baseURL: "http://localhost:13305" });

    expect(result).toEqual({ ok: false, failure: "unreachable", baseURL: "http://localhost:13305" });
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it("does not retry a rejected key", async () => {
    serve({ "https://gw.example.test": new Error("[auth] The provider returned 401. bad key") });

    const result = await discoverCustomModels({ providerId: "gw", baseURL: "https://gw.example.test", key: "sk-x" });

    expect(result).toEqual({ ok: false, failure: "auth", baseURL: "https://gw.example.test" });
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it("reports an empty /v1 list rather than the 404 at the root", async () => {
    serve({ "http://localhost:13305/v1": new Error("[decode] Unexpected response from the provider. the provider listed no models") });

    const result = await discoverCustomModels({ providerId: "lemonade", baseURL: "http://localhost:13305" });

    expect(result).toEqual({ ok: false, failure: "unreadable", baseURL: "http://localhost:13305/v1" });
  });

  it("reports the first failure when /v1 does not help either", async () => {
    serve({});

    const result = await discoverCustomModels({ providerId: "gw", baseURL: "https://gw.example.test" });

    expect(result).toEqual({ ok: false, failure: "rejected", baseURL: "https://gw.example.test" });
  });

  it("checks a saved address without sending it as a new endpoint", async () => {
    serve({ saved: BONSAI });

    const result = await discoverCustomModels({
      providerId: "lemonade",
      baseURL: "http://localhost:13305/v1",
      savedBaseURL: "http://localhost:13305/v1",
    });

    expect(result.ok).toBe(true);
    expect(mockList).toHaveBeenCalledWith({ providerId: "lemonade", key: undefined, baseURL: undefined });
  });
});

describe("describeModelListFailure", () => {
  it("names the address in every message", () => {
    for (const failure of ["auth", "unreachable", "rejected", "unreadable", "timeout"] as const) {
      const text = describeModelListFailure(failure, "http://localhost:13305");
      expect(text).toContain("http://localhost:13305");
      expect(text).toBe(discovery[failure].replace("{{url}}", "http://localhost:13305"));
    }
  });
});
