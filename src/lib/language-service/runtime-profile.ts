import languageServerManifest from "../../../scripts/language-servers/manifest.json";
import {
  isJsonValue,
  type JsonValue,
} from "./json-rpc";
import type { LanguageServiceKind } from "./transport";

export interface LanguageServiceRuntimeProfile {
  kind: LanguageServiceKind;
  version: string;
  args: readonly string[];
  initializationOptions: { readonly [key: string]: JsonValue } | null;
  didChangeConfiguration: {
    readonly settings: { readonly [key: string]: JsonValue };
  } | null;
}

const isRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort((a, b) => Number(a > b) - Number(a < b));
  const sortedExpected = [...expected].sort((a, b) => Number(a > b) - Number(a < b));
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function jsonObject(
  value: unknown,
): { readonly [key: string]: JsonValue } | null {
  return isRecord(value) && isJsonValue(value)
    ? (structuredClone(value) as {
        readonly [key: string]: JsonValue;
      })
    : null;
}

/**
 * The packaged manifest is the single production source of server arguments
 * and handshake settings. This parser validates the complete runtime-profile
 * shape and refuses to synthesize defaults: a malformed or partially packaged
 * profile cannot silently re-enable a server's build/export behavior.
 */
export function parseLanguageServiceRuntimeProfile(
  manifest: unknown,
  kind: LanguageServiceKind,
): LanguageServiceRuntimeProfile {
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== 1 ||
    !isRecord(manifest.servers)
  ) {
    throw new Error("Language-server manifest schema is invalid");
  }
  const server = manifest.servers[kind];
  if (
    !isRecord(server) ||
    typeof server.version !== "string" ||
    server.version.trim().length === 0 ||
    !isRecord(server.lsp) ||
    !exactKeys(server.lsp, [
      "args",
      "helpArgs",
      "initializationOptions",
      "didChangeConfiguration",
    ]) ||
    !Array.isArray(server.lsp.args) ||
    server.lsp.args.length === 0 ||
    !server.lsp.args.every(
      (argument) =>
        typeof argument === "string" && argument.length > 0,
    ) ||
    !Array.isArray(server.lsp.helpArgs) ||
    !server.lsp.helpArgs.every(
      (argument) =>
        typeof argument === "string" && argument.length > 0,
    )
  ) {
    throw new Error(`Language-server profile for ${kind} is invalid`);
  }

  const initializationOptions =
    server.lsp.initializationOptions === null
      ? null
      : jsonObject(server.lsp.initializationOptions);
  if (
    server.lsp.initializationOptions !== null &&
    initializationOptions === null
  ) {
    throw new Error(
      `Language-server initialization options for ${kind} are invalid`,
    );
  }

  let didChangeConfiguration: LanguageServiceRuntimeProfile["didChangeConfiguration"] =
    null;
  if (server.lsp.didChangeConfiguration !== null) {
    const configuration = server.lsp.didChangeConfiguration;
    if (
      !isRecord(configuration) ||
      !exactKeys(configuration, ["settings"])
    ) {
      throw new Error(
        `Language-server configuration profile for ${kind} is invalid`,
      );
    }
    const settings = jsonObject(configuration.settings);
    if (!settings) {
      throw new Error(
        `Language-server configuration settings for ${kind} are invalid`,
      );
    }
    didChangeConfiguration = { settings };
  }

  return Object.freeze({
    kind,
    version: server.version,
    args: Object.freeze([...server.lsp.args] as string[]),
    initializationOptions,
    didChangeConfiguration,
  });
}

export function getLanguageServiceRuntimeProfile(
  kind: LanguageServiceKind,
): LanguageServiceRuntimeProfile {
  return parseLanguageServiceRuntimeProfile(
    languageServerManifest,
    kind,
  );
}
