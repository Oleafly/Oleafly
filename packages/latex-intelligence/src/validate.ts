import type {
  AtSuggestion,
  CoreCatalog,
  CoreCommand,
  CoreEnvironment,
  CorpusEnvironment,
  CorpusMacro,
  Manifest,
  NameList,
  PackageCatalog,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === "number";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || isStringArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every(isStringArray);
}

function isCoreCommand(value: unknown): value is CoreCommand {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    isOptionalString(value.snippet) &&
    isOptionalString(value.detail) &&
    isOptionalString(value.documentation)
  );
}

function isCoreEnvironment(value: unknown): value is CoreEnvironment {
  return isRecord(value) && typeof value.name === "string" && isOptionalString(value.snippet);
}

export function validateCoreCatalog(value: unknown): CoreCatalog | null {
  if (
    isRecord(value) &&
    Array.isArray(value.commands) &&
    value.commands.every(isCoreCommand) &&
    Array.isArray(value.environments) &&
    value.environments.every(isCoreEnvironment)
  ) {
    return value as unknown as CoreCatalog;
  }
  return null;
}

function isCorpusMacro(value: unknown): value is CorpusMacro {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    isOptionalString(value.snippet) &&
    isOptionalString(value.detail) &&
    isOptionalString(value.documentation) &&
    isOptionalBoolean(value.unusual) &&
    isOptionalStringArray(value.keys) &&
    isOptionalNumber(value.keyPos)
  );
}

function isCorpusEnvironment(value: unknown): value is CorpusEnvironment {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    isOptionalString(value.snippet) &&
    isOptionalString(value.detail) &&
    isOptionalBoolean(value.unusual) &&
    isOptionalStringArray(value.keys) &&
    isOptionalNumber(value.keyPos)
  );
}

export function validatePackageCatalog(value: unknown): PackageCatalog | null {
  if (
    isRecord(value) &&
    isStringArray(value.deps) &&
    Array.isArray(value.macros) &&
    value.macros.every(isCorpusMacro) &&
    Array.isArray(value.envs) &&
    value.envs.every(isCorpusEnvironment) &&
    isStringArrayRecord(value.keys) &&
    isStringArray(value.args) &&
    isOptionalStringArray(value.options)
  ) {
    return value as unknown as PackageCatalog;
  }
  return null;
}

function isAtSuggestion(value: unknown): value is AtSuggestion {
  return (
    isRecord(value) &&
    typeof value.trigger === "string" &&
    typeof value.replacement === "string" &&
    isOptionalString(value.detail)
  );
}

export function validateAtSuggestions(value: unknown): AtSuggestion[] | null {
  if (Array.isArray(value) && value.every(isAtSuggestion)) {
    return value as AtSuggestion[];
  }
  return null;
}

export function validateNameList(value: unknown): NameList | null {
  if (isRecord(value) && isStringArray(value.names) && isStringRecord(value.details)) {
    return value as unknown as NameList;
  }
  return null;
}

export function validateManifest(value: unknown): Manifest | null {
  if (
    isRecord(value) &&
    typeof value.source === "string" &&
    typeof value.texlive === "string" &&
    typeof value.license === "string" &&
    typeof value.generatedBy === "string" &&
    typeof value.catalogs === "number" &&
    isStringArray(value.notices)
  ) {
    return value as unknown as Manifest;
  }
  return null;
}
