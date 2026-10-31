import { i18n } from "@/i18n";
import { agentErrorKind } from "@/lib/agent-backend";
import { agentListModels, type ProviderModel } from "@/lib/tauri";

export type ModelListFailure = "auth" | "unreachable" | "rejected" | "unreadable" | "timeout";

export type CustomModelDiscovery =
  | { ok: true; models: ProviderModel[]; baseURL: string }
  | { ok: false; failure: ModelListFailure; baseURL: string };

const ENDPOINT_PATHS = ["/chat/completions", "/completions", "/responses", "/models"];

export function trimEndpointPath(url: string): string {
  let base = url.trim().replace(/\/+$/, "");
  for (const path of ENDPOINT_PATHS) {
    if (base.toLowerCase().endsWith(path)) {
      base = base.slice(0, -path.length).replace(/\/+$/, "");
      break;
    }
  }
  return base;
}

/** The base with `/v1` added when its path names no API version. Lemonade,
 * LM Studio, llama.cpp and vLLM only serve their models under one. */
export function withApiVersion(baseURL: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (/\/v\d+[a-z\d]*$/i.test(parsed.pathname.replace(/\/+$/, ""))) return null;
  return `${baseURL.replace(/\/+$/, "")}/v1`;
}

export function modelListFailureOf(error: unknown): ModelListFailure {
  switch (agentErrorKind(error)) {
    case "auth":
      return "auth";
    case "transport":
      return "unreachable";
    case "timeout":
      return "timeout";
    case "decode":
      return "unreadable";
    default:
      return "rejected";
  }
}

export async function discoverCustomModels(args: {
  providerId: string;
  baseURL: string;
  savedBaseURL?: string;
  key?: string;
  tryVersioned?: boolean;
}): Promise<CustomModelDiscovery> {
  const list = (baseURL: string) =>
    agentListModels({
      providerId: args.providerId,
      key: args.key || undefined,
      baseURL: baseURL === args.savedBaseURL ? undefined : baseURL,
    });
  let failure: ModelListFailure;
  try {
    return { ok: true, models: await list(args.baseURL), baseURL: args.baseURL };
  } catch (error) {
    failure = modelListFailureOf(error);
  }
  const pathMayBeWrong = failure === "rejected" || failure === "unreadable";
  const versioned =
    args.tryVersioned !== false && pathMayBeWrong ? withApiVersion(args.baseURL) : null;
  if (!versioned) return { ok: false, failure, baseURL: args.baseURL };
  try {
    return { ok: true, models: await list(versioned), baseURL: versioned };
  } catch (error) {
    const retried = modelListFailureOf(error);
    return retried === "unreadable"
      ? { ok: false, failure: retried, baseURL: versioned }
      : { ok: false, failure, baseURL: args.baseURL };
  }
}

export function describeModelListFailure(failure: ModelListFailure, baseURL: string): string {
  const url = baseURL;
  switch (failure) {
    case "auth":
      return i18n.t(($) => $.settings.ai.customProvider.discovery.auth, { url });
    case "unreachable":
      return i18n.t(($) => $.settings.ai.customProvider.discovery.unreachable, { url });
    case "timeout":
      return i18n.t(($) => $.settings.ai.customProvider.discovery.timeout, { url });
    case "unreadable":
      return i18n.t(($) => $.settings.ai.customProvider.discovery.unreadable, { url });
    case "rejected":
      return i18n.t(($) => $.settings.ai.customProvider.discovery.rejected, { url });
  }
}
