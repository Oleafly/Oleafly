import type {
  JsonValue,
  LanguageServiceRuntimeProfile,
} from "@/lib/language-service";

type JsonObject = { readonly [key: string]: JsonValue };

const OPTION_FIRST_MINOR: ReadonlyArray<readonly [string, number]> = [
  ["formatterIndentSize", 12],
  ["lint", 13],
];

function tinymistMinor(version: string): number | null {
  const match = /^0\.(\d+)\.\d+/.exec(version.trim());
  return match ? Number(match[1]) : null;
}

export function tinymistOptionsForVersion<T extends JsonObject | null>(
  options: T,
  version: string,
): T {
  const minor = tinymistMinor(version);
  if (options === null || minor === null) return options;
  const unread = new Set(
    OPTION_FIRST_MINOR.filter(([, first]) => minor < first).map(
      ([key]) => key,
    ),
  );
  if (unread.size === 0) return options;
  return Object.fromEntries(
    Object.entries(options).filter(([key]) => !unread.has(key)),
  ) as T;
}

export function tinymistProfileForVersion(
  profile: LanguageServiceRuntimeProfile,
  version: string,
): LanguageServiceRuntimeProfile {
  if (profile.kind !== "tinymist") return profile;
  if (
    profile.version === version &&
    tinymistOptionsForVersion(profile.initializationOptions, version) ===
      profile.initializationOptions
  ) {
    return profile;
  }
  return Object.freeze({
    ...profile,
    version,
    initializationOptions: tinymistOptionsForVersion(
      profile.initializationOptions,
      version,
    ),
  });
}
